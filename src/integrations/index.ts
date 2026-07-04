// Importing each integration registers its widget as a side effect.
// Add new integrations here as they are implemented.
import "./plex/widget";
import "./qbittorrent/statsWidget";
import "./qbittorrent/torrentsWidget";
import "./sonarr/calendarWidget";
import "./sonarr/queueWidget";
import "./sabnzbd/widget";
import "./prowlarr/statsWidget";
import "./radarr/statsWidget";
import "./radarr/queueWidget";
import "./seerr/statsWidget";
import "./seerr/requestsWidget";
import "./immich/statsWidget";
import "./unraid/statsWidget";
import "./netdata/cpuWidget";
import "./netdata/ramWidget";
import "./netdata/netWidget";
import "./netdata/diskIoWidget";
import "./netdata/diskSpaceWidget";
import "./netdata/loadWidget";
import "./netdata/sensorWidget";

export type IntegrationStatus = "ok" | "error" | "unknown";
