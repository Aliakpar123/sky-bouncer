import 'dotenv/config';
import { Bot, InlineKeyboard, webhookCallback } from 'grammy';
import { createClient } from '@supabase/supabase-js';
import http from 'node:http';

const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL; // e.g. https://pulse-radar.vercel.app
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // set to enable webhook mode instead of polling
const PORT = process.env.PORT ?? 8080;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN env var is required');
if (!APP_URL) throw new Error('APP_URL env var is required (the deployed Mini App URL)');

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

const bot = new Bot(BOT_TOKEN);

function launchKeyboard(startParam) {
  const url = startParam ? `${APP_URL}?startapp=${encodeURIComponent(startParam)}` : APP_URL;
  return new InlineKeyboard().webApp('Open Pulse Radar', url);
}

bot.command('start', async (ctx) => {
  const payload = ctx.match?.toString().trim();
  const referrerId = /^REF_(\d+)$/.exec(payload ?? '')?.[1];

  // Actual referral attribution happens atomically in `upsert_user_session`
  // when the user opens the Mini App — that's the only place we can trust
  // first-touch attribution, so the bot only needs to forward the payload.

  await ctx.reply(
    referrerId
      ? "You've been invited to Pulse Radar! Walk, check in at partner venues, and earn real rewards. 🚀"
      : 'Welcome to Pulse Radar! Walk, check in at partner venues, and earn real rewards. 🚀',
    { reply_markup: launchKeyboard(payload) }
  );
});

bot.command('stats', async (ctx) => {
  if (!supabase) {
    await ctx.reply('Stats are unavailable — bot is not connected to Supabase.');
    return;
  }
  const telegramId = ctx.from?.id;
  const { data, error } = await supabase
    .from('users')
    .select('balance, total_steps, streak')
    .eq('id', telegramId)
    .maybeSingle();

  if (error || !data) {
    await ctx.reply("You haven't opened Pulse Radar yet — tap below to get started!", {
      reply_markup: launchKeyboard(),
    });
    return;
  }

  await ctx.reply(
    `📊 Your Pulse Radar stats\n\nBalance: ${data.balance} PTS\nTotal steps: ${data.total_steps}\nStreak: ${data.streak} days`,
    { reply_markup: launchKeyboard() }
  );
});

// --- Telegram Stars payments -------------------------------------------------
// Telegram gives roughly 10 seconds to answer a pre-checkout query; failing to
// answer cancels the payment, so this stays deliberately trivial.
bot.on('pre_checkout_query', async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error('Failed to answer pre-checkout query', err);
  }
});

bot.on('message:successful_payment', async (ctx) => {
  const payment = ctx.message.successful_payment;

  if (!supabase) {
    console.error('Payment received but Supabase is not configured', payment);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(payment.invoice_payload);
  } catch {
    console.error('Unparseable invoice payload', payment.invoice_payload);
    return;
  }

  // The payload was written by our own create-invoice function, but the buyer
  // is taken from the Telegram update rather than the payload, so a crafted
  // payload cannot credit someone else's account.
  const userId = ctx.from?.id;
  if (!userId || payload.userId !== userId) {
    console.error('Payment payload does not match the payer', { userId, payload });
    return;
  }

  const { error } = await supabase.rpc('grant_purchase', {
    p_user_id: userId,
    p_product_id: payload.productId,
    p_stars: payment.total_amount,
    p_charge_id: payment.telegram_payment_charge_id,
  });

  if (error) {
    // Do not confirm to the user: the payment succeeded but the grant did not,
    // and that needs to be visible in the logs for manual repair.
    console.error('Failed to credit purchase', { userId, payload, error });
    await ctx.reply(
      'Payment received, but crediting it failed. Our team has been notified — nothing is lost.'
    );
    return;
  }

  await ctx.reply(
    payload.productId === 'streak_saver'
      ? 'Streak Saver added. It will cover your next missed day automatically. 🔥'
      : 'Booster active — your steps earn double for the next 3 hours. ⚡',
    { reply_markup: launchKeyboard() }
  );
});

bot.catch((err) => console.error('Bot error', err));

if (WEBHOOK_URL) {
  const callback = webhookCallback(bot, 'http');
  http
    .createServer(async (req, res) => {
      if (req.url === '/health') {
        res.writeHead(200);
        res.end('ok');
        return;
      }
      await callback(req, res);
    })
    .listen(PORT, () => console.log(`Bot webhook server listening on :${PORT}`));

  await bot.api.setWebhook(WEBHOOK_URL);
  console.log(`Webhook set to ${WEBHOOK_URL}`);
} else {
  bot.start();
  console.log('Bot started in long-polling mode');
}
