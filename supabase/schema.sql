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
-- Migration from the QR check-in model
-- ============================================================================
-- The catch engine replaces per-visit QR tokens with geofence + anti-cheat, so
-- the tables behind that flow are gone.
--
-- DESTRUCTIVE: this drops check-in history and the old offer catalogue. It is
-- written for a project that has not launched yet. If yours holds data you
-- care about, export it before applying.
drop table if exists public.redemptions cascade;
drop table if exists public.checkins cascade;
drop table if exists public.checkin_tokens cascade;
drop table if exists public.offers cascade;

-- `venues` predates the new spec under different column names.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'venues' and column_name = 'location_lat'
  ) then
    alter table public.venues rename column location_lat to lat;
    alter table public.venues rename column location_lng to lng;
  end if;
end
$$;

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
  -- Last catch position, kept for the teleport check in catch_bonus.
  last_catch_lat double precision,
  last_catch_lng double precision,
  last_catch_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

-- Kept separate from the create so existing projects pick these up on re-apply.
alter table public.users add column if not exists onboarded_at timestamptz;
alter table public.users add column if not exists last_catch_lat double precision;
alter table public.users add column if not exists last_catch_lng double precision;
alter table public.users add column if not exists last_catch_at timestamptz;

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  reward_points int not null default 150 check (reward_points >= 0),
  offer_title text not null,
  lat double precision not null,
  lng double precision not null,
  owner_user_id bigint references public.users(id),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.venues add column if not exists category text;
alter table public.venues add column if not exists reward_points int not null default 150;
alter table public.venues add column if not exists offer_title text;

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id bigint references public.users(id) on delete cascade,
  steps_count int not null default 0,
  points_earned int not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

-- One row per successful bonus catch. `distance_m` and `accuracy_m` are kept
-- for fraud review: a stream of catches at implausible accuracy is the
-- clearest signal of a spoofed device.
create table if not exists public.catches (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.users(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  points_awarded int not null,
  lat double precision not null,
  lng double precision not null,
  distance_m double precision,
  accuracy_m double precision,
  created_at timestamptz not null default timezone('utc', now())
);

-- Short-lived proof the user shows at the counter. Deliberately human-
-- readable: at MVP the merchant reads it off the screen, with no scanner or
-- POS integration to install.
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  catch_id uuid not null references public.catches(id) on delete cascade,
  user_id bigint not null references public.users(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  code text not null unique,
  offer_title text not null,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_users_referrer_id on public.users(referrer_id);
create index if not exists idx_activities_user_id on public.activities(user_id);
create index if not exists idx_activities_user_day on public.activities(user_id, created_at);
create index if not exists idx_catches_user_day on public.catches(user_id, created_at);
create index if not exists idx_catches_venue_id on public.catches(venue_id);
create index if not exists idx_coupons_user_id on public.coupons(user_id);
create index if not exists idx_coupons_code on public.coupons(code);
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
-- Tuning constants
-- ============================================================================
-- Kept as functions so the catch rules live in one place and the tests can
-- assert against the same values the engine uses.

-- The spec's radar zone. Effective radius is this plus the reported GPS
-- accuracy — see catch_bonus for why.
create or replace function public.catch_radius_m() returns double precision
  language sql immutable as $$ select 20::double precision $$;

-- Beyond this, a reading is too vague to prove presence anywhere.
create or replace function public.max_gps_accuracy_m() returns double precision
  language sql immutable as $$ select 100::double precision $$;

-- Faster than city driving between two catches means the position is forged.
create or replace function public.max_travel_speed_kmh() returns double precision
  language sql immutable as $$ select 120::double precision $$;

-- "Move to earn": a catch has to be preceded by actual walking.
create or replace function public.min_steps_for_catch() returns int
  language sql immutable as $$ select 500 $$;

create or replace function public.coupon_ttl_minutes() returns int
  language sql immutable as $$ select 15 $$;

-- Streak reward ladder. The UI renders the same steps, so both sides must be
-- read from here rather than each carrying its own formula.
create or replace function public.streak_multiplier(p_streak int)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_streak, 0) >= 7 then 1.5
    when coalesce(p_streak, 0) >= 3 then 1.2
    else 1.0
  end::numeric;
$$;

-- Great-circle distance in metres.
create or replace function public.distance_m(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
) returns double precision
language sql
immutable
as $$
  select 6371000 * 2 * asin(sqrt(
    sin(radians(p_lat2 - p_lat1) / 2) ^ 2 +
    cos(radians(p_lat1)) * cos(radians(p_lat2)) *
    sin(radians(p_lng2 - p_lng1) / 2) ^ 2
  ));
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- No table grants INSERT/UPDATE/DELETE to clients; all mutation flows through
-- the SECURITY DEFINER RPCs below, which derive the actor from the JWT.

alter table public.users enable row level security;
alter table public.venues enable row level security;
alter table public.activities enable row level security;
alter table public.catches enable row level security;
alter table public.coupons enable row level security;

-- Dropped so the whole script stays re-runnable. The first groups are older
-- policy names (pre-JWT, and the pre-catch check-in model), kept so an
-- existing project upgrades cleanly.
drop policy if exists "venues are publicly readable" on public.venues;
drop policy if exists "users are readable" on public.users;
drop policy if exists "activities are readable" on public.activities;

drop policy if exists "venues are readable by everyone" on public.venues;
drop policy if exists "users read own row" on public.users;
drop policy if exists "activities read own rows" on public.activities;
drop policy if exists "catches read own rows" on public.catches;
drop policy if exists "coupons read own rows" on public.coupons;

-- The venue catalogue is public marketing data — the map has to render it
-- before the user has gone anywhere.
create policy "venues are readable by everyone" on public.venues
  for select using (true);

-- Everything user-scoped is readable only by its owner (or the venue owner,
-- for venue-side rows).
create policy "users read own row" on public.users
  for select using (id = public.current_telegram_id());

create policy "activities read own rows" on public.activities
  for select using (user_id = public.current_telegram_id());

create policy "catches read own rows" on public.catches
  for select using (
    user_id = public.current_telegram_id()
    or venue_id in (
      select id from public.venues where owner_user_id = public.current_telegram_id()
    )
  );

create policy "coupons read own rows" on public.coupons
  for select using (
    user_id = public.current_telegram_id()
    or venue_id in (
      select id from public.venues where owner_user_id = public.current_telegram_id()
    )
  );

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

  if v_user.last_active_date = current_date then
    v_new_streak := v_user.streak;
  elsif v_user.last_active_date = current_date - 1 then
    v_new_streak := v_user.streak + 1;
  else
    v_new_streak := 1;
  end if;

  -- The multiplier follows the streak the user holds after today's activity,
  -- which is the number the home screen shows them.
  v_points := floor(
    (v_steps::numeric / 1000 * 100) * public.streak_multiplier(v_new_streak)
  )::int;

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
-- RPC: catch_bonus
-- The core loop: the user is physically at a venue and taps to collect.
--
-- Every input here comes from a device the user controls, so the geofence
-- alone proves nothing — a spoofed GPS is a settings toggle away on Android.
-- These layers each raise the cost of faking a visit:
--
--   * distance is computed server-side from the venue's stored coordinates;
--   * an implausible accuracy reading is refused outright, so a spoofer
--     cannot claim a 5km error radius and "overlap" every venue in the city;
--   * a genuine accuracy reading widens the radius, because a real phone at
--     the counter often reports 30-50m of error and would otherwise be
--     locked out;
--   * moving between two catches faster than a car is treated as teleporting;
--   * the day's step count must show the user actually walked somewhere;
--   * one catch per venue per day caps the value of any single bypass.
-- ============================================================================
create or replace function public.catch_bonus(
  p_venue_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision default null
) returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id bigint := public.current_telegram_id();
  v_user public.users;
  v_venue public.venues;
  v_distance_m double precision;
  v_allowed_radius double precision;
  v_steps_today int;
  v_elapsed_seconds double precision;
  v_travelled_m double precision;
  v_speed_kmh double precision;
  v_catch public.catches;
  v_coupon public.coupons;
  v_code text;
begin
  if v_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Location is required to catch a bonus';
  end if;

  select * into v_user from public.users where id = v_id for update;
  if not found then
    raise exception 'User not found';
  end if;

  select * into v_venue from public.venues where id = p_venue_id;
  if not found then
    raise exception 'Venue not found';
  end if;

  -- A missing accuracy reading is treated as the worst tolerated case rather
  -- than as "perfect", so omitting the field is never an advantage.
  if p_accuracy_m is null then
    p_accuracy_m := public.max_gps_accuracy_m();
  end if;
  if p_accuracy_m < 0 or p_accuracy_m > public.max_gps_accuracy_m() then
    raise exception 'Your location is too imprecise right now — move outside and try again';
  end if;

  v_distance_m := public.distance_m(p_lat, p_lng, v_venue.lat, v_venue.lng);
  v_allowed_radius := public.catch_radius_m() + p_accuracy_m;

  if v_distance_m > v_allowed_radius then
    raise exception 'You are % metres away — get closer to catch this bonus',
      round(v_distance_m - public.catch_radius_m());
  end if;

  if exists (
    select 1 from public.catches
    where user_id = v_id and venue_id = p_venue_id and created_at >= current_date
  ) then
    raise exception 'You already caught this bonus today';
  end if;

  select coalesce(sum(steps_count), 0) into v_steps_today
    from public.activities
    where user_id = v_id and created_at >= current_date;
  if v_steps_today < public.min_steps_for_catch() then
    raise exception 'Walk at least % steps today before catching a bonus',
      public.min_steps_for_catch();
  end if;

  -- Teleport check against the previous catch.
  if v_user.last_catch_at is not null
     and v_user.last_catch_lat is not null then
    v_elapsed_seconds := greatest(
      extract(epoch from (timezone('utc', now()) - v_user.last_catch_at)), 1
    );
    v_travelled_m := public.distance_m(
      v_user.last_catch_lat, v_user.last_catch_lng, p_lat, p_lng
    );
    v_speed_kmh := (v_travelled_m / v_elapsed_seconds) * 3.6;

    if v_speed_kmh > public.max_travel_speed_kmh() then
      raise exception 'Suspicious movement detected — please try again shortly';
    end if;
  end if;

  insert into public.catches (
    user_id, venue_id, points_awarded, lat, lng, distance_m, accuracy_m
  )
  values (
    v_id, p_venue_id, v_venue.reward_points, p_lat, p_lng, v_distance_m, p_accuracy_m
  )
  returning * into v_catch;

  update public.users
    set balance = balance + v_venue.reward_points,
        last_catch_lat = p_lat,
        last_catch_lng = p_lng,
        last_catch_at = timezone('utc', now())
    where id = v_id
    returning * into v_user;

  -- Six characters from an unambiguous alphabet (no 0/O/1/I), because a
  -- cashier reads this off a phone screen.
  v_code := (
    select string_agg(
      substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
             1 + floor(random() * 32)::int, 1), ''
    )
    from generate_series(1, 6)
  );

  insert into public.coupons (
    catch_id, user_id, venue_id, code, offer_title, expires_at
  )
  values (
    v_catch.id, v_id, p_venue_id, v_code, v_venue.offer_title,
    timezone('utc', now()) + make_interval(mins => public.coupon_ttl_minutes())
  )
  returning * into v_coupon;

  -- Referral cascade on catch points: 10% to the referrer, 5% above them.
  if v_user.referrer_id is not null then
    update public.users
      set balance = balance + floor(v_venue.reward_points * 0.10)
      where id = v_user.referrer_id;

    update public.users
      set balance = balance + floor(v_venue.reward_points * 0.05)
      where id = (select referrer_id from public.users where id = v_user.referrer_id)
        and id <> v_id;
  end if;

  return json_build_object(
    'points_awarded', v_venue.reward_points,
    'balance', v_user.balance,
    'distance_m', round(v_distance_m),
    'coupon', json_build_object(
      'code', v_coupon.code,
      'offer_title', v_coupon.offer_title,
      'expires_at', v_coupon.expires_at
    )
  );
end;
$$;

-- ============================================================================
-- RPC: active_coupons
-- The coupon screen after a catch, and on relaunch within the window.
-- ============================================================================
create or replace function public.active_coupons()
returns setof public.coupons
language sql
security definer
set search_path = public
stable
as $$
  select * from public.coupons
  where user_id = public.current_telegram_id()
    and public.current_telegram_id() is not null
    and redeemed_at is null
    and expires_at > timezone('utc', now())
  order by expires_at;
$$;

-- ============================================================================
-- RPC: redeem_coupon
-- Called by the venue owner to burn a code the customer just showed. Keeps a
-- screenshot from being reused inside the validity window.
-- ============================================================================
create or replace function public.redeem_coupon(p_code text)
returns public.coupons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint := public.current_telegram_id();
  v_coupon public.coupons;
begin
  if v_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_coupon
    from public.coupons
    where upper(code) = upper(trim(p_code))
    for update;

  if not found then
    raise exception 'Coupon not found';
  end if;

  if not exists (
    select 1 from public.venues where id = v_coupon.venue_id and owner_user_id = v_id
  ) then
    raise exception 'Not authorised for this venue';
  end if;

  if v_coupon.redeemed_at is not null then
    raise exception 'Coupon was already redeemed';
  end if;
  if v_coupon.expires_at <= timezone('utc', now()) then
    raise exception 'Coupon has expired';
  end if;

  update public.coupons
    set redeemed_at = timezone('utc', now())
    where id = v_coupon.id
    returning * into v_coupon;

  return v_coupon;
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
      'catches_today', (
        select count(*) from public.catches
        where venue_id = p_venue_id and created_at >= current_date
      ),
      'catches_7d', (
        select count(*) from public.catches
        where venue_id = p_venue_id and created_at >= timezone('utc', now()) - interval '7 days'
      ),
      'unique_visitors_7d', (
        select count(distinct user_id) from public.catches
        where venue_id = p_venue_id and created_at >= timezone('utc', now()) - interval '7 days'
      ),
      'coupons_redeemed_7d', (
        select count(*) from public.coupons
        where venue_id = p_venue_id
          and redeemed_at is not null
          and redeemed_at >= timezone('utc', now()) - interval '7 days'
      ),
      'return_rate', (
        select coalesce(
          (count(*) filter (where visit_count > 1))::float / nullif(count(*), 0),
          0
        )
        from (
          select user_id, count(*) as visit_count
          from public.catches
          where venue_id = p_venue_id
          group by user_id
        ) v
      )
    )
  );
end;
$$;

-- Old QR-flow functions, removed with the check-in model.
drop function if exists public.generate_checkin_token(uuid, int);
drop function if exists public.confirm_checkin(uuid, text, double precision, double precision);
drop function if exists public.redeem_offer(uuid);

-- ============================================================================
-- Grants — only the authenticated role (i.e. a verified Telegram user) may
-- call the RPCs. The anon key alone can read the public offer catalogue.
-- ============================================================================
revoke all on function
  public.upsert_user_session(text, text, bigint),
  public.sync_step_activity(int),
  public.complete_onboarding(),
  public.referral_counts(),
  public.catch_bonus(uuid, double precision, double precision, double precision),
  public.active_coupons(),
  public.redeem_coupon(text),
  public.venue_analytics(uuid)
from public, anon;

grant execute on function
  public.upsert_user_session(text, text, bigint),
  public.sync_step_activity(int),
  public.complete_onboarding(),
  public.referral_counts(),
  public.catch_bonus(uuid, double precision, double precision, double precision),
  public.active_coupons(),
  public.redeem_coupon(text),
  public.venue_analytics(uuid)
to authenticated;
