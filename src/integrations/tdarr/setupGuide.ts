import type { WidgetSetupGuide } from "@/widgets";

export const tdarrSetupGuide: WidgetSetupGuide = {
  title: "Connect Tdarr",
  summary: "Read transcoding statistics from your Tdarr Server.",
  requirement: "New Tdarr v3 installations enable authentication by default and need an API key. Keep keys private and use private networking or HTTPS.",
  steps: [
    {
      title: "Open Tdarr’s WebUI",
      description: "Open the WebUI, usually on port 8265. Complete initial account setup if prompted. When authentication is enabled, sign in as an administrator.",
    },
    {
      title: "Create an API key when authentication is enabled",
      description: "Open Tools → API Keys and create a key for Kokpit. Copy the full value, including any tapi_ prefix, and paste it here. Leave this field blank only if your Server already has authentication disabled.",
    },
    {
      title: "Enter the Server API address",
      description: "Use the Server’s API address, usually http://tdarr.local:8266/. This differs from the WebUI port 8265. Keep any proxy prefix; omit /api/v2 and query parameters. Kokpit adds the API routes.",
    },
    {
      title: "Test, then save",
      description: "If Test connection is enabled, click it and wait for Connection OK, then save. Otherwise, save the form and check the widget on your dashboard.",
    },
  ],
  troubleshooting: [
    {
      title: "401 or 403 response",
      description: "Authentication requires a current API key from Tools → API Keys on the same Server. Paste only the key, not a sign-in password, Bearer token or authSecretKey. A blank key works only when Server authentication is already disabled.",
    },
    {
      title: "404 or an HTML page",
      description: "Check the Server API port (normally 8266), rather than assuming the WebUI port (8265) serves the API. A proxy must forward the API routes. Remove /api/v2 from URL. Tools → API Docs documents the routes for your installed version.",
    },
    {
      title: "Cannot reach the Server",
      description: "Use the Tdarr Server’s hostname or address reachable from Kokpit, not a Node address. localhost inside Docker points to Kokpit’s own container. Check published ports, firewall rules and trusted HTTPS certificates.",
    },
    {
      title: "Workers or FPS stay at zero",
      description: "The nodes request is best-effort: unavailable or unexpected node data produces zero without hiding the queue stats. Check that Nodes are connected in Tdarr. Node API keys must be configured separately; saving Kokpit’s key does not configure Nodes.",
    },
    {
      title: "Counters differ from Tdarr",
      description: "Missing statistics fields default to zero; check your version’s Tools → API Docs if values differ from Tdarr. Space Saved preserves the reported sign, so it can be negative.",
    },
  ],
  documentationUrl: "https://docs.tdarr.io/docs/other/authentication/",
};
