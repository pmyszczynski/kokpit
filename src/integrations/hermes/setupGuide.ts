import type { WidgetSetupGuide } from "@/widgets";

export const hermesSetupGuide: WidgetSetupGuide = {
  title: "Connect Hermes",
  summary: "Read gateway health, scheduled jobs and recent session metadata.",
  requirement: "The key grants full agent access, including terminal commands. Keep it private and use HTTPS or a trusted private network.",
  steps: [
    {
      title: "Enable the API and find its key",
      description: "Edit Hermes’s .env (normally ~/.hermes/.env) and set API_SERVER_ENABLED=true. Reuse its API_SERVER_KEY or YAML key; if none exists, run openssl rand -hex 32 and set API_SERVER_KEY to the result.",
    },
    {
      title: "Make the listener reachable and restart",
      description: "Set API_SERVER_HOST to a reachable private interface if Kokpit runs elsewhere; its default is 127.0.0.1. Start with hermes gateway, or use hermes gateway restart for an installed service.",
    },
    {
      title: "Enter the final API address",
      description: "Use the listener root, normally http://hermes:8642, keeping any proxy prefix. Omit /v1 and endpoint paths. For a multiplexed profile, add /p/name and use that profile’s own API_SERVER_KEY.",
    },
    {
      title: "Paste the key, test and save",
      description: "Paste the key value alone. Use Test connection when enabled, then save. If testing is unavailable, save and check the dashboard.",
    },
  ],
  troubleshooting: [
    {
      title: "Which key should I copy?",
      description: "Use the API server key, not an OpenAI, Anthropic or other model-provider key. For the default listener, read API_SERVER_KEY from Hermes’s .env or gateway.api_server.key from config.yaml; environment settings take precedence. Paste the value without API_SERVER_KEY=, Bearer or surrounding quotes. Changing this upstream key affects its other API clients too.",
    },
    {
      title: "The listener will not start or cannot be reached",
      description: "Confirm the API is enabled and has a real random key: current Hermes rejects placeholders and keys shorter than 16 characters. The default 127.0.0.1 bind is local-only. Use a trusted private interface; inside a container, a 0.0.0.0 bind may be needed with port 8642 published only to a trusted host interface. Restrict access to trusted clients. localhost inside Kokpit points to its own container.",
    },
    {
      title: "401 or 403 for a profile",
      description: "A /p/name route requires that named profile’s own API_SERVER_KEY from ~/.hermes/profiles/name/.env. The default profile’s key is rejected there; unprefixed routes and /p/default use the default key. After changing settings, restart the gateway that owns the listener. With the same connection URL, an untouched saved key is retained; URL edits require re-entering it.",
    },
    {
      title: "404, HTML or a redirect error",
      description: "Use the final API listener address, including its configured API_SERVER_PORT and any real proxy/profile prefix. Remove /v1, /health and /api suffixes, query strings and fragments. Kokpit does not follow redirects, including proxy sign-in pages or HTTP-to-HTTPS redirects. Requests are server-to-server, so Kokpit does not need a CORS allowlist.",
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
