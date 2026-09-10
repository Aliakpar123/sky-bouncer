import WebApp from '@twa-dev/sdk';

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? 'PulseRadarBot';
const APP_SHORT_NAME = import.meta.env.VITE_APP_SHORT_NAME ?? 'app';

export function initTelegram() {
  try {
    WebApp.ready();
    WebApp.expand();
    WebApp.setHeaderColor('#0a0a12');
    WebApp.setBackgroundColor('#0a0a12');
    WebApp.enableClosingConfirmation();
  } catch (err) {
    console.warn('Telegram WebApp not available (running outside Telegram?)', err);
  }
}

/** Returns the Telegram user object from initDataUnsafe, or a dev fallback. */
export function getTelegramUser() {
  const user = WebApp?.initDataUnsafe?.user;
  if (user) return user;
  if (import.meta.env.DEV) {
    return { id: 1000000001, first_name: 'Dev', username: 'dev_user' };
  }
  return null;
}

/** Extracts the referrer's Telegram ID from the startapp deep-link param, e.g. `REF_12345`. */
export function getReferrerIdFromStartParam() {
  const raw = WebApp?.initDataUnsafe?.start_param;
  if (!raw) return null;
  const match = /^REF_(\d+)$/.exec(raw);
  return match ? Number(match[1]) : null;
}

export function buildReferralLink(userId) {
  return `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=REF_${userId}`;
}

export function shareReferralLink(userId, text = 'Join me on Pulse Radar and start earning rewards for walking!') {
  const link = buildReferralLink(userId);
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  try {
    WebApp.openTelegramLink(shareUrl);
  } catch {
    window.open(shareUrl, '_blank');
  }
}

export function haptic(style = 'light') {
  try {
    if (['light', 'medium', 'heavy', 'rigid', 'soft'].includes(style)) {
      WebApp.HapticFeedback.impactOccurred(style);
    } else if (style === 'success' || style === 'error' || style === 'warning') {
      WebApp.HapticFeedback.notificationOccurred(style);
    }
  } catch {
    /* haptics unavailable outside Telegram */
  }
}

export function getThemeParams() {
  return WebApp?.themeParams ?? {};
}

export default WebApp;
