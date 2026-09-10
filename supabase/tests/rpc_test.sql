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
truncate table public.redemptions, public.checkins, public.checkin_tokens,
               public.activities, public.offers, public.venues, public.users
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
-- Venue ownership: minting check-in codes and reading analytics
-- --------------------------------------------------------------------------
insert into public.venues (id, name, owner_user_id, location_lat, location_lng)
  values ('11111111-1111-1111-1111-111111111111', 'Blue Bottle', 1001, 41.3121, 69.2801);
insert into public.offers (id, venue_id, title, cost_in_points, partner_name, location_lat, location_lng)
  values ('22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111',
          'Free flat white', 100, 'Blue Bottle', 41.3121, 69.2801);

select pg_temp.act_as(1002); -- Bob does not own the venue
select pg_temp.check_raises(
  'a non-owner cannot mint a check-in token',
  $$select public.generate_checkin_token('11111111-1111-1111-1111-111111111111', 60)$$,
  'Not authorised');

select pg_temp.check_raises(
  'a non-owner cannot read venue analytics',
  $$select public.venue_analytics('11111111-1111-1111-1111-111111111111')$$,
  'Not authorised');

select pg_temp.act_as(1001); -- Alice owns it
select pg_temp.check('the owner can mint a token',
  length(public.generate_checkin_token('11111111-1111-1111-1111-111111111111', 60)) = 32);
select pg_temp.check('the owner can read analytics',
  (public.venue_analytics('11111111-1111-1111-1111-111111111111') ->> 'checkins_today')::int = 0);

create temporary table t_long_ttl as
  select public.generate_checkin_token('11111111-1111-1111-1111-111111111111', 999999) as token;
select pg_temp.check('TTL is clamped to at most 5 minutes',
  (select expires_at <= timezone('utc', now()) + interval '301 seconds'
     from public.checkin_tokens
    where token = (select token from t_long_ttl)));

-- --------------------------------------------------------------------------
-- Check-in: both factors must hold
-- --------------------------------------------------------------------------
select pg_temp.act_as(1001);
create temporary table t_token as
  select public.generate_checkin_token('11111111-1111-1111-1111-111111111111', 60) as token;

select pg_temp.act_as(1002); -- Bob checks in at Alice's venue

select pg_temp.check_raises(
  'a forged QR payload is rejected',
  $$select public.confirm_checkin('22222222-2222-2222-2222-222222222222',
      'deadbeefdeadbeefdeadbeefdeadbeef', 41.3121, 69.2801)$$,
  'invalid or expired');

select pg_temp.check_raises(
  'a valid QR from 3km away is rejected by the geofence',
  format($$select public.confirm_checkin('22222222-2222-2222-2222-222222222222',
      %L, 41.3400, 69.2801)$$, (select token from t_token)),
  'too far');

select pg_temp.check_raises(
  'a check-in without coordinates is rejected',
  format($$select public.confirm_checkin('22222222-2222-2222-2222-222222222222',
      %L, null, null)$$, (select token from t_token)),
  'Location is required');

-- Now the legitimate path.
select public.confirm_checkin('22222222-2222-2222-2222-222222222222',
  (select token from t_token), 41.3121, 69.2801);
select pg_temp.check('a valid check-in is recorded',
  (select count(*) = 1 from public.checkins where user_id = 1002));
select pg_temp.check('check-in credits points',
  (select balance = 20 + 50 from public.users where id = 1002));

-- Checked from a different account: Bob's own retry would hit the
-- one-per-day rule first, which would not prove the token was consumed.
select pg_temp.act_as(1003);
select pg_temp.check_raises(
  'a token already spent by someone else cannot be reused',
  format($$select public.confirm_checkin('22222222-2222-2222-2222-222222222222',
      %L, 41.3121, 69.2801)$$, (select token from t_token)),
  'invalid or expired');
select pg_temp.act_as(1002);

-- A fresh token still cannot beat the one-per-day rule.
select pg_temp.act_as(1001);
create temporary table t_token2 as
  select public.generate_checkin_token('11111111-1111-1111-1111-111111111111', 60) as token;
select pg_temp.act_as(1002);
select pg_temp.check_raises(
  'a second check-in at the same venue on the same day is rejected',
  format($$select public.confirm_checkin('22222222-2222-2222-2222-222222222222',
      %L, 41.3121, 69.2801)$$, (select token from t_token2)),
  'Already checked in');

-- Expired tokens are refused.
select pg_temp.act_as(1001);
insert into public.checkin_tokens (token, venue_id, expires_at)
  values ('expiredtoken00000000000000000000',
          '11111111-1111-1111-1111-111111111111',
          timezone('utc', now()) - interval '1 minute');
select pg_temp.act_as(1003);
select pg_temp.check_raises(
  'an expired token is rejected',
  $$select public.confirm_checkin('22222222-2222-2222-2222-222222222222',
      'expiredtoken00000000000000000000', 41.3121, 69.2801)$$,
  'invalid or expired');

-- --------------------------------------------------------------------------
-- Redemption
-- --------------------------------------------------------------------------
select pg_temp.act_as(1003); -- Carol has 200 pts, offer costs 100
select public.redeem_offer('22222222-2222-2222-2222-222222222222');
select pg_temp.check('redeeming deducts the cost',
  (select balance = 100 from public.users where id = 1003));
select pg_temp.check('redemption is recorded',
  (select count(*) = 1 from public.redemptions where user_id = 1003));

select pg_temp.act_as(1004);
update public.users set balance = 10 where id = 1004;
select pg_temp.check_raises(
  'redeeming past the balance is rejected',
  $$select public.redeem_offer('22222222-2222-2222-2222-222222222222')$$,
  'Insufficient balance');

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
