"use client";

import { useEffect, useState } from "react";

interface ServiceTileProps {
  name: string;
  url: string;
  icon?: string;
  description?: string;
}

type PingStatus = "pending" | "ok" | "error";

function StatusDot({ url }: { url: string }) {
  const [status, setStatus] = useState<PingStatus>("pending");

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(
          `/api/ping?url=${encodeURIComponent(url)}`
        );
        const data = await res.json();
        setStatus(data.ok ? "ok" : "error");
      } catch {
        setStatus("error");
      }
    };

    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [url]);

  return (
    <div
      className={`status-dot status-dot--${status}`}
      title={status === "pending" ? "Checking…" : status === "ok" ? "Online" : "Offline"}
      aria-label={status === "pending" ? "Checking status" : status === "ok" ? "Online" : "Offline"}
    />
  );
}

function ServiceIcon({ icon, url, name }: { icon?: string; url: string; name: string }) {
  const [iconError, setIconError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);

  const faviconUrl = (() => {
    try {
      return new URL("/favicon.ico", url).href;
    } catch {
      return null;
    }
  })();

  if (icon && !iconError) {
    return (
      <img
        src={icon}
        alt=""
        className="service-tile__icon"
        onError={() => setIconError(true)}
      />
    );
  }

  if (faviconUrl && !faviconError) {
    return (
      <img
        src={faviconUrl}
        alt=""
        className="service-tile__icon"
        onError={() => setFaviconError(true)}
      />
    );
  }

  return (
    <div className="service-tile__letter-fallback" aria-hidden="true">
      {name[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

export default function ServiceTile({ name, url, icon, description }: ServiceTileProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="service-tile"
    >
      <StatusDot url={url} />
      <ServiceIcon icon={icon} url={url} name={name} />
      <span className="service-tile__name">{name}</span>
      {description && (
        <span className="service-tile__description">{description}</span>
      )}
    </a>
  );
}
