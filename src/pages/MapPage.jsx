import { useEffect, useState } from 'react';
import Header from '../components/layout/Header';
import PartnerMap from '../components/map/PartnerMap';
import CheckInModal from '../components/map/CheckInModal';
import { useGeolocation } from '../hooks/useGeolocation';
import { useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';

export default function MapPage() {
  const { position } = useGeolocation({ watch: true });
  const { profile, refreshProfile } = useUser();
  const [offers, setOffers] = useState([]);
  const [selectedOffer, setSelectedOffer] = useState(null);

  useEffect(() => {
    async function loadOffers() {
      const { data, error } = await supabase.from('offers').select('*');
      if (error) console.error('Failed to load offers', error);
      else setOffers(data ?? []);
    }
    loadOffers();
  }, []);

  async function handleConfirmCheckIn({ offer, qrPayload, userPosition }) {
    const { error } = await supabase.rpc('confirm_checkin', {
      p_offer_id: offer.id,
      p_qr_payload: qrPayload,
      p_lat: userPosition.lat,
      p_lng: userPosition.lng,
    });
    if (error) throw error;
    await refreshProfile(profile.id);
  }

  return (
    <div className="h-screen flex flex-col">
      <Header title="Nearby venues" />
      <div className="flex-1 relative">
        <PartnerMap userPosition={position} offers={offers} onSelectOffer={setSelectedOffer} />
      </div>
      {selectedOffer && (
        <CheckInModal
          offer={selectedOffer}
          userPosition={position}
          onClose={() => setSelectedOffer(null)}
          onConfirm={handleConfirmCheckIn}
        />
      )}
    </div>
  );
}
