const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in meters between two lat/lng points (Haversine formula). */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export const CHECKIN_RADIUS_METERS = 100;

export function isWithinCheckInRange(userLat, userLng, venueLat, venueLng) {
  return distanceMeters(userLat, userLng, venueLat, venueLng) <= CHECKIN_RADIUS_METERS;
}
