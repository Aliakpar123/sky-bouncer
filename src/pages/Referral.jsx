import { useEffect, useState } from 'react';
import Header from '../components/layout/Header';
import ReferralCard from '../components/referral/ReferralCard';
import { useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';

export default function Referral() {
  const { profile } = useUser();
  const [counts, setCounts] = useState({ tier1: 0, tier2: 0 });

  useEffect(() => {
    if (!profile) return;
    async function loadCounts() {
      const { data, error } = await supabase.rpc('referral_counts');
      if (error) console.error('Failed to load referral counts', error);
      else setCounts({ tier1: data.tier1 ?? 0, tier2: data.tier2 ?? 0 });
    }
    loadCounts();
  }, [profile]);

  if (!profile) return null;

  return (
    <div className="pb-24">
      <Header title="Invite & earn" />
      <main className="px-4 pt-4">
        <ReferralCard userId={profile.id} tier1Count={counts.tier1} tier2Count={counts.tier2} />
      </main>
    </div>
  );
}
