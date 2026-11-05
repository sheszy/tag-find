create table if not exists public.tag_items (
  id uuid primary key,
  owner_token_hash text not null,
  name text not null,
  category text not null,
  owner_name text not null,
  contact text not null default '',
  reward text not null default '',
  message text not null default '',
  offline_instructions text not null default '',
  is_lost boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.finder_reports (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.tag_items(id) on delete cascade,
  notes text not null check (char_length(notes) between 2 and 1000),
  coords text not null default '' check (char_length(coords) <= 64),
  created_at timestamptz not null default now()
);

create index if not exists finder_reports_item_created_idx
  on public.finder_reports (item_id, created_at desc);

create table if not exists public.public_api_rate_limits (
  ip_hash text not null,
  window_start timestamptz not null,
  report_count integer not null default 0,
  primary key (ip_hash, window_start)
);
create index if not exists public_api_rate_limits_window_idx
  on public.public_api_rate_limits (window_start);

alter table public.tag_items enable row level security;
alter table public.finder_reports enable row level security;
alter table public.public_api_rate_limits enable row level security;

revoke all on public.tag_items, public.finder_reports, public.public_api_rate_limits
  from anon, authenticated;
grant select, insert, update, delete on public.tag_items to service_role;
grant select, insert, delete on public.finder_reports to service_role;
grant select, insert, update, delete on public.public_api_rate_limits to service_role;

create or replace function public.check_tag_creation_rate_limit(p_ip_hash text)
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

  if v_count > 5 then
    raise exception 'tag creation rate limit exceeded';
  end if;
  return true;
end;
$$;

create or replace function public.submit_finder_report(
  p_item_id uuid,
  p_notes text,
  p_coords text,
  p_ip_hash text
)
returns setof public.finder_reports
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if char_length(trim(p_notes)) < 2 or char_length(p_notes) > 1000
    or char_length(p_coords) > 64 or char_length(p_ip_hash) <> 64 then
    raise exception 'invalid finder report';
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

  return query
    insert into public.finder_reports (item_id, notes, coords)
    values (p_item_id, trim(p_notes), coalesce(trim(p_coords), ''))
    returning *;
end;
$$;

revoke all on function public.submit_finder_report(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_finder_report(uuid, text, text, text) to service_role;
revoke all on function public.check_tag_creation_rate_limit(text) from public, anon, authenticated;
grant execute on function public.check_tag_creation_rate_limit(text) to service_role;
