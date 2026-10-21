"use client";

import { useEffect, useRef, useState } from "react";

interface Coordinates { latitude: number; longitude: number }
interface Props {
  latitude: unknown;
  longitude: unknown;
  onDetect: (coordinates: Coordinates) => void;
}

/** One explicit browser lookup; only the reviewed coordinates enter tile config. */
export function WeatherLocationButton({ latitude, longitude, onDetect }: Props) {
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [result, setResult] = useState<{
    latitude: unknown; longitude: unknown; pending: boolean; error: boolean; message: string;
  } | null>(null);
  // Editing either coordinate, changing widget type or closing the form cancels
  // delivery. Geolocation itself has no cancellation API.
  useEffect(() => () => {
    request.current++;
    clearTimeout(timer.current);
  }, [latitude, longitude]);

  const current = result?.latitude === latitude && result?.longitude === longitude ? result : null;
  // Discard obsolete feedback so returning to a previous coordinate value
  // cannot resurrect an already-cancelled lookup's disabled button.
  if (result && !current) setResult(null);

  function detect() {
    const id = ++request.current;
    clearTimeout(timer.current);
    function fail(message: string) {
      if (id !== request.current) return;
      request.current++;
      clearTimeout(timer.current);
      setResult({ latitude, longitude, pending: false, error: true, message });
    }
    if (!window.isSecureContext) {
      fail("Location detection requires HTTPS or localhost. Enter coordinates manually on this connection.");
      return;
    }
    if (!navigator.geolocation) {
      fail("This browser does not support location detection. Enter coordinates manually.");
      return;
    }
    setResult({ latitude, longitude, pending: true, error: false, message: "Waiting for your browser’s location permission and position…" });
    // The browser's timeout excludes time spent waiting for permission. Bound
    // the entire interaction too, and ignore callbacks from expired attempts.
    timer.current = setTimeout(() => fail("Location detection timed out. Try again or enter coordinates manually."), 15_000);
    try {
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        if (id !== request.current) return;
        if (!Number.isFinite(coords.latitude) || Math.abs(coords.latitude) > 90 ||
            !Number.isFinite(coords.longitude) || Math.abs(coords.longitude) > 180) {
          fail("Your browser returned an invalid location. Try again or enter coordinates manually.");
          return;
        }
        request.current++;
        clearTimeout(timer.current);
        // Roughly 100 m is ample for weather; avoid persisting precise GPS data.
        const coordinates = {
          latitude: Number(coords.latitude.toFixed(3)),
          longitude: Number(coords.longitude.toFixed(3)),
        };
        setResult({ ...coordinates, pending: false, error: false, message: "Location detected. Review the coordinates, then save the tile." });
        onDetect(coordinates);
      }, (error) => fail(error.code === 1
        ? "Location permission was denied. Allow location in your browser’s site settings to retry, or enter coordinates manually."
        : error.code === 3
          ? "Location detection timed out. Try again or enter coordinates manually."
          : "Your location is unavailable. Try again or enter coordinates manually."),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 });
    } catch {
      fail("Location detection is unavailable. Check your browser’s site settings or enter coordinates manually.");
    }
  }

  return <div className="settings-form-row">
    <button type="button" className="settings-btn" onClick={detect} disabled={current?.pending}
      aria-describedby="sf-weather-location-hint">
      {current?.pending ? "Detecting location…" : "Use my location"}
    </button>
    <p id="sf-weather-location-hint" className="settings-form-hint">
      Uses this device’s location once, with your permission. Approximate coordinates are saved for this tile and shared with Open-Meteo for weather after saving; all viewers see the same location.
    </p>
    <div role="status" aria-atomic="true">
      {current && !current.error && <p className="settings-form-hint">{current.message}</p>}
    </div>
    <div role="alert" aria-atomic="true">
      {current?.error && <p className="settings-form-hint settings-form-hint--error">{current.message}</p>}
    </div>
  </div>;
}
