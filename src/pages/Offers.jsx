import { useEffect, useState } from 'react';
import Header from '../components/layout/Header';
import OfferCard from '../components/offers/OfferCard';
import { useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';
import { haptic } from '../lib/telegram';

export default function Offers() {
  const { profile, refreshProfile } = useUser();
  const [offers, setOffers] = useState([]);
  const [redeemingId, setRedeemingId] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    async function loadOffers() {
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .order('cost_in_points', { ascending: true });
      if (error) console.error('Failed to load offers', error);
      else setOffers(data ?? []);
    }
    loadOffers();
  }, []);

  async function handleRedeem(offer) {
    setRedeemingId(offer.id);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('redeem_offer', {
        p_user_id: profile.id,
        p_offer_id: offer.id,
      });
      if (error) throw error;
      await refreshProfile(profile.id);
      haptic('success');
      setMessage({ type: 'success', text: `Redeemed: ${offer.title}` });
    } catch (err) {
      haptic('error');
      setMessage({ type: 'error', text: err.message ?? 'Redemption failed' });
    } finally {
      setRedeemingId(null);
    }
  }

  return (
    <div className="pb-24">
      <Header title="Rewards" />
      <main className="px-4 pt-4 flex flex-col gap-3">
        {message && (
          <p className={`text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {message.text}
          </p>
        )}
        {offers.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            balance={profile?.balance ?? 0}
            redeeming={redeemingId === offer.id}
            onRedeem={handleRedeem}
          />
        ))}
        {offers.length === 0 && (
          <p className="text-center text-white/40 text-sm mt-8">No offers available yet.</p>
        )}
      </main>
    </div>
  );
}
