import { registerWidget, type WidgetConfigField, type WidgetProps } from "@/widgets";
import { WidgetBody, WidgetSearchForm, WidgetStaleNotice, WidgetState } from "@/widgets/ui";
import { fetchSearch, searchUrl, SearchConfigSchema, type SearchConfig, type SearchData } from "./api";
import "./widget.css";

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
  { key: "search_url", label: "Search URL", type: "url", defaultValue: "https://duckduckgo.com/", description: "Engine endpoint, e.g. https://www.google.com/search or https://search.example/search for SearXNG. Existing non-query parameters are retained. No credentials or fragments." },
  { key: "query_parameter", label: "Query parameter", type: "text", defaultValue: "q", description: "Parameter receiving the query (usually q). The browser encodes the search text." },
  { key: "engine_name", label: "Engine name", type: "text", description: "Optional display name; otherwise DuckDuckGo, Google or the endpoint host is shown." },
  { key: "new_tab", label: "Open results in a new tab", type: "boolean", defaultValue: true },
];
registerWidget<SearchConfig, SearchData>({ id: "search", name: "Search", integrationType: null, configSchema: SearchConfigSchema,
  fetchData: fetchSearch, component: SearchWidget, refreshInterval: 0, supportsConnectionTest: false, compactHeader: true, sharedUI: true, hasLinks: true,
  preferredSize: "wide", supportedFootprints: [{ label: "Search", columnSpan: 6, rowSpan: 2 }],
  configFields: FIELDS, optionFields: FIELDS, serviceEditorPreset: { defaultName: "Search", defaultIconUrl: "/icons/search.svg" },
});
