begin;

create table public.users (
  id uuid primary key references auth.users(id) on delete restrict,
  evm_wallet text check (evm_wallet ~ '^0x[0-9a-fA-F]{40}$'),
  solana_wallet text check (solana_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  display_name text not null default 'Автор' check (char_length(display_name) between 2 and 60),
  bio text not null default '' check (char_length(bio) <= 1000),
  created_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.users(id),
  title text not null check (char_length(title) between 3 and 100),
  description text not null check (char_length(description) between 10 and 5000),
  prices jsonb not null check (jsonb_typeof(prices) = 'array' and jsonb_array_length(prices) between 1 and 7),
  preview_key text not null,
  file_name text not null,
  file_size bigint not null check (file_size > 0),
  active boolean not null default true,
  affiliate_enabled boolean not null default false,
  affiliate_bps integer not null default 1000 check (affiliate_bps between 100 and 9000),
  created_at timestamptz not null default now()
);
create index products_seller_idx on public.products(seller_id, created_at desc);
create index products_catalog_idx on public.products(created_at desc) where active;
create table public.product_files (
  product_id uuid primary key references public.products(id),
  object_key text not null unique,
  sha256 text not null
);
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  kind text not null check (kind in ('file','preview')),
  object_key text not null unique,
  filename text not null,
  content_type text not null,
  bytes bigint not null check (bytes > 0),
  checksum text not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
create index uploads_owner_idx on public.uploads(user_id, created_at);
create table public.affiliate_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9_-]{16,32}$'),
  user_id uuid not null references public.users(id),
  seller_id uuid not null references public.users(id),
  product_id uuid references public.products(id),
  campaign text not null default 'Основная' check (char_length(campaign) between 1 and 40),
  created_at timestamptz not null default now(),
  unique nulls not distinct (user_id,seller_id,product_id,campaign),
  check (user_id <> seller_id)
);
create index affiliate_links_owner_idx on public.affiliate_links(user_id,created_at desc);
create table public.affiliate_clicks (
  link_id uuid not null references public.affiliate_links(id),
  visitor_hash text not null check (visitor_hash ~ '^[a-f0-9]{64}$'),
  day date not null default (now() at time zone 'UTC')::date,
  created_at timestamptz not null default now(),
  primary key(link_id,visitor_hash,day)
);
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  seller_id uuid not null references public.users(id),
  buyer_id uuid not null references public.users(id),
  buyer_wallet text not null,
  seller_wallet text not null,
  platform_wallet text not null,
  asset text not null check (asset in ('base:USDC','base:ETH','arbitrum:USDC','arbitrum:ETH','solana:USDC','solana:USDT','solana:SOL')),
  network text not null check (network in ('base','arbitrum','solana')),
  amount text not null check (amount ~ '^[0-9]{1,36}$' and amount::numeric between 100 and 100000000000000000000000000000000000),
  fee text not null check (fee ~ '^[0-9]+$'),
  fixed_fee text not null check (fixed_fee ~ '^[0-9]{1,36}$' and fixed_fee::numeric > 0),
  affiliate_amount text not null default '0' check (affiliate_amount ~ '^[0-9]{1,36}$'),
  affiliate_wallet text,
  affiliate_id uuid references public.users(id),
  affiliate_link_id uuid references public.affiliate_links(id),
  affiliate_bps integer not null default 0 check (affiliate_bps between 0 and 9000),
  usd_rate text not null default '1' check (usd_rate ~ '^[0-9]{1,9}(\.[0-9]{1,8})?$' and usd_rate::numeric > 0),
  rate_quoted_at timestamptz not null default now(),
  quote_signature text,
  chain_environment text not null default 'testnet' check (chain_environment in ('testnet','mainnet')),
  router text,
  status text not null default 'pending' check (status in ('pending','paid')),
  tx_hash text,
  block_number text,
  verification_error text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  paid_at timestamptz,
  check (fee::numeric = floor(amount::numeric * 500 / 10000) + fixed_fee::numeric),
  check (affiliate_amount::numeric = floor(amount::numeric * affiliate_bps / 10000)),
  check (fee::numeric + affiliate_amount::numeric < amount::numeric),
  check ((affiliate_id is null and affiliate_link_id is null and affiliate_wallet is null and affiliate_bps=0) or
    (affiliate_id is not null and affiliate_link_id is not null and affiliate_wallet is not null and affiliate_bps>0 and affiliate_amount::numeric>0 and affiliate_id<>buyer_id and affiliate_id<>seller_id)),
  check (split_part(asset, ':', 1) = network),
  check ((status = 'paid' and tx_hash is not null and paid_at is not null and block_number is not null) or status = 'pending'),
  check (expires_at > created_at)
);
create unique index sales_tx_once on public.sales(network, tx_hash) where status = 'paid';
create index sales_seller_idx on public.sales(seller_id, paid_at desc) where status = 'paid';
create index sales_buyer_idx on public.sales(buyer_id, product_id, created_at desc);
create index sales_worker_idx on public.sales(checked_at nulls first) where status = 'pending' and tx_hash is not null;
create index sales_affiliate_idx on public.sales(affiliate_id,paid_at desc);
create index sales_link_idx on public.sales(affiliate_link_id);
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  author_id uuid not null references public.users(id),
  sale_id uuid not null unique references public.sales(id),
  rating integer not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 10 and 2000),
  seller_reply text not null default '' check (char_length(seller_reply) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id,author_id)
);
create index reviews_product_idx on public.reviews(product_id,created_at desc);
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  author_id uuid not null references public.users(id),
  body text not null check (char_length(body) between 2 and 1000),
  created_at timestamptz not null default now()
);
create index comments_product_idx on public.comments(product_id,created_at desc);
create table public.rate_limits (key text primary key, hits integer not null, expires_at timestamptz not null);

alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.product_files enable row level security;
alter table public.uploads enable row level security;
alter table public.sales enable row level security;
alter table public.rate_limits enable row level security;
alter table public.affiliate_links enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.reviews enable row level security;
alter table public.comments enable row level security;
revoke all on public.affiliate_links,public.affiliate_clicks,public.reviews,public.comments from anon,authenticated;
grant all on public.affiliate_links,public.affiliate_clicks,public.reviews,public.comments to service_role;
grant select on public.affiliate_links to authenticated;
create policy own_affiliate_links on public.affiliate_links for select to authenticated using(user_id=(select auth.uid()));

revoke all on public.users, public.products, public.product_files, public.uploads, public.sales, public.rate_limits from anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.users, public.sales to authenticated;
grant all on public.users, public.products, public.product_files, public.uploads, public.sales, public.rate_limits to service_role;
create policy own_profile on public.users for select to authenticated using (id = (select auth.uid()));
create policy visible_products on public.products for select to anon, authenticated using (active or seller_id = (select auth.uid()));
create policy own_sales on public.sales for select to authenticated using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));

create function public.consume_rate_limit(p_key text, p_limit integer, p_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_limit < 1 or p_seconds < 1 then raise exception 'invalid limit'; end if;
  insert into public.rate_limits as r (key,hits,expires_at) values (p_key,1,now()+make_interval(secs=>p_seconds))
  on conflict (key) do update set hits = case when r.expires_at <= now() then 1 else r.hits+1 end,
  expires_at = case when r.expires_at <= now() then now()+make_interval(secs=>p_seconds) else r.expires_at end returning hits into n;
  return n <= p_limit;
end $$;

create function public.publish_product(p_user uuid, p_product uuid, p_title text, p_description text, p_prices jsonb, p_file uuid, p_preview uuid, p_file_key text, p_preview_key text, p_affiliate_enabled boolean default false, p_affiliate_bps integer default 1000)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f public.uploads; i public.uploads;
begin
  select * into f from public.uploads where id=p_file and user_id=p_user and kind='file' and not used for update;
  if not found then raise exception 'invalid file upload'; end if;
  select * into i from public.uploads where id=p_preview and user_id=p_user and kind='preview' and not used for update;
  if not found then raise exception 'invalid preview upload'; end if;
  insert into public.products(id,seller_id,title,description,prices,preview_key,file_name,file_size,affiliate_enabled,affiliate_bps)
    values(p_product,p_user,p_title,p_description,p_prices,p_preview_key,f.filename,f.bytes,p_affiliate_enabled,p_affiliate_bps);
  insert into public.product_files(product_id,object_key,sha256) values(p_product,p_file_key,f.checksum);
  update public.uploads set used=true where id in (p_file,p_preview);
  return p_product;
end $$;

create function public.complete_sale(p_id uuid, p_hash text, p_block text, p_paid_at timestamptz)
returns public.sales language plpgsql security definer set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id=p_id for update;
  if not found then raise exception 'unknown sale'; end if;
  if s.status='paid' then
    if s.tx_hash <> p_hash then raise exception 'order already paid'; end if;
    return s;
  end if;
  if p_paid_at < s.created_at - interval '30 seconds' or (s.network <> 'solana' and p_paid_at > s.expires_at) then raise exception 'payment outside quote window'; end if;
  update public.sales set status='paid', tx_hash=p_hash, block_number=p_block, paid_at=p_paid_at, verification_error=null, checked_at=now() where id=p_id returning * into s;
  return s;
end $$;

create function public.seller_totals(p_seller uuid) returns table(asset text, gross text, fees text, net text, count bigint)
language sql stable security definer set search_path = '' as $$
  select asset, sum(amount::numeric)::text, sum(fee::numeric)::text, sum(amount::numeric-fee::numeric-affiliate_amount::numeric)::text, count(*)
  from public.sales where seller_id=p_seller and status='paid' group by asset;
$$;
create function public.create_order(p_sale jsonb) returns public.sales
language plpgsql security definer set search_path = '' as $$
declare s public.sales;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((p_sale->>'buyer_id') || ':' || (p_sale->>'product_id'),0));
  select * into s from public.sales where buyer_id=(p_sale->>'buyer_id')::uuid and product_id=(p_sale->>'product_id')::uuid
    and (status='paid' or tx_hash is not null or (asset=p_sale->>'asset' and expires_at>now()))
    order by (status='paid') desc, created_at desc limit 1;
  if found then return s; end if;
  insert into public.sales(product_id,seller_id,buyer_id,buyer_wallet,seller_wallet,platform_wallet,asset,network,amount,fee,router,fixed_fee,affiliate_amount,affiliate_wallet,affiliate_id,affiliate_link_id,affiliate_bps,usd_rate,rate_quoted_at,chain_environment)
  values((p_sale->>'product_id')::uuid,(p_sale->>'seller_id')::uuid,(p_sale->>'buyer_id')::uuid,p_sale->>'buyer_wallet',p_sale->>'seller_wallet',p_sale->>'platform_wallet',p_sale->>'asset',p_sale->>'network',p_sale->>'amount',p_sale->>'fee',p_sale->>'router',p_sale->>'fixed_fee',coalesce(p_sale->>'affiliate_amount','0'),p_sale->>'affiliate_wallet',(p_sale->>'affiliate_id')::uuid,(p_sale->>'affiliate_link_id')::uuid,coalesce((p_sale->>'affiliate_bps')::integer,0),coalesce(p_sale->>'usd_rate','1'),coalesce((p_sale->>'rate_quoted_at')::timestamptz,now()),coalesce(p_sale->>'chain_environment','testnet')) returning * into s;
  return s;
end $$;
revoke all on function public.create_order(jsonb) from public,anon,authenticated;
grant execute on function public.create_order(jsonb) to service_role;
revoke all on function public.consume_rate_limit(text,integer,integer), public.publish_product(uuid,uuid,text,text,jsonb,uuid,uuid,text,text,boolean,integer), public.complete_sale(uuid,text,text,timestamptz), public.seller_totals(uuid) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer), public.publish_product(uuid,uuid,text,text,jsonb,uuid,uuid,text,text,boolean,integer), public.complete_sale(uuid,text,text,timestamptz), public.seller_totals(uuid) to service_role;

create function public.save_review(p_user uuid,p_product uuid,p_rating integer,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.sales; review_id uuid;
begin
  select * into s from public.sales where product_id=p_product and buyer_id=p_user and status='paid' order by paid_at limit 1;
  if not found or s.seller_id=p_user then raise exception 'verified purchase required'; end if;
  insert into public.reviews(product_id,author_id,sale_id,rating,body) values(p_product,p_user,s.id,p_rating,p_body)
  on conflict(product_id,author_id) do update set rating=excluded.rating,body=excluded.body,updated_at=now() returning id into review_id;
  return review_id;
end $$;
create function public.seller_reputation(p_seller uuid) returns table(rating numeric,reviews bigint,sales bigint)
language sql stable security definer set search_path='' as $$
  select (select round(avg(r.rating),2) from public.reviews r join public.products p on p.id=r.product_id where p.seller_id=p_seller),
  (select count(*) from public.reviews r join public.products p on p.id=r.product_id where p.seller_id=p_seller),
  (select count(*) from public.sales s where s.seller_id=p_seller and s.status='paid');
$$;
create function public.affiliate_totals(p_user uuid) returns table(asset text,earned text,count bigint)
language sql stable security definer set search_path='' as $$
  select asset,sum(affiliate_amount::numeric)::text,count(*) from public.sales where affiliate_id=p_user and status='paid' group by asset;
$$;
create function public.affiliate_metrics(p_user uuid,p_offset integer default 0) returns table(id uuid,code text,product_id uuid,seller_id uuid,campaign text,clicks bigint,leads bigint,conversions bigint)
language sql stable security definer set search_path='' as $$
  select l.id,l.code,l.product_id,l.seller_id,l.campaign,
  (select count(*) from public.affiliate_clicks c where c.link_id=l.id),
  (select count(distinct s.buyer_id) from public.sales s where s.affiliate_link_id=l.id),
  (select count(*) from public.sales s where s.affiliate_link_id=l.id and s.status='paid')
  from public.affiliate_links l where l.user_id=p_user order by l.created_at desc limit 20 offset greatest(0,least(p_offset,2000000));
$$;
revoke all on function public.save_review(uuid,uuid,integer,text),public.seller_reputation(uuid),public.affiliate_totals(uuid),public.affiliate_metrics(uuid,integer) from public,anon,authenticated;
grant execute on function public.save_review(uuid,uuid,integer,text),public.seller_reputation(uuid),public.affiliate_totals(uuid),public.affiliate_metrics(uuid,integer) to service_role;

alter table public.products add column if not exists revision integer not null default 0 check (revision >= 0);
alter table public.products add column if not exists category text not null default 'other'
  check (category in ('software','courses','ebooks','video','audio','graphics','photos','templates','code','games','accounts','guides','plans','data','models','fonts','presets','marketing','other'));
create index if not exists products_category_idx on public.products(category,created_at desc) where active;

create or replace function public.publish_product_v2(
  p_user uuid,p_product uuid,p_title text,p_description text,p_prices jsonb,
  p_file uuid,p_preview uuid,p_file_key text,p_preview_key text,
  p_affiliate_enabled boolean,p_affiliate_bps integer,p_category text
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.publish_product(p_user,p_product,p_title,p_description,p_prices,p_file,p_preview,p_file_key,p_preview_key,p_affiliate_enabled,p_affiliate_bps);
  update public.products set category=p_category where id=p_product and seller_id=p_user;
end $$;
revoke all on function public.publish_product_v2(uuid,uuid,text,text,jsonb,uuid,uuid,text,text,boolean,integer,text) from public,anon,authenticated;
grant execute on function public.publish_product_v2(uuid,uuid,text,text,jsonb,uuid,uuid,text,text,boolean,integer,text) to service_role;

create or replace function public.bump_product_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  return new;
end $$;
revoke all on function public.bump_product_revision() from public,anon,authenticated;
create or replace trigger products_revision before update on public.products
for each row execute function public.bump_product_revision();

create or replace function public.edit_product(
  p_user uuid, p_product uuid, p_revision integer, p_title text, p_description text,
  p_prices jsonb, p_affiliate_enabled boolean, p_affiliate_bps integer,
  p_file uuid default null, p_preview uuid default null,
  p_file_key text default null, p_preview_key text default null, p_category text default 'other'
) returns integer language plpgsql security definer set search_path = '' as $$
declare current_product public.products; f public.uploads; i public.uploads; next_revision integer;
begin
  select * into current_product from public.products where id=p_product and seller_id=p_user for update;
  if not found then raise exception 'product_not_owned'; end if;
  if current_product.revision is distinct from p_revision then raise exception 'product_edit_conflict'; end if;
  if (p_file is null) <> (p_file_key is null) or (p_preview is null) <> (p_preview_key is null)
    or p_file_key='' or p_preview_key='' then raise exception 'invalid_replacement'; end if;

  if p_file is not null then
    select * into f from public.uploads where id=p_file and user_id=p_user and kind='file' and not used for update;
    if not found then raise exception 'invalid_file_upload'; end if;
  end if;
  if p_preview is not null then
    select * into i from public.uploads where id=p_preview and user_id=p_user and kind='preview' and not used for update;
    if not found then raise exception 'invalid_preview_upload'; end if;
  end if;

  update public.products set title=p_title, description=p_description, prices=p_prices, category=p_category,
    affiliate_enabled=p_affiliate_enabled, affiliate_bps=p_affiliate_bps,
    preview_key=coalesce(p_preview_key,preview_key),
    file_name=case when p_file is null then file_name else f.filename end,
    file_size=case when p_file is null then file_size else f.bytes end
  where id=p_product and seller_id=p_user returning revision into next_revision;
  if p_file is not null then
    update public.product_files set object_key=p_file_key, sha256=f.checksum where product_id=p_product;
    if not found then raise exception 'product_file_missing'; end if;
    update public.uploads set used=true where id=p_file;
  end if;
  if p_preview is not null then update public.uploads set used=true where id=p_preview; end if;
  return next_revision;
end $$;
revoke all on function public.edit_product(uuid,uuid,integer,text,text,jsonb,boolean,integer,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.edit_product(uuid,uuid,integer,text,text,jsonb,boolean,integer,uuid,uuid,text,text,text) to service_role;

notify pgrst, 'reload schema';

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  buyer_id uuid not null references public.users(id),
  seller_id uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id,buyer_id),
  check (buyer_id <> seller_id)
);
create index conversations_buyer_idx on public.conversations(buyer_id,updated_at desc);
create index conversations_seller_idx on public.conversations(seller_id,updated_at desc);
create table public.messages (
  id bigint generated always as identity primary key check (id <= 9007199254740991),
  conversation_id uuid not null references public.conversations(id),
  sender_id uuid not null references public.users(id),
  client_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  unique(sender_id,client_id)
);
create index messages_conversation_idx on public.messages(conversation_id,id desc);
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
revoke all on public.conversations,public.messages from anon,authenticated;
grant select on public.conversations,public.messages to authenticated;
grant all on public.conversations,public.messages to service_role;
grant usage,select on sequence public.messages_id_seq to service_role;
create policy conversations_participants on public.conversations for select to authenticated
  using ((select auth.uid()) in (buyer_id,seller_id));
create policy messages_participants on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id=conversation_id and (select auth.uid()) in (c.buyer_id,c.seller_id)));

create function public.start_conversation(p_user uuid,p_product uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.products; conversation uuid;
begin
  select id into conversation from public.conversations where product_id=p_product and buyer_id=p_user;
  if found then return conversation; end if;
  select * into p from public.products where id=p_product and active;
  if not found then raise exception 'product_unavailable'; end if;
  if p.seller_id=p_user then raise exception 'cannot_message_yourself'; end if;
  insert into public.conversations(product_id,buyer_id,seller_id) values(p_product,p_user,p.seller_id)
    on conflict(product_id,buyer_id) do update set product_id=excluded.product_id returning id into conversation;
  return conversation;
end $$;
create function public.send_message(p_user uuid,p_conversation uuid,p_client uuid,p_body text) returns public.messages
language plpgsql security definer set search_path='' as $$
declare c public.conversations; m public.messages;
begin
  select * into c from public.conversations where id=p_conversation and p_user in (buyer_id,seller_id) for update;
  if not found then raise exception 'conversation_not_found'; end if;
  select * into m from public.messages where sender_id=p_user and client_id=p_client;
  if found then
    if m.conversation_id<>p_conversation or m.body<>btrim(p_body) then raise exception 'message_conflict'; end if;
    return m;
  end if;
  insert into public.messages(conversation_id,sender_id,client_id,body) values(p_conversation,p_user,p_client,btrim(p_body)) returning * into m;
  update public.conversations set updated_at=now() where id=p_conversation;
  return m;
end $$;
revoke all on function public.start_conversation(uuid,uuid),public.send_message(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.start_conversation(uuid,uuid),public.send_message(uuid,uuid,uuid,text) to service_role;

create index if not exists sales_admin_idx on public.sales(chain_environment,paid_at desc) where status='paid';
create function public.admin_metrics(p_days integer,p_environment text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare start_at timestamptz; today_at timestamptz; result jsonb;
begin
  if p_days not in (7,30,90) or p_environment not in ('testnet','mainnet') or p_days is null or p_environment is null then
    raise exception 'invalid_metrics_range';
  end if;
  today_at := date_trunc('day',now() at time zone 'Europe/Chisinau') at time zone 'Europe/Chisinau';
  start_at := ((now() at time zone 'Europe/Chisinau')::date - (p_days-1))::timestamp at time zone 'Europe/Chisinau';
  with paid as (
    select s.*,power(10::numeric,case when asset in ('base:ETH','arbitrum:ETH') then 18 when asset='solana:SOL' then 9 else 6 end) as units
    from public.sales s where status='paid' and chain_environment=p_environment and paid_at>=start_at and paid_at<=now()
  ), daily as (
    select (paid_at at time zone 'Europe/Chisinau')::date as day,count(*) as sales,
      sum(amount::numeric/units*usd_rate::numeric) as turnover,sum(fee::numeric/units*usd_rate::numeric) as revenue
    from paid group by 1
  ), assets as (
    select asset,count(*) as sales,sum(amount::numeric/units)::text as turnover,sum(fee::numeric/units)::text as revenue
    from paid group by asset
  )
  select jsonb_build_object(
    'registered_users',(select count(*) from public.users),
    'sellers_total',(select count(distinct seller_id) from public.products),
    'active_sellers_30d',(select count(distinct seller_id) from public.products where created_at>=now()-interval '30 days'),
    'products_today',(select count(*) from public.products where created_at>=today_at),
    'products_total',(select count(*) from public.products),
    'products_active',(select count(*) from public.products where active),
    'paid_sales',(select count(*) from paid),
    'turnover_usd',coalesce((select sum(amount::numeric/units*usd_rate::numeric)::text from paid),'0'),
    'revenue_usd',coalesce((select sum(fee::numeric/units*usd_rate::numeric)::text from paid),'0'),
    'average_usd',coalesce((select avg(amount::numeric/units*usd_rate::numeric)::text from paid),'0'),
    'affiliate_usd',coalesce((select sum(affiliate_amount::numeric/units*usd_rate::numeric)::text from paid),'0'),
    'daily',coalesce((select jsonb_agg(jsonb_build_object('day',d.day::date,'sales',coalesce(a.sales,0),'turnover',coalesce(a.turnover,0)::text,'revenue',coalesce(a.revenue,0)::text) order by d.day)
      from generate_series((start_at at time zone 'Europe/Chisinau')::date::timestamp,(today_at at time zone 'Europe/Chisinau')::date::timestamp,interval '1 day') d(day) left join daily a on a.day=d.day::date),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(to_jsonb(a) order by a.asset) from assets a),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.admin_metrics(integer,text) from public,anon,authenticated;
grant execute on function public.admin_metrics(integer,text) to service_role;

notify pgrst,'reload schema';
alter table public.products add column gallery_keys text[] not null default '{}' check (cardinality(gallery_keys)<=5);
alter table public.products add column youtube_id text check (youtube_id ~ '^[A-Za-z0-9_-]{11}$');

create function public.set_product_media(p_user uuid,p_product uuid,p_keep text[],p_uploads uuid[],p_keys text[],p_youtube text) returns integer
language plpgsql security definer set search_path='' as $$
declare p public.products; item public.uploads; idx integer; rev integer;
begin
  select * into p from public.products where id=p_product and seller_id=p_user for update;
  if not found then raise exception 'product_not_owned'; end if;
  if p_keep is null or p_uploads is null or p_keys is null or cardinality(p_keys)<>cardinality(p_uploads)
    or cardinality(p_keep)+cardinality(p_keys)>5 or not p_keep <@ p.gallery_keys
    or array_position(p_keep,null) is not null or array_position(p_keys,null) is not null or array_position(p_uploads,null) is not null
    or cardinality(p_keep || p_keys)<>(select count(distinct k) from unnest(p_keep || p_keys) k)
    or cardinality(p_uploads)<>(select count(distinct u) from unnest(p_uploads) u)
    then raise exception 'invalid_gallery'; end if;
  if cardinality(p_uploads)>0 then
    for idx in 1..cardinality(p_uploads) loop
      select * into item from public.uploads where id=p_uploads[idx] and user_id=p_user and kind='preview' and not used for update;
      if not found or p_keys[idx]='' then raise exception 'invalid_gallery_upload'; end if;
      update public.uploads set used=true where id=item.id;
    end loop;
  end if;
  update public.products set gallery_keys=p_keep || p_keys,youtube_id=p_youtube where id=p_product returning revision into rev;
  return rev;
end $$;
create function public.publish_product_v3(
  p_user uuid,p_product uuid,p_title text,p_description text,p_prices jsonb,
  p_file uuid,p_preview uuid,p_file_key text,p_preview_key text,
  p_affiliate_enabled boolean,p_affiliate_bps integer,p_category text,
  p_gallery_uploads uuid[],p_gallery_keys text[],p_youtube text
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.publish_product_v2(p_user,p_product,p_title,p_description,p_prices,p_file,p_preview,p_file_key,p_preview_key,p_affiliate_enabled,p_affiliate_bps,p_category);
  perform public.set_product_media(p_user,p_product,'{}',p_gallery_uploads,p_gallery_keys,p_youtube);
end $$;
create function public.edit_product_v2(
  p_user uuid,p_product uuid,p_revision integer,p_title text,p_description text,p_prices jsonb,
  p_affiliate_enabled boolean,p_affiliate_bps integer,p_file uuid,p_preview uuid,
  p_file_key text,p_preview_key text,p_category text,p_gallery_keep text[],p_gallery_uploads uuid[],p_gallery_keys text[],p_youtube text
) returns integer language plpgsql security definer set search_path='' as $$
begin
  perform public.edit_product(p_user,p_product,p_revision,p_title,p_description,p_prices,p_affiliate_enabled,p_affiliate_bps,p_file,p_preview,p_file_key,p_preview_key,p_category);
  return public.set_product_media(p_user,p_product,p_gallery_keep,p_gallery_uploads,p_gallery_keys,p_youtube);
end $$;
revoke all on function public.set_product_media(uuid,uuid,text[],uuid[],text[],text),public.publish_product_v3(uuid,uuid,text,text,jsonb,uuid,uuid,text,text,boolean,integer,text,uuid[],text[],text),public.edit_product_v2(uuid,uuid,integer,text,text,jsonb,boolean,integer,uuid,uuid,text,text,text,text[],uuid[],text[],text) from public,anon,authenticated;
grant execute on function public.set_product_media(uuid,uuid,text[],uuid[],text[],text),public.publish_product_v3(uuid,uuid,text,text,jsonb,uuid,uuid,text,text,boolean,integer,text,uuid[],text[],text),public.edit_product_v2(uuid,uuid,integer,text,text,jsonb,boolean,integer,uuid,uuid,text,text,text,text[],uuid[],text[],text) to service_role;
notify pgrst,'reload schema';
commit;

begin;
create table if not exists public.payment_routers (
  network text not null check(network in ('base','arbitrum')),
  chain_environment text not null check(chain_environment in ('testnet','mainnet')),
  address text not null check(address ~ '^0x[0-9a-fA-F]{40}$'),
  tx_hash text not null check(tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  registered_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(network,chain_environment)
);
alter table public.payment_routers enable row level security;
revoke all on public.payment_routers from public,anon,authenticated;
grant select,insert on public.payment_routers to service_role;

create or replace function public.create_order(p_sale jsonb) returns public.sales
language plpgsql security definer set search_path = '' as $$
declare s public.sales;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((p_sale->>'buyer_id') || ':' || (p_sale->>'product_id') || ':' || coalesce(p_sale->>'chain_environment','testnet'),0));
  select * into s from public.sales where buyer_id=(p_sale->>'buyer_id')::uuid and product_id=(p_sale->>'product_id')::uuid
    and chain_environment=coalesce(p_sale->>'chain_environment','testnet')
    and (status='paid' or tx_hash is not null or (asset=p_sale->>'asset' and expires_at>now()))
    order by (status='paid') desc, created_at desc limit 1;
  if found then return s; end if;
  insert into public.sales(product_id,seller_id,buyer_id,buyer_wallet,seller_wallet,platform_wallet,asset,network,amount,fee,router,fixed_fee,affiliate_amount,affiliate_wallet,affiliate_id,affiliate_link_id,affiliate_bps,usd_rate,rate_quoted_at,chain_environment)
  values((p_sale->>'product_id')::uuid,(p_sale->>'seller_id')::uuid,(p_sale->>'buyer_id')::uuid,p_sale->>'buyer_wallet',p_sale->>'seller_wallet',p_sale->>'platform_wallet',p_sale->>'asset',p_sale->>'network',p_sale->>'amount',p_sale->>'fee',p_sale->>'router',p_sale->>'fixed_fee',coalesce(p_sale->>'affiliate_amount','0'),p_sale->>'affiliate_wallet',(p_sale->>'affiliate_id')::uuid,(p_sale->>'affiliate_link_id')::uuid,coalesce((p_sale->>'affiliate_bps')::integer,0),coalesce(p_sale->>'usd_rate','1'),coalesce((p_sale->>'rate_quoted_at')::timestamptz,now()),coalesce(p_sale->>'chain_environment','testnet')) returning * into s;
  return s;
end $$;
create or replace function public.seller_totals_v2(p_seller uuid,p_environment text) returns table(asset text,gross text,fees text,net text,count bigint)
language sql stable security definer set search_path='' as $$
 select asset,sum(amount::numeric)::text,sum(fee::numeric)::text,sum(amount::numeric-fee::numeric-affiliate_amount::numeric)::text,count(*)
 from public.sales where seller_id=p_seller and status='paid' and chain_environment=p_environment group by asset;
$$;
create or replace function public.affiliate_totals_v2(p_user uuid,p_environment text) returns table(asset text,earned text,count bigint)
language sql stable security definer set search_path='' as $$
 select asset,sum(affiliate_amount::numeric)::text,count(*) from public.sales where affiliate_id=p_user and status='paid' and chain_environment=p_environment group by asset;
$$;
create or replace function public.affiliate_metrics_v2(p_user uuid,p_environment text,p_offset integer default 0) returns table(id uuid,code text,product_id uuid,seller_id uuid,campaign text,clicks bigint,leads bigint,conversions bigint)
language sql stable security definer set search_path='' as $$
 select l.id,l.code,l.product_id,l.seller_id,l.campaign,
 (select count(*) from public.affiliate_clicks c where c.link_id=l.id),
 (select count(distinct s.buyer_id) from public.sales s where s.affiliate_link_id=l.id and s.chain_environment=p_environment),
 (select count(*) from public.sales s where s.affiliate_link_id=l.id and s.status='paid' and s.chain_environment=p_environment)
 from public.affiliate_links l where l.user_id=p_user order by l.created_at desc limit 20 offset greatest(0,least(p_offset,2000000));
$$;
revoke all on function public.create_order(jsonb),public.seller_totals_v2(uuid,text),public.affiliate_totals_v2(uuid,text),public.affiliate_metrics_v2(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.create_order(jsonb),public.seller_totals_v2(uuid,text),public.affiliate_totals_v2(uuid,text),public.affiliate_metrics_v2(uuid,text,integer) to service_role;
notify pgrst,'reload schema';
commit;

begin;
alter table public.products add column is_hidden boolean not null default false;
create index products_visible_catalog_idx on public.products(created_at desc) where active and not is_hidden;
drop policy visible_products on public.products;
create policy visible_products on public.products for select to anon,authenticated using ((active and not is_hidden) or seller_id=(select auth.uid()));
create table public.product_reports (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id),
 reporter_id uuid not null references public.users(id),
 reason text not null check(reason in ('malware','fraud','copyright','prohibited','other')),
 details text not null check(char_length(details) between 10 and 2000),
 status text not null default 'open' check(status in ('open','resolved')),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 unique(product_id,reporter_id)
);
create index reports_queue_idx on public.product_reports(status,created_at desc);
create table public.moderation_events (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id),
 admin_id uuid not null references public.users(id),
 hidden boolean not null,
 reason text not null check(char_length(reason) between 5 and 1000),
 created_at timestamptz not null default now()
);
alter table public.product_reports enable row level security;
alter table public.moderation_events enable row level security;
revoke all on public.product_reports,public.moderation_events from public,anon,authenticated;
grant select on public.product_reports to authenticated;
create policy own_reports on public.product_reports for select to authenticated using(reporter_id=(select auth.uid()));
grant select,insert,update on public.product_reports to service_role;
grant select on public.moderation_events to service_role;
create function public.moderate_product(p_admin uuid,p_product uuid,p_hidden boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_admin is null or p_hidden is null or p_reason is null or char_length(p_reason) not between 5 and 1000 then raise exception 'invalid_moderation'; end if;
 update public.products set is_hidden=p_hidden where id=p_product;
 if not found then raise exception 'product_missing'; end if;
 insert into public.moderation_events(product_id,admin_id,hidden,reason) values(p_product,p_admin,p_hidden,p_reason);
 if p_hidden then update public.product_reports set status='resolved',resolved_at=now() where product_id=p_product and status='open'; end if;
end $$;
revoke all on function public.moderate_product(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.moderate_product(uuid,uuid,boolean,text) to service_role;
create or replace function public.start_conversation(p_user uuid,p_product uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.products; conversation uuid;
begin
 select id into conversation from public.conversations where product_id=p_product and buyer_id=p_user;
 if found then return conversation; end if;
 select * into p from public.products where id=p_product and active and not is_hidden;
 if not found then raise exception 'product_unavailable'; end if;
 if p.seller_id=p_user then raise exception 'cannot_message_yourself'; end if;
 insert into public.conversations(product_id,buyer_id,seller_id) values(p_product,p_user,p.seller_id)
 on conflict(product_id,buyer_id) do update set product_id=excluded.product_id returning id into conversation;
 return conversation;
end $$;
revoke all on function public.start_conversation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_conversation(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
begin;
alter table public.sales add column fee_bps integer not null default 500;
alter table public.sales add column commission_version smallint not null default 1;

create function public.asset_decimals(p_asset text) returns integer
language sql immutable strict set search_path='' as $$
 select case split_part(p_asset,':',2) when 'ETH' then 18 when 'SOL' then 9 else 6 end;
$$;
revoke all on function public.asset_decimals(text) from public,anon,authenticated;
grant execute on function public.asset_decimals(text) to service_role;

do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.sales'::regclass and contype='c' and pg_get_constraintdef(oid) like '%fixed_fee%' loop
  execute format('alter table public.sales drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.sales add constraint sales_fixed_fee_nonnegative check(fixed_fee ~ '^[0-9]{1,36}$' and fixed_fee::numeric>=0);
alter table public.sales add constraint sales_fee_formula check(fee::numeric>0 and fee::numeric=floor(amount::numeric*fee_bps/10000)+fixed_fee::numeric);
alter table public.sales add constraint sales_commission_rules check(
 (commission_version=1 and fee_bps=500 and fixed_fee::numeric>0) or
 (commission_version=2 and
  (split_part(asset,':',2) not in ('USDC','USDT') or usd_rate::numeric=1) and
  case when amount::numeric*usd_rate::numeric < 2.50*power(10::numeric,public.asset_decimals(asset))
   then fee_bps=1000 and fixed_fee::numeric=0
   else fee_bps=500 and fixed_fee::numeric=div(50000000*power(10::numeric,public.asset_decimals(asset))+usd_rate::numeric*100000000-1,usd_rate::numeric*100000000)
  end)
);

create or replace function public.create_order(p_sale jsonb) returns public.sales
language plpgsql security definer set search_path='' as $$
declare s public.sales;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((p_sale->>'buyer_id')||':'||(p_sale->>'product_id')||':'||coalesce(p_sale->>'chain_environment','testnet'),0));
 select * into s from public.sales where buyer_id=(p_sale->>'buyer_id')::uuid and product_id=(p_sale->>'product_id')::uuid
  and chain_environment=coalesce(p_sale->>'chain_environment','testnet')
  and (status='paid' or tx_hash is not null or (asset=p_sale->>'asset' and expires_at>now()))
  order by (status='paid') desc,created_at desc limit 1;
 if found then return s; end if;
 insert into public.sales(product_id,seller_id,buyer_id,buyer_wallet,seller_wallet,platform_wallet,asset,network,amount,fee,router,fixed_fee,fee_bps,commission_version,affiliate_amount,affiliate_wallet,affiliate_id,affiliate_link_id,affiliate_bps,usd_rate,rate_quoted_at,chain_environment)
 values((p_sale->>'product_id')::uuid,(p_sale->>'seller_id')::uuid,(p_sale->>'buyer_id')::uuid,p_sale->>'buyer_wallet',p_sale->>'seller_wallet',p_sale->>'platform_wallet',p_sale->>'asset',p_sale->>'network',p_sale->>'amount',p_sale->>'fee',p_sale->>'router',p_sale->>'fixed_fee',coalesce((p_sale->>'fee_bps')::integer,500),coalesce((p_sale->>'commission_version')::smallint,1),coalesce(p_sale->>'affiliate_amount','0'),p_sale->>'affiliate_wallet',(p_sale->>'affiliate_id')::uuid,(p_sale->>'affiliate_link_id')::uuid,coalesce((p_sale->>'affiliate_bps')::integer,0),coalesce(p_sale->>'usd_rate','1'),coalesce((p_sale->>'rate_quoted_at')::timestamptz,now()),coalesce(p_sale->>'chain_environment','testnet')) returning * into s;
 return s;
end $$;
revoke all on function public.create_order(jsonb) from public,anon,authenticated;
grant execute on function public.create_order(jsonb) to service_role;
notify pgrst,'reload schema';
commit;

begin;
create function public.catalog_normalize(p_text text) returns text
language sql immutable strict set search_path='' as $$
 select regexp_replace(lower(p_text),'\m(telegram|телеграмм?|tg|тг)\M','telegram','g');
$$;
create function public.catalog_query(p_text text) returns tsquery
language sql immutable strict set search_path='' as $$
 select to_tsquery('simple',string_agg(quote_literal(word)||':*',' & '))
 from (select word from regexp_split_to_table(public.catalog_normalize(left(p_text,120)),'[^[:alnum:]]+') word where word<>'' limit 12) words;
$$;
create index products_search_idx on public.products using gin(to_tsvector('simple',public.catalog_normalize(title||' '||description))) where active and not is_hidden;

create function public.search_catalog(p_query text default '',p_category text default '',p_sort text default 'newest',p_offset integer default 0,p_environment text default 'mainnet',p_eth_usd numeric default null,p_sol_usd numeric default null)
returns table(product jsonb,rating numeric,review_count bigint,price_usd numeric,display_price jsonb,total_count bigint)
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_sort not in ('newest','price_asc','price_desc','title_asc','title_desc','rating','reviews') or p_environment not in ('mainnet','testnet') or char_length(p_query)>120 or char_length(p_category)>30 or p_offset not between 0 and 1200000 then raise exception 'invalid_catalog_filter'; end if;
 if (p_eth_usd is not null and (p_eth_usd<=0 or p_eth_usd>=1000000000)) or (p_sol_usd is not null and (p_sol_usd<=0 or p_sol_usd>=1000000000)) then raise exception 'invalid_catalog_rate'; end if;
 return query
 with candidates as (
  select p.*,r.average_rating,r.reviews_count,price.usd,price.item
  from public.products p
  left join lateral (
   select avg(rv.rating)::numeric average_rating,count(*) reviews_count
   from public.reviews rv join public.sales s on s.id=rv.sale_id
   where rv.product_id=p.id and s.status='paid' and s.chain_environment=p_environment
  ) r on true
  left join lateral (
   select item,(item->>'amount')::numeric * case split_part(item->>'asset',':',2) when 'USDC' then 1 when 'USDT' then 1 when 'ETH' then p_eth_usd when 'SOL' then p_sol_usd end usd
   from jsonb_array_elements(p.prices) item
   where p_environment='mainnet' or item->>'asset'<>'solana:USDT'
   order by usd asc nulls last,item->>'asset' limit 1
  ) price on true
  where p.active and not p.is_hidden and (p_category='' or p.category=p_category)
   and (p_query='' or to_tsvector('simple',public.catalog_normalize(p.title||' '||p.description)) @@ public.catalog_query(p_query))
 )
 select to_jsonb(c)-'average_rating'-'reviews_count'-'usd'-'item',c.average_rating,c.reviews_count,c.usd,c.item,count(*) over()
 from candidates c
 order by
  case when p_sort='price_asc' then c.usd end asc nulls last,
  case when p_sort='price_desc' then c.usd end desc nulls last,
  case when p_sort='title_asc' then lower(c.title) end asc,
  case when p_sort='title_desc' then lower(c.title) end desc,
  case when p_sort='rating' then c.average_rating end desc nulls last,
  case when p_sort in ('rating','reviews') then c.reviews_count end desc,
  c.created_at desc,c.id
 limit 13 offset p_offset;
end $$;
revoke all on function public.catalog_normalize(text),public.catalog_query(text),public.search_catalog(text,text,text,integer,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.catalog_normalize(text),public.catalog_query(text),public.search_catalog(text,text,text,integer,text,numeric,numeric) to service_role;
notify pgrst,'reload schema';
commit;

begin;
alter table public.products drop constraint products_category_check;
alter table public.products add constraint products_category_check check(category in ('software','courses','ebooks','video','audio','graphics','photos','templates','code','games','accounts','proxies','licenses','guides','plans','data','models','fonts','presets','marketing','other'));
alter table public.products add column delivery_mode text not null default 'file' check(delivery_mode in ('file','stock'));
alter table public.sales add column delivery_mode text not null default 'file' check(delivery_mode in ('file','stock'));
alter table public.sales add column quantity integer not null default 1 check(quantity between 1 and 1000);
alter table public.sales add column unit_amount text;
update public.sales set unit_amount=amount;
alter table public.sales alter column unit_amount set not null;
alter table public.sales add constraint sales_quantity_amount check(unit_amount ~ '^[0-9]{1,36}$' and unit_amount::numeric>=100 and amount::numeric=unit_amount::numeric*quantity and (delivery_mode='stock' or quantity=1));
alter table public.sales add column checkout_key uuid;
alter table public.sales add column reservation_released_at timestamptz;
alter table public.sales add column payment_started_at timestamptz;
alter table public.sales add column solana_last_valid_height bigint;
alter table public.sales add column solana_blockhashes text[] not null default '{}';
alter table public.sales add column solana_first_slot bigint;
alter table public.sales add column inventory_checked_at timestamptz;
create unique index sales_checkout_key on public.sales(buyer_id,checkout_key) where checkout_key is not null;
create index sales_stock_pending on public.sales(expires_at) where delivery_mode='stock' and status='pending' and reservation_released_at is null;

create table public.inventory_units (
 id bigint generated always as identity primary key,
 product_id uuid not null references public.products(id),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 ciphertext text not null check(length(ciphertext) between 40 and 5600),
 sale_id uuid references public.sales(id),
 created_at timestamptz not null default now(),
 unique(product_id,fingerprint)
);
create index inventory_available on public.inventory_units(product_id,id) where sale_id is null;
create index inventory_sale on public.inventory_units(sale_id) where sale_id is not null;
alter table public.inventory_units enable row level security;
revoke all on public.inventory_units from public,anon,authenticated;
grant all on public.inventory_units to service_role;
grant usage,select on sequence public.inventory_units_id_seq to service_role;

create function public.insert_inventory(p_product uuid,p_items jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 10000 then raise exception 'invalid_inventory'; end if;
 insert into public.inventory_units(product_id,fingerprint,ciphertext)
 select p_product,item->>'fingerprint',item->>'ciphertext' from jsonb_array_elements(p_items) item on conflict(product_id,fingerprint) do nothing;
 get diagnostics added=row_count;
 if added=0 then raise exception 'inventory_duplicates'; end if;
 return added;
end $$;
create function public.publish_product_v4(p_fields jsonb,p_items jsonb default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare product uuid:=(p_fields->>'p_product')::uuid;
begin
 perform public.publish_product_v3((p_fields->>'p_user')::uuid,product,p_fields->>'p_title',p_fields->>'p_description',p_fields->'p_prices',
 (p_fields->>'p_file')::uuid,(p_fields->>'p_preview')::uuid,p_fields->>'p_file_key',p_fields->>'p_preview_key',
 (p_fields->>'p_affiliate_enabled')::boolean,(p_fields->>'p_affiliate_bps')::integer,p_fields->>'p_category',
 array(select jsonb_array_elements_text(p_fields->'p_gallery_uploads')::uuid),array(select jsonb_array_elements_text(p_fields->'p_gallery_keys')),p_fields->>'p_youtube');
 if p_items is not null then
   update public.products set delivery_mode='stock' where id=product;
   delete from public.product_files where product_id=product;
   perform public.insert_inventory(product,p_items);
 end if;
 return product;
end $$;
create function public.restock_product(p_user uuid,p_product uuid,p_upload uuid,p_items jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 perform 1 from public.products where id=p_product and seller_id=p_user and delivery_mode='stock' for update;
 if not found then raise exception 'product_unavailable'; end if;
 perform 1 from public.uploads where id=p_upload and user_id=p_user and kind='file' and not used for update;
 if not found then raise exception 'invalid file upload'; end if;
 added:=public.insert_inventory(p_product,p_items);
 update public.uploads set used=true where id=p_upload;
 return added;
end $$;
create function public.inventory_counts(p_product uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('available',count(*) filter(where u.sale_id is null),'reserved',count(*) filter(where s.status='pending'),'sold',count(*) filter(where s.status='paid'))
 from public.inventory_units u left join public.sales s on s.id=u.sale_id where u.product_id=p_product;
$$;

-- Preserve single-download deduplication for existing products and callers.
alter function public.create_order(jsonb) rename to create_file_order;
-- Legacy inserts omit unit_amount; a trigger supplies the immutable snapshot.
create function public.sale_unit_default() returns trigger language plpgsql set search_path='' as $$
begin
 if new.unit_amount is null then new.unit_amount:=new.amount; end if;
 return new;
end $$;
create trigger sale_unit_default before insert on public.sales for each row execute function public.sale_unit_default();
create function public.create_order(p_sale jsonb) returns public.sales
language plpgsql security definer set search_path='' as $$
declare s public.sales; p public.products; q integer:=coalesce((p_sale->>'quantity')::integer,1); ids bigint[];
begin
 select * into p from public.products where id=(p_sale->>'product_id')::uuid for update;
 if p.delivery_mode<>'stock' then return public.create_file_order(p_sale); end if;
 if not p.active or p.is_hidden then raise exception 'product_unavailable'; end if;
 if q not between 1 and 1000 or p_sale->>'checkout_key' is null then raise exception 'invalid_quantity'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stock-buyer:'||(p_sale->>'buyer_id'),0));
 select * into s from public.sales where buyer_id=(p_sale->>'buyer_id')::uuid and checkout_key=(p_sale->>'checkout_key')::uuid;
 if found then
   if s.product_id<>p.id or s.quantity<>q or s.asset<>p_sale->>'asset' or s.chain_environment<>p_sale->>'chain_environment' then raise exception 'checkout_conflict'; end if;
   return s;
 end if;
 select * into s from public.sales where buyer_id=(p_sale->>'buyer_id')::uuid and product_id=p.id and delivery_mode='stock' and status='pending' and reservation_released_at is null order by created_at desc limit 1;
 if found then
   if s.quantity<>q or s.asset<>p_sale->>'asset' then raise exception 'inventory_pending_order'; end if;
   return s;
 end if;
 if (select count(*) from public.sales where buyer_id=(p_sale->>'buyer_id')::uuid and delivery_mode='stock' and status='pending' and reservation_released_at is null)>=5 then raise exception 'inventory_pending_limit'; end if;
 if p.revision is distinct from (p_sale->>'product_revision')::integer or p.seller_id is distinct from (p_sale->>'seller_id')::uuid then raise exception 'product_edit_conflict'; end if;
 select array_agg(id) into ids from (select id from public.inventory_units where product_id=p.id and sale_id is null order by id limit q for update) units;
 if coalesce(cardinality(ids),0)<>q then raise exception 'inventory_insufficient'; end if;
 insert into public.sales(product_id,seller_id,buyer_id,buyer_wallet,seller_wallet,platform_wallet,asset,network,amount,fee,router,fixed_fee,fee_bps,commission_version,affiliate_amount,affiliate_wallet,affiliate_id,affiliate_link_id,affiliate_bps,usd_rate,rate_quoted_at,chain_environment,delivery_mode,quantity,unit_amount,checkout_key)
 values(p.id,p.seller_id,(p_sale->>'buyer_id')::uuid,p_sale->>'buyer_wallet',p_sale->>'seller_wallet',p_sale->>'platform_wallet',p_sale->>'asset',p_sale->>'network',p_sale->>'amount',p_sale->>'fee',p_sale->>'router',p_sale->>'fixed_fee',(p_sale->>'fee_bps')::integer,(p_sale->>'commission_version')::smallint,coalesce(p_sale->>'affiliate_amount','0'),p_sale->>'affiliate_wallet',(p_sale->>'affiliate_id')::uuid,(p_sale->>'affiliate_link_id')::uuid,coalesce((p_sale->>'affiliate_bps')::integer,0),p_sale->>'usd_rate',(p_sale->>'rate_quoted_at')::timestamptz,p_sale->>'chain_environment','stock',q,p_sale->>'unit_amount',(p_sale->>'checkout_key')::uuid) returning * into s;
 update public.inventory_units set sale_id=s.id where id=any(ids);
 return s;
end $$;

create function public.arm_inventory_payment(p_id uuid,p_height bigint default null,p_blockhash text default null,p_slot bigint default null) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.sales set payment_started_at=coalesce(payment_started_at,now()),solana_last_valid_height=greatest(solana_last_valid_height,p_height),
 solana_first_slot=least(solana_first_slot,p_slot),
 solana_blockhashes=case when p_blockhash is null or p_blockhash=any(solana_blockhashes) then solana_blockhashes else array_append(solana_blockhashes,p_blockhash) end
 where id=p_id and delivery_mode='stock' and status='pending' and reservation_released_at is null and expires_at>now() and cardinality(solana_blockhashes)<32
 and (network<>'solana' or (p_height>0 and p_slot>0 and p_blockhash is not null));
 return found;
end $$;
-- Only a server that has proved no payable transaction exists may call this.
create function public.release_inventory(p_id uuid,p_expected_started timestamptz default null,p_expected_height bigint default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare s public.sales;
begin
 select * into s from public.sales where id=p_id for update;
 if not found or s.delivery_mode<>'stock' or s.status<>'pending' or s.reservation_released_at is not null or s.expires_at>now() then return false; end if;
 if s.payment_started_at is distinct from p_expected_started or s.solana_last_valid_height is distinct from p_expected_height then return false; end if;
 update public.sales set reservation_released_at=now() where id=p_id;
 update public.inventory_units set sale_id=null where sale_id=p_id;
 return true;
end $$;
create or replace function public.complete_sale(p_id uuid,p_hash text,p_block text,p_paid_at timestamptz) returns public.sales
language plpgsql security definer set search_path='' as $$
declare s public.sales;
begin
 select * into s from public.sales where id=p_id for update;
 if not found then raise exception 'unknown sale'; end if;
 if s.status='paid' then
   if s.tx_hash<>p_hash then raise exception 'order already paid'; end if;
   return s;
 end if;
 if s.reservation_released_at is not null then raise exception 'inventory_reservation_released'; end if;
 if s.delivery_mode='stock' and (select count(*) from public.inventory_units where sale_id=p_id)<>s.quantity then raise exception 'inventory_fulfillment_mismatch'; end if;
 if p_paid_at<s.created_at-interval '30 seconds' or (s.network<>'solana' and p_paid_at>s.expires_at) then raise exception 'payment outside quote window'; end if;
 update public.sales set status='paid',tx_hash=p_hash,block_number=p_block,paid_at=p_paid_at,verification_error=null,checked_at=now() where id=p_id returning * into s;
 return s;
end $$;
revoke all on function public.insert_inventory(uuid,jsonb),public.publish_product_v4(jsonb,jsonb),public.restock_product(uuid,uuid,uuid,jsonb),public.inventory_counts(uuid),public.create_order(jsonb),public.arm_inventory_payment(uuid,bigint,text,bigint),public.release_inventory(uuid,timestamptz,bigint),public.sale_unit_default() from public,anon,authenticated;
grant execute on function public.insert_inventory(uuid,jsonb),public.publish_product_v4(jsonb,jsonb),public.restock_product(uuid,uuid,uuid,jsonb),public.inventory_counts(uuid),public.create_order(jsonb),public.arm_inventory_payment(uuid,bigint,text,bigint),public.release_inventory(uuid,timestamptz,bigint) to service_role;
notify pgrst,'reload schema';
commit;

begin;
alter table public.users add column tron_wallet text check(tron_wallet ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$');
alter table public.sales drop constraint sales_asset_check;
alter table public.sales add constraint sales_asset_check check(asset in ('base:USDC','base:ETH','arbitrum:USDC','arbitrum:ETH','arbitrum:USDT','ethereum:USDC','ethereum:USDT','ethereum:ETH','bsc:USDT','tron:USDT','solana:USDC','solana:USDT','solana:SOL'));
alter table public.sales drop constraint sales_network_check;
alter table public.sales add constraint sales_network_check check(network in ('base','arbitrum','ethereum','bsc','solana','tron') and split_part(asset,':',1)=network);
alter table public.payment_routers drop constraint payment_routers_network_check;
alter table public.payment_routers drop constraint payment_routers_address_check;
alter table public.payment_routers drop constraint payment_routers_tx_hash_check;
alter table public.payment_routers add constraint payment_routers_network_check check(network in ('base','arbitrum','ethereum','bsc','tron'));
alter table public.payment_routers add constraint payment_routers_address_check check(case when network='tron' then address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' else address ~ '^0x[0-9a-fA-F]{40}$' end);
alter table public.payment_routers add constraint payment_routers_tx_hash_check check(case when network='tron' then tx_hash ~ '^[0-9a-fA-F]{64}$' else tx_hash ~ '^0x[0-9a-fA-F]{64}$' end);
create or replace function public.asset_decimals(p_asset text) returns integer
language sql immutable strict set search_path='' as $$
 select case when p_asset='bsc:USDT' then 18 when split_part(p_asset,':',2)='ETH' then 18 when p_asset='solana:SOL' then 9 else 6 end;
$$;
do $$ declare definition text; begin
 select pg_get_functiondef('public.admin_metrics(integer,text)'::regprocedure) into definition;
 definition := replace(definition,'case when asset in (''base:ETH'',''arbitrum:ETH'') then 18 when asset=''solana:SOL'' then 9 else 6 end','public.asset_decimals(asset)');
 execute definition;
 select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='search_catalog';
 if definition is not null then
  definition := replace(definition,'item->>''asset''<>''solana:USDT''','item->>''asset'' not in (''solana:USDT'',''ethereum:USDT'',''arbitrum:USDT'',''bsc:USDT'',''tron:USDT'')');
  execute definition;
 end if;
end $$;
create table public.tron_identities (
 address text primary key check(address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
 user_id uuid not null unique references auth.users(id) on delete cascade,
 login_email text not null unique,
 created_at timestamptz not null default now()
);
create table public.wallet_challenges (
 id uuid primary key default gen_random_uuid(), address text not null,
 message text not null, expires_at timestamptz not null, used boolean not null default false
);
alter table public.tron_identities enable row level security;
alter table public.wallet_challenges enable row level security;
revoke all on public.tron_identities,public.wallet_challenges from public,anon,authenticated;
grant all on public.tron_identities,public.wallet_challenges to service_role;
notify pgrst,'reload schema';
commit;
