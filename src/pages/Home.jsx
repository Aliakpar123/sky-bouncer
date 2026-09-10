import { useEffect, useRef } from 'react';
import Header from '../components/layout/Header';
import StepsRing from '../components/home/StepsRing';
import DailyStreak from '../components/home/DailyStreak';
import { useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';

const SYNC_INTERVAL_MS = 30000;

export default function Home({ steps: motion }) {
  const { profile, setProfile } = useUser();
  const { steps, pointsEarned, supported, permission, requestPermission } = motion;
  const lastSyncedSteps = useRef(0);

  useEffect(() => {
    if (!profile) return undefined;
    const interval = setInterval(async () => {
      const delta = steps - lastSyncedSteps.current;
      if (delta <= 0) return;
      lastSyncedSteps.current = steps;
      try {
        // Points are derived server-side from the step delta — sending them
        // from here would let anyone with the public anon key mint balance.
        const { data, error } = await supabase.rpc('sync_step_activity', { p_steps: delta });
        if (error) throw error;
        if (data) setProfile(data);
      } catch (err) {
        console.error('Failed to sync steps', err);
      }
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [steps, profile, setProfile]);

  return (
    <div className="pb-24">
      <Header title={`Hi, ${profile?.first_name ?? 'there'}`} />
      <main className="px-4 pt-8 flex flex-col gap-6">
        <StepsRing steps={steps} pointsEarned={pointsEarned} />

        {!supported && (
          <p className="text-center text-xs text-white/40">
            Motion sensors unavailable on this device — steps won't be tracked automatically.
          </p>
        )}
        {supported && permission !== 'granted' && (
          <button
            type="button"
            onClick={requestPermission}
            className="mx-auto text-xs text-accent2 underline"
          >
            Enable motion access to track steps
          </button>
        )}

        <DailyStreak streak={profile?.streak ?? 0} />
      </main>
    </div>
  );
}
