import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../components/layout/Header';
import StepsRing from '../components/home/StepsRing';
import DailyStreak from '../components/home/DailyStreak';
import NearestVenue from '../components/home/NearestVenue';
import { useUser } from '../context/UserContext';
import { useGeolocation } from '../hooks/useGeolocation';
import { supabase } from '../lib/supabase';
import { distanceMeters } from '../lib/geo';
import { pointsForSteps } from '../lib/rewards';

const SYNC_INTERVAL_MS = 30000;

export default function Home({ steps: motion }) {
  const { profile, setProfile } = useUser();
  const { steps, supported, permission, requestPermission } = motion;
  const pointsEarned = pointsForSteps(steps, profile?.streak ?? 0, profile?.boost_expires_at);
  const lastSyncedSteps = useRef(0);
  const { position } = useGeolocation();
  const [venues, setVenues] = useState([]);
  const [caughtVenueIds, setCaughtVenueIds] = useState(new Set());

  useEffect(() => {
    async function loadNearby() {
      const [{ data: venueRows }, { data: catchRows }] = await Promise.all([
        supabase.from('venues').select('id, name, offer_title, reward_points, lat, lng'),
        supabase.from('catches').select('venue_id, created_at'),
      ]);
      setVenues(venueRows ?? []);

      const today = new Date().toISOString().slice(0, 10);
      setCaughtVenueIds(
        new Set(
          (catchRows ?? [])
            .filter((c) => c.created_at?.slice(0, 10) === today)
            .map((c) => c.venue_id)
        )
      );
    }
    loadNearby();
  }, []);

  // Prefer the closest venue the user can still catch today; fall back to the
  // closest overall so the card does not vanish once they have caught it.
  const nearest = useMemo(() => {
    if (!position || venues.length === 0) return null;
    const withDistance = venues
      .filter((v) => v.lat != null && v.lng != null)
      .map((v) => ({
        venue: v,
        distance: distanceMeters(position.lat, position.lng, v.lat, v.lng),
        caught: caughtVenueIds.has(v.id),
      }))
      .sort((a, b) => a.distance - b.distance);

    return withDistance.find((v) => !v.caught) ?? withDistance[0] ?? null;
  }, [position, venues, caughtVenueIds]);

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

        <DailyStreak
          streak={profile?.streak ?? 0}
          boostExpiresAt={profile?.boost_expires_at}
        />

        {nearest && (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-white/60">Closest bonus</h2>
            <NearestVenue
              venue={nearest.venue}
              distance={nearest.distance}
              caught={nearest.caught}
            />
          </div>
        )}
      </main>
    </div>
  );
}
