import { registerWidget, type WidgetProps, type WidgetConfigField } from "@/widgets";
import { WidgetBody, WidgetList, WidgetListItem, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import { fetchRss, RssConfigSchema, articleUrl, type RssConfig, type RssData } from "./api";
import "./widget.css";

function publicationDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
export function RssWidget({ data, loading, error, footprint }: WidgetProps<RssData>) {
  if (!data) return <WidgetBody centered className="rss-widget"><WidgetState state={loading ? "loading" : error ? "error" : "empty"}>{!loading ? error ?? "Feed unavailable" : undefined}</WidgetState></WidgetBody>;
  const detailed = (footprint?.rowSpan ?? 3) >= 4;
  return <WidgetBody className="rss-widget" reserveNotice notice={<WidgetStaleNotice error={error} />}>
    <WidgetList label="Feed articles" summary={{ primary: data.title, secondary: `${data.articles.length} ${data.articles.length === 1 ? "article" : "articles"}` }}
      empty={data.articles.length === 0 ? <WidgetState state="empty">No articles in this feed</WidgetState> : undefined}>
      {data.articles.map((article, index) => {
        const url = article.url ? articleUrl(article.url) : null;
        return <WidgetListItem key={index} className="rss-widget__article" titleTooltip={article.title}
          title={url ? <a className="rss-widget__link" href={url} target="_blank" rel="noopener noreferrer">{article.title}</a> : article.title}
          secondary={<>{article.publishedAt ? <time dateTime={article.publishedAt} title={article.publishedAt}>{publicationDate(article.publishedAt)}</time> : "Date unavailable"}{detailed && article.summary ? ` · ${article.summary}` : ""}</>}
          secondaryTooltip={`${publicationDate(article.publishedAt)}${detailed && article.summary ? ` · ${article.summary}` : ""}`} wrapSecondary={detailed} />;
      })}
    </WidgetList>
  </WidgetBody>;
}
const FIELDS: WidgetConfigField[] = [
  { key: "feed_url", label: "Feed URL", type: "url", required: true, placeholder: "https://example.com/feed.xml", description: "Public HTTP(S) RSS or Atom feed. Private networks and URLs with embedded credentials are blocked." },
  { key: "max_items", label: "Article limit", type: "number", defaultValue: 10, description: "Show 1–50 articles, in the order supplied by the feed." },
];
registerWidget<RssConfig, RssData>({ id: "rss", name: "RSS / Atom", integrationType: null, configSchema: RssConfigSchema,
  fetchData: fetchRss, component: RssWidget, refreshInterval: 600_000, compactHeader: true, sharedUI: true, hasLinks: true,
  preferredSize: "normal", supportedFootprints: [{ label: "Compact", columnSpan: 3, rowSpan: 3 }, { label: "Wide", columnSpan: 6, rowSpan: 3 }, { label: "Detailed", columnSpan: 6, rowSpan: 4 }],
  configFields: FIELDS, optionFields: FIELDS,
  serviceEditorPreset: { defaultName: "News feed", defaultIconUrl: "mdi-rss" },
});
