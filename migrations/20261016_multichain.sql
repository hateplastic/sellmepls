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
