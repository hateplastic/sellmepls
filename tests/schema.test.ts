import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
let db: PGlite;
const seller = "00000000-0000-4000-8000-000000000001",
  buyer = "00000000-0000-4000-8000-000000000002",
  outsider = "00000000-0000-4000-8000-000000000003",
  product = "00000000-0000-4000-8000-000000000004",
  order = "00000000-0000-4000-8000-000000000005";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;",
  );
  await db.exec(readFileSync("schema.sql", "utf8"));
  await db.exec(
    `insert into auth.users values ('${seller}'),('${buyer}'),('${outsider}');insert into public.users(id) select id from auth.users;insert into public.products(id,seller_id,title,description,prices,preview_key,file_name,file_size) values ('${product}','${seller}','Test product','A complete digital file','[{"asset":"base:USDC","amount":"1"}]','previews/p.webp','file.zip',100);insert into public.product_files values ('${product}','private/secret','checksum');`,
  );
  await db.query(
    "insert into public.sales(id,product_id,seller_id,buyer_id,buyer_wallet,seller_wallet,platform_wallet,asset,network,amount,fee,fixed_fee,router) values ($1,$2,$3,$4,'buyer','seller','platform','base:USDC','base','1000000','550000','500000','router')",
    [order, product, seller, buyer],
  );
});
afterAll(async () => {
  await db.close();
});
async function asUser<T>(role: string, user: string, fn: () => Promise<T>) {
  await db.exec(`set role ${role};set request.jwt.claim.sub='${user}';`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;reset request.jwt.claim.sub;");
  }
}
describe("PostgreSQL RLS and settlement", () => {
  it("lets anonymous users read active products", async () => {
    const r = await asUser("anon", "", () =>
      db.query("select id from public.products"),
    );
    expect(r.rows).toHaveLength(1);
  });
  it("denies private object keys even to the seller", async () => {
    await expect(
      asUser("authenticated", seller, () =>
        db.query("select * from public.product_files"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("denies direct insertion of paid sales", async () => {
    await expect(
      asUser("authenticated", buyer, () =>
        db.query("insert into public.sales default values"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("denies settlement RPC to the buyer", async () => {
    await expect(
      asUser("authenticated", buyer, () =>
        db.query("select public.complete_sale($1,'hash','10',now())", [order]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("isolates sales to the buyer and seller", async () => {
    const own = await asUser("authenticated", buyer, () =>
      db.query("select * from public.sales"),
    );
    const foreign = await asUser("authenticated", outsider, () =>
      db.query("select * from public.sales"),
    );
    expect(own.rows).toHaveLength(1);
    expect(foreign.rows).toHaveLength(0);
  });
  it("settles atomically and idempotently", async () => {
    await db.query("select public.complete_sale($1,'hash','10',now())", [
      order,
    ]);
    await db.query("select public.complete_sale($1,'hash','10',now())", [
      order,
    ]);
    const r = await db.query<{ net: string; count: number }>(
      "select * from public.seller_totals($1)",
      [seller],
    );
    expect(r.rows[0].net).toBe("450000");
    expect(Number(r.rows[0].count)).toBe(1);
  });
  it("rejects reuse of the same chain transaction for another order", async () => {
    const another = crypto.randomUUID();
    await db.query(
      "insert into public.sales(id,product_id,seller_id,buyer_id,buyer_wallet,seller_wallet,platform_wallet,asset,network,amount,fee,fixed_fee,router) select $1,product_id,seller_id,buyer_id,buyer_wallet,seller_wallet,platform_wallet,asset,network,amount,fee,fixed_fee,router from public.sales where id=$2",
      [another, order],
    );
    await expect(
      db.query("select public.complete_sale($1,'hash','10',now())", [another]),
    ).rejects.toThrow(/duplicate key/);
  });
  it("uses a shared atomic rate limit", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.query<{ consume_rate_limit: boolean }>(
          "select public.consume_rate_limit('test',3,60)",
        ),
      ),
    );
    expect(results.filter((r) => r.rows[0].consume_rate_limit)).toHaveLength(3);
  });
  it("creates only one order for concurrent checkout requests", async () => {
    const payload = {
      product_id: product,
      seller_id: seller,
      buyer_id: outsider,
      buyer_wallet: "buyer",
      seller_wallet: "seller",
      platform_wallet: "platform",
      asset: "base:USDC",
      network: "base",
      amount: "1000000",
      fee: "550000",
      fixed_fee: "500000",
      router: "router",
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        db.query<{ id: string }>("select (public.create_order($1::jsonb)).id", [
          JSON.stringify(payload),
        ]),
      ),
    );
    expect(new Set(results.map((r) => r.rows[0].id)).size).toBe(1);
  });
  it("returns a paid order even when another asset is selected", async () => {
    const payload = {
      product_id: product,
      seller_id: seller,
      buyer_id: buyer,
      buyer_wallet: "buyer",
      seller_wallet: "seller",
      platform_wallet: "platform",
      asset: "arbitrum:USDC",
      network: "arbitrum",
      amount: "1000000",
      fee: "550000",
      fixed_fee: "500000",
      router: "router",
    };
    const result = await db.query<{ id: string }>(
      "select (public.create_order($1::jsonb)).id",
      [JSON.stringify(payload)],
    );
    expect(result.rows[0].id).toBe(order);
  });
  it("does not allow unpaid users to create reviews", async () => {
    await expect(
      db.query(
        "select public.save_review($1,$2,5,'A review without a purchase')",
        [outsider, product],
      ),
    ).rejects.toThrow(/verified purchase/);
  });
  it("keeps one verified review per buyer and product", async () => {
    await db.query(
      "select public.save_review($1,$2,5,'The course is very useful')",
      [buyer, product],
    );
    await db.query(
      "select public.save_review($1,$2,4,'Updated after completing the course')",
      [buyer, product],
    );
    const r = await db.query<{ rating: string; reviews: number }>(
      "select * from public.seller_reputation($1)",
      [seller],
    );
    expect(Number(r.rows[0].rating)).toBe(4);
    expect(Number(r.rows[0].reviews)).toBe(1);
  });
  it("denies forged reviews and affiliate links from the browser", async () => {
    await expect(
      asUser("authenticated", outsider, () =>
        db.query("insert into public.reviews default values"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser("authenticated", outsider, () =>
        db.query("select public.save_review($1,$2,5,'Forged review text')", [
          buyer,
          product,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser("authenticated", outsider, () =>
        db.query("insert into public.affiliate_links default values"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("counts affiliate payouts once and subtracts them from seller income", async () => {
    const link = crypto.randomUUID(),
      sale = crypto.randomUUID();
    await db.query(
      "insert into public.affiliate_links(id,code,user_id,seller_id,product_id) values($1,'abcdefghijklmnop',$2,$3,$4)",
      [link, outsider, seller, product],
    );
    await db.query(
      "insert into public.sales(id,product_id,seller_id,buyer_id,buyer_wallet,seller_wallet,platform_wallet,asset,network,amount,fee,fixed_fee,affiliate_amount,affiliate_wallet,affiliate_id,affiliate_link_id,affiliate_bps) values($1,$2,$3,$4,'buyer','seller','platform','base:USDC','base','10000000','1000000','500000','1000000','affiliate',$5,$6,1000)",
      [sale, product, seller, buyer, outsider, link],
    );
    await db.query(
      "select public.complete_sale($1,'affiliate-hash','20',now())",
      [sale],
    );
    await db.query(
      "select public.complete_sale($1,'affiliate-hash','20',now())",
      [sale],
    );
    const totals = await db.query<{ earned: string; count: number }>(
      "select * from public.affiliate_totals($1)",
      [outsider],
    );
    expect(totals.rows[0].earned).toBe("1000000");
    expect(Number(totals.rows[0].count)).toBe(1);
    const income = await db.query<{ net: string }>(
      "select * from public.seller_totals($1)",
      [seller],
    );
    expect(income.rows[0].net).toBe("8450000");
    const visitor = "a".repeat(64);
    await db.query(
      "insert into public.affiliate_clicks(link_id,visitor_hash) values($1,$2) on conflict do nothing",
      [link, visitor],
    );
    await db.query(
      "insert into public.affiliate_clicks(link_id,visitor_hash) values($1,$2) on conflict do nothing",
      [link, visitor],
    );
    const metrics = await db.query<{
      clicks: number;
      leads: number;
      conversions: number;
    }>("select * from public.affiliate_metrics($1)", [outsider]);
    expect(Number(metrics.rows[0].clicks)).toBe(1);
    expect(Number(metrics.rows[0].leads)).toBe(1);
    expect(Number(metrics.rows[0].conversions)).toBe(1);
    const rows = await asUser("authenticated", outsider, () =>
      db.query("select id from public.sales where id=$1", [sale]),
    );
    expect(rows.rows).toHaveLength(0);
  });
  it("rejects duplicate campaigns including storefront links with null product", async () => {
    await db.query(
      "insert into public.affiliate_links(code,user_id,seller_id) values('storefrontcode111',$1,$2)",
      [outsider, seller],
    );
    await expect(
      db.query(
        "insert into public.affiliate_links(code,user_id,seller_id) values('storefrontcode222',$1,$2)",
        [outsider, seller],
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});
