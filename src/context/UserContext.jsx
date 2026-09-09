import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getReferrerIdFromStartParam, getTelegramUser, initTelegram } from '../lib/telegram';

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refreshProfile = useCallback(async (id) => {
    const { data, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchError) throw fetchError;
    setProfile(data);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      initTelegram();
      const tgUser = getTelegramUser();

      if (!tgUser) {
        setError('Open this app inside Telegram to continue.');
        setLoading(false);
        return;
      }

      const referrerId = getReferrerIdFromStartParam();

      try {
        // Upsert via RPC so first-touch referral attribution is set atomically
        // and never overwritten on subsequent launches.
        const { data, error: rpcError } = await supabase.rpc('upsert_user_session', {
          p_id: tgUser.id,
          p_first_name: tgUser.first_name ?? null,
          p_username: tgUser.username ?? null,
          p_referrer_id: referrerId,
        });
        if (rpcError) throw rpcError;
        if (!cancelled) setProfile(data);
      } catch (err) {
        console.error('Failed to bootstrap user session', err);
        if (!cancelled) setError(err.message ?? 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ profile, loading, error, refreshProfile }),
    [profile, loading, error, refreshProfile]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within a UserProvider');
  return ctx;
}
