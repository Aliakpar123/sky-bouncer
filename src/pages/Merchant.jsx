import { useParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import QRGenerator from '../components/merchant/QRGenerator';
import MerchantDashboard from '../components/merchant/MerchantDashboard';

export default function Merchant() {
  const { venueId } = useParams();

  if (!venueId) {
    return (
      <div className="pb-24">
        <Header title="Merchant portal" />
        <p className="px-4 pt-8 text-white/50 text-sm">
          No venue linked to this account. Contact Pulse Radar support to set up your merchant
          portal.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <Header title="Merchant portal" />
      <main className="px-4 pt-4 flex flex-col gap-6">
        <section>
          <h2 className="text-sm font-semibold text-white/60 mb-2">Check-in code</h2>
          <QRGenerator venueId={venueId} />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-white/60 mb-2">Analytics</h2>
          <MerchantDashboard venueId={venueId} />
        </section>
      </main>
    </div>
  );
}
