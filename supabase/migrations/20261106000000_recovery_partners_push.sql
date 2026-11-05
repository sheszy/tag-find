create table if not exists public.tag_handoff_challenges (
  item_id uuid primary key references public.tag_items(id) on delete cascade,
  pin_hash text not null check (char_length(pin_hash) = 64),
  expires_at timestamptz not null,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tag_handoff_audit (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  event_type text not null check (event_type in ('verification_failed', 'verified_return')),
  created_at timestamptz not null default now()
);

create index if not exists tag_handoff_audit_item_created_idx
  on public.tag_handoff_audit (item_id, created_at desc);

alter table public.tag_items add column if not exists lost_at timestamptz;
update public.tag_items set lost_at = created_at where is_lost and lost_at is null;

alter table public.tag_handoff_challenges enable row level security;
alter table public.tag_handoff_audit enable row level security;
revoke all on public.tag_handoff_challenges, public.tag_handoff_audit
  from anon, authenticated;
grant select, insert, update, delete on public.tag_handoff_challenges to service_role;
grant select, insert on public.tag_handoff_audit to service_role;

create or replace function public.issue_tag_handoff_challenge(
  p_item_id uuid,
  p_owner_token_hash text,
  p_pin_hash text
)
returns table(expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expires_at timestamptz := now() + interval '30 minutes';
begin
  if char_length(p_owner_token_hash) <> 64 or char_length(p_pin_hash) <> 64 then
    raise exception 'invalid handoff challenge';
  end if;

  if not exists (
    select 1 from public.tag_items
    where id = p_item_id and owner_token_hash = p_owner_token_hash and is_lost
      and lost_at is not null
  ) then
    raise exception 'owner authorization failed or item is not lost';
  end if;

  insert into public.tag_handoff_challenges (item_id, pin_hash, expires_at, failed_attempts, used_at)
  values (p_item_id, p_pin_hash, v_expires_at, 0, null)
  on conflict (item_id) do update
    set pin_hash = excluded.pin_hash,
        expires_at = excluded.expires_at,
        failed_attempts = 0,
        used_at = null,
        created_at = now();

  return query select v_expires_at;
end;
$$;

create or replace function public.complete_tag_handoff(
  p_item_id uuid,
  p_pin_hash text
)
returns table(verified boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.tag_handoff_challenges%rowtype;
begin
  if char_length(p_pin_hash) <> 64 then
    return query select false;
    return;
  end if;

  if not exists (select 1 from public.tag_items where id = p_item_id) then
    return query select false;
    return;
  end if;

  select * into v_challenge
  from public.tag_handoff_challenges
  where item_id = p_item_id
  for update;

  if not found or v_challenge.used_at is not null
    or v_challenge.expires_at <= now() or v_challenge.failed_attempts >= 5 then
    insert into public.tag_handoff_audit (item_id, event_type)
    values (p_item_id, 'verification_failed');
    return query select false;
    return;
  end if;

  if v_challenge.pin_hash <> p_pin_hash then
    update public.tag_handoff_challenges
      set failed_attempts = failed_attempts + 1
      where item_id = p_item_id;
    insert into public.tag_handoff_audit (item_id, event_type)
      values (p_item_id, 'verification_failed');
    return query select false;
    return;
  end if;

  update public.tag_handoff_challenges
    set used_at = now()
    where item_id = p_item_id;
  update public.tag_items set is_lost = false where id = p_item_id;
  insert into public.tag_handoff_audit (item_id, event_type)
    values (p_item_id, 'verified_return');
  return query select true;
end;
$$;

revoke all on function public.issue_tag_handoff_challenge(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.complete_tag_handoff(uuid, text)
  from public, anon, authenticated;
grant execute on function public.issue_tag_handoff_challenge(uuid, text, text) to service_role;
grant execute on function public.complete_tag_handoff(uuid, text) to service_role;

create table if not exists public.tag_push_subscriptions (
  endpoint_hash text primary key check (char_length(endpoint_hash) = 64),
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  created_at timestamptz not null default now()
);

alter table public.tag_push_subscriptions enable row level security;
revoke all on public.tag_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.tag_push_subscriptions to service_role;

create or replace function public.nearby_tag_push_subscriptions(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision default 10
)
returns table(endpoint_hash text, endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.endpoint_hash, s.endpoint, s.p256dh, s.auth
  from public.tag_push_subscriptions s
  where 6371 * 2 * asin(sqrt(
    power(sin(radians(s.latitude - p_latitude) / 2), 2)
    + cos(radians(p_latitude)) * cos(radians(s.latitude))
    * power(sin(radians(s.longitude - p_longitude) / 2), 2)
  )) <= least(greatest(p_radius_km, 1), 25)
  limit 500;
$$;

revoke all on function public.nearby_tag_push_subscriptions(double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.nearby_tag_push_subscriptions(double precision, double precision, double precision)
  to service_role;

create or replace function public.check_tag_push_subscription_rate_limit(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if char_length(p_ip_hash) <> 64 then
    raise exception 'invalid rate limit key';
  end if;
  delete from public.public_api_rate_limits
    where window_start < date_trunc('hour', now()) - interval '1 day';
  insert into public.public_api_rate_limits (ip_hash, window_start, report_count)
  values (p_ip_hash, date_trunc('hour', now()), 1)
  on conflict (ip_hash, window_start)
  do update set report_count = public.public_api_rate_limits.report_count + 1
  returning report_count into v_count;
  if v_count > 10 then
    raise exception 'push subscription rate limit exceeded';
  end if;
  return true;
end;
$$;

create or replace function public.check_tag_handoff_verify_rate_limit(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if char_length(p_ip_hash) <> 64 then
    raise exception 'invalid rate limit key';
  end if;
  delete from public.public_api_rate_limits
    where window_start < date_trunc('hour', now()) - interval '1 day';
  insert into public.public_api_rate_limits (ip_hash, window_start, report_count)
  values (p_ip_hash, date_trunc('hour', now()), 1)
  on conflict (ip_hash, window_start)
  do update set report_count = public.public_api_rate_limits.report_count + 1
  returning report_count into v_count;
  if v_count > 10 then
    raise exception 'handoff verification rate limit exceeded';
  end if;
  return true;
end;
$$;

revoke all on function public.check_tag_push_subscription_rate_limit(text)
  from public, anon, authenticated;
revoke all on function public.check_tag_handoff_verify_rate_limit(text)
  from public, anon, authenticated;
grant execute on function public.check_tag_push_subscription_rate_limit(text) to service_role;
grant execute on function public.check_tag_handoff_verify_rate_limit(text) to service_role;
