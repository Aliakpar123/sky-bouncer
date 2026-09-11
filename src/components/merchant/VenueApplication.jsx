import { useState } from 'react';
import { Clock, MapPin, Store, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useGeolocation } from '../../hooks/useGeolocation';
import { haptic } from '../../lib/telegram';

function StatusBadge({ status }) {
  const styles = {
    pending: 'bg-surface2 border-border text-white/60',
    approved: 'bg-green-500/15 border-green-500/40 text-green-400',
    rejected: 'bg-red-500/10 border-red-500/30 text-red-400',
  };
  const labels = { pending: 'Awaiting review', approved: 'Approved', rejected: 'Not approved' };

  return (
    <span className={`text-xs rounded-full border px-2.5 py-1 ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export default function VenueApplication({ applications, onSubmitted }) {
  const { position, error: geoError, refresh, loading: locating } = useGeolocation();
  const [form, setForm] = useState({ name: '', category: '', offer_title: '', contact: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const pending = applications.find((a) => a.status === 'pending');
  const settled = applications.filter((a) => a.status !== 'pending');

  async function submit(event) {
    event.preventDefault();
    if (!position) {
      setError('We need your location to place the venue on the map.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('submit_venue_application', {
        p_name: form.name,
        p_category: form.category || null,
        p_offer_title: form.offer_title,
        p_lat: position.lat,
        p_lng: position.lng,
        p_contact: form.contact || null,
      });
      if (rpcError) throw rpcError;
      haptic('success');
      onSubmitted();
    } catch (err) {
      haptic('error');
      setError(err.message ?? 'Could not submit the application');
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <div className="bg-surface2 border border-border rounded-2xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold">{pending.name}</p>
          <StatusBadge status="pending" />
        </div>
        <p className="text-sm text-white/60">{pending.offer_title}</p>
        <div className="flex items-start gap-2 text-xs text-white/45">
          <Clock size={14} className="shrink-0 mt-0.5" />
          <p>
            We verify each venue by hand before it goes on the radar — it decides how many
            points visitors earn there. We&apos;ll message you in this chat once it&apos;s
            reviewed.
          </p>
        </div>
      </div>
    );
  }

  const field =
    'w-full rounded-xl bg-base border border-border px-4 py-3 text-sm placeholder:text-white/25 focus:border-accent outline-none';

  return (
    <div className="flex flex-col gap-4">
      {settled.map((application) => (
        <div
          key={application.id}
          className="bg-surface2 border border-border rounded-2xl p-4 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{application.name}</p>
            {application.review_note && (
              <p className="text-xs text-white/45 truncate">{application.review_note}</p>
            )}
          </div>
          <StatusBadge status={application.status} />
        </div>
      ))}

      <form onSubmit={submit} className="bg-surface2 border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Store size={18} className="text-accent2" />
          <p className="font-semibold text-sm">List your venue</p>
        </div>
        <p className="text-xs text-white/50 mb-4">
          Bring nearby walkers to your door. Free to list — you only hand over the perk when
          someone walks in.
        </p>

        <div className="flex flex-col gap-3">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Venue name"
            maxLength={80}
            required
            className={field}
          />
          <input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="Category (cafe, bakery, gym…)"
            maxLength={40}
            className={field}
          />
          <input
            value={form.offer_title}
            onChange={(e) => setForm({ ...form, offer_title: e.target.value })}
            placeholder="What visitors get (e.g. free espresso)"
            maxLength={80}
            required
            className={field}
          />
          <input
            value={form.contact}
            onChange={(e) => setForm({ ...form, contact: e.target.value })}
            placeholder="Contact (phone or @username)"
            maxLength={80}
            className={field}
          />

          <div className="flex items-center gap-2 text-xs">
            <MapPin size={14} className={position ? 'text-green-400' : 'text-white/40'} />
            {position ? (
              <span className="text-white/55">
                Using your current location — stand at the venue when you submit.
              </span>
            ) : (
              <button
                type="button"
                onClick={refresh}
                className="text-accent2 underline"
              >
                {locating ? 'Locating…' : geoError ? 'Retry location' : 'Use my location'}
              </button>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={busy || !position}
          className="mt-4 w-full rounded-xl py-3 font-semibold bg-gradient-to-r from-accent to-accent2 disabled:opacity-40 disabled:grayscale"
        >
          {busy ? 'Submitting…' : 'Submit for review'}
        </button>

        {error && (
          <p className="mt-3 text-sm text-red-400 text-center flex items-center justify-center gap-1.5">
            <X size={14} /> {error}
          </p>
        )}
      </form>
    </div>
  );
}
