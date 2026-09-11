import WebApp from '@twa-dev/sdk';
import { getAccessToken } from './auth';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/**
 * Buys a product with Telegram Stars.
 *
 * The price is never sent from here — the edge function reads it from the
 * products table — and the grant happens bot-side when Telegram confirms the
 * charge, so a resolved 'paid' status means the payment went through, not
 * that the item is already credited.
 */
export async function purchaseWithStars(productId) {
  const token = await getAccessToken();

  const response = await fetch(`${SUPABASE_URL}/functions/v1/create-invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ productId }),
  });

  if (!response.ok) {
    throw new Error('Could not start the purchase. Please try again.');
  }

  const { link } = await response.json();

  return new Promise((resolve, reject) => {
    try {
      WebApp.openInvoice(link, (status) => resolve(status));
    } catch {
      reject(new Error('Star payments are only available inside Telegram.'));
    }
  });
}
