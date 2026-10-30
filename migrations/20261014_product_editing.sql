begin;

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
commit;
