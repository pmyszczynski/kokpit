import type { WidgetSetupGuide } from "@/widgets";

export const seerrSetupGuide: WidgetSetupGuide = {
  title: "Connect Seerr",
  summary: "Read request counts and recent requests from Seerr, Jellyseerr or Overseerr.",
  requirement: "Complete the app’s initial setup first. Its API key grants administrator access: keep it private and use a trusted network or HTTPS.",
  steps: [
    {
      title: "Find the application’s API Key",
      description: "Sign in to Seerr, Jellyseerr or Overseerr as an administrator. Open Settings → General → API Key.",
    },
    {
      title: "Copy the existing API Key",
      description: "Click the copy button beside API Key and paste only its value here. Regenerating it affects other connected apps; this setup flow has no separate read-only key.",
    },
    {
      title: "Enter the application’s base address",
      description: "Use a base address reachable from Kokpit, usually http://seerr.local:5055/ or a subdomain such as https://requests.example.com/. Omit /api/v1; Kokpit adds it automatically.",
    },
    {
      title: "Test, then save",
      description: "If Test connection is enabled, click it and wait for Connection OK, then save. Otherwise, save the form and check the widget on your dashboard.",
    },
  ],
  troubleshooting: [
    {
      title: "The API Key is missing or rejected",
      description: "Only an administrator can view the application key. Copy its current value from Settings → General in the same instance as URL. A Plex/Jellyfin token or a Sonarr/Radarr key will not work.",
    },
    {
      title: "404 or an HTML login page",
      description: "Use the instance’s root address or a subdomain, without /api/v1. Seerr does not officially support subfolder base URLs; use its supported subdomain proxy configuration. A separate proxy login must not block Kokpit’s API requests.",
    },
    {
      title: "Cannot reach the application",
      description: "localhost inside Docker points to Kokpit’s own container. Check the hostname, port and network access from Kokpit. HTTPS certificates must be trusted by Kokpit; keep this administrator key on a trusted connection.",
    },
    {
      title: "Counts and the request list differ",
      description: "Stats uses the API’s Pending, Approved, Available and All request filters, not library-wide movie/episode totals. Requests shows only the 15 newest requests across all statuses; its count, filter and ordering are fixed.",
    },
    {
      title: "A request shows (Movie) or (Show)",
      description: "Some versions omit titles from request data. Kokpit then asks the same instance for movie/TV details. If that lookup fails, it shows a fallback label; check the app’s media metadata connectivity.",
    },
  ],
  documentationUrl: "https://docs.seerr.dev/using-seerr/settings/general/",
};
