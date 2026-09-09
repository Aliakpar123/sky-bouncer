# Pulse Radar

A Web2.5 Telegram Mini App (TMA) on TON: gamified Move-to-Earn + geofenced B2B
check-ins, a 2-tier viral referral program, and a lightweight merchant portal.

## Stack

- **Frontend**: React + Vite, Tailwind CSS, Lucide icons, `react-router-dom`
- **Telegram**: `@twa-dev/sdk` (haptics, native QR scanner, `startapp` deep links, theme)
- **Web3**: `@tonconnect/ui-react` + `@ton/ton`
- **Maps**: `react-leaflet` with dark Carto tiles
- **Backend**: Supabase (Postgres, RLS, RPC functions)
- **Bot**: Node.js + grammY (`/bot`)

## Project layout

```
src/
  components/    UI building blocks (layout, home, map, offers, referral, wallet, merchant)
  pages/         Route-level screens wired to Supabase + Telegram
  hooks/         useSteps (DeviceMotion step counter), useGeolocation
  lib/           supabase client, telegram helpers, geo/haversine utils
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
supabase secrets set BOT_TOKEN=<your bot token> SUPABASE_JWT_SECRET=<Settings → API → JWT secret>
```

`--no-verify-jwt` is required: this is the endpoint that *issues* the JWT, so
it must accept unauthenticated calls. It is not an open door — it returns a
token only for an `initData` string carrying a valid Telegram HMAC signature.

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

## Core mechanics

- **Steps → Points**: `useSteps` counts steps via `DeviceMotion` peak
  detection; every 1,000 steps converts to 100 PTS. Progress syncs to
  Supabase via `sync_step_activity`, which also updates the daily streak and
  cascades referral rewards.
- **Referrals**: Tier 1 (direct referrer) earns 10% of a referee's earned
  points; Tier 2 (referrer's referrer) earns 5%. Attribution is captured
  once, on first launch, and never overwritten.
- **Geofenced check-ins**: `confirm_checkin` requires both an unexpired QR
  token minted by the venue (`generate_checkin_token`, refreshed every 60s to
  prevent screenshot sharing) and GPS coordinates within 150m of the venue.
- **Merchant portal**: `/merchant/:venueId` shows a rotating QR code and
  check-in analytics (`venue_analytics`: daily/7-day check-ins, unique
  visitors, return rate).

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
- **Check-in needs two independent factors**: a short-lived QR token that only
  the venue owner can mint (`generate_checkin_token` is owner-restricted —
  otherwise any user could mint a valid code for any venue), plus GPS within
  150m. One check-in per venue per day.
- **The QR code is rendered on-device.** The token is a bearer credential, so
  it must never be handed to a third-party QR image service.
- **RLS is scoped to the verified identity**: users, activities, check-ins and
  redemptions are readable only by their owner (or the venue owner, for
  venue-side rows). `checkin_tokens` has no select policy at all.

Known gaps, in rough priority order:

1. Nothing has been tested against a live Supabase project — the schema and
   edge function are written but unrun. Verify the initData signature path
   against a real bot token before trusting it.
2. There is no venue-owner onboarding flow; `venues.owner_user_id` has to be
   set by hand for now.
3. `TonConnectUIProvider` wraps the whole app, so the wallet list (~25 CDN
   hosts) is fetched on every screen, not just `/wallet`.
