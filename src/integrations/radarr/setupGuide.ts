import type { WidgetSetupGuide } from "@/widgets";

export const radarrSetupGuide: WidgetSetupGuide = {
  title: "Connect Radarr",
  summary: "Use the same Radarr connection for movie library counts and download progress.",
  requirement: "Radarr must be reachable from the Kokpit server or container. Its API key grants application access, so keep it private.",
  steps: [
    {
      title: "Open Radarr’s security settings",
      description: "Sign in to Radarr and go to Settings → General. Find the Security section and its API Key field.",
    },
    {
      title: "Copy the existing API key",
      description: "Use the copy button beside API Key. Paste it into API Key here, without a Bearer prefix. Use Radarr’s key, not Sonarr’s or a download client’s; resetting it also affects other connected apps.",
    },
    {
      title: "Enter the Radarr address",
      description: "Set URL to Radarr’s base address, usually on port 7878. Include any URL Base from Settings → General → Host, with a final slash: https://example.com/radarr/. Kokpit adds /api/v3 automatically.",
    },
    {
      title: "Choose the widget, test and save",
      description: "Choose Stats for library counts or Queue for download progress. If Test connection is enabled, wait for Connection OK, then save. Otherwise, save and check the dashboard widget.",
    },
  ],
  troubleshooting: [
    {
      title: "401 or 403 response",
      description: "Copy the current API Key from this Radarr instance. If a reverse proxy adds another login, ensure Kokpit can reach the API with its key; a browser login session is not sent by Kokpit.",
    },
    {
      title: "404 or an HTML login page",
      description: "Remove /api/v3, /movie or /queue from URL. Include the configured URL Base and end it with a slash, such as /radarr/. Check that the reverse proxy forwards API requests to Radarr.",
    },
    {
      title: "Cannot reach Radarr",
      description: "Use an address reachable from Kokpit. localhost inside Docker points to the Kokpit container. Check the hostname, port and firewall; HTTPS needs a certificate trusted by Kokpit.",
    },
    {
      title: "Queued count is larger than the list",
      description: "Stats uses Radarr’s reported queue total. Queue displays only the first page of up to 25 entries and excludes downloads without a known movie. Compare Activity → Queue in Radarr.",
    },
    {
      title: "Missing and Wanted differ",
      description: "Wanted counts all monitored movies without a file. Missing counts only those Radarr also marks available. Available counts movies with a file; Upcoming counts announced or in-cinemas movies.",
    },
  ],
  documentationUrl: "https://wiki.servarr.com/radarr/settings#general",
};

export const radarrUrlDescription = "Radarr’s base address, including http:// or https:// and its port (usually 7878). Include any URL Base and end it with a slash, e.g. https://example.com/radarr/. Do not append /api/v3. The address must work from Kokpit.";

export const radarrApiKeyDescription = "Copy Radarr’s API Key from Settings → General → Security. Paste only the key. Leave a saved key unchanged to keep using it.";
