// Tests for the initData signature check.
//
//   BOT_TOKEN=test-token SUPABASE_JWT_SECRET=test-secret \
//     deno test --allow-env --allow-net supabase/functions/telegram-auth/
//
// The function is the only thing standing between a public endpoint and a
// minted identity, so the forgery cases matter more than the happy path.

import { assertEquals } from 'jsr:@std/assert@1';

const BOT_TOKEN = 'test-token';
const JWT_SECRET = 'test-secret';

Deno.env.set('BOT_TOKEN', BOT_TOKEN);
Deno.env.set('SUPABASE_JWT_SECRET', JWT_SECRET);

const { default: handler } = await import('./handler.ts');

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Builds a correctly signed initData string, the way Telegram would. */
async function signInitData(
  fields: Record<string, string>,
  botToken = BOT_TOKEN
): Promise<string> {
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = await hmac(encoder.encode('WebAppData'), botToken);
  const hash = toHex(await hmac(secretKey, dataCheckString));

  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function validFields(overrides: Record<string, string> = {}) {
  return {
    auth_date: String(nowSeconds()),
    query_id: 'AAEtest',
    user: JSON.stringify({ id: 555001, first_name: 'Alice', username: 'alice' }),
    ...overrides,
  };
}

function post(initData: unknown) {
  return handler(
    new Request('http://localhost/telegram-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
  );
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split('.');
  const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));
}

Deno.test('accepts correctly signed initData and returns a usable token', async () => {
  const response = await post(await signInitData(validFields()));
  assertEquals(response.status, 200);

  const body = await response.json();
  const claims = decodeJwtPayload(body.token);

  assertEquals(claims.telegram_id, 555001);
  assertEquals(claims.sub, '555001');
  assertEquals(claims.role, 'authenticated');
  assertEquals(body.user.id, 555001);
  assertEquals(claims.exp > nowSeconds(), true);
});

Deno.test('the issued JWT is signed with the project secret', async () => {
  const response = await post(await signInitData(validFields()));
  const { token } = await response.json();

  const [header, payload, signature] = token.split('.');
  const expected = await hmac(encoder.encode(JWT_SECRET), `${header}.${payload}`);
  const expectedB64 = btoa(String.fromCharCode(...expected))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  assertEquals(signature, expectedB64);
});

Deno.test('rejects initData signed with a different bot token', async () => {
  const forged = await signInitData(validFields(), 'attacker-token');
  const response = await post(forged);
  assertEquals(response.status, 401);
});

Deno.test('rejects a tampered user id that keeps the original hash', async () => {
  const signed = await signInitData(validFields());
  const params = new URLSearchParams(signed);
  // Swap in a different user while keeping the (now stale) signature.
  params.set('user', JSON.stringify({ id: 999999, first_name: 'Mallory' }));

  const response = await post(params.toString());
  assertEquals(response.status, 401);
});

Deno.test('rejects initData with no hash at all', async () => {
  const params = new URLSearchParams(validFields());
  const response = await post(params.toString());
  assertEquals(response.status, 401);
});

Deno.test('rejects initData older than the replay window', async () => {
  const stale = await signInitData(validFields({ auth_date: String(nowSeconds() - 90_000) }));
  const response = await post(stale);
  assertEquals(response.status, 401);
});

Deno.test('rejects initData dated in the future', async () => {
  const future = await signInitData(validFields({ auth_date: String(nowSeconds() + 3600) }));
  const response = await post(future);
  assertEquals(response.status, 401);
});

Deno.test('rejects a payload with no user object', async () => {
  const fields = validFields();
  delete (fields as Record<string, string>).user;
  const response = await post(await signInitData(fields));
  assertEquals(response.status, 401);
});

Deno.test('rejects a missing or non-string initData', async () => {
  assertEquals((await post(undefined)).status, 400);
  assertEquals((await post(12345)).status, 400);
  assertEquals((await post('')).status, 400);
});

Deno.test('does not leak the rejection reason to the caller', async () => {
  const response = await post(await signInitData(validFields(), 'attacker-token'));
  const body = await response.json();
  assertEquals(body.error, 'Invalid initData');
});
