import distance from '@turf/distance';
import { point } from '@turf/helpers';

/** Great-circle distance in metres between two lat/lng pairs. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  return distance(point([lng1, lat1]), point([lng2, lat2]), { units: 'meters' });
}

// Mirrors catch_radius_m() / max_gps_accuracy_m() in schema.sql. The server
// re-checks both, so these values only drive what the UI shows.
export const CATCH_RADIUS_METERS = 20;
export const MAX_GPS_ACCURACY_METERS = 100;

/**
 * What the catch button should show for a venue.
 *
 * A phone standing at the counter routinely reports 30-50m of error, so a
 * hard 20m cut would lock out people who are genuinely there. The radius is
 * widened by the reported accuracy — but only up to the point where the
 * reading stops meaning anything, past which we say so rather than pretending
 * the user might be in range.
 */
export function catchState(userPosition, venue) {
  if (!userPosition) {
    return { status: 'locating', distance: null };
  }

  const accuracy = userPosition.accuracy ?? MAX_GPS_ACCURACY_METERS;
  if (accuracy > MAX_GPS_ACCURACY_METERS) {
    return { status: 'imprecise', distance: null, accuracy };
  }

  const metres = distanceMeters(userPosition.lat, userPosition.lng, venue.lat, venue.lng);
  const allowed = CATCH_RADIUS_METERS + accuracy;

  return {
    status: metres <= allowed ? 'ready' : 'far',
    distance: Math.round(metres),
    // How much closer the user needs to get, as the button label reports it.
    metresToGo: Math.max(1, Math.round(metres - CATCH_RADIUS_METERS)),
    accuracy,
  };
}
