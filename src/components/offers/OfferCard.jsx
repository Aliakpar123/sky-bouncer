import { MapPin, Zap } from 'lucide-react';

export default function OfferCard({ offer, balance, onRedeem, redeeming }) {
  const affordable = balance >= offer.cost_in_points;

  return (
    <div className="bg-surface2 border border-border rounded-2xl p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{offer.title}</p>
          <p className="text-xs text-white/50 flex items-center gap-1 mt-0.5">
            <MapPin size={12} /> {offer.partner_name}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0 text-accent2 font-bold text-sm">
          <Zap size={14} className="fill-accent2" />
          {offer.cost_in_points.toLocaleString()}
        </div>
      </div>
      {offer.description && <p className="text-sm text-white/70">{offer.description}</p>}
      <button
        type="button"
        disabled={!affordable || redeeming}
        onClick={() => onRedeem(offer)}
        className="mt-2 w-full rounded-xl py-2.5 text-sm font-semibold bg-gradient-to-r from-accent to-accent2 disabled:opacity-40 disabled:grayscale transition"
      >
        {redeeming ? 'Redeeming…' : affordable ? 'Redeem' : 'Not enough points'}
      </button>
    </div>
  );
}
