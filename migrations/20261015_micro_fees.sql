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
