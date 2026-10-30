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
