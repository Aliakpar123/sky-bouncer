import { useCallback, useEffect, useState } from 'react';
import Header from '../components/layout/Header';
import RedeemCoupon from '../components/merchant/RedeemCoupon';
import MerchantDashboard from '../components/merchant/MerchantDashboard';
import VenueApplication from '../components/merchant/VenueApplication';
import { supabase } from '../lib/supabase';
import { haptic } from '../lib/telegram';

export default function Merchant() {
  const [venues, setVenues] = useState([]);
  const [applications, setApplications] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: venueRows, error: venueError }, { data: appRows }] = await Promise.all([
      supabase.rpc('my_venues'),
      supabase.rpc('my_venue_applications'),
    ]);

    if (venueError) console.error('Failed to load venues', venueError);
    const owned = venueRows ?? [];
    setVenues(owned);
    setApplications(appRows ?? []);
    setSelectedId((current) => current ?? owned[0]?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = venues.find((v) => v.id === selectedId);

  return (
    <div className="pb-24">
      <Header title={selected ? selected.name : 'For business'} />
      <main className="px-4 pt-4 flex flex-col gap-6">
        {loading && <p className="text-white/40 text-sm text-center mt-8">Loading…</p>}

        {!loading && venues.length === 0 && (
          <VenueApplication applications={applications} onSubmitted={load} />
        )}

        {!loading && venues.length > 0 && (
          <>
            {venues.length > 1 && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {venues.map((venue) => (
                  <button
                    key={venue.id}
                    type="button"
                    onClick={() => {
                      haptic('light');
                      setSelectedId(venue.id);
                    }}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
                      venue.id === selectedId
                        ? 'border-accent bg-accent/15 text-white'
                        : 'border-border bg-surface2 text-white/60'
                    }`}
                  >
                    {venue.name}
                  </button>
                ))}
              </div>
            )}

            <RedeemCoupon />

            <section>
              <h2 className="text-sm font-semibold text-white/60 mb-2">Analytics</h2>
              <MerchantDashboard venueId={selectedId} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
