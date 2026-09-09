import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { supabase } from '../../lib/supabase';

const TOKEN_TTL_SECONDS = 60;

export default function QRGenerator({ venueId }) {
  const [token, setToken] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(TOKEN_TTL_SECONDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const canvasRef = useRef(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('generate_checkin_token', {
        p_venue_id: venueId,
        p_ttl_seconds: TOKEN_TTL_SECONDS,
      });
      if (rpcError) throw rpcError;
      setToken(data);
      setSecondsLeft(TOKEN_TTL_SECONDS);
    } catch (err) {
      console.error('Failed to generate check-in token', err);
      setError(err.message ?? 'Could not generate a code');
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

  // Rendered locally: the check-in token is a bearer credential, so it must
  // never leave the device for a third-party QR image service.
  useEffect(() => {
    if (!token || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, token, {
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch((err) => {
      console.error('Failed to render QR code', err);
      setError('Could not render the code');
    });
  }, [token]);

  return (
    <div className="flex flex-col items-center gap-4 bg-surface2 border border-border rounded-2xl p-6">
      <div className="w-[220px] h-[220px] flex items-center justify-center rounded-xl overflow-hidden bg-white/5">
        <canvas ref={canvasRef} className={token && !error ? 'rounded-xl' : 'hidden'} />
        {(!token || error) && (
          <span className="text-white/40 text-sm px-4 text-center">
            {error ?? (loading ? 'Generating…' : 'No code yet')}
          </span>
        )}
      </div>
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
