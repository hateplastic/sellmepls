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
