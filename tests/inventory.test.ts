import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { parseInventory, sealUnit, openUnit } from "../lib/inventory-format";
import { platformFee } from "../lib/pricing";
import { split, type Sale } from "../lib/catalog";

const secret = "a7".repeat(32);
describe("TXT inventory", () => {
  it("reads BOM, CRLF, ignores blank lines and preserves credentials exactly", () => {
    expect(
      parseInventory(
        Buffer.from("\uFEFFlogin:pass\r\n\r\n  secret with spaces  \nключ"),
      ),
    ).toEqual(["login:pass", "  secret with spaces  ", "ключ"]);
  });
  it.each([
    Buffer.from(""),
    Buffer.from([255, 254, 1]),
    Buffer.from("hello\0world"),
    Buffer.from("duplicate\nduplicate"),
    Buffer.from("x".repeat(4097)),
    Buffer.from(Array.from({ length: 10001 }, (_, i) => String(i)).join("\n")),
  ])("rejects malformed or excessive input %#", (bytes) =>
    expect(() => parseInventory(bytes)).toThrow(),
  );
  it("encrypts content with authenticated product binding and random IVs", () => {
    const a = sealUnit("secret:password", "product-a", secret),
      b = sealUnit("secret:password", "product-a", secret);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(openUnit(a, "product-a", secret)).toBe("secret:password");
    expect(() => openUnit(a, "product-b", secret)).toThrow();
    expect(() => openUnit(a, "product-a", "b8".repeat(32))).toThrow();
  });
});

let db: PGlite;
const seller = crypto.randomUUID(),
  buyer = crypto.randomUUID(),
  other = crypto.randomUUID();
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;",
  );
  await db.exec(readFileSync("schema.sql", "utf8"));
  for (const id of [seller, buyer, other]) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("insert into users(id) values($1)", [id]);
  }
});
afterAll(async () => db.close());
async function product(count = 5) {
  const id = crypto.randomUUID();
  await db.query(
    "insert into products(id,seller_id,title,description,prices,preview_key,file_name,file_size,delivery_mode) values($1,$2,'License keys','A unique key on each line','[{\"asset\":\"solana:USDC\",\"amount\":\"0.1\"}]','preview.webp','batch.txt',100,'stock')",
    [id, seller],
  );
  await db.query("select insert_inventory($1,$2)", [
    id,
    JSON.stringify(
      Array.from({ length: count }, (_, i) => sealUnit(`key-${i}`, id, secret)),
    ),
  ]);
  return id;
}
function payload(
  id: string,
  quantity: number,
  user = buyer,
  checkout = crypto.randomUUID(),
) {
  const amount = BigInt(quantity) * 100000n,
    commission = platformFee(amount, "solana:USDC", "1"),
    parts = split(amount, commission.fixedFee, 0, commission.feeBps);
  return {
    product_id: id,
    seller_id: seller,
    buyer_id: user,
    buyer_wallet: user,
    seller_wallet: seller,
    platform_wallet: "platform",
    asset: "solana:USDC",
    network: "solana",
    amount: String(amount),
    unit_amount: "100000",
    quantity,
    checkout_key: checkout,
    fee: String(parts.fee),
    fixed_fee: String(commission.fixedFee),
    fee_bps: commission.feeBps,
    commission_version: 2,
    usd_rate: "1",
    rate_quoted_at: new Date().toISOString(),
    chain_environment: "testnet",
    product_revision: 0,
  };
}
async function order(input: ReturnType<typeof payload>) {
  return (
    await db.query<Sale>("select (create_order($1)).*", [JSON.stringify(input)])
  ).rows[0];
}
async function counts(id: string) {
  return (
    await db.query<{
      value: { available: number; reserved: number; sold: number };
    }>("select inventory_counts($1) as value", [id])
  ).rows[0].value;
}
async function paid(s: Sale, hash = crypto.randomUUID()) {
  return db.query("select complete_sale($1,$2,'123',now())", [s.id, hash]);
}

describe("Stock transactions and isolation", () => {
  it("reserves exact quantity, reuses retries and prevents over-selling", async () => {
    const id = await product(5),
      input = payload(id, 3),
      a = await order(input);
    expect(a.quantity).toBe(3);
    expect(a.unit_amount).toBe("100000");
    expect(a.amount).toBe("300000");
    expect((await order(input)).id).toBe(a.id);
    expect(
      (await order({ ...input, checkout_key: crypto.randomUUID() })).id,
    ).toBe(a.id);
    expect(await counts(id)).toEqual({ available: 2, reserved: 3, sold: 0 });
    await expect(order(payload(id, 3, other))).rejects.toThrow(
      /inventory_insufficient/,
    );
    const b = await order(payload(id, 2, other));
    expect(await counts(id)).toEqual({ available: 0, reserved: 5, sold: 0 });
    const units = await db.query<{ sale_id: string }>(
      "select sale_id from inventory_units where product_id=$1",
      [id],
    );
    expect(units.rows.filter((u) => u.sale_id === a.id)).toHaveLength(3);
    expect(units.rows.filter((u) => u.sale_id === b.id)).toHaveLength(2);
  });
  it("applies one platform fee to the total, not to each unit", async () => {
    const id = await product(40),
      a = await order(payload(id, 30));
    expect(a.amount).toBe("3000000");
    expect(a.fee).toBe("650000");
    expect(a.fee_bps).toBe(500);
    expect(a.fixed_fee).toBe("500000");
  });
  it("allows repeat purchases after payment and never reassigns delivered units", async () => {
    const id = await product(4),
      a = await order(payload(id, 2)),
      hash = crypto.randomUUID();
    await paid(a, hash);
    await paid(a, hash);
    await expect(paid(a, "different")).rejects.toThrow(/already paid/);
    const b = await order(payload(id, 2));
    expect(b.id).not.toBe(a.id);
    expect(await counts(id)).toEqual({ available: 0, reserved: 2, sold: 2 });
    expect(
      (
        await db.query<{ release_inventory: boolean }>(
          "select release_inventory($1)",
          [a.id],
        )
      ).rows[0].release_inventory,
    ).toBe(false);
  });
  it("expires only pending reservations and rejects fulfillment after release", async () => {
    const id = await product(2),
      a = await order(payload(id, 2));
    expect(
      (
        await db.query<{ release_inventory: boolean }>(
          "select release_inventory($1)",
          [a.id],
        )
      ).rows[0].release_inventory,
    ).toBe(false);
    await db.query(
      "update sales set created_at=now()-interval '12 minutes',expires_at=now()-interval '2 minutes' where id=$1",
      [a.id],
    );
    expect(
      (
        await db.query<{ release_inventory: boolean }>(
          "select release_inventory($1)",
          [a.id],
        )
      ).rows[0].release_inventory,
    ).toBe(true);
    expect(await counts(id)).toEqual({ available: 2, reserved: 0, sold: 0 });
    await expect(paid(a)).rejects.toThrow(/reservation_released/);
    expect((await order(payload(id, 2))).id).not.toBe(a.id);
  });
  it("uses compare-and-set against an in-flight payment preparation", async () => {
    const id = await product(1),
      a = await order(payload(id, 1, other));
    await db.query("select arm_inventory_payment($1,100,'blockhash',90)", [
      a.id,
    ]);
    await db.query(
      "update sales set created_at=now()-interval '12 minutes',expires_at=now()-interval '2 minutes' where id=$1",
      [a.id],
    );
    expect(
      (
        await db.query<{ release_inventory: boolean }>(
          "select release_inventory($1)",
          [a.id],
        )
      ).rows[0].release_inventory,
    ).toBe(false);
    expect(await counts(id)).toEqual({ available: 0, reserved: 1, sold: 0 });
    expect(
      (
        await db.query<{ arm_inventory_payment: boolean }>(
          "select arm_inventory_payment($1,101,'another',91)",
          [a.id],
        )
      ).rows[0].arm_inventory_payment,
    ).toBe(false);
  });
  it("deduplicates across restocks, including sold inventory", async () => {
    const id = await product(1),
      a = await order(payload(id, 1, other));
    await paid(a);
    await expect(
      db.query("select insert_inventory($1,$2)", [
        id,
        JSON.stringify([sealUnit("key-0", id, secret)]),
      ]),
    ).rejects.toThrow(/inventory_duplicates/);
    expect(
      (
        await db.query<{ insert_inventory: number }>(
          "select insert_inventory($1,$2)",
          [
            id,
            JSON.stringify([
              sealUnit("key-0", id, secret),
              sealUnit("new-key", id, secret),
            ]),
          ],
        )
      ).rows[0].insert_inventory,
    ).toBe(1);
    expect(await counts(id)).toEqual({ available: 1, reserved: 0, sold: 1 });
  });
  it("never exposes stock secrets or reservation mutators through browser roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.query("select * from inventory_units")).rejects.toThrow(
          /permission denied/,
        );
        await expect(
          db.query("select release_inventory($1)", [crypto.randomUUID()]),
        ).rejects.toThrow(/permission denied/);
        await expect(
          db.query("select insert_inventory($1,'[]')", [crypto.randomUUID()]),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
  });
});
