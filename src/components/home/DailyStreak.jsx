import { Flame } from 'lucide-react';

export default function DailyStreak({ streak = 0 }) {
  const multiplier = 1 + Math.min(streak, 7) * 0.1;

  return (
    <div className="flex items-center justify-between bg-surface2 border border-border rounded-2xl px-4 py-3">
      <div className="flex items-center gap-2">
        <Flame size={20} className="text-orange-400 fill-orange-400" />
        <div>
          <p className="text-sm font-semibold">{streak}-day streak</p>
          <p className="text-xs text-white/50">Keep it going for bigger rewards</p>
        </div>
      </div>
      <span className="text-sm font-bold text-accent2">x{multiplier.toFixed(1)}</span>
    </div>
  );
}
