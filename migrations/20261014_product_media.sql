begin;
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
