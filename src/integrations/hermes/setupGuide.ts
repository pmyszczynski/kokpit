import type { WidgetSetupGuide } from "@/widgets";

export const hermesSetupGuide: WidgetSetupGuide = {
  title: "Connect Hermes",
  summary: "Read gateway health, scheduled jobs and recent session metadata.",
  requirement: "The key grants full agent access, including terminal commands. Keep it private and use HTTPS or a trusted private network.",
  steps: [
    {
      title: "Enable the API and find its key",
      description: "Set API_SERVER_ENABLED=true in Hermes’s .env (normally ~/.hermes/.env). Find its existing key first (see key lookup below). Only if unconfigured, run openssl rand -hex 32 and set API_SERVER_KEY to the result.",
    },
    {
      title: "Make the listener reachable and restart",
      description: "Set API_SERVER_HOST to a reachable private interface if Kokpit runs elsewhere; its default is 127.0.0.1. Start with hermes gateway, or use hermes gateway restart for an installed service.",
    },
    {
      title: "Enter the final API address",
      description: "Use the listener root, normally http://hermes:8642, keeping any real proxy prefix. Do not append /v1 or endpoint paths. For a multiplexed profile, add /p/name and use that profile’s own API_SERVER_KEY.",
    },
    {
      title: "Paste the key, test and save",
      description: "Paste the key value alone. Use Test connection when enabled, then save. If testing is unavailable, save and check the dashboard.",
    },
  ],
  troubleshooting: [
    {
      title: "Which key should I copy?",
      description: "Use the API server key, not a model-provider key. In the selected gateway’s actual Hermes home, check API_SERVER_KEY in .env and config.yaml key values under gateway.api_server, gateway.platforms.api_server or platforms.api_server. Environment settings take precedence. Reuse the effective compatible key; generate one only if all are unset. Paste the value without API_SERVER_KEY=, Bearer or quotes. Changing it affects other API clients too.",
    },
    {
      title: "An existing key is rejected when saving",
      description: "Kokpit trims surrounding whitespace, then accepts only visible ASCII characters without spaces, up to 4,096 characters. Hermes can accept some keys that Kokpit cannot, such as keys with embedded spaces or Unicode. Do not remove characters from the key: plan a deliberate rotation in Hermes and update its other clients, or keep the current key and leave this widget unconfigured. A new openssl rand -hex 32 key fits Kokpit’s format.",
    },
    {
      title: "The listener will not start or cannot be reached",
      description: "Confirm the API is enabled and has a real random key: current Hermes rejects placeholders and keys shorter than 16 characters. The default 127.0.0.1 bind is local-only. Use a trusted private interface; inside a container, a 0.0.0.0 bind may be needed with port 8642 published only to a trusted host interface. Restrict access to trusted clients. localhost inside Kokpit points to its own container.",
    },
    {
      title: "401 or 403 for a profile",
      description: "On the default multiplexing listener, /p/name requires that profile’s own API_SERVER_KEY, normally in ~/.hermes/profiles/name/.env; unprefixed routes and /p/default use the default key. A standalone named-profile listener on its own port uses that profile’s effective key even without /p/name. Restart the gateway that owns the listener after changes. A saved key is retained only while the URL stays unchanged; URL edits require re-entry.",
    },
    {
      title: "404, HTML or a redirect error",
      description: "Use the final API listener address, its configured port and any real proxy/profile prefix. Omit appended endpoint paths such as /v1 or /health, but keep a configured proxy mount, including /api if that is the mount. For example, a base of https://host/api/ requests https://host/api/health/detailed. Omit queries and fragments. Redirects are not followed, including sign-in pages or HTTP-to-HTTPS redirects. Server-to-server requests need no CORS allowlist.",
    },
    {
      title: "Online, Degraded or unsupported sections",
      description: "Ready needs a successful detailed readiness report. Older listeners can fall back to Online with an unknown API-run count. Degraded reports a readiness problem in Hermes; check its own status. Missing job/session endpoints are labeled unsupported, while transient or invalid section responses are unavailable rather than zero.",
    },
    {
      title: "Counts differ from my other Hermes activity",
      description: "API runs covers the API listener, not every CLI or messaging conversation. Recent sessions are activity records, not a count of running agents; the request is limited to ten top-level sessions. Scheduled jobs excludes disabled, paused, running and terminal jobs. Failed jobs reflects current job metadata, including failed delivery or configuration, not a lifetime failure total. Times are UTC.",
    },
  ],
  documentationUrl: "https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server",
};
