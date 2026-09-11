import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap } from 'lucide-react';
import Header from '../components/layout/Header';
import PartnerMap from '../components/map/PartnerMap';
import CatchButton from '../components/catch/CatchButton';
import CouponCard from '../components/catch/CouponCard';
import { useGeolocation } from '../hooks/useGeolocation';
import { useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';
import { catchState, distanceMeters } from '../lib/geo';
import { haptic } from '../lib/telegram';

export default function MapPage() {
  const { position } = useGeolocation({ watch: true });
  const { profile, setProfile } = useUser();
  const [venues, setVenues] = useState([]);
  const [selected, setSelected] = useState(null);
  const [catching, setCatching] = useState(false);
  const [reward, setReward] = useState(null);
  const [error, setError] = useState(null);
  const [caughtToday, setCaughtToday] = useState(new Set());

  useEffect(() => {
    async function load() {
      const [{ data: venueRows, error: venueError }, { data: catchRows }] = await Promise.all([
        supabase.from('venues').select('*'),
        supabase.from('catches').select('venue_id, created_at'),
      ]);

      if (venueError) console.error('Failed to load venues', venueError);
      else setVenues(venueRows ?? []);

      const today = new Date().toISOString().slice(0, 10);
      setCaughtToday(
        new Set(
          (catchRows ?? [])
            .filter((c) => c.created_at?.slice(0, 10) === today)
            .map((c) => c.venue_id)
        )
      );
    }
    load();
  }, []);

  // Nearest first — the radar is about what's within reach right now.
  const sorted = useMemo(() => {
    if (!position) return venues;
    return [...venues].sort(
      (a, b) =>
        distanceMeters(position.lat, position.lng, a.lat, a.lng) -
        distanceMeters(position.lat, position.lng, b.lat, b.lng)
    );
  }, [venues, position]);

  const state = selected ? catchState(position, selected) : null;

  const handleCatch = useCallback(async () => {
    if (!selected || !position) return;
    setCatching(true);
    setError(null);
    haptic('heavy');

    try {
      const { data, error: rpcError } = await supabase.rpc('catch_bonus', {
        p_venue_id: selected.id,
        p_lat: position.lat,
        p_lng: position.lng,
        p_accuracy_m: position.accuracy ?? null,
      });
      if (rpcError) throw rpcError;

      haptic('success');
      setReward(data);
      setCaughtToday((prev) => new Set(prev).add(selected.id));
      if (profile) setProfile({ ...profile, balance: data.balance });
    } catch (err) {
      haptic('error');
      setError(err.message ?? 'Could not catch this bonus');
    } finally {
      setCatching(false);
    }
  }, [selected, position, profile, setProfile]);

  function closeSheet() {
    setSelected(null);
    setReward(null);
    setError(null);
  }

  return (
    <div className="h-screen flex flex-col">
      <Header title="Radar" />
      <div className="flex-1 relative">
        <PartnerMap
          userPosition={position}
          venues={sorted}
          onSelectVenue={(venue) => {
            haptic('light');
            setSelected(venue);
          }}
        />
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            className="fixed inset-0 z-30 flex items-end bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeSheet}
          >
            <motion.div
              className="w-full bg-surface rounded-t-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+20px)]"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="font-bold text-lg">{selected.name}</p>
                  <p className="text-sm text-white/60">{selected.offer_title}</p>
                </div>
                <button type="button" onClick={closeSheet} className="p-1 text-white/50">
                  <X size={20} />
                </button>
              </div>

              {reward ? (
                <div className="flex flex-col gap-4">
                  <motion.p
                    className="text-center text-2xl font-extrabold text-accent2"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', damping: 12 }}
                  >
                    +{reward.points_awarded} PTS
                  </motion.p>
                  <CouponCard coupon={reward.coupon} venueName={selected.name} />
                </div>
              ) : caughtToday.has(selected.id) ? (
                <p className="text-center text-sm text-white/50 py-4">
                  You already caught this bonus today. Come back tomorrow.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm mb-4">
                    <span className="text-white/60">
                      {state?.distance != null ? `${state.distance}m away` : 'Locating…'}
                    </span>
                    <span className="flex items-center gap-1 text-accent2 font-semibold">
                      <Zap size={14} className="fill-accent2" />
                      {selected.reward_points} PTS
                    </span>
                  </div>

                  <CatchButton state={state} catching={catching} onCatch={handleCatch} />

                  {state?.status === 'imprecise' && (
                    <p className="text-xs text-white/50 text-center mt-3">
                      Your GPS signal is off by {Math.round(state.accuracy)}m. Step outside or
                      wait a moment for it to settle.
                    </p>
                  )}
                  {error && <p className="text-center text-red-400 text-sm mt-3">{error}</p>}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
