import type { ReactNode } from "react";
import { z } from "zod";
import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import type { WidgetStatTone } from "@/widgets/ui";
import {
  fetchSummary,
  ActualSummaryConfigSchema,
  BASE_CONFIG_FIELDS,
  TIMEZONE_CONFIG_FIELD,
} from "./api";
import type { ActualSummaryConfig, ActualSummary } from "./api";
import { Amount } from "./Amount";
import { actualBudgetSetupGuide } from "./setupGuide";

// WidgetProps only carries { data, loading, error, refresh } — the component
// never sees the resolved config. currency/locale/privacy_mode are config, so
// this fetchData wrapper (owned by this file, not api.ts) folds them into the
// data it returns. api.ts and format.ts are not touched.
type ActualSummaryData = ActualSummary & {
  currency: string;
  locale?: string;
  privacyMode: boolean;
  sizeDefaults?: boolean;
};

type ActualSummaryDisplayConfig = ActualSummaryConfig & { size_defaults?: boolean };

async function fetchSummaryData(
  config: ActualSummaryDisplayConfig,
  signal?: AbortSignal
): Promise<ActualSummaryData> {
  const summary = await fetchSummary(config, signal);
  return {
    ...summary,
    currency: config.currency,
    locale: config.locale,
    privacyMode: config.privacy_mode,
    sizeDefaults: config.size_defaults,
  };
}

export function ActualBudgetSummaryWidget({
  data, loading, error, footprint,
}: WidgetProps<ActualSummaryData>) {
  if (!data) {
    return <WidgetBody centered className="actualbudget-summary-widget actualbudget-summary-widget--empty">
      <WidgetState state={loading ? "loading" : error ? "error" : "empty"}
        className="actualbudget-summary-widget__hint" labelClassName="actualbudget-summary-widget__hint--error">
        {loading ? "Loading…" : error ?? undefined}
      </WidgetState>
    </WidgetBody>;
  }

  // Archived categories are absent from Categories and must not inflate this count.
  const overspentCount = data.month.categories.filter(c => c.balance < 0 && !c.hidden).length;
  const footprintName = `${footprint?.columnSpan ?? 3}x${footprint?.rowSpan ?? 2}`;
  const amount = (cents: number) => <Amount cents={cents} currency={data.currency} locale={data.locale} />;
  const availableTone = (cents: number): WidgetStatTone => cents < 0 ? "alert" : cents > 0 ? "positive" : "neutral";
  const stats = {
    toAssign: { label: "To Assign", value: amount(data.month.toBudget), tone: availableTone(data.month.toBudget) },
    budgeted: { label: "Budgeted", value: amount(data.month.totalBudgeted), tone: data.month.totalBudgeted < 0 ? "alert" : "info" },
    spent: { label: "Spent", value: amount(Math.abs(data.month.totalSpent)), tone: "info" },
    remaining: { label: "Remaining", value: amount(data.month.totalBalance), tone: availableTone(data.month.totalBalance) },
    overspent: { label: "Overspent", value: overspentCount, tone: overspentCount > 0 ? "alert" : "neutral" },
    netWorth: { label: "Net Worth", value: data.netWorth === null ? "—" : amount(data.netWorth),
      tone: data.netWorth === null ? "neutral" : data.netWorth < 0 ? "alert" : "info" },
  } satisfies Record<string, { label: string; value: ReactNode; tone: WidgetStatTone }>;
  // Saved configurations keep all six figures; only new presets opt into size defaults.
  const fields: (keyof typeof stats)[] = !data.sizeDefaults || footprintName === "3x4"
    ? ["toAssign", "budgeted", "spent", "remaining", "overspent", "netWorth"]
    : footprintName === "6x2" ? ["toAssign", "remaining", "spent"] : ["toAssign", "remaining"];

  return <WidgetBody className={`actualbudget-summary-widget${data.privacyMode ? " actualbudget-widget--private" : ""}`}
    aria-label="Actual Budget summary" data-footprint={footprintName} scrollLabel="Budget measurements" reserveNotice
    notice={<WidgetStaleNotice error={error} className="actualbudget-summary-widget__stale-error" />}>
    <WidgetStatGrid columns={footprintName === "6x2" ? 3 : 2} className="actualbudget-summary-widget__grid">
      {fields.map(key => <WidgetStat key={key} data-field={key} {...stats[key]}
        className="actualbudget-summary-widget__stat" valueClassName="actualbudget-summary-widget__value"
        labelClassName="actualbudget-summary-widget__label" />)}
    </WidgetStatGrid>
  </WidgetBody>;
}

registerWidget<ActualSummaryDisplayConfig, ActualSummaryData>({
  id: "actualbudget-summary",
  name: "Actual Budget Summary",
  preferredSize: "normal",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: {
    wrapper: "actualbudget-summary-widget actualbudget-summary-widget--empty",
    loading: "actualbudget-summary-widget__hint",
    error: "actualbudget-summary-widget__hint actualbudget-summary-widget__hint--error",
  },
  supportedFootprints: [
    { label: "Compact", columnSpan: 3, rowSpan: 2 },
    { label: "Detailed", columnSpan: 3, rowSpan: 4 },
    { label: "Wide", columnSpan: 6, rowSpan: 2 },
  ],
  setupGuide: actualBudgetSetupGuide,
  footprintDescription: "With Choose stats by tile size enabled, Compact (3×2) shows To Assign and Remaining; Wide (6×2) adds Spent in three columns; Detailed (3×4) shows all six in two columns. Turn it off to keep all six at every size, scrolling when needed. The other figures are Budgeted, Overspent (non-hidden categories with negative balances), and Net Worth (open account balances, including off-budget accounts). Net Worth shows — if its optional lookup fails.",
  serviceEditorPreset: {
    defaultConfig: { size_defaults: true },
    defaultName: "Actual Budget",
    defaultIconUrl:
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/actual-budget.svg",
  },
  configSchema: ActualSummaryConfigSchema.extend({ size_defaults: z.boolean().default(false) }),
  fetchData: fetchSummaryData,
  refreshInterval: 300_000,
  fetchTimeoutMs: 15_000,
  component: ActualBudgetSummaryWidget,
  configFields: [...BASE_CONFIG_FIELDS, TIMEZONE_CONFIG_FIELD, {
    key: "size_defaults",
    label: "Choose stats by tile size",
    type: "boolean",
    defaultValue: false,
    description: "Show 2/3/6 figures in Compact/Wide/Detailed: To Assign + Remaining; add Spent; then all six. New editor presets enable this. Existing/YAML configs default to off, keeping all six figures at every size. This toggle is the only measurement-selection option.",
  }],
  credentialScopeFields: ["url", "budget_sync_id"],
});
