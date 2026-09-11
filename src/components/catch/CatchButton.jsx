import { motion } from 'framer-motion';
import { Loader2, Lock, Radar, SatelliteDish, Zap } from 'lucide-react';

const LABELS = {
  locating: { icon: Loader2, text: 'Finding you…' },
  imprecise: { icon: SatelliteDish, text: 'Signal too weak' },
  far: { icon: Lock, text: null }, // filled in from distance
  ready: { icon: Zap, text: 'Catch bonus' },
  catching: { icon: Radar, text: 'Catching…' },
};

export default function CatchButton({ state, catching, onCatch }) {
  const status = catching ? 'catching' : state.status;
  const { icon: Icon, text } = LABELS[status] ?? LABELS.locating;
  const isReady = status === 'ready';

  const label =
    status === 'far' ? `Walk ${state.metresToGo}m closer` : text;

  return (
    <div className="relative flex items-center justify-center">
      {/* Pulse rings only while the bonus is actually catchable. */}
      {isReady && (
        <>
          <motion.span
            className="absolute inset-0 rounded-2xl bg-accent2"
            initial={{ opacity: 0.35, scale: 1 }}
            animate={{ opacity: 0, scale: 1.35 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.span
            className="absolute inset-0 rounded-2xl bg-accent"
            initial={{ opacity: 0.25, scale: 1 }}
            animate={{ opacity: 0, scale: 1.6 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
          />
        </>
      )}

      <motion.button
        type="button"
        disabled={!isReady || catching}
        onClick={onCatch}
        animate={isReady ? { scale: [1, 1.03, 1] } : { scale: 1 }}
        transition={isReady ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : {}}
        whileTap={isReady ? { scale: 0.96 } : {}}
        className={`relative w-full rounded-2xl py-4 font-bold flex items-center justify-center gap-2 transition-colors ${
          isReady
            ? 'bg-gradient-to-r from-accent to-accent2 text-white shadow-[0_0_30px_rgba(184,76,255,0.55)]'
            : 'bg-surface2 border border-border text-white/45'
        }`}
      >
        <Icon
          size={20}
          className={status === 'locating' || catching ? 'animate-spin' : ''}
        />
        {label}
      </motion.button>
    </div>
  );
}
