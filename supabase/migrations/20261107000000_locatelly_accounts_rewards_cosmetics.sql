create table if not exists public.tag_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  coins integer not null default 0 check (coins >= 0),
  unlocked_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(unlocked_items) = 'array'),
  customizations jsonb not null default '{}'::jsonb
    check (jsonb_typeof(customizations) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tag_cosmetic_catalog (
  id text primary key,
  category text not null check (category in ('theme', 'wallpaper', 'card_style', 'qr_frame', 'qr_palette', 'qr_corner', 'qr_badge')),
  cost integer not null check (cost >= 0),
  value text not null
);

insert into public.tag_cosmetic_catalog (id, category, cost, value) values
  ('theme-neon', 'theme', 120, 'neon'),
  ('theme-sunset', 'theme', 120, 'sunset'),
  ('pattern-checker', 'wallpaper', 80, 'checker'),
  ('cards-flat', 'card_style', 60, 'flat'),
  ('qr-frame-blue', 'qr_frame', 75, 'blue'),
  ('qr-palette-mint', 'qr_palette', 60, 'mint'),
  ('qr-corner-soft', 'qr_corner', 40, 'soft'),
  ('qr-badge-star', 'qr_badge', 50, 'star')
on conflict (id) do update
  set category = excluded.category, cost = excluded.cost, value = excluded.value;

create table if not exists public.tag_claim_sessions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.tag_items(id) on delete cascade,
  finder_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists tag_claim_sessions_item_idx
  on public.tag_claim_sessions (item_id, created_at desc);

alter table public.finder_reports
  add column if not exists claim_session_id uuid
  references public.tag_claim_sessions(id) on delete set null;

alter table public.tag_handoff_challenges
  add column if not exists finder_user_id uuid references auth.users(id) on delete set null;

alter table public.tag_handoff_audit
  add column if not exists finder_user_id uuid references auth.users(id) on delete set null;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  claim_session_id uuid not null references public.tag_claim_sessions(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('owner', 'finder')),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists messages_claim_created_idx
  on public.messages (claim_session_id, created_at);

alter table public.tag_profiles enable row level security;
alter table public.tag_cosmetic_catalog enable row level security;
alter table public.tag_claim_sessions enable row level security;
alter table public.messages enable row level security;

revoke all on public.tag_profiles, public.tag_cosmetic_catalog,
  public.tag_claim_sessions, public.messages from anon, authenticated;
grant select on public.tag_profiles to authenticated;
create policy "Users can read their own Locatelly profile"
  on public.tag_profiles for select to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.tag_profiles to service_role;
grant select, insert, update, delete on public.tag_cosmetic_catalog to service_role;
grant select, insert, update, delete on public.tag_claim_sessions to service_role;
grant select, insert, update, delete on public.messages to service_role;
grant select, insert, update, delete on public.finder_reports to service_role;

create or replace function public.send_tag_message(
  p_item_id uuid,
  p_claim_session_id uuid,
  p_sender_role text,
  p_sender_user_id uuid,
  p_body text
)
returns setof public.messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_lost boolean;
  v_claim public.tag_claim_sessions%rowtype;
begin
  if p_sender_role not in ('owner', 'finder')
    or char_length(trim(p_body)) not between 1 and 4000 then
    raise exception 'invalid message';
  end if;

  select is_lost into v_is_lost
    from public.tag_items where id = p_item_id for update;
  if not found then raise exception 'item not found'; end if;

  select * into v_claim
    from public.tag_claim_sessions
    where id = p_claim_session_id and item_id = p_item_id
    for update;
  if not found or v_claim.closed_at is not null or not v_is_lost then
    raise exception 'claim is closed';
  end if;

  if (p_sender_role = 'finder' and p_sender_user_id is distinct from v_claim.finder_user_id)
    or (p_sender_role = 'owner' and p_sender_user_id is not null) then
    raise exception 'message sender does not belong to this claim';
  end if;

  return query
    insert into public.messages (claim_session_id, sender_user_id, sender_role, body)
    values (p_claim_session_id, p_sender_user_id, p_sender_role, trim(p_body))
    returning *;
end;
$$;

revoke all on function public.send_tag_message(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.send_tag_message(uuid, uuid, text, uuid, text)
  to service_role;

create or replace function public.create_tag_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.tag_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_locatelly_profile on auth.users;
create trigger on_auth_user_created_locatelly_profile
  after insert on auth.users
  for each row execute function public.create_tag_profile_for_auth_user();

create or replace function public.clear_tag_messages_on_verified_return()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_lost and not new.is_lost then
    update public.tag_claim_sessions
      set closed_at = coalesce(closed_at, now())
      where item_id = new.id and closed_at is null;

    delete from public.messages
      where claim_session_id in (
        select id from public.tag_claim_sessions where item_id = new.id
      );
  end if;
  return new;
end;
$$;

drop trigger if exists clear_tag_messages_after_verified_return on public.tag_items;
create trigger clear_tag_messages_after_verified_return
  after update of is_lost on public.tag_items
  for each row execute function public.clear_tag_messages_on_verified_return();

drop function if exists public.submit_finder_report(uuid, text, text, text);
create or replace function public.submit_finder_report(
  p_item_id uuid,
  p_notes text,
  p_coords text,
  p_ip_hash text,
  p_finder_user_id uuid default null
)
returns setof public.finder_reports
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_claim_session_id uuid;
  v_item_is_lost boolean;
begin
  if char_length(trim(p_notes)) < 2 or char_length(p_notes) > 1000
    or char_length(p_coords) > 64 or char_length(p_ip_hash) <> 64 then
    raise exception 'invalid finder report';
  end if;

  if p_finder_user_id is not null and not exists (
    select 1 from auth.users where id = p_finder_user_id
  ) then
    raise exception 'invalid finder account';
  end if;

  delete from public.public_api_rate_limits
    where window_start < date_trunc('hour', now()) - interval '1 day';

  insert into public.public_api_rate_limits (ip_hash, window_start, report_count)
  values (p_ip_hash, date_trunc('hour', now()), 1)
  on conflict (ip_hash, window_start)
  do update set report_count = public.public_api_rate_limits.report_count + 1
  returning report_count into v_count;

  if v_count > 10 then
    raise exception 'finder report rate limit exceeded';
  end if;

  select is_lost into v_item_is_lost
    from public.tag_items where id = p_item_id for update;
  if not found then raise exception 'item not found'; end if;

  if p_finder_user_id is not null and v_item_is_lost then
    insert into public.tag_claim_sessions (item_id, finder_user_id)
    values (p_item_id, p_finder_user_id)
    returning id into v_claim_session_id;
  end if;

  return query
    insert into public.finder_reports (item_id, notes, coords, claim_session_id)
    values (p_item_id, trim(p_notes), coalesce(trim(p_coords), ''), v_claim_session_id)
    returning *;
end;
$$;

revoke all on function public.submit_finder_report(uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_finder_report(uuid, text, text, text, uuid)
  to service_role;

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

  insert into public.tag_handoff_challenges (item_id, pin_hash, expires_at, failed_attempts, used_at, finder_user_id)
  values (p_item_id, p_pin_hash, v_expires_at, 0, null, null)
  on conflict (item_id) do update
    set pin_hash = excluded.pin_hash,
        expires_at = excluded.expires_at,
        failed_attempts = 0,
        used_at = null,
        finder_user_id = null,
        created_at = now();

  return query select v_expires_at;
end;
$$;

drop function if exists public.complete_tag_handoff(uuid, text);
create or replace function public.complete_tag_handoff(
  p_item_id uuid,
  p_pin_hash text,
  p_finder_user_id uuid
)
returns table(verified boolean, coins_awarded integer, coins_balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.tag_handoff_challenges%rowtype;
  v_balance integer;
begin
  if char_length(p_pin_hash) <> 64 or p_finder_user_id is null
    or not exists (select 1 from auth.users where id = p_finder_user_id) then
    return query select false, 0, null::integer;
    return;
  end if;

  select * into v_challenge
    from public.tag_handoff_challenges
    where item_id = p_item_id
    for update;

  if not found or v_challenge.used_at is not null
    or v_challenge.expires_at <= now() or v_challenge.failed_attempts >= 5
    or not exists (select 1 from public.tag_items where id = p_item_id and is_lost) then
    insert into public.tag_handoff_audit (item_id, event_type, finder_user_id)
    values (p_item_id, 'verification_failed', p_finder_user_id);
    return query select false, 0, null::integer;
    return;
  end if;

  if v_challenge.pin_hash <> p_pin_hash then
    update public.tag_handoff_challenges
      set failed_attempts = failed_attempts + 1
      where item_id = p_item_id;
    insert into public.tag_handoff_audit (item_id, event_type, finder_user_id)
      values (p_item_id, 'verification_failed', p_finder_user_id);
    return query select false, 0, null::integer;
    return;
  end if;

  update public.tag_handoff_challenges
    set used_at = now(), finder_user_id = p_finder_user_id
    where item_id = p_item_id;
  insert into public.tag_handoff_audit (item_id, event_type, finder_user_id)
    values (p_item_id, 'verified_return', p_finder_user_id);
  update public.tag_items set is_lost = false where id = p_item_id;

  insert into public.tag_profiles (user_id)
    values (p_finder_user_id)
    on conflict (user_id) do nothing;
  update public.tag_profiles
    set coins = coins + 100, updated_at = now()
    where user_id = p_finder_user_id
    returning coins into v_balance;

  return query select true, 100, v_balance;
end;
$$;

revoke all on function public.issue_tag_handoff_challenge(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.issue_tag_handoff_challenge(uuid, text, text) to service_role;
revoke all on function public.complete_tag_handoff(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_tag_handoff(uuid, text, uuid) to service_role;

create or replace function public.purchase_tag_cosmetic(p_user_id uuid, p_cosmetic_id text)
returns table(purchased boolean, coins integer, unlocked_items jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cost integer;
  v_coins integer;
  v_unlocked jsonb;
begin
  select cost into v_cost from public.tag_cosmetic_catalog where id = p_cosmetic_id;
  if not found then raise exception 'unknown cosmetic'; end if;

  insert into public.tag_profiles (user_id)
    values (p_user_id) on conflict (user_id) do nothing;
  select tag_profiles.coins, tag_profiles.unlocked_items
    into v_coins, v_unlocked
    from public.tag_profiles where user_id = p_user_id for update;

  if v_unlocked ? p_cosmetic_id then
    return query select false, v_coins, v_unlocked;
    return;
  end if;
  if v_coins < v_cost then
    return query select false, v_coins, v_unlocked;
    return;
  end if;

  update public.tag_profiles
    set coins = coins - v_cost,
        unlocked_items = unlocked_items || jsonb_build_array(p_cosmetic_id),
        updated_at = now()
    where user_id = p_user_id
    returning tag_profiles.coins, tag_profiles.unlocked_items
      into v_coins, v_unlocked;
  return query select true, v_coins, v_unlocked;
end;
$$;

create or replace function public.equip_tag_cosmetic(p_user_id uuid, p_cosmetic_id text)
returns table(equipped boolean, customizations jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_category text;
  v_value text;
  v_customizations jsonb;
begin
  select category, value into v_category, v_value
    from public.tag_cosmetic_catalog where id = p_cosmetic_id;
  if not found then raise exception 'unknown cosmetic'; end if;

  update public.tag_profiles
    set customizations = jsonb_set(customizations, array[v_category], to_jsonb(v_value), true),
        updated_at = now()
    where user_id = p_user_id and unlocked_items ? p_cosmetic_id
    returning tag_profiles.customizations into v_customizations;
  if not found then
    select customizations into v_customizations
      from public.tag_profiles where user_id = p_user_id;
    return query select false, coalesce(v_customizations, '{}'::jsonb);
    return;
  end if;
  return query select true, v_customizations;
end;
$$;

revoke all on function public.purchase_tag_cosmetic(uuid, text)
  from public, anon, authenticated;
grant execute on function public.purchase_tag_cosmetic(uuid, text) to service_role;
revoke all on function public.equip_tag_cosmetic(uuid, text)
  from public, anon, authenticated;
grant execute on function public.equip_tag_cosmetic(uuid, text) to service_role;
