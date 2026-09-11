import { useEffect, useState } from 'react';
import { Ticket } from 'lucide-react';
import Header from '../components/layout/Header';
import CouponCard from '../components/catch/CouponCard';
import { supabase } from '../lib/supabase';

export default function Offers() {
  const [coupons, setCoupons] = useState([]);
  const [venuesById, setVenuesById] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [{ data: couponRows, error }, { data: venueRows }] = await Promise.all([
        supabase.rpc('active_coupons'),
        supabase.from('venues').select('id, name'),
      ]);

      if (error) console.error('Failed to load coupons', error);
      else setCoupons(couponRows ?? []);

      setVenuesById(Object.fromEntries((venueRows ?? []).map((v) => [v.id, v.name])));
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="pb-24">
      <Header title="My coupons" />
      <main className="px-4 pt-4 flex flex-col gap-3">
        {loading && <p className="text-center text-white/40 text-sm mt-8">Loading…</p>}

        {!loading && coupons.length === 0 && (
          <div className="text-center mt-16 flex flex-col items-center gap-3">
            <Ticket size={32} className="text-white/25" />
            <p className="text-white/50 text-sm max-w-[260px]">
              No active coupons. Walk to a partner venue on the radar and catch a bonus to get
              one.
            </p>
          </div>
        )}

        {coupons.map((coupon) => (
          <CouponCard key={coupon.id} coupon={coupon} venueName={venuesById[coupon.venue_id]} />
        ))}
      </main>
    </div>
  );
}
