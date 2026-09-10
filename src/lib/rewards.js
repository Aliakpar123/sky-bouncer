// Mirrors streak_multiplier() and the points formula in supabase/schema.sql.
// The server is authoritative — these exist so the UI can preview what a sync
// will award without waiting for the round trip. Change both together.

export function streakMultiplier(streak) {
  const days = streak ?? 0;
  if (days >= 7) return 1.5;
  if (days >= 3) return 1.2;
  return 1.0;
}

export const POINTS_PER_1000_STEPS = 100;

export function pointsForSteps(steps, streak) {
  return Math.floor((steps / 1000) * POINTS_PER_1000_STEPS * streakMultiplier(streak));
}
