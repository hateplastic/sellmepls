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
