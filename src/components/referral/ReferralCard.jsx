import { Copy, Share2, Users } from 'lucide-react';
import { buildReferralLink, haptic, shareReferralLink } from '../../lib/telegram';

export default function ReferralCard({ userId, tier1Count = 0, tier2Count = 0 }) {
  const link = buildReferralLink(userId);

  function copyLink() {
    navigator.clipboard?.writeText(link);
    haptic('light');
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-surface2 border border-border rounded-2xl p-5 text-center">
        <Users size={28} className="mx-auto mb-2 text-accent2" />
        <p className="font-bold text-lg">Invite friends, earn together</p>
        <p className="text-sm text-white/60 mt-1">
          Get 10% of points your direct invites earn, plus 5% from their invites.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface2 border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-extrabold">{tier1Count}</p>
          <p className="text-xs text-white/50 mt-1">Tier 1 referrals (10%)</p>
        </div>
        <div className="bg-surface2 border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-extrabold">{tier2Count}</p>
          <p className="text-xs text-white/50 mt-1">Tier 2 referrals (5%)</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            haptic('medium');
            shareReferralLink(userId);
          }}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 font-semibold bg-gradient-to-r from-accent to-accent2"
        >
          <Share2 size={18} /> Share invite link
        </button>
        <button
          type="button"
          onClick={copyLink}
          className="px-4 rounded-xl border border-border bg-surface2"
          aria-label="Copy referral link"
        >
          <Copy size={18} />
        </button>
      </div>
    </div>
  );
}
