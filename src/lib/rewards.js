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

// Mirrors boost_multiplier() in schema.sql.
export const BOOST_MULTIPLIER = 2.0;

export function isBoostActive(boostExpiresAt) {
  return Boolean(boostExpiresAt) && new Date(boostExpiresAt) > new Date();
}

/** The multiplier a sync will actually apply: streak ladder times any booster. */
export function effectiveMultiplier(streak, boostExpiresAt) {
  return streakMultiplier(streak) * (isBoostActive(boostExpiresAt) ? BOOST_MULTIPLIER : 1);
}

export function pointsForSteps(steps, streak, boostExpiresAt) {
  return Math.floor(
    (steps / 1000) * POINTS_PER_1000_STEPS * effectiveMultiplier(streak, boostExpiresAt)
  );
}
