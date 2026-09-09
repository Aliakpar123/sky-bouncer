import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function MerchantDashboard({ venueId }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase.rpc('venue_analytics', { p_venue_id: venueId });
      if (!cancelled) {
        if (error) console.error('Failed to load venue analytics', error);
        else setStats(data);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  if (loading) return <p className="text-white/50 text-sm">Loading analytics…</p>;
  if (!stats) return <p className="text-white/50 text-sm">No data yet.</p>;

  const cards = [
    { label: "Today's check-ins", value: stats.checkins_today },
    { label: 'Check-ins (7d)', value: stats.checkins_7d },
    { label: 'Unique visitors (7d)', value: stats.unique_visitors_7d },
    { label: 'Return rate', value: `${Math.round((stats.return_rate ?? 0) * 100)}%` },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-surface2 border border-border rounded-xl p-4">
          <p className="text-2xl font-extrabold tabular-nums">{c.value}</p>
          <p className="text-xs text-white/50 mt-1">{c.label}</p>
        </div>
      ))}
    </div>
  );
}
