import { useEffect, useState } from "react";

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface GeoState {
  pos: GeoPoint | null;
  loading: boolean;
  error: string | null;
}

/** Live GPS position with loading / denied states. */
export function useGeolocation(watch = false) {
  const [state, setState] = useState<GeoState>({ pos: null, loading: false, error: null });

  const request = () => {
    if (!("geolocation" in navigator)) {
      setState({ pos: null, loading: false, error: "Geolocation is not supported on this device." });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const opts: PositionOptions = { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 };
    const onOk = (p: GeolocationPosition) => {
      setState({
        pos: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy },
        loading: false,
        error: null,
      });
    };
    const onErr = (e: GeolocationPositionError) => {
      const msg =
        e.code === e.PERMISSION_DENIED
          ? "Location permission was denied — tap the map to set the spot manually."
          : e.code === e.TIMEOUT
            ? "Getting your location took too long — tap the map to set it manually."
            : "Could not read your location — tap the map to set the spot manually.";
      setState({ pos: null, loading: false, error: msg });
    };
    if (watch) {
      const id = navigator.geolocation.watchPosition(onOk, onErr, opts);
      return () => navigator.geolocation.clearWatch(id);
    }
    // Some embedded browsers throw synchronously (insecure context, sandboxed
    // iframe) instead of calling the error callback — catch and fall back.
    try {
      navigator.geolocation.getCurrentPosition(onOk, onErr, opts);
    } catch {
      onErr({
        code: 2,
        message: "Geolocation unavailable — tap the map to set the spot manually.",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    }
  };

  useEffect(() => {
    if (!watch) return;
    const cleanup = request();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch]);

  return { ...state, request };
}
