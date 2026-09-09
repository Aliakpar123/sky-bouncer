import { useState } from 'react';
import { MapPin, QrCode, X } from 'lucide-react';
import { CHECKIN_RADIUS_METERS, distanceMeters } from '../../lib/geo';
import { haptic, scanQrCode } from '../../lib/telegram';

export default function CheckInModal({ offer, userPosition, onClose, onConfirm }) {
  const [status, setStatus] = useState('idle'); // idle | scanning | success | error
  const [errorMsg, setErrorMsg] = useState('');

  const distance = userPosition
    ? Math.round(
        distanceMeters(userPosition.lat, userPosition.lng, offer.location_lat, offer.location_lng)
      )
    : null;
  const inRange = distance !== null && distance <= CHECKIN_RADIUS_METERS;

  async function handleScan() {
    if (!inRange) return;
    setStatus('scanning');
    const code = await scanQrCode(`Scan the QR code at ${offer.partner_name} to confirm your visit`);
    if (!code) {
      setStatus('idle');
      return;
    }
    try {
      await onConfirm({ offer, qrPayload: code, userPosition });
      haptic('success');
      setStatus('success');
    } catch (err) {
      haptic('error');
      setErrorMsg(err.message ?? 'Check-in failed');
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="w-full bg-surface rounded-t-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+20px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="font-bold text-lg">{offer.partner_name}</p>
            <p className="text-sm text-white/60">{offer.title}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-white/50">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-2 text-sm mb-4">
          <MapPin size={16} className={inRange ? 'text-green-400' : 'text-white/40'} />
          {distance === null
            ? 'Locating you…'
            : inRange
            ? `You're at the venue (${distance}m away)`
            : `Get within ${CHECKIN_RADIUS_METERS}m to check in (currently ${distance}m away)`}
        </div>

        {status === 'success' ? (
          <p className="text-center text-green-400 font-semibold py-3">
            Check-in verified! Points credited.
          </p>
        ) : (
          <button
            type="button"
            disabled={!inRange || status === 'scanning'}
            onClick={handleScan}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-semibold bg-gradient-to-r from-accent to-accent2 disabled:opacity-40 disabled:grayscale"
          >
            <QrCode size={18} />
            {status === 'scanning' ? 'Scanning…' : 'Scan venue QR to check in'}
          </button>
        )}

        {status === 'error' && (
          <p className="text-center text-red-400 text-sm mt-2">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
