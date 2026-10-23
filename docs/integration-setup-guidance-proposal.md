# Integration setup guidance

Proposal and sequential delivery record, 23 October 2026. The owner accepted the Unraid design and authorized delivery of every integration, one at a time, including documentation research, full validation, PR/AI reviews, administrator merge and verified release before beginning the next integration.

## Editor design

Every integration gets a setup guide inside Add/Edit Service, beside the fields on desktop and above them on narrow screens. The guide stays visible as desktop users scroll through their settings. It follows the selected **integration**, including when that integration belongs to a plain link tile. Informational widgets with external providers get equivalent widget-specific guidance when implemented.

Each guide contains:

1. A short description of the data this connection supplies.
2. Prerequisites: supported service versions, API/plugin availability and authentication requirements.
3. Numbered steps with the exact upstream settings path, how to create/copy credentials, the permissions needed, where to paste them, and how to test and save.
4. Always-visible help under each field: purpose, example, default, units/range, and what leaving it empty does. Distinguish the API address from the optional tile launch URL.
5. An expandable troubleshooting section with specific symptoms and fixes.
6. An official documentation link that opens separately so the user's draft stays available.
7. A brief notice that instructions may become outdated, with a link to open a GitHub issue requesting a correction.

The form keeps its existing test, validation, saved-credential handling and YAML persistence. No setup step generates credentials or changes the upstream service. Keep instructions as typed registry metadata and reuse the presentation across integrations. Shared integration steps must be identical across a service's widgets; tile options retain their own help.

For all widgets, explain the refresh field in milliseconds and seconds, its actual default and 5-second minimum. Explain each footprint using the data it shows. Document optional credentials as optional; do not invent API keys for services that use passwords, sockets or public endpoints.

## First completed example: Unraid Stats

Implemented in `unraid-stats`, using a reusable `WidgetSetupGuide` and the existing field descriptions.

- Prerequisites distinguish the built-in API in Unraid 7.2+ from the Unraid Connect plugin on earlier versions. Local API access does not require a Connect account login.
- Four steps: open **Settings → Management Access → API Keys**; create a key named **Kokpit** with `READ_ANY` for `ARRAY` and `VARS`; copy it into API Key and enter the base URL; test and save.
- URL help explains protocol, optional port, automatic `/graphql`, and reachability from the Kokpit container.
- API Key help explains the data it authorizes, omitting the `Bearer` prefix, and retaining a saved key.
- Footprint help explains Compact (array/storage), Wide (also disk errors), and Detailed/Legacy (all six stats). Refresh help explains the 30-second default and 5-second minimum.
- Troubleshooting covers missing API settings, rejected/revoked credentials, container networking, trusted HTTPS certificates, and reverse-proxy/endpoint mistakes. The developer Sandbox is optional.
- Evidence: actual editor screenshots in `docs/assets/widget-ui/unraid-setup/`; browser coverage of desktop themes, mobile scrolling, keyboard disclosure, saved credentials and custom CSS.

Validation: type checking passed; lint passed with the existing unused `NetdataBaseConfig` warning. All 234 focused unit tests and 14 browser tests passed (setup guidance, settings UI and Unraid behavior). Browser checks used the environment's system Chromium. Screenshot inspection also caught and fixed the settings-input background shorthand resetting dropdown chevron placement/repetition.

Authoritative sources checked for the pilot:

- [Unraid API availability](https://docs.unraid.net/API/)
- [Using the API and managing keys](https://docs.unraid.net/API/how-to-use-the-api/)
- [Permission names and API key management](https://docs.unraid.net/API/programmatic-api-key-management/)

The widget's existing query requests `array` and `vars`; it performs no mutations. A live Unraid instance is still needed to verify the full upstream setup end to end.

## Per-integration setup plans

These are implementation plans based on the current registry, editor and fetchers. Verify each provider's current official documentation, labels, permissions and version differences when implementing its guide. The upstream paths below are proposed copy, not a claim that every provider has already been live-tested.

| Integration | Numbered setup sequence to include | Troubleshooting to include |
| --- | --- | --- |
| Unraid | **Implemented above.** | Missing API/plugin; rejected key; ARRAY/VARS access; URL, container network, HTTPS and proxy routing. |
| Plex | 1. Sign into Plex Web as the server owner. 2. Open a library item's **Get Info → View XML** and locate `X-Plex-Token` in the URL. 3. Copy only the token, and enter the Plex Media Server address (typically port 32400). 4. Test and save. Replace the current inaccurate Account/XML hint. | Plex Web/cloud URL versus server URL; token missing from the XML URL; invalid token; server network reachability. Link Plex's official token-retrieval guide. |
| qBittorrent | 1. Open **Tools → Options → Web UI** (or the equivalent Web UI settings). 2. Enable Web UI and set its port and login credentials. 3. Enter that Web UI address, username and password. 4. Test and save. Explicitly state that there is no API key. | Host-header/reverse-proxy settings; incorrect credentials or temporary password; IP bans; container port mapping. Do not recommend disabling authentication or security checks. |
| Sonarr | 1. Open **Settings → General → Security**. 2. Reveal/copy API Key. 3. Enter the Sonarr root address (typically 8989), including any configured URL base. 4. Paste key, test and save. | Wrong service key; missing URL base; container reachability; API access errors. |
| Radarr | 1. Open **Settings → General → Security**. 2. Copy API Key. 3. Enter Radarr's root address (typically 7878), including URL base. 4. Paste key, test and save. | Same failure classes as Sonarr, with Radarr-specific examples. |
| Prowlarr | 1. Open **Settings → General → Security**. 2. Copy API Key. 3. Enter Prowlarr's root address (typically 9696). 4. Paste key, test and save. | Prowlarr's own key versus an indexer key; URL base; connectivity. |
| SABnzbd | 1. Open **Config → General → Security**. 2. Copy **API Key**, explaining that the NZB Key is different. 3. Enter SABnzbd's base address (typically 8080). 4. Paste key, test and save. | NZB Key used by mistake; hostname allowlist; proxy prefix; authentication and ports. |
| Tdarr | 1. Find the Tdarr Server HTTP address (typically 8265). 2. Check whether API authentication is enabled. 3. If enabled, copy/create the server API key using the version's documented API-key settings; otherwise leave the key blank. 4. Enter address/key, test and save. | Server versus node address; API version/authentication differences; key required only when enabled. Verify the exact key-creation UI before writing final copy. |
| Seerr / Jellyseerr / Overseerr | 1. Sign in as an administrator. 2. Open **Settings → General** and copy API Key. 3. Enter the application's base address (typically 5055). 4. Paste key, test and save. | Wrong product address/key; API authorization; URL base; compatibility across the three products. |
| Immich | 1. Sign into Immich as an account authorized for server statistics. 2. Open **Account Settings → API Keys** and create a dedicated Kokpit key. 3. Grant the statistics endpoint's required permission for the installed version and copy the key. 4. Enter the API base ending in `/api`, test and save. | Missing server-statistics permission; personal versus server-wide statistics; `/api` omitted or doubled. Confirm permission names against the fetcher's endpoint before implementation. |
| Netdata | 1. Locate the local Netdata agent address (typically 19999). 2. Determine whether that agent requires bearer authentication. 3. If required, obtain a token through the deployment's supported authentication setup; otherwise leave it blank. 4. Enter URL/token, test and save. Do not describe a Netdata Cloud claim token as an API token. | Agent versus Cloud URL; missing collectors/charts; authentication mode compatibility; proxy and local network access. |
| Docker | 1. Locate the Docker Unix socket on the host. 2. Mount it at a known path in Kokpit using the deployment configuration. 3. Enter the path **inside Kokpit**, or keep the default. 4. Test and save. State that no API key is needed. Explain that socket access can grant powerful host access, even with a read-only mount. | Socket missing or permission denied; host path versus container path; unsupported TCP endpoints. Avoid prescribing broad permission changes. |
| Tautulli | 1. Open **Settings → Web Interface → API**. 2. Enable API access if needed and copy API Key. 3. Enter Tautulli's base address (typically 8181), including its HTTP root. 4. Paste key, test and save. | Plex token used instead of Tautulli key; API disabled; proxy root; Plex/Tautulli connectivity. |
| Actual Budget | 1. Deploy/configure the supported **actual-http-api** sidecar with Actual server access. 2. Set/copy the sidecar's `API_KEY`. 3. In Actual, open **Settings → Show advanced settings** and copy **Sync ID**. 4. Enter the sidecar URL, key and Sync ID; add the budget's encryption password only if encrypted. 5. Test and save. | Actual server URL/password used instead of sidecar credentials; sidecar budget sync failures; wrong Sync ID; encrypted budget password; currency/time-zone mistakes. Link the exact supported sidecar's docs. |
| Weather | 1. Choose the location and name the tile. 2. Enter coordinates or use location detection and allow browser location access. 3. Select units. 4. Save. Explicitly state that the Open-Meteo integration needs no API key. | Denied geolocation; reversed coordinates; range validation; browser geolocation versus server weather fetching. |
| RSS / Atom | 1. Find the publisher's public RSS/Atom URL. 2. Enter the feed URL rather than a normal article/page URL. 3. Set the article limit. 4. Test/save. Explicitly state that authenticated/private feeds are unsupported. | HTML returned instead of XML; public HTTP(S) requirement; private addresses/embedded credentials blocked; malformed feeds. |
| Calendar — CalDAV | 1. In the calendar provider, find the **calendar collection** URL. 2. Create an app password if supported. 3. Enter collection URL, username and password; leave Google API key empty. 4. Set time zone/window/limit, test and save. Include provider-specific examples rather than assuming all CalDAV menus match. | Discovery URL versus collection URL; app password; read access; recurring/all-day events; time-zone mismatch. |
| Calendar — public Google | 1. Make the intended calendar public and copy **Calendar ID** from its integration settings. 2. In Google Cloud, choose/create a project and enable **Google Calendar API**. 3. Create an API key and restrict it to that API, using server-compatible restrictions. 4. Enter calendar ID and key, leaving CalDAV login blank. 5. Set options, test and save. | Private calendars unsupported by this key flow; API not enabled; browser-referrer restrictions on server requests; calendar ID versus iCal URL. |
| Hermes | 1. Enable/configure Hermes's API listener. 2. Set `API_SERVER_KEY` in Hermes and restart/reload as its documentation requires. 3. Enter the API listener URL (typically 8642), retaining profile or proxy prefixes, and the same key. 4. Test and save. | Dashboard URL versus API listener; key mismatch; disabled listener; profile prefix and proxy routing. |
| Search | 1. Choose a search provider. 2. Enter its search endpoint. 3. Set its query parameter (usually `q`) and optional display name. 4. Choose the new-tab behavior and save. State that searches run in the browser without an API key. | Provider endpoint versus homepage; wrong parameter; existing query parameters; credentials/fragments disallowed. |

## Per-widget field and option plans

Each row is a separate rollout item. Connection fields inherit the corresponding sequence above. Every row also receives the shared refresh/footprint help where those controls exist. Defaults and ranges must be taken from the schema/fetcher, not guessed from placeholder text.

| Widget | Fields and explanations to add |
| --- | --- |
| Unraid Stats (`unraid-stats`) | **Implemented:** `url` selects the reachable Unraid base address; `api_key` reads array/parity data. Footprints and 30-second refresh explained. |
| Plex (`plex`) | `url`: local server address, not app.plex.tv. `token`: owner token. `size_defaults`: automatic stats for each size versus historical defaults. `fields`: custom visible stats, required selection and restore-defaults action. |
| qBittorrent Stats (`qbittorrent-stats`) | `url`: Web UI endpoint. `username`, `password`: Web UI login. Describe which transfer/torrent totals the widget reads. |
| qBittorrent Torrents (`qbittorrent-torrents`) | Same connection help. Explain that the widget requests all torrents without a filter or item limit, displays them in the order returned by qBittorrent, and scrolls the list. |
| Sonarr Calendar (`sonarr-calendar`) | `url`, `api_key`: shared Sonarr setup. `days`: upcoming window (1–30 days), default and whether today's episodes are included, verified against the fetcher. |
| Sonarr Queue (`sonarr-queue`) | Shared Sonarr connection; explain active downloads and queue status. The fetcher requests a fixed page of up to 25 queue entries and excludes unknown series items. |
| Radarr Stats (`radarr-stats`) | `url`, `api_key`: shared Radarr setup. Explain that stats summarize the connected movie library, with footprint-specific content. |
| Radarr Queue (`radarr-queue`) | Shared Radarr connection; describe active movie downloads. The fetcher requests a fixed page of up to 25 queue entries and excludes unknown movie items. |
| Prowlarr Stats (`prowlarr-stats`) | `url`: Prowlarr application root. `api_key`: Prowlarr application key, not an indexer credential. Explain indexer totals versus grab statistics. |
| SABnzbd (`sabnzbd`) | `url`: SABnzbd root, retaining any URL base. `apikey`: full API Key, not NZB Key. Describe queue/history data and default polling. |
| Tdarr Stats (`tdarr-stats`) | `url`: server API address. `apikey`: optional when upstream authentication is disabled; explain when it becomes required. |
| Seerr Stats (`seerr-stats`) | `url`: Seerr/Jellyseerr/Overseerr root. `api_key`: administrator-created application key. Explain request/media summary scope. |
| Seerr Requests (`seerr-requests`) | Shared Seerr connection; explain the request list. The fetcher requests 15 entries with `sort=added` and `filter=all`; these values are fixed rather than configurable. |
| Immich Stats (`immich-stats`) | `url`: API base ending in `/api`. `api_key`: required statistics permissions and account scope. Explain storage and asset totals. |
| Netdata CPU (`netdata-cpu`) | `url`: agent address. `api_token`: optional agent authentication. `history_minutes`: graph window, default/range, not polling frequency. |
| Netdata RAM (`netdata-ram`) | Same connection/history help; explain memory accounting and that history changes the chart window. |
| Netdata Network (`netdata-net`) | Same connection/history help. Explain that the widget reads the agent's aggregate `system.net` chart and its received/sent rates; the current schema has no interface selector. |
| Netdata Disk I/O (`netdata-disk-io`) | Same connection/history help. Explain the aggregate `system.io` chart's read/write rates; the current schema has no per-disk selector. |
| Netdata Disk Space (`netdata-disk-space`) | `url`, optional `api_token`; `chart_id`: filesystem chart, default `disk_space._` for root. Steps to inspect `/api/v1/charts` and select another filesystem. |
| Netdata Load (`netdata-load`) | `url`, optional `api_token`; explain 1/5/15-minute load averages and the difference from CPU utilization. No history control is exposed here. |
| Netdata Sensor (`netdata-sensor`) | `url`, optional `api_token`; `chart_id`: discover in `/api/v1/charts`, checking units; `label`: optional tile measurement name; `history_minutes`: graph window/default/range. |
| Docker (`docker`) | `socket_path`: Unix socket inside Kokpit; empty uses the default. `max_items`: 1–50 containers and effective default. Include a concise explanation of socket access privileges. |
| Tautulli Activity (`tautulli-activity`) | `url`, `api_key`: shared Tautulli setup. Selected `sections` determine which content appears: summary, sessions, or both. Explain defaults, the minimum of one section, summary-only and sessions-only configurations, and how tile size affects visibility. |
| Actual Budget Summary (`actualbudget-summary`) | Shared `url`, `api_key`, `budget_sync_id`, optional `encryption_password`. `currency`: ISO code; `locale`: number formatting; `privacy_mode`: hover-reveal blur; `timezone`: budget month boundary; `size_defaults`: 2/3/6 stats versus all six. |
| Actual Budget Categories (`actualbudget-categories`) | Same connection/currency/locale/privacy/time-zone help. `limit`: count and spending-based order; `hide_income`: exclude income; `hide_empty`: exclude unbudgeted/unspent categories. |
| Actual Budget Accounts (`actualbudget-accounts`) | Same connection/currency/locale/privacy help. `exclude_closed` and `exclude_offbudget`: affect both list and net-worth total. Do not add time-zone help to this widget; it has no time-zone control. |
| Actual Budget Schedules (`actualbudget-schedules`) | Same shared connection/display help. `timezone`: today/overdue boundaries; `limit`: count; `days_ahead`: upcoming horizon and bounds. Explain due-soon and overdue behavior using the fetcher. |
| Weather (`weather`) | `latitude`, `longitude`: correct order/ranges and location detection; `imperial`: °F/mph versus °C/km/h. Explain no key, tile-name location label and refresh. |
| RSS / Atom (`rss`) | `feed_url`: public feed endpoint, no credentials/private addresses; `max_items`: 1–50 items, default 10, publisher ordering. |
| Calendar (`calendar`) | `calendar`: CalDAV collection URL or public Google ID; `username`/`password`: CalDAV only; `api_key`: Google only. `days_ahead`: 1–30/default 7; `max_items`: 1–50/default 10; `timezone`: IANA name/default UTC; explain all-day dates. Both setup paths appear in one guide. |
| Hermes Overview (`hermes-overview`) | `url`: API listener, including `/p/profile` or reverse-proxy prefix; `api_key`: matching `API_SERVER_KEY`. Distinguish from the launch URL. |
| Search (`search`) | `search_url`: provider search endpoint and retained parameters; `query_parameter`: query key/default `q`; `engine_name`: optional label/fallback; `new_tab`: where results open. No connection test or polling is needed. |
| System Stats (`system-stats`) — local companion | No external service or key. Explain `proc_path` host bind mount; `disk_path` measured filesystem; `interface` or non-loopback aggregate; `docker_socket_path` only for selected Docker stats; `size_defaults`; and `fields`, including explicit empty selection. Add as a local setup guide after the external pilot pattern is agreed. |

## Delivery order and review gate

1. **Unraid pilot:** complete the design, field copy, regression checks and actual editor screenshots. Review the desktop panel, mobile order, density and troubleshooting disclosure before copying the pattern.
2. **API-key services:** Sonarr Calendar/Queue, Radarr Stats/Queue, Prowlarr, SABnzbd, Seerr Stats/Requests, Tautulli, Tdarr, Immich and Hermes. Reuse verified connection copy within each family.
3. **Other credential models:** Plex, qBittorrent Stats/Torrents, Actual Budget's four widgets, and Calendar's two provider paths.
4. **Agent/local access:** Netdata's seven widgets, Docker and the System Stats companion.
5. **Public/browser providers:** Weather, RSS/Atom and Search, explicitly documenting that no key is required.

For each integration, verify the upstream sequence and permissions against official documentation, check every visible field against the schema and fetcher, implement copy, and inspect the real edit form in dark/light and narrow layouts. Preserve validation, opaque credentials, reusable integrations and YAML sync. Run the repository's required full local gate before any commit/PR, then monitor actual PR checks and AI reviews, address findings, use the authorized administrator merge, and verify the release and Docker publication before starting the next integration. The owner authorized the entire sequence on 2026-10-23.

| Integration | Delivery status | PR / release evidence |
| --- | --- | --- |
| Unraid | Released; CI and AI feedback cleared, Docker publication verified | [PR #160](https://github.com/pmyszczynski/kokpit/pull/160), [v0.32.0](https://github.com/pmyszczynski/kokpit/releases/tag/v0.32.0), [verified release run](https://github.com/pmyszczynski/kokpit/actions/runs/39890907906) |
| Sonarr | Released; all three AI reviewers clear, CI and Docker verification passed | [PR #161](https://github.com/pmyszczynski/kokpit/pull/161), [v0.32.1](https://github.com/pmyszczynski/kokpit/releases/tag/v0.32.1), [verified release run](https://github.com/pmyszczynski/kokpit/actions/runs/39896440534) |
| Radarr | Guide implemented for Stats and Queue; validating | Targeting v0.32.2 |
| Prowlarr | Planned | — |
| SABnzbd | Planned | — |
| Seerr | Planned | — |
| Tautulli | Planned | — |
| Tdarr | Planned | — |
| Immich | Planned | — |
| Hermes | Planned | — |
| Plex | Planned | — |
| qBittorrent | Planned | — |
| Actual Budget | Planned | — |
| Calendar | Planned | — |
| Netdata | Planned | — |
| Docker | Planned | — |
| System Stats | Planned local companion | — |
| Weather | Planned | — |
| RSS / Atom | Planned | — |
| Search | Planned | — |

### Sonarr documentation and implementation evidence

Checked 23 October 2026 against the [official Sonarr settings guide](https://wiki.servarr.com/sonarr/settings#general), [API documentation](https://sonarr.tv/docs/api/), and upstream [Security settings UI](https://github.com/Sonarr/Sonarr/blob/develop/frontend/src/Settings/General/SecuritySettings.tsx).

- **Getting the key:** General → Security contains the existing API Key and a copy button. The key grants application access. The guide tells users to copy it, explains the effect of resetting it, and does not invent a separate read-only key workflow.
- **Address:** the official Host documentation describes URL Base for reverse proxies. Kokpit's current shared HTTP helper requires a trailing slash to retain a base path. Both fields and troubleshooting state this explicitly, with `/sonarr/` as an example; no API suffix is entered by the user.
- **API contract:** the upstream [OpenAPI definition](https://github.com/Sonarr/Sonarr/blob/develop/src/Sonarr.Api.V3/openapi.json) documents `X-Api-Key`, calendar `start`/`end`/`includeSeries`, and queue `pageSize`/`includeSeries`/`includeUnknownSeriesItems`. Its v3 API applies to Sonarr v3 and v4.
- **Kokpit behavior:** checked `src/integrations/sonarr/api.ts`, both widget definitions/renderers, and `src/integrations/shared/http.ts`. Calendar starts at today's UTC midnight, accepts 1–30 days and defaults to 7. Queue requests one page of 25 with unknown series excluded. Both use a 3×4 scrolling layout; polling defaults are 60 seconds for Calendar and 15 for Queue.
- The common outdated-instructions disclaimer and GitHub issue link apply to both widgets. Browser verification uses isolated test configuration and a dummy key; a live Sonarr deployment has not been tested.

### Radarr documentation and implementation evidence

Checked 23 October 2026 against the [official Radarr settings guide](https://wiki.servarr.com/radarr/settings#general), [API reference](https://radarr.video/docs/api/), upstream [Security settings UI](https://github.com/Radarr/Radarr/blob/develop/frontend/src/Settings/General/SecuritySettings.tsx), and [OpenAPI definition](https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/openapi.json).

- **Getting the key:** General → Security has the existing API Key and copy/reset buttons. The guide explains copying the application key and the effect of resetting it. No separate read-only key creation is claimed.
- **Address:** the official Host section documents URL Base for reverse proxies. Kokpit's shared HTTP helper preserves that path only when the configured URL ends with `/`, so the guide and URL help use `https://example.com/radarr/`. The v3 API uses `X-Api-Key`; the user does not append `/api/v3`.
- **Widget behavior:** checked `src/integrations/radarr/api.ts` and both widget definitions/renderers. Stats fetches movies plus the reported queue total. Missing means monitored, no file, and `isAvailable`; Wanted means monitored with no file; Available means `hasFile`; Upcoming means announced or in cinemas. Detailed and Wide show the same six metrics, with a 60-second default refresh.
- Queue requests one page of 25, includes movie data and excludes unknown movie items. Its default footprint is a scrolling 3×4 list and its default refresh is 15 seconds. No queue limit/filter controls are claimed.
- Both widgets inherit the shared outdated-instructions disclaimer and GitHub issue link. Preview screenshots use an isolated configuration and a dummy key; live Radarr connectivity has not been tested.
