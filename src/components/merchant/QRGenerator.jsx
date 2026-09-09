import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const TOKEN_TTL_SECONDS = 60;

export default function QRGenerator({ venueId }) {
  const [token, setToken] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(TOKEN_TTL_SECONDS);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('generate_checkin_token', {
        p_venue_id: venueId,
        p_ttl_seconds: TOKEN_TTL_SECONDS,
      });
      if (error) throw error;
      setToken(data);
      setSecondsLeft(TOKEN_TTL_SECONDS);
    } catch (err) {
      console.error('Failed to generate check-in token', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  useEffect(() => {
    if (!token) return undefined;
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          generate();
          return TOKEN_TTL_SECONDS;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const qrImageUrl = token
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(token)}`
    : null;

  return (
    <div className="flex flex-col items-center gap-4 bg-surface2 border border-border rounded-2xl p-6">
      {qrImageUrl ? (
        <img src={qrImageUrl} alt="Check-in QR code" className="rounded-xl w-[220px] h-[220px]" />
      ) : (
        <div className="w-[220px] h-[220px] flex items-center justify-center text-white/40">
          {loading ? 'Generating…' : 'No code yet'}
        </div>
      )}
      <div className="flex items-center gap-2 text-sm text-white/60">
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        Refreshes in {secondsLeft}s
      </div>
      <p className="text-xs text-white/40 text-center">
        Have the customer scan this in-app to confirm their visit. Codes expire automatically to
        prevent screenshot sharing.
      </p>
    </div>
  );
}
