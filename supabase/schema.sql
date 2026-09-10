-- Pulse Radar — Supabase schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.
--
-- Trust model: the anon key ships inside the Mini App bundle and is public, so
-- nothing here trusts a caller-supplied user id. Identity comes from the
-- `telegram_id` claim of a JWT minted by the `telegram-auth` edge function,
-- which is the only component that validates Telegram's initData signature.

-- `gen_random_bytes` (check-in tokens) lives in pgcrypto. Supabase installs it
-- into the `extensions` schema, so functions that use it must carry that
-- schema on their search_path as well as `public`.
create extension if not exists pgcrypto;

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
  last_step_sync_at timestamptz,
  onboarded_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

-- Kept separate from the create so existing projects pick it up on re-apply.
alter table public.users add column if not exists onboarded_at timestamptz;

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
create index if not exists idx_activities_user_day on public.activities(user_id, created_at);
create index if not exists idx_checkins_venue_id on public.checkins(venue_id);
create index if not exists idx_checkins_user_id on public.checkins(user_id);
create index if not exists idx_offers_venue_id on public.offers(venue_id);
create index if not exists idx_venues_owner on public.venues(owner_user_id);

-- ============================================================================
-- Identity helper
-- ============================================================================

-- Reads the verified Telegram ID out of the request JWT. Returns null for
-- anonymous callers, which every policy and RPC below treats as "no access".
--
-- Anonymous requests leave `request.jwt.claims` unset, empty, or non-numeric
-- depending on the PostgREST version, and this function runs inside RLS
-- policies — so a raw cast here would surface as a 500 on ordinary anonymous
-- reads instead of an empty result. Every malformed case degrades to null.
create or replace function public.current_telegram_id()
returns bigint
language plpgsql
stable
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_id bigint;
begin
  if v_claims is null then
    return null;
  end if;

  begin
    v_id := nullif(v_claims::json ->> 'telegram_id', '')::bigint;
  exception when others then
    return null;
  end;

  return v_id;
end;
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- No table grants INSERT/UPDATE/DELETE to clients; all mutation flows through
-- the SECURITY DEFINER RPCs below, which derive the actor from the JWT.

alter table public.users enable row level security;
alter table public.venues enable row level security;
alter table public.offers enable row level security;
alter table public.activities enable row level security;
alter table public.checkin_tokens enable row level security;
alter table public.checkins enable row level security;
alter table public.redemptions enable row level security;

-- Dropped so the whole script stays re-runnable. The first group is the
-- pre-JWT policy names, kept so an existing project upgrades cleanly.
drop policy if exists "offers are publicly readable" on public.offers;
drop policy if exists "venues are publicly readable" on public.venues;
drop policy if exists "users are readable" on public.users;
drop policy if exists "activities are readable" on public.activities;
drop policy if exists "checkins are readable" on public.checkins;
drop policy if exists "redemptions are readable" on public.redemptions;

drop policy if exists "offers are readable by everyone" on public.offers;
drop policy if exists "venues are readable by everyone" on public.venues;
drop policy if exists "users read own row" on public.users;
drop policy if exists "activities read own rows" on public.activities;
drop policy if exists "checkins read own rows" on public.checkins;
drop policy if exists "redemptions read own rows" on public.redemptions;

-- The partner catalogue is public marketing data.
create policy "offers are readable by everyone" on public.offers
  for select using (true);

create policy "venues are readable by everyone" on public.venues
  for select using (true);

-- Everything user-scoped is readable only by its owner.
create policy "users read own row" on public.users
  for select using (id = public.current_telegram_id());

create policy "activities read own rows" on public.activities
  for select using (user_id = public.current_telegram_id());

create policy "checkins read own rows" on public.checkins
  for select using (
    user_id = public.current_telegram_id()
    or venue_id in (
      select id from public.venues where owner_user_id = public.current_telegram_id()
    )
  );

create policy "redemptions read own rows" on public.redemptions
  for select using (
    user_id = public.current_telegram_id()
    or offer_id in (
      select o.id from public.offers o
      join public.venues v on v.id = o.venue_id
      where v.owner_user_id = public.current_telegram_id()
    )
  );

-- checkin_tokens is never read directly by clients — `confirm_checkin`
-- validates tokens internally, so no select policy is granted at all.

-- ============================================================================
-- RPC: upsert_user_session
-- Creates the user row on first launch (capturing first-touch referral
-- attribution) or refreshes the profile fields otherwise.
-- ============================================================================
create or replace function public.upsert_user_session(
  p_first_name text,
  p_username text,
  p_referrer_id bigint
) returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint := public.current_telegram_id();
  v_user public.users;
begin
  if v_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.users (id, first_name, username, referrer_id, last_active_date)
  values (
    v_id,
    p_first_name,
    p_username,
    case
      when p_referrer_id is not null
       and p_referrer_id <> v_id
       and exists (select 1 from public.users where id = p_referrer_id)
      then p_referrer_id
      else null
    end,
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
--
-- Steps come from a device the user controls, so they can never be fully
-- trusted. Two server-side ceilings bound the damage: a walking-cadence limit
-- based on elapsed time since the last sync, and a daily cap. Points are
-- always derived here — never accepted from the caller.
-- ============================================================================
create or replace function public.sync_step_activity(p_steps int)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint := public.current_telegram_id();
  v_user public.users;
  v_elapsed_seconds double precision;
  v_cadence_cap int;
  v_today_steps int;
  v_daily_remaining int;
  v_steps int;
  v_points int;
  v_referrer_id bigint;
  v_grandreferrer_id bigint;
  v_new_streak int;
begin
  if v_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_steps is null or p_steps <= 0 then
    return (select u from public.users u where u.id = v_id);
  end if;

  select * into v_user from public.users where id = v_id for update;
  if not found then
    raise exception 'User not found';
  end if;

  -- Cadence ceiling: 4 steps/second is beyond a sprint, so anything above it
  -- is a client bug or forgery. First sync of a session gets a 60s allowance.
  v_elapsed_seconds := extract(epoch from (
    timezone('utc', now()) - coalesce(v_user.last_step_sync_at, timezone('utc', now()) - interval '60 seconds')
  ));
  v_cadence_cap := greatest(0, ceil(v_elapsed_seconds * 4))::int;

  select coalesce(sum(steps_count), 0) into v_today_steps
    from public.activities
    where user_id = v_id and created_at >= current_date;
  v_daily_remaining := greatest(0, 30000 - v_today_steps);

  v_steps := least(p_steps, v_cadence_cap, v_daily_remaining);
  if v_steps <= 0 then
    update public.users set last_step_sync_at = timezone('utc', now()) where id = v_id;
    return (select u from public.users u where u.id = v_id);
  end if;

  v_points := floor(v_steps::numeric / 1000 * 100)::int;

  if v_user.last_active_date = current_date then
    v_new_streak := v_user.streak;
  elsif v_user.last_active_date = current_date - 1 then
    v_new_streak := v_user.streak + 1;
  else
    v_new_streak := 1;
  end if;

  update public.users
    set total_steps = total_steps + v_steps,
        balance = balance + v_points,
        streak = v_new_streak,
        last_active_date = current_date,
        last_step_sync_at = timezone('utc', now())
    where id = v_id
    returning * into v_user;

  insert into public.activities (user_id, steps_count, points_earned)
    values (v_id, v_steps, v_points);

  if v_points > 0 and v_user.referrer_id is not null then
    v_referrer_id := v_user.referrer_id;

    update public.users
      set balance = balance + floor(v_points * 0.10)
      where id = v_referrer_id;

    select referrer_id into v_grandreferrer_id from public.users where id = v_referrer_id;
    if v_grandreferrer_id is not null and v_grandreferrer_id <> v_id then
      update public.users
        set balance = balance + floor(v_points * 0.05)
        where id = v_grandreferrer_id;
    end if;
  end if;

  return v_user;
end;
$$;

-- ============================================================================
-- RPC: complete_onboarding
-- Marks the intro flow as seen. Stored server-side rather than in
-- localStorage so it survives a new device or a cleared WebView.
-- ============================================================================
create or replace function public.complete_onboarding()
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint := public.current_telegram_id();
  v_user public.users;
begin
  if v_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.users
    set onboarded_at = coalesce(onboarded_at, timezone('utc', now()))
    where id = v_id
    returning * into v_user;

  if not found then
    raise exception 'User not found';
  end if;

  return v_user;
end;
$$;

-- ============================================================================
-- RPC: referral_counts
-- ============================================================================
create or replace function public.referral_counts()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'tier1', (
      select count(*) from public.users
      where referrer_id = public.current_telegram_id()
        and public.current_telegram_id() is not null
    ),
    'tier2', (
      select count(*) from public.users u2
      where public.current_telegram_id() is not null
        and u2.referrer_id in (
          select id from public.users where referrer_id = public.current_telegram_id()
        )
    )
  );
$$;

-- ============================================================================
-- RPC: generate_checkin_token
-- Mints a short-lived QR payload. Restricted to the venue's owner — otherwise
-- any user could mint a valid token for any venue and check in remotely,
-- defeating the QR half of the verification entirely.
-- ============================================================================
create or replace function public.generate_checkin_token(
  p_venue_id uuid,
  p_ttl_seconds int default 60
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id bigint := public.current_telegram_id();
  v_token text;
begin
  if v_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.venues where id = p_venue_id and owner_user_id = v_id
  ) then
    raise exception 'Not authorised for this venue';
  end if;

  -- Bound the TTL so a caller cannot mint a effectively permanent code.
  p_ttl_seconds := least(greatest(coalesce(p_ttl_seconds, 60), 15), 300);

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
  v_id bigint := public.current_telegram_id();
  v_venue_id uuid;
  v_venue_lat double precision;
  v_venue_lng double precision;
  v_distance_m double precision;
  v_points bigint := 50;
  v_checkin public.checkins;
begin
  if v_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Location is required to check in';
  end if;

  select o.venue_id, v.location_lat, v.location_lng
    into v_venue_id, v_venue_lat, v_venue_lng
    from public.offers o
    join public.venues v on v.id = o.venue_id
    where o.id = p_offer_id;

  if v_venue_id is null then
    raise exception 'Offer % has no linked venue', p_offer_id;
  end if;

  -- One check-in per venue per day keeps a single valid QR from being farmed.
  if exists (
    select 1 from public.checkins
    where user_id = v_id and venue_id = v_venue_id and created_at >= current_date
  ) then
    raise exception 'Already checked in at this venue today';
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
    raise exception 'You are too far from the venue (%m away)', round(v_distance_m);
  end if;

  update public.checkin_tokens set used_by_user_id = v_id where token = p_qr_payload;

  insert into public.checkins (user_id, offer_id, venue_id, lat, lng, points_earned)
    values (v_id, p_offer_id, v_venue_id, p_lat, p_lng, v_points)
    returning * into v_checkin;

  update public.users set balance = balance + v_points where id = v_id;

  return v_checkin;
end;
$$;

-- ============================================================================
-- RPC: redeem_offer
-- ============================================================================
create or replace function public.redeem_offer(p_offer_id uuid)
returns public.redemptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint := public.current_telegram_id();
  v_cost bigint;
  v_balance bigint;
  v_redemption public.redemptions;
begin
  if v_id is null then
    raise exception 'Not authenticated';
  end if;

  select cost_in_points into v_cost from public.offers where id = p_offer_id;
  if v_cost is null then
    raise exception 'Offer not found';
  end if;

  select balance into v_balance from public.users where id = v_id for update;
  if v_balance is null then
    raise exception 'User not found';
  end if;
  if v_balance < v_cost then
    raise exception 'Insufficient balance';
  end if;

  update public.users set balance = balance - v_cost where id = v_id;

  insert into public.redemptions (user_id, offer_id, points_spent)
    values (v_id, p_offer_id, v_cost)
    returning * into v_redemption;

  return v_redemption;
end;
$$;

-- ============================================================================
-- RPC: venue_analytics — restricted to the venue's owner.
-- ============================================================================
create or replace function public.venue_analytics(p_venue_id uuid)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_id bigint := public.current_telegram_id();
begin
  if v_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.venues where id = p_venue_id and owner_user_id = v_id
  ) then
    raise exception 'Not authorised for this venue';
  end if;

  return (
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
    )
  );
end;
$$;

-- ============================================================================
-- Grants — only the authenticated role (i.e. a verified Telegram user) may
-- call the RPCs. The anon key alone can read the public offer catalogue.
-- ============================================================================
revoke all on function
  public.upsert_user_session(text, text, bigint),
  public.sync_step_activity(int),
  public.complete_onboarding(),
  public.referral_counts(),
  public.generate_checkin_token(uuid, int),
  public.confirm_checkin(uuid, text, double precision, double precision),
  public.redeem_offer(uuid),
  public.venue_analytics(uuid)
from public, anon;

grant execute on function
  public.upsert_user_session(text, text, bigint),
  public.sync_step_activity(int),
  public.complete_onboarding(),
  public.referral_counts(),
  public.generate_checkin_token(uuid, int),
  public.confirm_checkin(uuid, text, double precision, double precision),
  public.redeem_offer(uuid),
  public.venue_analytics(uuid)
to authenticated;
