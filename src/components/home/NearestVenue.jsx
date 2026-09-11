import { ChevronRight, MapPin, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CATCH_RADIUS_METERS } from '../../lib/geo';
import { haptic } from '../../lib/telegram';

function formatDistance(metres) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

export default function NearestVenue({ venue, distance, caught }) {
  const navigate = useNavigate();
  const inRange = distance <= CATCH_RADIUS_METERS;

  return (
    <button
      type="button"
      onClick={() => {
        haptic('light');
        navigate('/map');
      }}
      className="w-full flex items-center gap-3 bg-surface2 border border-border rounded-2xl px-4 py-3 text-left"
    >
      <div
        className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
          inRange && !caught ? 'bg-accent/20' : 'bg-base'
        }`}
      >
        <MapPin size={18} className={inRange && !caught ? 'text-accent2' : 'text-white/45'} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{venue.name}</p>
        <p className="text-xs text-white/50 truncate">
          {caught
            ? 'Caught today — back tomorrow'
            : inRange
            ? "You're in range — catch it now"
            : `${formatDistance(distance)} away · ${venue.offer_title}`}
        </p>
      </div>

      {!caught && (
        <span className="shrink-0 flex items-center gap-1 text-sm font-bold text-accent2">
          <Zap size={13} className="fill-accent2" />
          {venue.reward_points}
        </span>
      )}
      <ChevronRight size={18} className="shrink-0 text-white/30" />
    </button>
  );
}
