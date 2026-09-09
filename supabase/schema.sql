-- Pulse Radar — Supabase schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.users (
  id bigint primary key, -- Telegram user ID
  first_name text,
  username text,
  total_steps bigint not null default 0,
  balance bigint not null default 0,
  referrer_id bigint references public.users(id),
  streak int not null default 0,
  last_active_date date,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id bigint references public.users(id),
  location_lat double precision not null,
  location_lng double precision not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references public.venues(id) on delete cascade,
  title text not null,
  description text,
  cost_in_points bigint not null check (cost_in_points >= 0),
  partner_name text not null,
  location_lat double precision,
  location_lng double precision,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id bigint references public.users(id) on delete cascade,
  steps_count int not null default 0,
  points_earned int not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.checkin_tokens (
  token text primary key,
  venue_id uuid not null references public.venues(id) on delete cascade,
  expires_at timestamptz not null,
  used_by_user_id bigint references public.users(id),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.users(id) on delete cascade,
  offer_id uuid references public.offers(id),
  venue_id uuid not null references public.venues(id),
  lat double precision not null,
  lng double precision not null,
  points_earned bigint not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.users(id) on delete cascade,
  offer_id uuid not null references public.offers(id),
  points_spent bigint not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_users_referrer_id on public.users(referrer_id);
create index if not exists idx_activities_user_id on public.activities(user_id);
create index if not exists idx_checkins_venue_id on public.checkins(venue_id);
create index if not exists idx_checkins_user_id on public.checkins(user_id);
create index if not exists idx_offers_venue_id on public.offers(venue_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- The anon/authenticated key is never trusted to write balances or referral
-- state directly — all mutation happens through SECURITY DEFINER RPCs below.
-- Tables are readable (own rows only, where applicable) but not writable
-- from the client.

alter table public.users enable row level security;
alter table public.venues enable row level security;
alter table public.offers enable row level security;
alter table public.activities enable row level security;
alter table public.checkin_tokens enable row level security;
alter table public.checkins enable row level security;
alter table public.redemptions enable row level security;

create policy "offers are publicly readable" on public.offers
  for select using (true);

create policy "venues are publicly readable" on public.venues
  for select using (true);

-- Broad anon-read policies below assume the Telegram initData signature is
-- verified server-side (edge function / bot) before issuing a Supabase
-- session; tighten to auth.uid()-scoped policies once that JWT bridge is in
-- place.
create policy "users are readable" on public.users
  for select using (true);

create policy "activities are readable" on public.activities
  for select using (true);

create policy "checkins are readable" on public.checkins
  for select using (true);

create policy "redemptions are readable" on public.redemptions
  for select using (true);

-- ============================================================================
-- RPC: upsert_user_session
-- Creates the user row on first launch (capturing first-touch referral
-- attribution) or returns the existing row unchanged otherwise.
-- ============================================================================
create or replace function public.upsert_user_session(
  p_id bigint,
  p_first_name text,
  p_username text,
  p_referrer_id bigint
) returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users;
begin
  insert into public.users (id, first_name, username, referrer_id, last_active_date)
  values (
    p_id,
    p_first_name,
    p_username,
    case when p_referrer_id is not null and p_referrer_id <> p_id then p_referrer_id else null end,
    current_date
  )
  on conflict (id) do update
    set first_name = excluded.first_name,
        username = excluded.username
  returning * into v_user;

  return v_user;
end;
$$;

-- ============================================================================
-- RPC: sync_step_activity
-- Credits step-derived points, updates the daily streak, and cascades the
-- 2-tier referral reward (10% to the direct referrer, 5% to their referrer).
-- ============================================================================
create or replace function public.sync_step_activity(
  p_user_id bigint,
  p_steps int,
  p_points int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id bigint;
  v_grandreferrer_id bigint;
  v_last_active date;
  v_new_streak int;
begin
  if p_steps <= 0 then
    return;
  end if;

  select referrer_id, last_active_date into v_referrer_id, v_last_active
  from public.users where id = p_user_id for update;

  if v_last_active = current_date then
    v_new_streak := (select streak from public.users where id = p_user_id);
  elsif v_last_active = current_date - 1 then
    v_new_streak := (select streak from public.users where id = p_user_id) + 1;
  else
    v_new_streak := 1;
  end if;

  update public.users
    set total_steps = total_steps + p_steps,
        balance = balance + p_points,
        streak = v_new_streak,
        last_active_date = current_date
    where id = p_user_id;

  insert into public.activities (user_id, steps_count, points_earned)
    values (p_user_id, p_steps, p_points);

  if v_referrer_id is not null then
    update public.users
      set balance = balance + floor(p_points * 0.10)
      where id = v_referrer_id;

    select referrer_id into v_grandreferrer_id from public.users where id = v_referrer_id;
    if v_grandreferrer_id is not null then
      update public.users
        set balance = balance + floor(p_points * 0.05)
        where id = v_grandreferrer_id;
    end if;
  end if;
end;
$$;

-- ============================================================================
-- RPC: referral_counts
-- ============================================================================
create or replace function public.referral_counts(p_user_id bigint)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'tier1', (select count(*) from public.users where referrer_id = p_user_id),
    'tier2', (
      select count(*) from public.users u2
      where u2.referrer_id in (select id from public.users where referrer_id = p_user_id)
    )
  );
$$;

-- ============================================================================
-- RPC: generate_checkin_token
-- Called by the merchant portal to mint a short-lived QR payload for a venue.
-- ============================================================================
create or replace function public.generate_checkin_token(
  p_venue_id uuid,
  p_ttl_seconds int default 60
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  v_token := encode(gen_random_bytes(16), 'hex');

  insert into public.checkin_tokens (token, venue_id, expires_at)
    values (v_token, p_venue_id, timezone('utc', now()) + make_interval(secs => p_ttl_seconds));

  delete from public.checkin_tokens
    where venue_id = p_venue_id and expires_at < timezone('utc', now());

  return v_token;
end;
$$;

-- ============================================================================
-- RPC: confirm_checkin
-- Dual verification: the QR token must belong to the offer's venue and be
-- unexpired/unused, AND the reported coordinates must be within the geofence.
-- ============================================================================
create or replace function public.confirm_checkin(
  p_user_id bigint,
  p_offer_id uuid,
  p_qr_payload text,
  p_lat double precision,
  p_lng double precision
) returns public.checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue_id uuid;
  v_venue_lat double precision;
  v_venue_lng double precision;
  v_distance_m double precision;
  v_points bigint := 50;
  v_checkin public.checkins;
begin
  select o.venue_id, v.location_lat, v.location_lng
    into v_venue_id, v_venue_lat, v_venue_lng
    from public.offers o
    join public.venues v on v.id = o.venue_id
    where o.id = p_offer_id;

  if v_venue_id is null then
    raise exception 'Offer % has no linked venue', p_offer_id;
  end if;

  perform 1 from public.checkin_tokens
    where token = p_qr_payload
      and venue_id = v_venue_id
      and expires_at > timezone('utc', now())
      and used_by_user_id is null
    for update;

  if not found then
    raise exception 'QR code is invalid or expired';
  end if;

  v_distance_m := 6371000 * 2 * asin(sqrt(
    sin(radians(p_lat - v_venue_lat) / 2) ^ 2 +
    cos(radians(v_venue_lat)) * cos(radians(p_lat)) *
    sin(radians(p_lng - v_venue_lng) / 2) ^ 2
  ));

  if v_distance_m > 150 then
    raise exception 'You are too far from the venue (%.0fm away)', v_distance_m;
  end if;

  update public.checkin_tokens set used_by_user_id = p_user_id where token = p_qr_payload;

  insert into public.checkins (user_id, offer_id, venue_id, lat, lng, points_earned)
    values (p_user_id, p_offer_id, v_venue_id, p_lat, p_lng, v_points)
    returning * into v_checkin;

  update public.users set balance = balance + v_points where id = p_user_id;

  return v_checkin;
end;
$$;

-- ============================================================================
-- RPC: redeem_offer
-- ============================================================================
create or replace function public.redeem_offer(
  p_user_id bigint,
  p_offer_id uuid
) returns public.redemptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost bigint;
  v_balance bigint;
  v_redemption public.redemptions;
begin
  select cost_in_points into v_cost from public.offers where id = p_offer_id;
  if v_cost is null then
    raise exception 'Offer not found';
  end if;

  select balance into v_balance from public.users where id = p_user_id for update;
  if v_balance < v_cost then
    raise exception 'Insufficient balance';
  end if;

  update public.users set balance = balance - v_cost where id = p_user_id;

  insert into public.redemptions (user_id, offer_id, points_spent)
    values (p_user_id, p_offer_id, v_cost)
    returning * into v_redemption;

  return v_redemption;
end;
$$;

-- ============================================================================
-- RPC: venue_analytics
-- ============================================================================
create or replace function public.venue_analytics(p_venue_id uuid)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'checkins_today', (
      select count(*) from public.checkins
      where venue_id = p_venue_id and created_at >= current_date
    ),
    'checkins_7d', (
      select count(*) from public.checkins
      where venue_id = p_venue_id and created_at >= timezone('utc', now()) - interval '7 days'
    ),
    'unique_visitors_7d', (
      select count(distinct user_id) from public.checkins
      where venue_id = p_venue_id and created_at >= timezone('utc', now()) - interval '7 days'
    ),
    'return_rate', (
      select coalesce(
        (count(*) filter (where visit_count > 1))::float / nullif(count(*), 0),
        0
      )
      from (
        select user_id, count(*) as visit_count
        from public.checkins
        where venue_id = p_venue_id
        group by user_id
      ) v
    )
  );
$$;

grant execute on function
  public.upsert_user_session(bigint, text, text, bigint),
  public.sync_step_activity(bigint, int, int),
  public.referral_counts(bigint),
  public.generate_checkin_token(uuid, int),
  public.confirm_checkin(bigint, uuid, text, double precision, double precision),
  public.redeem_offer(bigint, uuid),
  public.venue_analytics(uuid)
to anon, authenticated;
