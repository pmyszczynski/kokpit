import type { WidgetSetupGuide } from "@/widgets";

export const netdataUrlDescription = "Local Agent address reachable from Kokpit, usually http://192.168.1.10:19999. Keep a real proxy prefix, for example https://metrics.example.com/netdata/. Do not enter app.netdata.cloud, a dashboard page or an /api endpoint; Kokpit adds the API paths.";
export const netdataTokenDescription = "Optional per-agent bearer, copied using the protected-Agent setup steps. Paste only its value, without Bearer. Cloud API/claim tokens, streaming keys and MCP keys do not fit this field. Leave empty for an already unauthenticated private Agent. A blank saved field keeps its token; use Clear saved credential to remove it.";
export const netdataHistoryDescription = "Sparkline lookback in whole minutes: 1–60, default 10 when empty. Kokpit requests up to 60 grouped points; this is not the refresh interval. A short retention window, missing chart or failed history request can leave fewer points or no sparkline while the current value still works.";

export const netdataSetupGuide: WidgetSetupGuide = {
  title: "Connect Netdata",
  summary: "Connect a local Netdata Agent once, then choose CPU, RAM, Network, Disk I/O, Disk Space, Load or Sensor tiles.",
  requirement: "The Agent’s HTTP(S) metrics API must be reachable from Kokpit. An already unauthenticated private Agent needs no key or Cloud account. Protected Agents need a per-agent bearer; Kokpit cannot renew it. Keep metrics private and use HTTPS or a trusted encrypted tunnel for tokens.",
  steps: [
    {
      title: "Find the local Agent address",
      description: "Open the Agent’s local dashboard, normally http://SERVER:19999. Copy its root address, keeping any actual proxy prefix. Use an address reachable from Kokpit’s container; localhost inside Kokpit means that container. Do not use the Netdata Cloud website address.",
    },
    {
      title: "Choose the existing authentication path",
      description: "If this private Agent already permits unauthenticated metrics, skip steps 3–4 and leave API Token empty. For native bearer protection, the Agent must be claimed and connected to Netdata Cloud and your account must have access to its Space. Do not disable authentication just to connect.",
    },
    {
      title: "Protected Agent — sign in locally",
      description: "Open the local Agent dashboard and complete its Netdata Cloud sign-in. Confirm that it shows this Agent’s metrics. Open your browser’s Developer Tools → Network, select Fetch/XHR, then reload the local dashboard and wait for data to appear.",
    },
    {
      title: "Protected Agent — copy its bearer",
      description: "Select a successful /api/ metrics request whose Request URL points to this local Agent, not app.netdata.cloud. Open Headers → Request Headers and find X-Netdata-Auth: Bearer …. Copy only the value after Bearer into API Token. Some UI versions use Authorization instead. Keep it private; never share the request, a HAR export or its headers. See troubleshooting if no matching request appears.",
    },
    {
      title: "Enter the connection and tile options",
      description: "Enter Netdata URL and the applicable API Token. Choose a widget. For sparklines, set History (minutes) or keep 10. Disk Space can use an exact disk_space chart ID; Sensor requires an exact chart ID and can have a label. The chart-discovery troubleshooting entry explains where to find IDs.",
    },
    {
      title: "Test, save and plan token replacement",
      description: "Test when available, wait for Connection OK, then save; otherwise save and check the tile. Native Agent tokens are time-limited: newly issued tokens last 24 hours, and a copied token may have less time left. Kokpit does not share the browser’s automatic renewal. Repeat the protected-Agent steps and replace the saved token when it expires.",
    },
  ],
  troubleshooting: [
    {
      title: "No token or the wrong kind of key",
      description: "For an already unauthenticated private Agent, no token is needed. Native protected Agents use a Cloud-issued per-agent bearer sent by Kokpit as X-Netdata-Auth: Bearer <value>. A long-lived Cloud API token authenticates Cloud requests, not this field; claim tokens, streaming API keys and local MCP keys have other roles. netdata.conf enables protection but does not contain a permanent API token to copy. The Agent token follows your Cloud role and can grant more than metric reads, although Kokpit only makes GET requests.",
    },
    {
      title: "No matching request in Developer Tools",
      description: "Use the local Agent dashboard after Cloud sign-in, keep Network recording, reload and inspect a successful Fetch/XHR request to that Agent’s own /api/ URL. Cloud-proxied requests, static files and failed anonymous requests are not the token source. Check Request Headers, not Response Headers. If your deployment does not make direct authenticated requests, use Netdata’s documented direct-agent bearer-minting flow instead; do not paste a Cloud API token as a substitute. Kokpit has no Cloud login or token exchange. Proxies requiring Basic login, interactive SSO cookies or custom headers need a compatible access path; this form only supplies the Agent bearer header.",
    },
    {
      title: "412, 401, 403 or a token that stopped working",
      description: "Check expiry and that the token came from the same Agent. Native authorization failures can use 412, and insufficient permissions can use 403; proxies can return other codes. Replace expired/revoked tokens manually. Browser renewal does not update Kokpit. For Cloud sign-in/minting problems, confirm the Agent is claimed, its ACLK connection is active and your account can access its Space. Check the Agent/proxy IP access rules for Kokpit’s actual source address rather than weakening authentication.",
    },
    {
      title: "Finding Disk Space and Sensor chart IDs",
      description: "Query <agent-root>/api/v1/allmetrics?format=json&help=no with the same bearer header when protected. In the JSON charts map, copy the complete object key, not its family or a context name. For Disk Space choose a disk_space.* chart for the intended mount; empty uses disk_space._ for root only if that chart exists. For Sensor choose a chart with suitable units, such as Celsius or RPM. IDs vary by host and collector; example sensor IDs are not defaults. Netdata’s older /api/v1/charts catalog is deprecated. The Kokpit README has a command for authenticated discovery.",
    },
    {
      title: "Chart not found, missing sensor or blank sparkline",
      description: "The Agent must actually collect system.cpu, system.ram, system.net, system.io or system.load for the corresponding fixed widget. Platform/collector differences can make a chart unavailable; these widgets do not discover substitute charts. Disk Space/Sensor use the selected exact chart ID. A Sensor chart also needs at least one finite current dimension value. Check the collector and chart on the same Agent. History failures are best effort: a current reading can still appear without a sparkline; at least two history points are needed to draw one.",
    },
    {
      title: "Address, proxy or network errors",
      description: "Kokpit uses the local legacy /api/v1/allmetrics and /api/v1/data endpoints, not the Cloud metrics API. Preserve any real proxy path without appending API routes. Keep the final HTTP(S) origin: requests follow at most five redirects within the same scheme/host/port and block cross-origin redirects. A proxy must forward X-Netdata-Auth and allow these GET requests; a web login page is not JSON metrics. Verify container DNS, port mapping, trusted TLS certificates and Agent IP access rules. An Agent with its web server disabled cannot serve this connection.",
    },
    {
      title: "What the readings and options mean",
      description: "CPU uses 100 minus system.cpu idle. RAM counts everything except free, including cache/buffers, so it can differ from tools that report available memory. Network and Disk I/O use the Agent’s system.net/system.io aggregates, show both directions in bytes per second and draw one combined sparkline; there is no interface/disk selector. Load shows the 1/5/15-minute averages, not CPU percentages. Disk Space shows used over available + used + reserved-for-root; reserved space is not added to used. Sensor averages all finite current dimensions in its chart and uses the chart’s units without temperature conversion.",
    },
    {
      title: "Refresh, shared data and saved credentials",
      description: "Default refresh is ten seconds, except Disk Space at sixty seconds. History controls the graph window only; Disk Space and Load have no sparkline/history control. Current allmetrics snapshots are cached for nine seconds per exact URL/token pair; history requests are separate and simultaneous cache misses can still issue multiple requests. A saved token is retained for the same normalized URL: a root trailing slash is equivalent, but a changed path, scheme, host, port or query requires re-entry. Tile options keep the connection. Use Clear saved credential if moving to an already unauthenticated path; blank alone retains a saved token. Failed refreshes retain old readings with a warning.",
    },
  ],
  documentationUrl: "https://learn.netdata.cloud/docs/netdata-agent/configuration/securing-agents",
};
