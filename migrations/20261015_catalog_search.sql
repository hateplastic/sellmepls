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
