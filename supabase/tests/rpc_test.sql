-- Regression tests for the Pulse Radar RPC layer.
--
-- Run against a scratch database that already has schema.sql applied:
--   psql -v ON_ERROR_STOP=1 -d pulse_test -f supabase/tests/rpc_test.sql
--
-- Identity is normally supplied by the telegram-auth JWT; here we set the
-- same `request.jwt.claims` GUC directly so the tests exercise the real
-- current_telegram_id() path.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages to warning;

create or replace function pg_temp.act_as(p_telegram_id bigint) returns void
language plpgsql as $$
begin
  if p_telegram_id is null then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config(
      'request.jwt.claims',
      json_build_object('telegram_id', p_telegram_id, 'role', 'authenticated')::text,
      true
    );
  end if;
end;
$$;

create or replace function pg_temp.check(p_label text, p_condition boolean) returns void
language plpgsql as $$
begin
  if p_condition then
    raise notice 'ok    %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end;
$$;

-- Asserts that an expression raises, optionally matching the message.
create or replace function pg_temp.check_raises(p_label text, p_sql text, p_match text default null)
returns void language plpgsql as $$
declare
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    v_message := SQLERRM;
  end;

  if v_message is null then
    raise exception 'FAIL  % (expected an exception, none raised)', p_label;
  elsif p_match is not null and position(lower(p_match) in lower(v_message)) = 0 then
    raise exception 'FAIL  % (expected to match "%", got: %)', p_label, p_match, v_message;
  else
    raise notice 'ok    %', p_label;
  end if;
end;
$$;

-- ============================================================================
set client_min_messages to notice;

begin;

-- Clean slate.
truncate table public.coupons, public.catches, public.activities,
               public.venues, public.users
  restart identity cascade;

-- --------------------------------------------------------------------------
-- Identity
-- --------------------------------------------------------------------------
select pg_temp.act_as(null);
select pg_temp.check('current_telegram_id() is null for anonymous callers',
  public.current_telegram_id() is null);

select pg_temp.check_raises(
  'upsert_user_session rejects anonymous callers',
  $$select public.upsert_user_session('Anon', 'anon', null)$$,
  'Not authenticated');

select pg_temp.check_raises(
  'sync_step_activity rejects anonymous callers',
  $$select public.sync_step_activity(500)$$,
  'Not authenticated');

-- --------------------------------------------------------------------------
-- Registration and referral attribution
-- --------------------------------------------------------------------------
select pg_temp.act_as(1001);
select public.upsert_user_session('Alice', 'alice', null);
select pg_temp.check('user row is created on first launch',
  (select count(*) = 1 from public.users where id = 1001));

-- Bob arrives through Alice's link.
select pg_temp.act_as(1002);
select public.upsert_user_session('Bob', 'bob', 1001);
select pg_temp.check('referrer is recorded on first launch',
  (select referrer_id = 1001 from public.users where id = 1002));

-- A later launch must not re-attribute Bob to someone else.
select public.upsert_user_session('Bob', 'bob', 9999);
select pg_temp.check('referral attribution is first-touch and immutable',
  (select referrer_id = 1001 from public.users where id = 1002));

-- Self-referral is ignored.
select pg_temp.act_as(1003);
select public.upsert_user_session('Carol', 'carol', 1003);
select pg_temp.check('self-referral is rejected',
  (select referrer_id is null from public.users where id = 1003));

-- Unknown referrer is ignored rather than violating the FK.
select pg_temp.act_as(1004);
select public.upsert_user_session('Dave', 'dave', 424242);
select pg_temp.check('unknown referrer is ignored',
  (select referrer_id is null from public.users where id = 1004));

-- Carol under Bob, so Alice is the tier-2 referrer for Carol's activity.
update public.users set referrer_id = 1002 where id = 1003;

-- --------------------------------------------------------------------------
-- Onboarding
-- --------------------------------------------------------------------------
select pg_temp.act_as(1001);
select pg_temp.check('a new user has not completed onboarding',
  (select onboarded_at is null from public.users where id = 1001));

select public.complete_onboarding();
select pg_temp.check('completing onboarding stamps the user row',
  (select onboarded_at is not null from public.users where id = 1001));

-- Calling it twice must not move the timestamp (it is a "first seen" marker).
create temporary table t_onboarded as
  select onboarded_at from public.users where id = 1001;
select public.complete_onboarding();
select pg_temp.check('completing onboarding twice keeps the original timestamp',
  (select onboarded_at from public.users where id = 1001)
    = (select onboarded_at from t_onboarded));

select pg_temp.check('onboarding one user does not affect another',
  (select onboarded_at is null from public.users where id = 1002));

select pg_temp.act_as(null);
select pg_temp.check_raises(
  'complete_onboarding rejects anonymous callers',
  $$select public.complete_onboarding()$$,
  'Not authenticated');

-- --------------------------------------------------------------------------
-- Step syncing: the ceilings are the whole point
-- --------------------------------------------------------------------------
select pg_temp.act_as(1001);
update public.users set last_step_sync_at = timezone('utc', now()) - interval '60 seconds'
  where id = 1001;

-- 60s elapsed * 4 steps/s = 240 step ceiling.
select public.sync_step_activity(1000000);
select pg_temp.check('cadence ceiling caps an absurd step claim at 4 steps/second',
  (select total_steps = 240 from public.users where id = 1001));
select pg_temp.check('points are derived server-side from the capped steps',
  (select balance = 24 from public.users where id = 1001));

select pg_temp.check('negative step deltas are ignored',
  (select total_steps from public.users where id = 1001) =
  (select total_steps from (select public.sync_step_activity(-5000)) s,
     public.users where id = 1001));

-- Daily cap: pretend a long day has already been banked.
select pg_temp.act_as(1004);
insert into public.activities (user_id, steps_count, points_earned)
  values (1004, 29900, 2990);
update public.users
  set total_steps = 29900, balance = 2990,
      last_step_sync_at = timezone('utc', now()) - interval '1 hour'
  where id = 1004;
select public.sync_step_activity(5000);
select pg_temp.check('daily cap limits the day to 30k steps',
  (select total_steps = 30000 from public.users where id = 1004));

-- --------------------------------------------------------------------------
-- Streak multipliers
-- --------------------------------------------------------------------------
select pg_temp.check('a short streak earns no multiplier',
  public.streak_multiplier(0) = 1.0 and public.streak_multiplier(2) = 1.0);
select pg_temp.check('a 3-day streak earns 1.2x',
  public.streak_multiplier(3) = 1.2 and public.streak_multiplier(6) = 1.2);
select pg_temp.check('a 7-day streak earns 1.5x',
  public.streak_multiplier(7) = 1.5 and public.streak_multiplier(40) = 1.5);
select pg_temp.check('a null streak is treated as zero',
  public.streak_multiplier(null) = 1.0);

-- A user mid-streak: yesterday's activity carries a 6-day streak, so today's
-- sync takes it to 7 and the award must be multiplied by 1.5.
select pg_temp.act_as(1006);
select public.upsert_user_session('Frank', 'frank', null);
update public.users
  set streak = 6,
      last_active_date = current_date - 1,
      last_step_sync_at = timezone('utc', now()) - interval '600 seconds'
  where id = 1006;

select public.sync_step_activity(2000);
select pg_temp.check('the streak advances to 7',
  (select streak = 7 from public.users where id = 1006));
-- 2000 steps = 200 base points, at 1.5x = 300.
select pg_temp.check('points are multiplied by the streak the user now holds',
  (select balance = 300 from public.users where id = 1006));

-- --------------------------------------------------------------------------
-- Telegram Stars purchases
-- --------------------------------------------------------------------------
select pg_temp.act_as(1007);
select public.upsert_user_session('Grace', 'grace', null);

select public.grant_purchase(1007, 'streak_saver', 50, 'charge_aaa');
select pg_temp.check('buying a streak saver credits one',
  (select streak_savers = 1 from public.users where id = 1007));

-- Telegram retries webhooks; the same charge must not pay out twice.
select public.grant_purchase(1007, 'streak_saver', 50, 'charge_aaa');
select pg_temp.check('replaying the same charge id grants nothing extra',
  (select streak_savers = 1 from public.users where id = 1007));
select pg_temp.check('the replay is not recorded as a second purchase',
  (select count(*) = 1 from public.purchases where charge_id = 'charge_aaa'));

select public.grant_purchase(1007, 'booster', 100, 'charge_bbb');
select pg_temp.check('buying a booster sets an expiry in the future',
  (select boost_expires_at > timezone('utc', now()) from public.users where id = 1007));

-- Stacking extends rather than overwrites.
create temporary table t_boost as
  select boost_expires_at from public.users where id = 1007;
select public.grant_purchase(1007, 'booster', 100, 'charge_ccc');
select pg_temp.check('a second booster extends the first',
  (select boost_expires_at from public.users where id = 1007)
    > (select boost_expires_at from t_boost));

select pg_temp.check_raises(
  'an unknown product is rejected',
  $$select public.grant_purchase(1007, 'free_money', 0, 'charge_ddd')$$,
  'Unknown product');

-- A booster doubles what the walking earns.
update public.users
  set streak = 0, last_active_date = null,
      balance = 0, total_steps = 0,
      last_step_sync_at = timezone('utc', now()) - interval '600 seconds'
  where id = 1007;
select public.sync_step_activity(2000);
-- 2000 steps = 200 base, streak 1 (x1.0), booster x2 = 400.
select pg_temp.check('an active booster doubles the step award',
  (select balance = 400 from public.users where id = 1007));

-- A streak saver absorbs a missed day instead of resetting the run.
select pg_temp.act_as(1008);
select public.upsert_user_session('Heidi', 'heidi', null);
update public.users
  set streak = 5,
      last_active_date = current_date - 3,  -- missed two days
      streak_savers = 1,
      last_step_sync_at = timezone('utc', now()) - interval '600 seconds'
  where id = 1008;

select public.sync_step_activity(1000);
select pg_temp.check('a streak saver keeps the run going through a missed day',
  (select streak = 6 from public.users where id = 1008));
select pg_temp.check('using a streak saver consumes it',
  (select streak_savers = 0 from public.users where id = 1008));

-- Without one, the same gap resets the streak.
update public.users
  set streak = 5, last_active_date = current_date - 3, streak_savers = 0,
      last_step_sync_at = timezone('utc', now()) - interval '600 seconds'
  where id = 1008;
select public.sync_step_activity(1000);
select pg_temp.check('without a saver a missed day resets the streak',
  (select streak = 1 from public.users where id = 1008));

-- --------------------------------------------------------------------------
-- Two-tier referral cascade
-- --------------------------------------------------------------------------
select pg_temp.act_as(1003); -- Carol → Bob (tier 1) → Alice (tier 2)
update public.users set last_step_sync_at = timezone('utc', now()) - interval '600 seconds'
  where id = 1003;

-- 600s * 4 = 2400 ceiling, so a 2000-step claim passes untouched → 200 pts.
select public.sync_step_activity(2000);
select pg_temp.check('earner receives the full points',
  (select balance = 200 from public.users where id = 1003));
select pg_temp.check('tier 1 referrer receives 10%',
  (select balance = 20 from public.users where id = 1002));
select pg_temp.check('tier 2 referrer receives 5% on top of their own balance',
  (select balance = 24 + 10 from public.users where id = 1001));

-- --------------------------------------------------------------------------
-- Catch engine: the anti-cheat layers are the point
-- --------------------------------------------------------------------------
insert into public.venues (id, name, category, reward_points, offer_title, lat, lng, owner_user_id)
  values ('11111111-1111-1111-1111-111111111111', 'Blue Bottle', 'cafe', 150,
          'Free flat white', 41.3121, 69.2801, 1001);

-- Bob (1002) will do the catching; give him the walking the engine requires.
select pg_temp.act_as(1002);
insert into public.activities (user_id, steps_count, points_earned)
  values (1002, 3000, 300);

select pg_temp.check_raises(
  'catching without authentication is rejected',
  $$select public.catch_bonus('11111111-1111-1111-1111-111111111111', 41.3121, 69.2801, 10)$$,
  'Not authenticated')
from (select pg_temp.act_as(null)) s;
select pg_temp.act_as(1002);

select pg_temp.check_raises(
  'catching without coordinates is rejected',
  $$select public.catch_bonus('11111111-1111-1111-1111-111111111111', null, null, 10)$$,
  'Location is required');

-- 41.3200 is roughly 880m north of the venue.
select pg_temp.check_raises(
  'a catch from far away is rejected',
  $$select public.catch_bonus('11111111-1111-1111-1111-111111111111', 41.3200, 69.2801, 10)$$,
  'get closer');

-- A spoofer claiming a huge error radius must not "overlap" the venue.
select pg_temp.check_raises(
  'an implausible accuracy reading is rejected outright',
  $$select public.catch_bonus('11111111-1111-1111-1111-111111111111', 41.3121, 69.2801, 5000)$$,
  'too imprecise');

-- Omitting accuracy must not be better than reporting a bad one: it is
-- treated as the worst tolerated value, so a far-away catch still fails.
select pg_temp.check_raises(
  'a missing accuracy reading does not widen the radius beyond the cap',
  $$select public.catch_bonus('11111111-1111-1111-1111-111111111111', 41.3200, 69.2801, null)$$,
  'get closer');

-- Someone who has not walked today cannot catch, however close they stand.
select pg_temp.act_as(1005);
select public.upsert_user_session('Erin', 'erin', null);
select pg_temp.check_raises(
  'a user with no steps today cannot catch',
  $$select public.catch_bonus('11111111-1111-1111-1111-111111111111', 41.3121, 69.2801, 10)$$,
  'Walk at least');
select pg_temp.act_as(1002);

-- The legitimate catch.
create temporary table t_catch as
  select public.catch_bonus('11111111-1111-1111-1111-111111111111', 41.3121, 69.2801, 10) as result;

select pg_temp.check('a valid catch is recorded',
  (select count(*) = 1 from public.catches where user_id = 1002));
select pg_temp.check('the catch awards the venue reward',
  (select (result ->> 'points_awarded')::int = 150 from t_catch));
select pg_temp.check('the catch credits the balance',
  (select balance >= 150 from public.users where id = 1002));
select pg_temp.check('the catch stores the measured distance for fraud review',
  (select distance_m is not null and accuracy_m = 10 from public.catches where user_id = 1002));

-- Coupon issued alongside.
select pg_temp.check('a coupon is issued with the catch',
  (select length(result -> 'coupon' ->> 'code') = 6 from t_catch));
select pg_temp.check('the coupon carries the venue offer',
  (select result -> 'coupon' ->> 'offer_title' = 'Free flat white' from t_catch));
select pg_temp.check('the coupon expires within the TTL window',
  (select expires_at <= timezone('utc', now()) + make_interval(mins => public.coupon_ttl_minutes())
     from public.coupons where user_id = 1002));
select pg_temp.check('the coupon code avoids ambiguous characters',
  (select code !~ '[01OI]' from public.coupons where user_id = 1002));

select pg_temp.check('active_coupons returns the live coupon',
  (select count(*) = 1 from public.active_coupons()));

-- Referral cascade on catch points: Bob's referrer is Alice (1001).
select pg_temp.check('tier 1 referrer earns 10% of catch points',
  (select balance from public.users where id = 1001) >= 15);

-- Second catch at the same venue today.
select pg_temp.check_raises(
  'a second catch at the same venue on the same day is rejected',
  $$select public.catch_bonus('11111111-1111-1111-1111-111111111111', 41.3121, 69.2801, 10)$$,
  'already caught');

-- Teleporting: a second venue on the other side of the country, moments later.
insert into public.venues (id, name, category, reward_points, offer_title, lat, lng, owner_user_id)
  values ('33333333-3333-3333-3333-333333333333', 'Far Cafe', 'cafe', 150,
          'Free tea', 55.7558, 37.6173, 1001);
select pg_temp.check_raises(
  'catching two venues 2000km apart within seconds is rejected',
  $$select public.catch_bonus('33333333-3333-3333-3333-333333333333', 55.7558, 37.6173, 10)$$,
  'Suspicious movement');

-- The same journey is fine once enough time has passed for it to be real.
update public.users set last_catch_at = timezone('utc', now()) - interval '30 hours'
  where id = 1002;
select public.catch_bonus('33333333-3333-3333-3333-333333333333', 55.7558, 37.6173, 10);
select pg_temp.check('the same journey is allowed once it is physically plausible',
  (select count(*) = 1 from public.catches
    where user_id = 1002 and venue_id = '33333333-3333-3333-3333-333333333333'));

-- --------------------------------------------------------------------------
-- Coupon redemption is the venue owner's call
-- --------------------------------------------------------------------------
create temporary table t_code as
  select code from public.coupons where user_id = 1002 and redeemed_at is null limit 1;

select pg_temp.act_as(1004); -- not the owner
select pg_temp.check_raises(
  'a stranger cannot redeem a coupon',
  format($$select public.redeem_coupon(%L)$$, (select code from t_code)),
  'Not authorised');

select pg_temp.act_as(1001); -- Alice owns both venues
select public.redeem_coupon((select code from t_code));
select pg_temp.check('the owner can redeem a coupon',
  (select redeemed_at is not null from public.coupons where code = (select code from t_code)));

select pg_temp.check_raises(
  'a coupon cannot be redeemed twice',
  format($$select public.redeem_coupon(%L)$$, (select code from t_code)),
  'already redeemed');

-- An expired coupon is refused even by the owner.
insert into public.coupons (catch_id, user_id, venue_id, code, offer_title, expires_at)
  select id, 1002, '11111111-1111-1111-1111-111111111111', 'EXPIRD', 'Free flat white',
         timezone('utc', now()) - interval '1 minute'
    from public.catches where user_id = 1002 limit 1;
select pg_temp.check_raises(
  'an expired coupon is refused',
  $$select public.redeem_coupon('EXPIRD')$$,
  'expired');

select pg_temp.check('expired coupons are not listed as active',
  (select count(*) = 0 from public.coupons c
    where c.code = 'EXPIRD'
      and c.id in (select id from public.active_coupons())));

-- --------------------------------------------------------------------------
-- Venue analytics stay owner-only
-- --------------------------------------------------------------------------
select pg_temp.act_as(1002);
select pg_temp.check_raises(
  'a non-owner cannot read venue analytics',
  $$select public.venue_analytics('11111111-1111-1111-1111-111111111111')$$,
  'Not authorised');

select pg_temp.act_as(1001);
select pg_temp.check('the owner sees catches for today',
  (public.venue_analytics('11111111-1111-1111-1111-111111111111') ->> 'catches_today')::int = 1);
select pg_temp.check('the owner sees redeemed coupons',
  (public.venue_analytics('11111111-1111-1111-1111-111111111111') ->> 'coupons_redeemed_7d')::int >= 0);

-- --------------------------------------------------------------------------
-- Referral counts reflect the caller, not a supplied id
-- --------------------------------------------------------------------------
select pg_temp.act_as(1001);
select pg_temp.check('tier 1 count is scoped to the caller',
  (public.referral_counts() ->> 'tier1')::int = 1);
select pg_temp.check('tier 2 count is scoped to the caller',
  (public.referral_counts() ->> 'tier2')::int = 1);

select pg_temp.act_as(null);
select pg_temp.check('anonymous callers see no referrals',
  (public.referral_counts() ->> 'tier1')::int = 0);

rollback;

\echo ''
\echo 'All RPC tests passed.'
