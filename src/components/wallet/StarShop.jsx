import { useEffect, useState } from 'react';
import { Flame, Star, Zap } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { purchaseWithStars } from '../../lib/purchases';
import { haptic } from '../../lib/telegram';

const ICONS = { streak_saver: Flame, booster: Zap };

export default function StarShop({ profile, onPurchased }) {
  const [products, setProducts] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('sort_order');
      if (error) console.error('Failed to load products', error);
      else setProducts(data ?? []);
    }
    load();
  }, []);

  async function buy(product) {
    setBusyId(product.id);
    setMessage(null);
    haptic('light');

    try {
      const status = await purchaseWithStars(product.id);

      if (status === 'paid') {
        haptic('success');
        // The bot credits the item when Telegram confirms the charge, which
        // can land a moment after this callback.
        setMessage({ ok: true, text: `${product.title} purchased — applying it now…` });
        setTimeout(onPurchased, 1500);
      } else if (status === 'failed') {
        haptic('error');
        setMessage({ ok: false, text: 'Payment failed.' });
      }
      // 'cancelled' and 'pending' need no message.
    } catch (err) {
      haptic('error');
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusyId(null);
    }
  }

  const boostActive =
    profile?.boost_expires_at && new Date(profile.boost_expires_at) > new Date();

  return (
    <section className="w-full flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-white/60">Power-ups</h2>

      {(profile?.streak_savers > 0 || boostActive) && (
        <div className="flex gap-2 text-xs">
          {profile?.streak_savers > 0 && (
            <span className="rounded-full bg-surface2 border border-border px-3 py-1">
              {profile.streak_savers} Streak Saver{profile.streak_savers > 1 ? 's' : ''} ready
            </span>
          )}
          {boostActive && (
            <span className="rounded-full bg-accent/20 border border-accent/40 px-3 py-1 text-accent2">
              Booster active
            </span>
          )}
        </div>
      )}

      {products.map((product) => {
        const Icon = ICONS[product.id] ?? Star;
        return (
          <div
            key={product.id}
            className="flex items-center gap-3 bg-surface2 border border-border rounded-2xl p-4"
          >
            <div className="shrink-0 w-10 h-10 rounded-xl bg-base flex items-center justify-center">
              <Icon size={18} className="text-accent2" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{product.title}</p>
              <p className="text-xs text-white/55">{product.description}</p>
            </div>
            <button
              type="button"
              disabled={busyId === product.id}
              onClick={() => buy(product)}
              className="shrink-0 flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold bg-gradient-to-r from-accent to-accent2 disabled:opacity-50"
            >
              <Star size={14} className="fill-white" />
              {product.stars}
            </button>
          </div>
        );
      })}

      {message && (
        <p className={`text-sm text-center ${message.ok ? 'text-green-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
