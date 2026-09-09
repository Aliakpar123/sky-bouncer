import { createClient } from '@supabase/supabase-js';
import { getAccessToken } from './auth';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase env vars are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  );
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  // Identity comes from the Telegram-verified JWT rather than Supabase Auth,
  // so every request carries the token minted by the telegram-auth function.
  accessToken: async () => {
    try {
      return await getAccessToken();
    } catch {
      return null;
    }
  },
});
