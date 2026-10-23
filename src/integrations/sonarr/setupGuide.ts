import type { WidgetSetupGuide } from "@/widgets";

export const sonarrSetupGuide: WidgetSetupGuide = {
  title: "Connect Sonarr",
  summary: "Use the same Sonarr connection for upcoming episodes and download progress.",
  requirement: "Sonarr must be reachable from the Kokpit server or container. Its API key grants application access, so keep it private.",
  steps: [
    {
      title: "Open Sonarr’s security settings",
      description: "Sign in to Sonarr and go to Settings → General. Find the Security section and its API Key field.",
    },
    {
      title: "Copy the existing API key",
      description: "Use the copy button beside API Key. Paste it into API Key here, without a Bearer prefix. Use Sonarr’s key, not a download client’s key; resetting it also affects other connected apps.",
    },
    {
      title: "Enter the Sonarr address",
      description: "Set URL to Sonarr’s base address, usually on port 8989. Include any URL Base from Settings → General → Host, with a final slash: https://example.com/sonarr/. Kokpit adds /api/v3 automatically.",
    },
    {
      title: "Choose the widget, test and save",
      description: "Choose Calendar for episode air dates or Queue for download progress. If Test connection is enabled, wait for Connection OK, then save. Otherwise, save and check the dashboard widget.",
    },
  ],
  troubleshooting: [
    {
      title: "401 or 403 response",
      description: "Copy the current API Key from this Sonarr instance. If a reverse proxy adds another login, ensure Kokpit can reach the API with its key; a browser login session is not sent by Kokpit.",
    },
    {
      title: "404 or an HTML login page",
      description: "Remove /api/v3, /calendar or /queue from URL. Include the configured URL Base and end it with a slash, such as /sonarr/. Check that the reverse proxy forwards API requests to Sonarr.",
    },
    {
      title: "Cannot reach Sonarr",
      description: "Use an address reachable from Kokpit. localhost inside Docker points to the Kokpit container. Check the hostname, port and firewall; HTTPS needs a certificate trusted by Kokpit.",
    },
    {
      title: "Connected but no entries",
      description: "Calendar needs upcoming monitored episodes in its date window. Queue shows the first page of up to 25 entries and excludes downloads Sonarr cannot associate with a series; compare Activity → Queue in Sonarr.",
    },
  ],
  documentationUrl: "https://wiki.servarr.com/sonarr/settings#general",
};

export const sonarrUrlDescription = "Sonarr’s base address, including http:// or https:// and its port (usually 8989). Include any URL Base and end it with a slash, e.g. https://example.com/sonarr/. Do not append /api/v3. The address must work from Kokpit.";

export const sonarrApiKeyDescription = "Copy Sonarr’s API Key from Settings → General → Security. Paste only the key. Leave a saved key unchanged to keep using it.";
