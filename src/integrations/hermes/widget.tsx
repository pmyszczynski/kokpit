import { registerIntegration, registerWidget, type WidgetConfigField, type WidgetProps } from "@/widgets";
import { WidgetBody, WidgetList, WidgetListItem, WidgetBadge, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import { fetchHermes, HermesConfigSchema, type HermesConfig, type HermesData, type HermesSectionState } from "./api";
import { hermesSetupGuide } from "./setupGuide";
import "./widget.css";

function timestamp(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}
const sectionMessage = (name: string, state: HermesSectionState) => `${name} ${state === "unsupported" ? "not supported by this Hermes version" : "unavailable"}`;
const HEALTH = { ready: "Ready", degraded: "Degraded", online: "Online", unknown: "Health unknown" } as const;

export function HermesWidget({ data, loading, error, footprint }: WidgetProps<HermesData>) {
  if (!data) return <WidgetBody centered className="hermes-widget"><WidgetState state={loading ? "loading" : error ? "error" : "empty"}>{!loading ? error ?? "Hermes unavailable" : undefined}</WidgetState></WidgetBody>;
  const next = data.nextJob;
  return <WidgetBody className={`hermes-widget${footprint?.columnSpan === 6 ? " hermes-widget--wide" : ""}`} aria-label="Hermes overview" reserveNotice notice={<WidgetStaleNotice error={error} />}>
    <WidgetList label="Hermes activity"
      summary={{ primary: <WidgetBadge tone={data.health === "ready" ? "positive" : data.health === "degraded" ? "warning" : "neutral"}>{HEALTH[data.health]}</WidgetBadge>, secondary: data.activeApiRuns === null ? "API runs: —" : `${data.activeApiRuns} API ${data.activeApiRuns === 1 ? "run" : "runs"}`, secondaryTone: data.activeApiRuns ? "positive" : "neutral" }}
      footerSummary={{ primary: data.scheduledJobs === null ? "Jobs: —" : `${data.scheduledJobs} scheduled`, secondary: data.failedJobs === null ? "Failures: —" : `${data.failedJobs} failed ${data.failedJobs === 1 ? "job" : "jobs"}`, secondaryTone: data.failedJobs ? "alert" : "neutral" }}>
      {data.jobsState !== "available" ? <WidgetListItem title={sectionMessage("Scheduled jobs", data.jobsState)} />
        : next ? <WidgetListItem title={next.name} secondary={`Next job · ${timestamp(next.nextRun)}${next.lastStatus ? ` · Last: ${next.lastStatus}` : ""}`} />
          : <WidgetListItem title={data.scheduledJobs ? "Next job time unavailable" : "No scheduled jobs"} />}
      {data.sessionsState !== "available" ? <WidgetListItem title={sectionMessage("Recent sessions", data.sessionsState)} />
        : data.sessions.length === 0 ? <WidgetListItem title="No recent sessions" />
          : data.sessions.map(session => <WidgetListItem key={session.id} title={session.title} secondary={`${session.source} · ${timestamp(session.lastActive)}`} />)}
    </WidgetList>
  </WidgetBody>;
}

const FIELDS: WidgetConfigField[] = [
  { key: "url", label: "API server URL", type: "url", required: true, placeholder: "http://hermes:8642", description: "Final HTTP(S) API listener address reachable from Kokpit, normally port 8642. Direct IP and hostname URLs work. Keep any real proxy prefix or /p/profile route; omit /v1, endpoint paths, credentials, query strings and fragments. Redirects are not followed. The optional service URL opens the dashboard separately." },
  { key: "api_key", label: "API server key", type: "password", required: true, description: "The listener’s effective API_SERVER_KEY, or its YAML gateway.api_server.key. A /p/name route needs that named profile’s own API_SERVER_KEY from its .env. Paste the key value alone; Kokpit adds Bearer. Use a real random key, not a provider key or example placeholder. A saved key is retained only while the connection URL is unchanged; re-enter it after a URL edit." },
];
registerIntegration<HermesConfig>({ id: "hermes", connectionSchema: HermesConfigSchema, connectionFields: FIELDS, credentialScopeFields: ["url"] });
registerWidget<HermesConfig, HermesData>({
  id: "hermes-overview", name: "Hermes Overview", integrationType: "hermes", configSchema: HermesConfigSchema,
  fetchData: fetchHermes, component: HermesWidget, refreshInterval: 30_000, preferredSize: "tall", minSize: "tall",
  compactHeader: true, sharedUI: true, hasLinks: true, configFields: FIELDS, optionFields: [], credentialScopeFields: ["url"],
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 4 }, { label: "Wide", columnSpan: 6, rowSpan: 3 }],
  footprintDescription: "Default (3×4) stacks activity in one column; Wide (6×3) uses two columns in the same scrolling area. Both keep health, active API runs and job totals fixed, with the next job and up to ten recent sessions when available. Times are UTC. There are no session-limit or section-selection settings.",
  setupGuide: hermesSetupGuide,
  serviceEditorPreset: { defaultName: "Hermes", defaultIconUrl: "/icons/hermes.svg" },
});
