import { Flame, Zap } from 'lucide-react';
import { effectiveMultiplier, isBoostActive, streakMultiplier } from '../../lib/rewards';

const NEXT_TIER = { 1.0: 3, 1.2: 7 };

function minutesLeft(expiresAt) {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000));
}

export default function DailyStreak({ streak = 0, boostExpiresAt }) {
  const multiplier = streakMultiplier(streak);
  const nextAt = NEXT_TIER[multiplier];
  const boosted = isBoostActive(boostExpiresAt);
  // Show what a sync will really award, booster included — the badge drifting
  // from the server's arithmetic is how the multiplier bug started.
  const shown = effectiveMultiplier(streak, boostExpiresAt);

  return (
    <div className="flex flex-col gap-2">
      {boosted && (
        <div className="flex items-center gap-2 bg-accent/15 border border-accent/40 rounded-2xl px-4 py-2.5">
          <Zap size={16} className="text-accent2 fill-accent2 shrink-0" />
          <p className="text-sm">
            <span className="font-semibold">Booster active</span>
            <span className="text-white/55"> · {minutesLeft(boostExpiresAt)} min left</span>
          </p>
        </div>
      )}
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
      <span className="text-sm font-bold text-accent2">x{shown.toFixed(1)}</span>
    </div>
    </div>
  );
}
