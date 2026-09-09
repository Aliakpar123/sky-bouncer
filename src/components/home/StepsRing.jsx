const DAILY_GOAL = 6000;
const RADIUS = 80;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function StepsRing({ steps, pointsEarned }) {
  const progress = Math.min(steps / DAILY_GOAL, 1);
  const offset = CIRCUMFERENCE * (1 - progress);

  return (
    <div className="relative flex items-center justify-center w-[200px] h-[200px] mx-auto">
      <svg width="200" height="200" className="-rotate-90">
        <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="#26263a" strokeWidth="14" />
        <circle
          cx="100"
          cy="100"
          r={RADIUS}
          fill="none"
          stroke="url(#stepsGradient)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
        <defs>
          <linearGradient id="stepsGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6e3cff" />
            <stop offset="100%" stopColor="#b84cff" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-extrabold tabular-nums">{steps.toLocaleString()}</span>
        <span className="text-xs text-white/50">of {DAILY_GOAL.toLocaleString()} steps</span>
        <span className="mt-2 text-sm font-semibold text-accent2">+{pointsEarned} PTS</span>
      </div>
    </div>
  );
}
