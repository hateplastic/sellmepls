import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { catalogFilters, catalogHref } from "../lib/catalog-search";
import { platformFee } from "../lib/pricing";
import { split, type AssetId } from "../lib/catalog";
let db: PGlite;
const seller = crypto.randomUUID(),
  buyer = crypto.randomUUID();
let cheap: string, expensive: string, native: string, hidden: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;",
  );
  await db.exec(readFileSync("schema.sql", "utf8"));
  for (const id of [seller, buyer]) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query("insert into users(id) values($1)", [id]);
  }
  cheap = await product("Alpha парсер Telegram", "software", [
    { asset: "base:USDC", amount: "1" },
  ]);
  expensive = await product("Beta парсер телеграм", "software", [
    { asset: "solana:USDC", amount: "20" },
    { asset: "base:USDC", amount: "8" },
  ]);
  native = await product("Gamma парсер TG", "code", [
    { asset: "base:ETH", amount: "0.002" },
  ]);
  hidden = await product("Hidden парсер тг", "software", [
    { asset: "base:USDC", amount: "0.5" },
  ]);
  await db.query("update products set is_hidden=true where id=$1", [hidden]);
  await review(cheap, 3, "mainnet");
  await review(expensive, 5, "mainnet");
  await review(native, 1, "testnet");
});
afterAll(async () => {
  await db.close();
});
async function product(title: string, category: string, prices: unknown[]) {
  const id = crypto.randomUUID();
  await db.query(
    "insert into products(id,seller_id,title,description,category,prices,preview_key,file_name,file_size) values($1,$2,$3,'Useful automation course',$4,$5,'previews/test.webp','file.zip',100)",
    [id, seller, title, category, JSON.stringify(prices)],
  );
  return id;
}
async function review(id: string, rating: number, environment: string) {
  const sale = crypto.randomUUID();
  await db.query(
    "insert into sales(id,product_id,seller_id,buyer_id,buyer_wallet,seller_wallet,platform_wallet,asset,network,amount,fee,fixed_fee,chain_environment,status,tx_hash,paid_at,block_number) values($1,$2,$3,$4,'buyer','seller','platform','base:USDC','base','10000000','1000000','500000',$5,'paid',$6,now(),'1')",
    [sale, id, seller, buyer, environment, crypto.randomUUID()],
  );
  await db.query(
    "insert into reviews(product_id,author_id,sale_id,rating,body) values($1,$2,$3,$4,'Verified review fixture')",
    [id, buyer, sale, rating],
  );
}
type Row = {
  product: { id: string };
  price_usd: string | number | null;
  rating: string | number | null;
  review_count: number;
  total_count: number;
};
async function search(
  query = "парсер тг",
  category = "",
  sort = "newest",
  offset = 0,
  eth: number | null = 2500,
) {
  return (
    await db.query<Row>(
      "select * from search_catalog($1,$2,$3,$4,'mainnet',$5,100)",
      [query, category, sort, offset, eth],
    )
  ).rows;
}
it("combines multi-word prefix search, Telegram synonyms, categories and moderation", async () => {
  expect(
    (await search("пАРс ТГ", "software", "title_asc")).map((r) => r.product.id),
  ).toEqual([cheap, expensive]);
  expect(
    (await search("telegram парсер")).map((r) => r.product.id).sort(),
  ).toEqual([cheap, expensive, native].sort());
  expect(await search("' | ! &:* <script>")).toEqual([]);
  expect(await search("%%%")).toEqual([]);
});
it("orders all products by comparable USD prices, using the cheapest accepted price", async () => {
  expect(
    (await search("парсер тг", "", "price_asc")).map((r) => r.product.id),
  ).toEqual([cheap, native, expensive]);
  expect(
    (await search("парсер тг", "", "price_desc")).map((r) => r.product.id),
  ).toEqual([expensive, native, cheap]);
  const missing = await search("парсер тг", "", "price_desc", 0, null);
  expect(missing.at(-1)?.product.id).toBe(native);
  expect(missing.at(-1)?.price_usd).toBeNull();
});
it("uses only verified reviews from the current chain environment", async () => {
  const rated = await search("парсер тг", "", "rating");
  expect(rated.map((r) => r.product.id)).toEqual([expensive, cheap, native]);
  expect(Number(rated[0].rating)).toBe(5);
  expect(Number(rated[2].review_count)).toBe(0);
});
it("sorts before pagination and keeps filters in navigation links", async () => {
  for (let i = 0; i < 15; i++)
    await product(`Paged ${String(i).padStart(2, "0")}`, "ebooks", [
      { asset: "base:USDC", amount: String(20 - i) },
    ]);
  const first = await search("paged", "ebooks", "price_asc"),
    next = await search("paged", "ebooks", "price_asc", 12);
  expect(first).toHaveLength(13);
  expect(next).toHaveLength(3);
  expect(Number(first[0].total_count)).toBe(15);
  expect(Number(first[0].price_usd)).toBe(6);
  expect(Number(next[0].price_usd)).toBe(18);
  const filters = catalogFilters({
    q: "  парсер   тг  ",
    category: "software",
    sort: "price_asc",
    page: "2",
  });
  expect(decodeURIComponent(catalogHref(filters, 3))).toContain(
    "category=software&sort=price_asc&page=3#market",
  );
  expect(catalogFilters({ sort: "__proto__", page: "-9" }).sort).toBe("newest");
});
it("does not expose the service search RPC to browser database roles", async () => {
  await db.exec("set role anon");
  try {
    await expect(db.query("select * from search_catalog()")).rejects.toThrow(
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});
it.each([
  ["base:USDC", "2499999", "1"],
  ["base:USDC", "2500000", "1"],
  ["solana:USDC", "4999999", "1"],
  ["base:ETH", "1000000000000000", "2500"],
  ["base:ETH", "2000000000000000", "3000.00000001"],
  ["solana:SOL", "24999999", "100"],
  ["solana:SOL", "25000000", "100"],
])(
  "enforces the exact new commission in PostgreSQL for %s %s",
  async (asset, amount, rate) => {
    const id = await product("Fee boundary test", "other", [
      { asset, amount: "1" },
    ]);
    const commission = platformFee(BigInt(amount), asset as AssetId, rate),
      parts = split(BigInt(amount), commission.fixedFee, 0, commission.feeBps);
    const sale = {
      product_id: id,
      seller_id: seller,
      buyer_id: buyer,
      buyer_wallet: "buyer",
      seller_wallet: "seller",
      platform_wallet: "platform",
      asset,
      network: asset.split(":")[0],
      amount,
      fee: parts.fee.toString(),
      fixed_fee: commission.fixedFee.toString(),
      fee_bps: commission.feeBps,
      commission_version: 2,
      usd_rate: rate,
    };
    await expect(
      db.query("select public.create_order($1)", [
        JSON.stringify({ ...sale, fee: String(parts.fee + 1n) }),
      ]),
    ).rejects.toThrow(/sales_fee_formula/);
    const saved = await db.query<{ fee: string; fee_bps: number }>(
      "select fee,fee_bps from public.create_order($1)",
      [JSON.stringify(sale)],
    );
    expect(saved.rows[0]).toEqual({
      fee: parts.fee.toString(),
      fee_bps: commission.feeBps,
    });
  },
);
it("rejects a lower-price tariff forged for a $5 item, including a forged stablecoin rate", async () => {
  const id = await product("Forged fee test", "other", [
    { asset: "base:USDC", amount: "5" },
  ]);
  const sale = {
    product_id: id,
    seller_id: seller,
    buyer_id: buyer,
    buyer_wallet: "buyer",
    seller_wallet: "seller",
    platform_wallet: "platform",
    asset: "base:USDC",
    network: "base",
    amount: "5000000",
    fee: "500000",
    fixed_fee: "0",
    fee_bps: 1000,
    commission_version: 2,
    usd_rate: "1",
  };
  await expect(
    db.query("select public.create_order($1)", [JSON.stringify(sale)]),
  ).rejects.toThrow(/sales_commission_rules/);
  await expect(
    db.query("select public.create_order($1)", [
      JSON.stringify({ ...sale, usd_rate: "0.1" }),
    ]),
  ).rejects.toThrow(/sales_commission_rules/);
});
