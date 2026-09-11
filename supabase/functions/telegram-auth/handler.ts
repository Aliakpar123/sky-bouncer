// Verifies Telegram Mini App initData and issues a short-lived Supabase JWT.
//
// The Mini App can only prove who the user is by forwarding the signed
// `initData` string Telegram puts in the WebView. Everything downstream (RLS,
// every RPC) trusts the `telegram_id` claim minted here, so this is the single
// place where an unauthenticated caller becomes a known user.
//
// Deploy: supabase functions deploy telegram-auth --no-verify-jwt
// Secrets: supabase secrets set BOT_TOKEN=... SUPABASE_JWT_SECRET=...

const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
const JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET');

// Telegram recommends rejecting stale initData; this also bounds how long a
// leaked initData string stays replayable.
const MAX_AUTH_AGE_SECONDS = 86_400;
const TOKEN_TTL_SECONDS = 3600;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return new Uint8Array(signature);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Length-independent, value-constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Implements Telegram's validation algorithm:
 * secret = HMAC_SHA256(key: "WebAppData", msg: bot_token)
 * expected = HMAC_SHA256(key: secret, msg: data_check_string)
 */
async function verifyInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const providedHash = params.get('hash');
  if (!providedHash) return { ok: false as const, reason: 'missing hash' };

  params.delete('hash');
  // `signature` is present on newer clients and is excluded from the check.
  params.delete('signature');

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const expectedHash = toHex(await hmacSha256(secretKey, dataCheckString));

  if (!timingSafeEqual(expectedHash, providedHash)) {
    return { ok: false as const, reason: 'signature mismatch' };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) {
    return { ok: false as const, reason: 'missing auth_date' };
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -60) {
    return { ok: false as const, reason: 'initData expired' };
  }

  let user: { id?: number; first_name?: string; username?: string };
  try {
    user = JSON.parse(params.get('user') ?? '{}');
  } catch {
    return { ok: false as const, reason: 'malformed user payload' };
  }
  if (typeof user.id !== 'number') {
    return { ok: false as const, reason: 'missing user id' };
  }

  return {
    ok: true as const,
    user,
    startParam: params.get('start_param'),
  };
}

async function issueJwt(telegramId: number, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: String(telegramId),
    telegram_id: telegramId,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  const encodedHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSha256(encoder.encode(secret), signingInput);

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  if (!BOT_TOKEN || !JWT_SECRET) {
    console.error('BOT_TOKEN or SUPABASE_JWT_SECRET is not configured');
    return json({ error: 'Server is not configured' }, 500);
  }

  let initData: string | undefined;
  try {
    ({ initData } = await req.json());
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!initData || typeof initData !== 'string') {
    return json({ error: 'initData is required' }, 400);
  }

  const result = await verifyInitData(initData, BOT_TOKEN);
  if (!result.ok) {
    // Deliberately vague to the caller; the reason stays in server logs.
    console.warn('initData rejected:', result.reason);
    return json({ error: 'Invalid initData' }, 401);
  }

  const token = await issueJwt(result.user.id!, JWT_SECRET);

  return json(
    {
      token,
      expires_in: TOKEN_TTL_SECONDS,
      user: {
        id: result.user.id,
        first_name: result.user.first_name ?? null,
        username: result.user.username ?? null,
      },
      start_param: result.startParam,
    },
    200
  );
}
