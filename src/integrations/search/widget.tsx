import { registerWidget, type WidgetConfigField, type WidgetProps } from "@/widgets";
import { WidgetBody, WidgetSearchForm, WidgetStaleNotice, WidgetState } from "@/widgets/ui";
import { fetchSearch, searchUrl, SearchConfigSchema, type SearchConfig, type SearchData } from "./api";
import { searchSetupGuide } from "./setupGuide";
import "./widget.css";

/** Compose the shared native form with an engine caption and stable refresh feedback. */
export function SearchWidget({ data, loading, error }: WidgetProps<SearchData>) {
  if (!data || !searchUrl(data.action)) return <WidgetBody centered className="search-widget"><WidgetState state={loading ? "loading" : "error"}>{!loading ? error ?? "Search unavailable" : undefined}</WidgetState></WidgetBody>;
  return <WidgetBody className="search-widget" contentCentered reserveNotice noticeClassName="search-widget__notice" notice={<>
    <p className="search-widget__destination" title={`${data.engineName} · ${data.action}`}>{data.engineName} · {data.newTab ? "Opens in a new tab" : "Opens in this tab"}</p>
    <WidgetStaleNotice error={error} />
  </>}>
    <WidgetSearchForm action={data.action} queryParameter={data.queryParameter} parameters={data.parameters} label={`Search with ${data.engineName}`} newTab={data.newTab} />
  </WidgetBody>;
}
const FIELDS: Exclude<WidgetConfigField, { type: "password" }>[] = [
  { key: "search_url", label: "Search URL", type: "url", defaultValue: "https://duckduckgo.com/", description: "HTTP(S) GET results endpoint, up to 2,048 characters. Default: https://duckduckgo.com/. Google uses https://www.google.com/search; SearXNG uses your instance’s /search address. Reachable from the viewer’s browser, including LAN/VPN when available. Fixed non-query parameters are retained. No URL credentials, fragments or query templates." },
  { key: "query_parameter", label: "Query parameter", type: "text", defaultValue: "q", description: "Exact, case-sensitive name for the typed query; default q. Use one name (1–80 characters), without whitespace, &, =, # or ?. Do not enter q=words or a {query}/%s template. Existing URL values with this name are replaced; the browser encodes the submitted text." },
  { key: "engine_name", label: "Engine name", type: "text", description: "Optional caption/accessibility label, up to 80 characters. Empty uses DuckDuckGo, Google or the endpoint host/port. This does not select an engine or change Search URL. Name above labels the tile separately." },
  { key: "new_tab", label: "Open results in a new tab", type: "boolean", defaultValue: true, description: "On by default: submit results to a new tab/window with no opener/referrer. Off opens results in the current dashboard tab. Browser/provider history and privacy policies still apply." },
];
registerWidget<SearchConfig, SearchData>({ id: "search", name: "Search", integrationType: null, configSchema: SearchConfigSchema,
  fetchData: fetchSearch, component: SearchWidget, refreshInterval: 0, supportsConnectionTest: false, compactHeader: true, sharedUI: true, hasLinks: true,
  preferredSize: "wide", supportedFootprints: [{ label: "Wide", columnSpan: 6, rowSpan: 2 }, { label: "Compact", columnSpan: 3, rowSpan: 2 }],
  configFields: FIELDS, optionFields: FIELDS, serviceEditorPreset: { defaultName: "Search", defaultIconUrl: "/icons/search.svg" },
  setupGuide: searchSetupGuide,
  configurationDescription: "Defaults are ready to use: save for DuckDuckGo or adjust these options. Empty Search URL/Query parameter fields use their defaults when saved. Enter search queries on the dashboard tile.",
  refreshDescription: "Search does not poll an external API. Leave empty to keep automatic option refresh disabled (default 0). An override must be at least 5,000 ms (5 seconds) and only reloads Kokpit’s saved engine options; it does not fetch search results.",
  footprintDescription: "Wide 6×2 is the default and preserves existing Search geometry, including tiles without an explicit footprint. Compact 3×2 shows the same search input, button and engine/tab caption. Results open at the provider; neither footprint embeds a result list.",
});
