// Importing each integration registers its widget as a side effect.
// Add new integrations here as they are implemented.
import "./plex/widget";
import "./qbittorrent/statsWidget";
import "./qbittorrent/torrentsWidget";
import "./sonarr/calendarWidget";
import "./sonarr/queueWidget";
import "./sabnzbd/widget";

export type IntegrationStatus = "ok" | "error" | "unknown";
