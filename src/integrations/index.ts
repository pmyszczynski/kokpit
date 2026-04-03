// Importing each integration registers its widget as a side effect.
// Add new integrations here as they are implemented.
import "./plex/widget";
import "./qbittorrent/statsWidget";
import "./qbittorrent/torrentsWidget";

export type IntegrationStatus = "ok" | "error" | "unknown";
