import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

function secondsLeft(expiresAt) {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export default function CouponCard({ coupon, venueName }) {
  const [remaining, setRemaining] = useState(() => secondsLeft(coupon.expires_at));

  useEffect(() => {
    const id = setInterval(() => setRemaining(secondsLeft(coupon.expires_at)), 1000);
    return () => clearInterval(id);
  }, [coupon.expires_at]);

  const expired = remaining === 0;
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, '0');

  return (
    <div
      className={`rounded-2xl border p-5 text-center ${
        expired ? 'border-border bg-surface2 opacity-60' : 'border-accent/50 bg-surface2'
      }`}
    >
      <p className="text-sm text-white/60">{venueName ?? 'Your reward'}</p>
      <p className="font-semibold mt-0.5">{coupon.offer_title}</p>

      <p
        className={`mt-4 text-4xl font-extrabold tracking-[0.2em] ${
          expired ? 'text-white/30' : 'text-white'
        }`}
      >
        {coupon.code}
      </p>

      <div className="mt-4 flex items-center justify-center gap-1.5 text-sm">
        <Clock size={14} className={expired ? 'text-white/40' : 'text-accent2'} />
        <span className={expired ? 'text-white/40' : 'text-accent2 font-semibold tabular-nums'}>
          {expired ? 'Expired' : `${minutes}:${seconds} left`}
        </span>
      </div>

      {!expired && (
        <p className="text-xs text-white/40 mt-3">Show this code at the counter.</p>
      )}
    </div>
  );
}
