import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { useEffect } from 'react';
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

function RecenterOnUser({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView([position.lat, position.lng], map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.lat, position?.lng]);
  return null;
}

export default function PartnerMap({ userPosition, offers, onSelectOffer }) {
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
        <Marker position={[userPosition.lat, userPosition.lng]}>
          <Popup>You are here</Popup>
        </Marker>
      )}
      {offers
        .filter((o) => o.location_lat && o.location_lng)
        .map((offer) => (
          <Marker
            key={offer.id}
            position={[offer.location_lat, offer.location_lng]}
            eventHandlers={{ click: () => onSelectOffer(offer) }}
          >
            <Popup>
              <strong>{offer.partner_name}</strong>
              <br />
              {offer.title}
            </Popup>
          </Marker>
        ))}
    </MapContainer>
  );
}
