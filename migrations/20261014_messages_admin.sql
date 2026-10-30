begin;

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
commit;
