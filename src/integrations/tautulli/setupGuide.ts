import type { WidgetSetupGuide } from "@/widgets";

export const tautulliSetupGuide: WidgetSetupGuide = {
  title: "Connect Tautulli",
  summary: "Show Plex stream totals and current playback sessions.",
  requirement: "Connect Tautulli to Plex first. Keep the API key private: it also allows changes. Use private networking, or HTTPS with Tautulli authentication for remote access.",
  steps: [
    {
      title: "Enable Tautulli’s API",
      description: "Sign in to Tautulli as an administrator. Open Settings → Web Interface, scroll to Enable API and check it if needed.",
    },
    {
      title: "Reveal, copy and save the API key",
      description: "Click the eye icon beside API key, then click the field to select and copy it. If empty, use Generate. Save Tautulli’s settings before pasting the key here; replacing it affects other connected apps.",
    },
    {
      title: "Enter Tautulli’s base address",
      description: "Use an address reachable from Kokpit, usually port 8181. Include any HTTP Root, such as https://example.com/tautulli/. Omit /api/v2 and query parameters; Kokpit builds the activity request.",
    },
    {
      title: "Test, then save",
      description: "If Test connection is enabled, click it and wait for Connection OK, then save. Otherwise, save the form and check the widget on your dashboard.",
    },
  ],
  troubleshooting: [
    {
      title: "API disabled or key rejected",
      description: "Enable API and save in Tautulli’s Settings → Web Interface. Copy the current API key from that same instance, not a Plex token or a Tautulli mobile-device registration token. Kokpit only reads activity, but this application key is not read-only.",
    },
    {
      title: "404 or an HTML login page",
      description: "Remove /api/v2 and any query string from URL. Include the HTTP Root shown under Show Advanced → Web Interface if configured. Ensure a separate proxy login does not block Kokpit’s API request.",
    },
    {
      title: "Cannot reach Tautulli",
      description: "localhost inside Docker points to Kokpit’s own container. Check the hostname, port and network access from Kokpit. HTTPS certificates must be trusted by Kokpit. Kokpit sends the API key as a query parameter, so keep full request URLs private.",
    },
    {
      title: "No active streams",
      description: "This widget shows current activity, not watch history. No active streams is normal when nothing is playing. If playback is active, check Tautulli’s homepage and its connection to your Plex Media Server.",
    },
    {
      title: "Summary or sessions are missing",
      description: "Display sections controls which parts are shown. Both are selected by default and at least one is required. Choosing Expanded changes the layout; it does not re-enable a section you turned off.",
    },
  ],
  documentationUrl: "https://github.com/Tautulli/Tautulli/wiki/Tautulli-API-Reference",
};
