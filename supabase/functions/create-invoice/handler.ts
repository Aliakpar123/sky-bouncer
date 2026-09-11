// Creates a Telegram Stars invoice link for a product.
//
// The Mini App cannot call the Bot API itself — that needs the bot token —
// and it must not be trusted with the price either, or a modified client
// would pay 1 Star for anything. So the caller sends only a product id: the
// identity comes from the same JWT the rest of the app uses, and the price is
// read from the products table.
//
// Deploy: supabase functions deploy create-invoice --no-verify-jwt
// Secrets: BOT_TOKEN, SUPABASE_JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
const JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const encoder = new TextEncoder();

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Verifies the HS256 JWT minted by telegram-auth and returns its telegram_id. */
async function telegramIdFromJwt(token: string, secret: string): Promise<number | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(signature),
    encoder.encode(`${header}.${payload}`)
  );
  if (!valid) return null;

  let claims: { telegram_id?: number; exp?: number };
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  } catch {
    return null;
  }

  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return typeof claims.telegram_id === 'number' ? claims.telegram_id : null;
}

async function loadProduct(productId: string) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&active=is.true&select=*`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
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

  if (!BOT_TOKEN || !JWT_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('create-invoice is missing required secrets');
    return json({ error: 'Server is not configured' }, 500);
  }

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const telegramId = token ? await telegramIdFromJwt(token, JWT_SECRET) : null;
  if (!telegramId) {
    return json({ error: 'Not authenticated' }, 401);
  }

  let productId: string | undefined;
  try {
    ({ productId } = await req.json());
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!productId || typeof productId !== 'string') {
    return json({ error: 'productId is required' }, 400);
  }

  const product = await loadProduct(productId);
  if (!product) {
    return json({ error: 'Unknown product' }, 404);
  }

  const telegramResponse = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: product.title,
        description: product.description,
        // Echoed back on successful_payment, which is how the bot knows who
        // bought what without trusting anything the client said.
        payload: JSON.stringify({ userId: telegramId, productId: product.id }),
        currency: 'XTR', // Telegram Stars
        prices: [{ label: product.title, amount: product.stars }],
      }),
    }
  );

  const result = await telegramResponse.json();
  if (!result.ok) {
    console.error('createInvoiceLink failed', result);
    return json({ error: 'Could not create invoice' }, 502);
  }

  return json({ link: result.result, product }, 200);
}
