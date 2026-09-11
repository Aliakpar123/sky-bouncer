import { useState } from 'react';
import { Check, Ticket } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { haptic } from '../../lib/telegram';

export default function RedeemCoupon() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (code.trim().length < 4) return;

    setBusy(true);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc('redeem_coupon', { p_code: code.trim() });
      if (error) throw error;
      haptic('success');
      setResult({ ok: true, text: `Redeemed: ${data.offer_title}` });
      setCode('');
    } catch (err) {
      haptic('error');
      setResult({ ok: false, text: err.message ?? 'Could not redeem this code' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-surface2 border border-border rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Ticket size={18} className="text-accent2" />
        <p className="font-semibold text-sm">Redeem a customer code</p>
      </div>

      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABC123"
        maxLength={6}
        autoCapitalize="characters"
        autoComplete="off"
        className="w-full rounded-xl bg-base border border-border px-4 py-3 text-center text-2xl font-bold tracking-[0.25em] placeholder:text-white/20 focus:border-accent outline-none"
      />

      <button
        type="submit"
        disabled={busy || code.trim().length < 4}
        className="mt-3 w-full rounded-xl py-3 font-semibold bg-gradient-to-r from-accent to-accent2 disabled:opacity-40 disabled:grayscale"
      >
        {busy ? 'Checking…' : 'Redeem'}
      </button>

      {result && (
        <p
          className={`mt-3 text-sm text-center flex items-center justify-center gap-1.5 ${
            result.ok ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {result.ok && <Check size={15} />}
          {result.text}
        </p>
      )}
    </form>
  );
}
