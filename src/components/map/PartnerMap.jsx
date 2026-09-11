import L from 'leaflet';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { Fragment, useEffect } from 'react';
import { CATCH_RADIUS_METERS } from '../../lib/geo';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Default Leaflet marker icons reference bundled assets by relative path, which
// breaks under Vite's asset pipeline — re-point them at the imported URLs so
// they ship with the bundle instead of depending on a third-party CDN.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

// The user's own position must not look like a venue pin, or "you are here"
// and "walk here" become the same symbol on a dark map.
const userDotIcon = L.divIcon({
  className: 'user-dot',
  html: '<span class="user-dot__core"></span><span class="user-dot__halo"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function RecenterOnUser({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView([position.lat, position.lng], map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.lat, position?.lng]);
  return null;
}

export default function PartnerMap({ userPosition, venues, onSelectVenue }) {
  const center = userPosition
    ? [userPosition.lat, userPosition.lng]
    : [41.3111, 69.2797]; // Tashkent fallback

  return (
    <MapContainer center={center} zoom={14} zoomControl={false} className="w-full h-full">
      <TileLayer
        url={DARK_TILES}
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
      />
      {userPosition && <RecenterOnUser position={userPosition} />}
      {userPosition && (
        <Marker
          position={[userPosition.lat, userPosition.lng]}
          icon={userDotIcon}
          interactive={false}
        />
      )}
      {venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((venue) => (
          <Fragment key={venue.id}>
            {/* The radar zone, drawn so the walk-closer instruction is legible. */}
            <Circle
              center={[venue.lat, venue.lng]}
              radius={CATCH_RADIUS_METERS}
              pathOptions={{ color: '#b84cff', weight: 1, fillOpacity: 0.15 }}
            />
            <Marker
              position={[venue.lat, venue.lng]}
              eventHandlers={{ click: () => onSelectVenue(venue) }}
            >
              <Popup>
                <strong>{venue.name}</strong>
                <br />
                {venue.offer_title}
              </Popup>
            </Marker>
          </Fragment>
        ))}
    </MapContainer>
  );
}
