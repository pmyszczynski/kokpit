import type { WidgetSetupGuide } from "@/widgets";

export const searchSetupGuide: WidgetSetupGuide = {
  title: "Set up Search",
  summary: "Open search results directly from the dashboard using a native browser form. No API key, service integration or search-API subscription is needed.",
  requirement: "Use an HTTP(S) search endpoint that accepts a GET query parameter and is reachable from each viewer’s browser. Kokpit does not proxy queries or embed results. Engine options are public tile configuration; do not put tokens or other secrets in them. URL usernames/passwords and fragments are rejected.",
  steps: [
    {
      title: "Keep DuckDuckGo or choose a results endpoint",
      description: "Select Search and name the tile. The defaults are ready to save: Search URL https://duckduckgo.com/ and Query parameter q. For Google, use https://www.google.com/search with q. For your SearXNG instance, use its browser-facing /search address with q, for example https://search.example.com/search after replacing the host. Use the endpoint’s real proxy path when applicable, rather than its API or an arbitrary home page.",
    },
    {
      title: "Set the query parameter and fixed options",
      description: "Enter the exact parameter name expected by the engine, usually q. Put only the name in Query parameter, without ? or =. Kokpit uses an endpoint and a separate named form field. Remove {query}/%s templates. Existing non-query URL parameters are retained, including repeated values; existing values with the chosen query name are replaced by the typed search. The browser encodes the text when you submit it.",
    },
    {
      title: "Choose the caption and results tab",
      description: "Engine name is optional: empty uses DuckDuckGo, Google or the endpoint host/port. This controls the caption and accessible search label. Search URL selects the destination. Open results in a new tab is on by default; turn it off to replace the current dashboard tab with results. An optional service launch URL affects only the tile header, not the search form.",
    },
    {
      title: "Choose the footprint and leave refresh empty",
      description: "Wide 6×2 is the default, including existing Search tiles without explicit geometry. Compact 3×2 offers the same input, button and caption. Leave Refresh interval empty to keep automatic option refresh disabled. An override of at least 5,000 ms only reloads Kokpit’s saved engine options; it does not contact the engine, fetch results or add search suggestions.",
    },
    {
      title: "Save, then submit a search from the tile",
      description: "Save the form and finish the normal dashboard save flow. On the tile, enter a query and press Enter or Search. Confirm the intended engine, fixed parameters and tab behavior in the opened page. There is deliberately no Test connection action: the editor can flag invalid option formats, but saving does not contact the engine or prove compatibility. Test the actual browser navigation from each device that will use a self-hosted endpoint.",
    },
  ],
  troubleshooting: [
    {
      title: "The home page, wrong results or raw JSON opens",
      description: "Check the provider’s GET results endpoint and case-sensitive query name. A normal site home page may not accept a query. Remove {query}/%s templates; Kokpit does not substitute them. For SearXNG, use /search with q and omit format=json/csv/rss when you want a normal HTML results page. Fixed settings belong in Search URL, for example ?language=en for SearXNG or ?kl=us-en for DuckDuckGo. The query field is entered on the dashboard tile, not saved as a fixed query option.",
    },
    {
      title: "A self-hosted engine cannot be reached",
      description: "The browser needs network/DNS access to the destination; this is browser navigation, not a Kokpit server fetch. LAN/VPN endpoints are allowed when the viewer can reach them. localhost refers to the viewer’s device. Check the host, port, real proxy path and browser certificate/login state. Prefer HTTPS when available; browser restrictions can warn about or block an HTTPS page submitting to HTTP. Kokpit cannot supply custom request headers or a POST-only search flow. Complete any normal provider login in that browser rather than storing credentials in the tile URL.",
    },
    {
      title: "No Test button, no result polling or Search unavailable",
      description: "Search loads saved options from Kokpit and submits directly to the engine only when you search. It has no upstream connection test, background engine polling or embedded result list. Refresh defaults to disabled; a saved override only reloads options. An options-loading warning concerns Kokpit’s saved configuration/session, not proof that the engine is down. To restore the default destination in the editor, clear Search URL/Query parameter and save; for YAML, omit those keys rather than setting them to empty strings.",
    },
    {
      title: "Labels, blank queries, tabs and privacy",
      description: "Name labels the service tile; Engine name labels the search form. Neither chooses an engine. Queries are trimmed, whitespace-only input is blocked, and the input accepts up to 500 characters; enter normal text rather than pre-encoding it. The browser decides whether a new browsing context is a tab or window. Kokpit’s new result tabs have no opener/referrer, and the widget stores no search history, but GET queries are visible in the destination URL and may appear in browser/provider history. Those provider/browser policies still apply.",
    },
  ],
  documentationUrl: "https://github.com/pmyszczynski/kokpit#search",
};
