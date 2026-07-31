import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import {
  fetchSummary,
  ActualSummaryConfigSchema,
  BASE_CONFIG_FIELDS,
  TIMEZONE_CONFIG_FIELD,
} from "./api";
import type { ActualSummaryConfig, ActualSummary } from "./api";
import { Amount } from "./Amount";

// WidgetProps only carries { data, loading, error, refresh } — the component
// never sees the resolved config. currency/locale/privacy_mode are config, so
// this fetchData wrapper (owned by this file, not api.ts) folds them into the
// data it returns. api.ts and format.ts are not touched.
type ActualSummaryData = ActualSummary & {
  currency: string;
  locale?: string;
  privacyMode: boolean;
};

async function fetchSummaryData(
  config: ActualSummaryConfig,
  signal?: AbortSignal
): Promise<ActualSummaryData> {
  const summary = await fetchSummary(config, signal);
  return {
    ...summary,
    currency: config.currency,
    locale: config.locale,
    privacyMode: config.privacy_mode,
  };
}

export function ActualBudgetSummaryWidget({
  data,
  loading,
  error,
}: WidgetProps<ActualSummaryData>) {
  if (!data) {
    return (
      <div className="actualbudget-summary-widget actualbudget-summary-widget--empty">
        {loading && (
          <span className="actualbudget-summary-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="actualbudget-summary-widget__hint actualbudget-summary-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  // Archived (hidden) categories are never shown by the categories widget —
  // see categoriesWidget.tsx's visibleCategories — so counting one here would
  // report "N overspent" with no corresponding row anywhere a user can see.
  const overspentCount = data.month.categories.filter(
    (c) => c.balance < 0 && !c.hidden
  ).length;

  return (
    <div
      className={`actualbudget-summary-widget${data.privacyMode ? " actualbudget-widget--private" : ""}`}
      aria-label="Actual Budget summary"
    >
      <div className="actualbudget-summary-widget__stat">
        <span className="actualbudget-summary-widget__value">
          <Amount cents={data.month.toBudget} currency={data.currency} locale={data.locale} />
        </span>
        <span className="actualbudget-summary-widget__label">To Assign</span>
      </div>
      <div className="actualbudget-summary-widget__stat">
        <span className="actualbudget-summary-widget__value">
          <Amount
            cents={data.month.totalBudgeted}
            currency={data.currency}
            locale={data.locale}
          />
        </span>
        <span className="actualbudget-summary-widget__label">Budgeted</span>
      </div>
      <div className="actualbudget-summary-widget__stat">
        <span className="actualbudget-summary-widget__value">
          <Amount
            cents={Math.abs(data.month.totalSpent)}
            currency={data.currency}
            locale={data.locale}
          />
        </span>
        <span className="actualbudget-summary-widget__label">Spent</span>
      </div>
      <div className="actualbudget-summary-widget__stat">
        <span className="actualbudget-summary-widget__value">
          <Amount
            cents={data.month.totalBalance}
            currency={data.currency}
            locale={data.locale}
          />
        </span>
        <span className="actualbudget-summary-widget__label">Remaining</span>
      </div>
      <div className="actualbudget-summary-widget__stat">
        <span className="actualbudget-summary-widget__value">{overspentCount}</span>
        <span className="actualbudget-summary-widget__label">Overspent</span>
      </div>
      <div className="actualbudget-summary-widget__stat">
        <span className="actualbudget-summary-widget__value">
          {data.netWorth === null ? (
            "—"
          ) : (
            <Amount cents={data.netWorth} currency={data.currency} locale={data.locale} />
          )}
        </span>
        <span className="actualbudget-summary-widget__label">Net Worth</span>
      </div>
      {error && (
        <span className="actualbudget-summary-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<ActualSummaryConfig, ActualSummaryData>({
  id: "actualbudget-summary",
  name: "Actual Budget Summary",
  preferredSize: "normal",
  serviceEditorPreset: {
    defaultName: "Actual Budget",
    defaultIconUrl:
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/actual-budget.svg",
  },
  configSchema: ActualSummaryConfigSchema,
  fetchData: fetchSummaryData,
  refreshInterval: 300_000,
  fetchTimeoutMs: 15_000,
  component: ActualBudgetSummaryWidget,
  configFields: [...BASE_CONFIG_FIELDS, TIMEZONE_CONFIG_FIELD],
  credentialScopeFields: ["url", "budget_sync_id"],
});
