import { useCallback, useEffect, useState } from 'react';

export function useGeolocation({ watch = false } = {}) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const onSuccess = useCallback((pos) => {
    setPosition({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    });
    setLoading(false);
    setError(null);
  }, []);

  const onError = useCallback((err) => {
    setError(err.message ?? 'Location unavailable');
    setLoading(false);
  }, []);

  const refresh = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported on this device');
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    });
  }, [onSuccess, onError]);

  useEffect(() => {
    if (!watch || !navigator.geolocation) return undefined;
    const id = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
    });
    return () => navigator.geolocation.clearWatch(id);
  }, [watch, onSuccess, onError]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { position, error, loading, refresh };
}
