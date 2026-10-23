import type { WidgetSetupGuide } from "@/widgets";

export const immichSetupGuide: WidgetSetupGuide = {
  title: "Connect Immich",
  summary: "Show instance-wide media totals and reported storage usage.",
  requirement: "Requires an administrator’s API key with server.statistics permission. Keep the key private and use private networking or HTTPS.",
  steps: [
    {
      title: "Open API Keys as an administrator",
      description: "Sign in to Immich as an administrator. Open the top-right profile icon → Account Settings → API Keys.",
    },
    {
      title: "Create and copy the key",
      description: "Click New API Key, name it Kokpit, select only server.statistics, then Create. Click Copy to Clipboard before closing; the secret is shown once. Paste only the key into API Key here.",
    },
    {
      title: "Enter the API address",
      description: "Use a reachable server root or /api base, e.g. http://immich.local:2283/api. Direct IP/hostname URLs work. For proxies, use a domain/subdomain root, not /immich. Omit /server/statistics and query parameters.",
    },
    {
      title: "Test, then save",
      description: "If Test connection is enabled, click it and wait for Connection OK, then save. Otherwise, save the form and check the widget on your dashboard.",
    },
  ],
  troubleshooting: [
    {
      title: "401 or 403 response",
      description: "Use a current key belonging to an administrator with server.statistics permission. A regular user’s key cannot read this endpoint. Paste the secret, not the key name or ID, password, or a shared-album link. Check your installed version’s API documentation if permission controls differ.",
    },
    {
      title: "Lost, rotated or deleted key",
      description: "The secret is shown only once. Create a replacement if you did not copy it. Rotating or deleting a key in Immich invalidates its old value; update Kokpit with the replacement and save. An untouched saved key is retained only while the connection URL stays unchanged. Re-enter the key after changing that URL.",
    },
    {
      title: "404, invalid JSON or an HTML page",
      description: "Use the server root or a single /api suffix, rather than /api/api or the full statistics route. Direct IP/hostname URLs work too. A reverse proxy must forward API requests and the API-key header from a domain/subdomain root. Immich does not support a subfolder such as /immich.",
    },
    {
      title: "Cannot reach Immich",
      description: "Check the hostname, published port (normally 2283), firewall and trusted HTTPS certificate. localhost inside Docker points to Kokpit’s own container. A working browser login does not prove that Kokpit can reach the API through a proxy sign-in page.",
    },
    {
      title: "Storage differs from disk usage or my library",
      description: "These are instance-wide totals, not just the key owner’s library. Items adds the reported photos and videos. Storage is Immich’s reported media usage, not disk capacity or free space; external-library files are excluded from that usage. Counts and usage follow your Immich version’s server-statistics rules.",
    },
  ],
  documentationUrl: "https://docs.immich.app/features/user-settings/",
};
