import WebApp from '@twa-dev/sdk';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Refresh a little before expiry so an in-flight request never races the clock.
const REFRESH_MARGIN_SECONDS = 60;

let cachedToken = null;
let expiresAt = 0;
let inFlight = null;

async function requestToken() {
  const initData = WebApp?.initData;
  if (!initData) {
    throw new Error('Open this app inside Telegram to continue.');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/telegram-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ initData }),
  });

  if (!response.ok) {
    throw new Error('Telegram sign-in failed. Please reopen the app.');
  }

  const { token, expires_in: expiresIn } = await response.json();
  cachedToken = token;
  expiresAt = Date.now() + (expiresIn - REFRESH_MARGIN_SECONDS) * 1000;
  return token;
}

/**
 * Returns a valid Supabase JWT for the current Telegram user, minting or
 * refreshing one as needed. Concurrent callers share a single request.
 */
export async function getAccessToken() {
  if (cachedToken && Date.now() < expiresAt) return cachedToken;

  if (!inFlight) {
    inFlight = requestToken().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export function clearAccessToken() {
  cachedToken = null;
  expiresAt = 0;
}
