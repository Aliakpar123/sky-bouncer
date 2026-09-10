import { Flame } from 'lucide-react';
import { streakMultiplier } from '../../lib/rewards';

const NEXT_TIER = { 1.0: 3, 1.2: 7 };

export default function DailyStreak({ streak = 0 }) {
  const multiplier = streakMultiplier(streak);
  const nextAt = NEXT_TIER[multiplier];

  return (
    <div className="flex items-center justify-between bg-surface2 border border-border rounded-2xl px-4 py-3">
      <div className="flex items-center gap-2">
        <Flame size={20} className="text-orange-400 fill-orange-400" />
        <div>
          <p className="text-sm font-semibold">{streak}-day streak</p>
          <p className="text-xs text-white/50">
            {nextAt
              ? `${nextAt - streak} more ${nextAt - streak === 1 ? 'day' : 'days'} for x${
                  multiplier === 1 ? '1.2' : '1.5'
                }`
              : 'Top multiplier — keep it going'}
          </p>
        </div>
      </div>
      <span className="text-sm font-bold text-accent2">x{multiplier.toFixed(1)}</span>
    </div>
  );
}
