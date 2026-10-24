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
  const [result, setResult] = useState<{
    latitude: unknown; longitude: unknown; pending: boolean; error: boolean; message: string;
  } | null>(null);
  // Editing either coordinate, changing widget type or closing the form cancels
  // delivery. Geolocation itself has no cancellation API.
  useEffect(() => () => {
    request.current++;
  }, [latitude, longitude]);

  const current = result?.latitude === latitude && result?.longitude === longitude ? result : null;
  // Discard obsolete feedback so returning to a previous coordinate value
  // cannot resurrect an already-cancelled lookup's disabled button.
  if (result && !current) setResult(null);

  function detect() {
    const id = ++request.current;
    function fail(message: string) {
      if (id !== request.current) return;
      request.current++;
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
    setResult({ latitude, longitude, pending: true, error: false, message: "Allow location permission in your browser and device settings. Finding your location can take up to a minute after permission is granted." });
    // Let the browser start its acquisition timeout after permission and
    // visibility checks. A wall-clock deadline also counts Windows' separate
    // system prompt and can discard a valid result just after permission.
    try {
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        if (id !== request.current) return;
        if (!Number.isFinite(coords.latitude) || Math.abs(coords.latitude) > 90 ||
            !Number.isFinite(coords.longitude) || Math.abs(coords.longitude) > 180) {
          fail("Your browser returned an invalid location. Try again or enter coordinates manually.");
          return;
        }
        request.current++;
        // Roughly 100 m is ample for weather; avoid persisting precise GPS data.
        const coordinates = {
          latitude: Number(coords.latitude.toFixed(3)),
          longitude: Number(coords.longitude.toFixed(3)),
        };
        setResult({ ...coordinates, pending: false, error: false, message: "Location detected. Review the coordinates, then save the tile." });
        onDetect(coordinates);
      }, (error) => fail(error.code === 1
        ? "Location permission was denied. Allow location in your browser’s site settings and your device’s Location Services to retry, or enter coordinates manually."
        : error.code === 3
          ? "Your browser could not determine your location within a minute. Check your device’s Location Services and allow location access for your browser, then retry or enter coordinates manually."
          : "Your location is unavailable. Check your device’s Location Services and allow location access for your browser, then retry or enter coordinates manually."),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 60_000 });
    } catch {
      fail("Location detection is unavailable. Check your browser’s site settings or enter coordinates manually.");
    }
  }

  return <div className="settings-form-row">
    <button type="button" className="settings-btn" onClick={() => {
      if (current?.pending) {
        request.current++;
        setResult(null);
      } else detect();
    }}
      aria-describedby="sf-weather-location-hint">
      {current?.pending ? "Cancel location detection" : "Use my location"}
    </button>
    <p id="sf-weather-location-hint" className="settings-form-hint">
      Uses this device’s location once, with your permission. Review the approximate coordinates before saving this tile. Testing sends draft coordinates to Open-Meteo; saving enables later weather fetches. All viewers see the same saved location.
    </p>
    <div role="status" aria-atomic="true">
      {current && !current.error && <p className="settings-form-hint">{current.message}</p>}
    </div>
    <div role="alert" aria-atomic="true">
      {current?.error && <p className="settings-form-hint settings-form-hint--error">{current.message}</p>}
    </div>
  </div>;
}
