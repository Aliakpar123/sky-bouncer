# Pulse Radar

A Web2.5 Telegram Mini App (TMA) on TON: gamified Move-to-Earn plus geofenced
"catch the bonus" drops at partner venues, a 2-tier viral referral program, and
a lightweight merchant portal.

## Stack

- **Frontend**: React + Vite, Tailwind CSS, Lucide icons, `react-router-dom`
- **Telegram**: `@twa-dev/sdk` (haptics, `startapp` deep links, theme)
- **Web3**: `@tonconnect/ui-react` + `@ton/ton`
- **Maps**: `react-leaflet` with dark Carto tiles, `@turf/distance` for geodesics
- **Animation**: `framer-motion` (catch pulse, reward, bottom sheet)
- **Backend**: Supabase (Postgres, RLS, RPC functions)
- **Bot**: Node.js + grammY (`/bot`)

## Project layout

```
src/
  components/    UI building blocks (layout, home, map, catch, referral, wallet, merchant)
  pages/         Route-level screens wired to Supabase + Telegram
  hooks/         useSteps (DeviceMotion step counter), useGeolocation
  lib/           supabase client, telegram helpers, geo/catch-state utils
  context/       UserContext — bootstraps the Telegram user + referral attribution
supabase/
  schema.sql     Tables, RLS policies, and SECURITY DEFINER RPC functions
bot/
  index.js       grammY bot: /start deep-link handling, /stats
```

## Local setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run `supabase/schema.sql`.
3. Copy your project URL and anon key.
4. Deploy the auth function and give it the secrets it needs:

```bash
supabase functions deploy telegram-auth --no-verify-jwt
supabase functions deploy create-invoice --no-verify-jwt
supabase secrets set BOT_TOKEN=<your bot token> SUPABASE_JWT_SECRET=<Settings → API → JWT secret>
```

`--no-verify-jwt` is required for `telegram-auth`: it is the endpoint that
*issues* the JWT, so it must accept unauthenticated calls. It is not an open
door — it returns a token only for an `initData` string carrying a valid
Telegram HMAC signature. `create-invoice` verifies that JWT itself rather than
relying on the gateway, so it is deployed the same way.

Star payments also need the bot running: Telegram delivers `successful_payment`
to the bot, not to the Mini App, and that is where the purchase is credited.

### 2. Frontend

```bash
cp .env.example .env.local   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / bot username
npm install
npm run dev
```

Because Telegram Mini Apps require HTTPS and Telegram's WebView context, use a
tunnel (e.g. `ngrok http 5173`) and register the URL with @BotFather
(`/setmenubutton` or `/newapp`) to test on-device. Outside Telegram, the app
falls back to a dev user so you can iterate on the UI locally.

### 3. Bot

```bash
cd bot
cp .env.example .env
npm install
npm start
```

The bot's `/start` handler forwards the `startapp` referral payload
(`REF_<telegramId>`) into the Mini App launch button — actual referral
attribution is recorded by `upsert_user_session` the first time the referred
user opens the app, which is the only point with trustworthy first-touch
attribution.

## Tests

The data layer and the auth function both have tests, and they cover the
abuse cases rather than the happy path — those are the parts worth trusting.

```bash
# 66 RPC tests: identity, step ceilings, streak multipliers, referral cascade,
# catch anti-cheat (spoofed accuracy, teleporting, daily cap, step gate),
# coupon lifecycle, and Star purchases (idempotency, boosters, savers).
# Needs a scratch Postgres 16 database.
createdb pulse_test && npm run test:db

# 10 signature tests: forged bot token, tampered user id, replay window.
# Needs Deno (the edge-function runtime).
npm run test:functions
```

`test:db` applies the schema and the tests in one pass; the test file runs
inside a transaction and rolls back, so the database is reusable. It sets the
`request.jwt.claims` GUC directly to impersonate a caller, which is the same
path PostgREST uses in production.

## Core mechanics

- **Onboarding**: a three-step intro on first launch explains the earning
  loop, then asks for motion and location access one at a time, each with the
  reason stated. Both are skippable — neither blocks entry. Completion is
  recorded in `users.onboarded_at` rather than localStorage, so it survives a
  new device. The motion prompt is deliberately wired to a button: iOS only
  honours `DeviceMotionEvent.requestPermission()` inside a user gesture, so
  requesting it from an effect silently fails and no steps are ever counted.
- **Steps → Points**: `useSteps` counts steps via `DeviceMotion` peak
  detection; every 1,000 steps converts to 100 PTS. Progress syncs to
  Supabase via `sync_step_activity`, which also updates the daily streak and
  cascades referral rewards.
- **Referrals**: Tier 1 (direct referrer) earns 10% of a referee's earned
  points; Tier 2 (referrer's referrer) earns 5%. Attribution is captured
  once, on first launch, and never overwritten.
- **Catch the bonus**: the radar screen unlocks a venue's button inside a 20m
  zone (`catch_bonus`). A catch awards the venue's `reward_points` and issues
  a 15-minute coupon code the user shows at the counter — no scanner or POS
  integration on the merchant side.
- **Streak multipliers**: 1.2x from a 3-day streak, 1.5x from 7 days
  (`streak_multiplier`), applied to step points server-side.
- **Telegram Stars**: Streak Savers (absorb a missed day) and Boosters (2x
  step points for 3 hours). The Mini App asks `create-invoice` for an invoice
  link — it never sends a price — and the bot credits the item on
  `successful_payment` via `grant_purchase`, keyed on Telegram's charge id so
  a retried webhook cannot pay out twice.
- **Merchant portal**: `/merchant/:venueId` redeems a customer's code and
  shows catch analytics (`venue_analytics`: daily/7-day catches, unique
  visitors, coupons redeemed, return rate).

## Deployment

- **Frontend**: Vercel. Set the `VITE_*` env vars from `.env.example` in the
  project settings, and add `/tonconnect-manifest.json` details for your
  production domain.
- **Bot**: Render or Fly.io as a persistent worker. Set `WEBHOOK_URL` to run
  in webhook mode instead of long polling.

## Security model

The anon key ships inside the Mini App bundle and is public. Nothing in the
data layer trusts it beyond reading the partner catalogue.

- **Identity** comes from the `telegram_id` claim of a JWT minted by the
  `telegram-auth` edge function, which validates Telegram's `initData` HMAC
  signature (and rejects payloads older than 24h to bound replay). No RPC
  accepts a caller-supplied user id.
- **Points are derived server-side.** `sync_step_activity` takes a step delta
  and computes the reward itself. It is bounded twice: a cadence ceiling of
  4 steps/second since the last sync, and a 30,000-step daily cap. Steps come
  from a device the user controls, so these ceilings bound forgery — they do
  not eliminate it. Anything of real value (a token claim, a payout) needs a
  stronger signal than accelerometer data.
- **A catch is only as trustworthy as GPS, which is weak.** Dropping the QR
  factor for zero-friction merchant onboarding means location is now the only
  proof of presence, and a spoofed GPS is a settings toggle away on Android.
  `catch_bonus` layers defences instead: distance is computed server-side; an
  accuracy reading worse than 100m is refused (so a spoofer cannot claim a
  5km error radius and overlap every venue); a genuine accuracy reading
  widens the radius, because a real phone at the counter often reports 30-50m
  and would otherwise be locked out; moving between two catches faster than
  120km/h is treated as teleporting; the day's step count must show real
  walking; and one catch per venue per day caps the value of any bypass.
  Every catch stores its distance and accuracy for fraud review.
- **Coupons expire in 15 minutes and can be burned by the venue owner**
  (`redeem_coupon`), so a screenshot is not reusable inside the window.
- **RLS is scoped to the verified identity**: users, activities, catches and
  coupons are readable only by their owner (or the venue owner, for venue-side
  rows). The venue catalogue is the only public table.

Known gaps, in rough priority order:

1. The logic is tested locally (see **Tests**) but nothing has run against a
   live Supabase project. Two things can only be confirmed there: that
   PostgREST populates `request.jwt.claims` the way `current_telegram_id()`
   expects, and that a real Telegram client's `initData` passes the signature
   check with a production bot token.
2. There is no venue-owner onboarding flow; `venues.owner_user_id` has to be
   set by hand for now.
3. `TonConnectUIProvider` wraps the whole app, so the wallet list (~25 CDN
   hosts) is fetched on every screen, not just `/wallet`.
4. Star payments are untested end to end — that needs a real bot token and a
   Telegram client. The pieces (invoice creation, pre-checkout, crediting)
   are wired but have never exchanged a real Star.
5. Converting points to a TON Jetton is specced but not built; there is no
   contract yet.
