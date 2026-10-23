import type { WidgetSetupGuide } from "@/widgets";

export const prowlarrSetupGuide: WidgetSetupGuide = {
  title: "Connect Prowlarr",
  summary: "Show indexer health, protocol counts and grab history.",
  requirement: "Prowlarr must be reachable from the Kokpit server or container. Its application API key is private and should not be shared.",
  steps: [
    {
      title: "Find Prowlarr’s API Key",
      description: "Sign in to Prowlarr and open Settings → General → Security. Find Prowlarr’s API Key, not an indexer’s key.",
    },
    {
      title: "Copy the existing key",
      description: "Use the copy button beside API Key and paste it into API Key here, without a Bearer prefix. Resetting the key also affects other apps connected to Prowlarr.",
    },
    {
      title: "Enter the Prowlarr address",
      description: "Use Prowlarr’s base address, usually port 9696. Include any URL Base from Settings → General → Host. Paths need a final slash, such as https://example.com/prowlarr/; a slash is optional at the root. Kokpit adds /api/v1.",
    },
    {
      title: "Test, then save",
      description: "If Test connection is enabled, click it and wait for Connection OK, then save. Otherwise, save the form and check the widget on your dashboard.",
    },
  ],
  troubleshooting: [
    {
      title: "401 or 403 response",
      description: "Copy the current API Key from Prowlarr’s General → Security settings. An indexer provider’s key or a Sonarr/Radarr key will not authenticate to Prowlarr.",
    },
    {
      title: "404 or an HTML login page",
      description: "Remove /api/v1 from URL. Include any configured URL Base path with a final slash, such as /prowlarr/. Check that your proxy forwards API requests without requiring a separate browser login session.",
    },
    {
      title: "Cannot reach Prowlarr",
      description: "Use an address reachable from Kokpit. localhost inside Docker points to the Kokpit container. Check the hostname, port and firewall; HTTPS needs a certificate trusted by Kokpit.",
    },
    {
      title: "Failing indexers are shown",
      description: "Kokpit reports Prowlarr’s indexer failure status. Check and test the affected indexers in Prowlarr, including their provider credentials and network access.",
    },
    {
      title: "Counts differ from expectations",
      description: "Usenet and Torrent include disabled indexers. Total Grabs counts retained release-grab history events; removing history can lower it, so it is not a permanent lifetime total.",
    },
  ],
  documentationUrl: "https://wiki.servarr.com/prowlarr/settings#general",
};
