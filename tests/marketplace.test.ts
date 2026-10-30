import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
let db: PGlite;
const seller = crypto.randomUUID(),
  buyer = crypto.randomUUID(),
  outsider = crypto.randomUUID();
const bootstrap =
  "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(bootstrap);
  await db.exec(readFileSync("schema.sql", "utf8"));
  for (const id of [seller, buyer, outsider]) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("insert into public.users(id) values($1)", [id]);
  }
});
afterAll(async () => {
  await db.close();
});
describe("Moderation and RLS", () => {
  it("enables RLS on every application table", async () => {
    const result = await db.query(
      "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and not relrowsecurity",
    );
    expect(result.rows).toEqual([]);
  });
  it("hides moderated products from anon while keeping owner access and an audit record", async () => {
    const id = await product();
    await db.query(
      "select public.moderate_product($1,$2,true,'Safety review')",
      [outsider, id],
    );
    await db.exec("set role anon");
    try {
      expect(
        (await db.query("select id from products where id=$1", [id])).rows,
      ).toEqual([]);
    } finally {
      await db.exec("reset role");
    }
    await db.exec(
      `set role authenticated;set request.jwt.claim.sub='${seller}'`,
    );
    try {
      expect(
        (await db.query("select id from products where id=$1", [id])).rows,
      ).toHaveLength(1);
      await expect(
        db.query("update products set is_hidden=false where id=$1", [id]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("select public.moderate_product($1,$2,false,'Owner bypass')", [
          seller,
          id,
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from moderation_events")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.exec("reset role;reset request.jwt.claim.sub");
    }
    expect(
      (
        await db.query("select * from moderation_events where product_id=$1", [
          id,
        ])
      ).rows,
    ).toHaveLength(1);
    await expect(
      db.query("select public.start_conversation($1,$2)", [buyer, id]),
    ).rejects.toThrow(/product_unavailable/);
  });
  it("keeps reports private and forbids browser writes to protected tables", async () => {
    const id = await product();
    await db.query(
      "insert into product_reports(product_id,reporter_id,reason,details) values($1,$2,'malware','Suspicious file content')",
      [id, buyer],
    );
    await db.exec(
      `set role authenticated;set request.jwt.claim.sub='${outsider}'`,
    );
    try {
      expect((await db.query("select * from product_reports")).rows).toEqual(
        [],
      );
      for (const table of [
        "products",
        "users",
        "sales",
        "conversations",
        "messages",
        "product_reports",
      ])
        await expect(
          db.query(`insert into ${table} default values`),
        ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role;reset request.jwt.claim.sub");
    }
  });
});
describe("Product gallery access and atomicity", () => {
  it("saves owned images and video, and removes them without changing the product ID", async () => {
    const id = await product(),
      image = await upload(seller, "preview");
    await db.query("select public.set_product_media($1,$2,'{}',$3,$4,$5)", [
      seller,
      id,
      [image],
      ["previews/gallery.webp"],
      "dQw4w9WgXcQ",
    ]);
    const saved = await db.query<{
      gallery_keys: string[];
      youtube_id: string;
    }>("select gallery_keys,youtube_id from products where id=$1", [id]);
    expect(saved.rows[0]).toEqual({
      gallery_keys: ["previews/gallery.webp"],
      youtube_id: "dQw4w9WgXcQ",
    });
    await db.query(
      "select public.set_product_media($1,$2,'{}','{}','{}',null)",
      [seller, id],
    );
    expect(
      (
        await db.query<{ gallery_keys: string[] }>(
          "select gallery_keys from products where id=$1",
          [id],
        )
      ).rows[0].gallery_keys,
    ).toEqual([]);
  });
  it("rejects foreign uploads, foreign products and fabricated retained keys", async () => {
    const id = await product(),
      image = await upload(outsider, "preview");
    await expect(
      db.query("select public.set_product_media($1,$2,'{}',$3,$4,null)", [
        seller,
        id,
        [image],
        ["foreign.webp"],
      ]),
    ).rejects.toThrow(/invalid_gallery_upload/);
    await expect(
      db.query("select public.set_product_media($1,$2,'{}','{}','{}',null)", [
        outsider,
        id,
      ]),
    ).rejects.toThrow(/product_not_owned/);
    await expect(
      db.query("select public.set_product_media($1,$2,$3,'{}','{}',null)", [
        seller,
        id,
        ["other-product.webp"],
      ]),
    ).rejects.toThrow(/invalid_gallery/);
  });
  it("rejects reused uploads and duplicate entries", async () => {
    const id = await product(),
      image = await upload(seller, "preview");
    await expect(
      db.query("select public.set_product_media($1,$2,'{}',$3,$4,null)", [
        seller,
        id,
        [image, image],
        ["one", "two"],
      ]),
    ).rejects.toThrow(/invalid_gallery/);
    await db.query("select public.set_product_media($1,$2,'{}',$3,$4,null)", [
      seller,
      id,
      [image],
      ["one"],
    ]);
    await expect(
      db.query("select public.set_product_media($1,$2,'{}',$3,$4,null)", [
        seller,
        id,
        [image],
        ["two"],
      ]),
    ).rejects.toThrow(/invalid_gallery_upload/);
  });
  it("rolls back metadata edits if gallery validation fails", async () => {
    const id = await product();
    await expect(
      db.query(
        "select public.edit_product_v2($1,$2,0,'Changed title','Changed description','[{\"asset\":\"base:USDC\",\"amount\":\"20\"}]',false,1000,null,null,null,null,'courses',$3,'{}','{}',null)",
        [seller, id, ["forged"]],
      ),
    ).rejects.toThrow(/invalid_gallery/);
    expect(
      (
        await db.query<{ title: string; revision: number }>(
          "select title,revision from products where id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ title: "Course ZIP", revision: 0 });
  });
});
describe("Payment environment isolation", () => {
  it("creates independent testnet and mainnet orders, reuses only the matching environment", async () => {
    const id = await product();
    const input = {
      product_id: id,
      seller_id: seller,
      buyer_id: buyer,
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
    const create = async (env: string) =>
      (
        await db.query<{ id: string }>(
          "select id from public.create_order($1::jsonb)",
          [JSON.stringify({ ...input, chain_environment: env })],
        )
      ).rows[0].id;
    const test = await create("testnet"),
      main = await create("mainnet");
    expect(main).not.toBe(test);
    expect(await create("testnet")).toBe(test);
    expect(await create("mainnet")).toBe(main);
  });
  it("does not expose or let browser users change the contract registry", async () => {
    await db.exec("set role authenticated");
    try {
      await expect(db.query("select * from payment_routers")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query("insert into payment_routers default values"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
});
async function product() {
  const id = crypto.randomUUID();
  await db.query(
    "insert into public.products(id,seller_id,title,description,prices,preview_key,file_name,file_size) values($1,$2,'Course ZIP','Complete course materials','[{\"asset\":\"base:USDC\",\"amount\":\"10\"}]','previews/original.webp','original.zip',100)",
    [id, seller],
  );
  await db.query("insert into public.product_files values($1,$2,'old-hash')", [
    id,
    `private/${id}`,
  ]);
  return id;
}
async function upload(owner: string, kind: "file" | "preview" = "file") {
  const id = crypto.randomUUID();
  await db.query(
    "insert into public.uploads(id,user_id,kind,object_key,filename,content_type,bytes,checksum) values($1,$2,$3,$4,$5,'application/octet-stream',200,'new-hash')",
    [
      id,
      owner,
      kind,
      `uploads/${id}`,
      kind === "file" ? "manual.pdf" : "cover.png",
    ],
  );
  return id;
}
async function edit(
  id: string,
  options: {
    user?: string;
    revision?: number;
    file?: string;
    key?: string;
    category?: string;
  } = {},
) {
  return db.query<{ edit_product: number }>(
    'select public.edit_product($1,$2,$3,\'Updated title\',\'Updated description content\',\'[{"asset":"base:USDC","amount":"20"}]\',true,2000,$4,null,$5,null,$6)',
    [
      options.user || seller,
      id,
      options.revision ?? 0,
      options.file || null,
      options.key || null,
      options.category || "courses",
    ],
  );
}
async function asUser<T>(role: string, user: string, run: () => Promise<T>) {
  await db.exec(`set role ${role};set request.jwt.claim.sub='${user}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;reset request.jwt.claim.sub;");
  }
}
async function thread(id: string) {
  const result = await db.query<{ id: string }>(
    "select public.start_conversation($1,$2) as id",
    [buyer, id],
  );
  return result.rows[0].id;
}
describe("product editing transaction", () => {
  it("updates metadata/category without replacing the delivery object or product ID", async () => {
    const id = await product();
    expect((await edit(id)).rows[0].edit_product).toBe(1);
    const row = await db.query<{
      category: string;
      title: string;
      file_name: string;
      object_key: string;
    }>(
      "select p.*,f.object_key from public.products p join public.product_files f on f.product_id=p.id where p.id=$1",
      [id],
    );
    expect(row.rows[0]).toMatchObject({
      category: "courses",
      title: "Updated title",
      file_name: "original.zip",
      object_key: `private/${id}`,
    });
  });
  it("denies another seller and rejects stale edits before consuming uploads", async () => {
    const id = await product(),
      file = await upload(seller);
    await expect(
      edit(id, { user: outsider, file, key: "private/replacement" }),
    ).rejects.toThrow(/product_not_owned/);
    await edit(id);
    await expect(
      edit(id, { file, key: "private/replacement" }),
    ).rejects.toThrow(/product_edit_conflict/);
    expect(
      (
        await db.query<{ used: boolean }>(
          "select used from public.uploads where id=$1",
          [file],
        )
      ).rows[0].used,
    ).toBe(false);
  });
  it("replaces delivery metadata and consumes the owned upload atomically", async () => {
    const id = await product(),
      file = await upload(seller);
    await edit(id, { file, key: `private/new/${id}` });
    const row = await db.query(
      "select p.file_name,p.file_size,f.object_key,f.sha256,u.used from public.products p join public.product_files f on f.product_id=p.id cross join public.uploads u where p.id=$1 and u.id=$2",
      [id, file],
    );
    expect(row.rows[0]).toMatchObject({
      file_name: "manual.pdf",
      file_size: 200,
      object_key: `private/new/${id}`,
      sha256: "new-hash",
      used: true,
    });
    await expect(
      edit(await product(), { file, key: "another/key" }),
    ).rejects.toThrow(/invalid_file_upload/);
  });
  it("rolls back metadata if replacement object key is already used", async () => {
    const id = await product(),
      other = await product(),
      file = await upload(seller);
    await expect(edit(id, { file, key: `private/${other}` })).rejects.toThrow(
      /duplicate key/,
    );
    expect(
      (
        await db.query(
          "select revision,title from public.products where id=$1",
          [id],
        )
      ).rows[0],
    ).toMatchObject({ revision: 0, title: "Course ZIP" });
    expect(
      (await db.query("select used from public.uploads where id=$1", [file]))
        .rows[0],
    ).toMatchObject({ used: false });
  });
  it("rejects foreign uploads and invalid categories", async () => {
    const id = await product(),
      file = await upload(outsider);
    await expect(edit(id, { file, key: "foreign" })).rejects.toThrow(
      /invalid_file_upload/,
    );
    await expect(edit(id, { category: "invalid" })).rejects.toThrow(
      /check constraint/,
    );
  });
  it("publishes with a category in a single transaction", async () => {
    const file = await upload(seller),
      preview = await upload(seller, "preview"),
      id = crypto.randomUUID();
    const args = [seller, id, file, preview];
    const statement =
      "select public.publish_product_v2($1,$2,'New ZIP course','A complete new digital course','[{\"asset\":\"base:USDC\",\"amount\":\"10\"}]',$3,$4,'sealed/course','preview/new.webp',false,1000,$5)";
    await expect(db.query(statement, [...args, "invalid"])).rejects.toThrow(
      /check constraint/,
    );
    expect(
      (await db.query("select id from public.products where id=$1", [id])).rows,
    ).toHaveLength(0);
    await db.query(statement, [...args, "courses"]);
    expect(
      (await db.query("select category from public.products where id=$1", [id]))
        .rows[0],
    ).toMatchObject({ category: "courses" });
  });
  it("denies editing/publishing RPC and direct product mutation from browser roles", async () => {
    const id = await product();
    await expect(
      asUser("authenticated", seller, () => edit(id)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser("authenticated", seller, () =>
        db.query("update public.products set title='Hacked' where id=$1", [id]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
describe("persistent private conversations", () => {
  it("opens before a purchase and returns one conversation under retries", async () => {
    const id = await product(),
      conversation = await thread(id);
    expect(await thread(id)).toBe(conversation);
    await expect(
      db.query("select public.start_conversation($1,$2)", [seller, id]),
    ).rejects.toThrow(/cannot_message_yourself/);
  });
  it("isolates history, disallows participant forgery and sends idempotently", async () => {
    const conversation = await thread(await product()),
      nonce = crypto.randomUUID();
    const send = (user: string, body: string) =>
      db.query("select (public.send_message($1,$2,$3,$4)).id", [
        user,
        conversation,
        nonce,
        body,
      ]);
    const first = await send(buyer, "Вопрос до покупки");
    expect((await send(buyer, "Вопрос до покупки")).rows).toEqual(first.rows);
    await expect(send(outsider, "Чужое сообщение")).rejects.toThrow(
      /conversation_not_found/,
    );
    await expect(send(buyer, "Другой текст с прежним ключом")).rejects.toThrow(
      /message_conflict/,
    );
    const query = () =>
      db.query("select body from public.messages where conversation_id=$1", [
        conversation,
      ]);
    expect((await asUser("authenticated", seller, query)).rows).toHaveLength(1);
    expect((await asUser("authenticated", outsider, query)).rows).toHaveLength(
      0,
    );
    await expect(asUser("anon", "", query)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser("authenticated", buyer, () => send(buyer, "Вопрос до покупки")),
    ).rejects.toThrow(/permission denied/);
  });
  it("preserves the chat after hiding a product but prevents new conversations", async () => {
    const id = await product(),
      conversation = await thread(id);
    await db.query("update public.products set active=false where id=$1", [id]);
    expect(await thread(id)).toBe(conversation);
    await db.query(
      "select public.send_message($1,$2,$3,'Поддержка после снятия с продажи')",
      [seller, conversation, crypto.randomUUID()],
    );
    await expect(
      db.query("select public.start_conversation($1,$2)", [outsider, id]),
    ).rejects.toThrow(/product_unavailable/);
  });
});
describe("administrator metrics", () => {
  it("counts only paid sales in the selected network environment with proper USD units", async () => {
    const id = await product();
    for (const environment of ["testnet", "mainnet"]) {
      const order = crypto.randomUUID();
      await db.query(
        "insert into public.sales(id,product_id,seller_id,buyer_id,buyer_wallet,seller_wallet,platform_wallet,asset,network,amount,fee,fixed_fee,usd_rate,chain_environment) values($1,$2,$3,$4,'buyer','seller','platform','base:ETH','base','10000000000000000','700000000000000','200000000000000','2500',$5)",
        [order, id, seller, buyer, environment],
      );
      await db.query("select public.complete_sale($1,$2,'100',now())", [
        order,
        crypto.randomUUID(),
      ]);
    }
    const result = await db.query<{
      m: {
        paid_sales: number;
        turnover_usd: string;
        revenue_usd: string;
        average_usd: string;
        daily: unknown[];
      };
    }>("select public.admin_metrics(30,'testnet') as m");
    expect(result.rows[0].m.paid_sales).toBe(1);
    expect(Number(result.rows[0].m.turnover_usd)).toBe(25);
    expect(Number(result.rows[0].m.revenue_usd)).toBe(1.75);
    expect(Number(result.rows[0].m.average_usd)).toBe(25);
    expect(result.rows[0].m.daily).toHaveLength(30);
    await edit(id);
    const sale = await db.query<{ amount: string }>(
      "select amount from public.sales where product_id=$1",
      [id],
    );
    expect(sale.rows.every((s) => s.amount === "10000000000000000")).toBe(true);
  });
  it("denies analytics RPC to anonymous users and authenticated sellers", async () => {
    for (const role of ["anon", "authenticated"])
      await expect(
        asUser(role, seller, () =>
          db.query("select public.admin_metrics(30,'testnet')"),
        ),
      ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select public.admin_metrics(9999,'testnet')"),
    ).rejects.toThrow(/invalid_metrics_range/);
  });
});
it("applies the upgrade migrations to the previously deployed schema", async () => {
  const upgrade = new PGlite();
  try {
    await upgrade.exec(bootstrap);
    const base = readFileSync("schema.sql", "utf8").split(
      "alter table public.products add column if not exists revision",
    )[0];
    await upgrade.exec(base + "commit;");
    await upgrade.exec(
      readFileSync("migrations/20261014_product_editing.sql", "utf8"),
    );
    await upgrade.exec(
      readFileSync("migrations/20261014_messages_admin.sql", "utf8"),
    );
    for (const file of [
      "20261014_product_media.sql",
      "20261014_mainnet.sql",
      "20261015_moderation.sql",
      "20261015_micro_fees.sql",
      "20261015_catalog_search.sql",
      "20261015_inventory.sql",
      "20261016_multichain.sql",
    ])
      await upgrade.exec(readFileSync(`migrations/${file}`, "utf8"));
    await upgrade.query("select fee_bps,commission_version from public.sales");
    expect(
      (await upgrade.query("select * from public.search_catalog()")).rows,
    ).toEqual([]);
    await upgrade.query("select category,revision from public.products");
    expect(
      (await upgrade.query("select * from public.messages")).rows,
    ).toHaveLength(0);
  } finally {
    await upgrade.close();
  }
});
