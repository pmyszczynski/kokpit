import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetList, WidgetListItem, WidgetState, WidgetStaleNotice, WidgetBar } from "@/widgets/ui";
import {
  fetchBudgetMonth,
  currentMonth,
  ActualCategoriesConfigSchema,
  BASE_CONFIG_FIELDS,
  TIMEZONE_CONFIG_FIELD,
} from "./api";
import type { ActualCategoriesConfig, ActualBudgetMonth, ActualCategory } from "./api";
import { Amount } from "./Amount";

// See summaryWidget.tsx for why display settings ride along on the fetched
// data: WidgetProps never carries config, so this file's own fetchData
// wrapper (not api.ts, which stays untouched) is the only place config can
// reach the component. hide_income/hide_empty/limit are applied below, in
// the component, per the plan — they just read their flags from `data`
// instead of a config prop.
type ActualCategoriesData = ActualBudgetMonth & {
  currency: string;
  locale?: string;
  privacyMode: boolean;
  hideIncome: boolean;
  hideEmpty: boolean;
  limit: number;
};

async function fetchCategoriesData(
  config: ActualCategoriesConfig,
  signal?: AbortSignal
): Promise<ActualCategoriesData> {
  const month = await fetchBudgetMonth(
    config,
    currentMonth(new Date(), config.timezone),
    signal
  );
  return {
    ...month,
    currency: config.currency,
    locale: config.locale,
    privacyMode: config.privacy_mode,
    hideIncome: config.hide_income,
    hideEmpty: config.hide_empty,
    limit: config.limit,
  };
}

/**
 * Percent of available funds spent, 0–100. `spent` is negative, so abs it
 * first.
 *
 * Deriving from `budgeted` alone (treating budgeted === 0 as "fully spent
 * whenever spent !== 0") got carried-over categories wrong: a category with
 * 0 budgeted this month but 100.00 carried from last month and 50.00 spent
 * still has 50.00 available, not 0 — it should read 50%, not 100%.
 *
 * `balance` already accounts for carryover: `balance = available − |spent|`,
 * so `available = balance + |spent|`. That single derivation is correct for
 * every case, including the ordinary one (no carryover): there,
 * `balance = budgeted − |spent|`, so `available` reduces to `budgeted` and
 * this produces the same percentage as before. When `available` is 0 (or
 * negative — truly unbudgeted with real spending, or overspent past a
 * carried balance), the category is fully consumed: 100% if anything was
 * spent, 0% if nothing was budgeted, carried, or spent at all.
 */
/**
 * Funds this category had available before spending: `balance + |spent|`.
 *
 * This is the denominator the row displays as well as the one the bar is
 * derived from — showing `budgeted` next to a bar computed from `available`
 * contradicts itself for any carried-over category (50% spent rendered
 * beside "50.00 / 0.00").
 */
function availableFor(category: ActualCategory): number {
  return category.balance + Math.abs(category.spent);
}

function percentSpent(category: ActualCategory): number {
  const spent = Math.abs(category.spent);
  const available = availableFor(category);
  if (available <= 0) {
    return spent > 0 ? 100 : 0;
  }
  return Math.min(100, Math.max(0, Math.round((spent / available) * 100)));
}

function visibleCategories(data: ActualCategoriesData): ActualCategory[] {
  return data.categories
    // "hidden" in Actual means archived — never something to show, and never
    // configurable. Left unfiltered, an archived category still consumes a
    // slot from `limit`, displacing an active one.
    .filter((c) => !c.hidden)
    .filter((c) => !data.hideIncome || !c.isIncome)
    .filter((c) => !data.hideEmpty || !(c.budgeted === 0 && c.spent === 0))
    .slice()
    .sort((a, b) => percentSpent(b) - percentSpent(a))
    .slice(0, data.limit);
}

export function ActualBudgetCategoriesWidget({
  data, loading, error,
}: WidgetProps<ActualCategoriesData>) {
  if (!data) {
    return <WidgetBody centered className="actualbudget-categories-widget actualbudget-categories-widget--empty">
      <WidgetState state={loading ? "loading" : error ? "error" : "empty"}
        className="actualbudget-categories-widget__hint" labelClassName="actualbudget-categories-widget__hint--error">
        {loading ? "Loading…" : error ?? undefined}
      </WidgetState>
    </WidgetBody>;
  }

  const categories = visibleCategories(data);
  return <WidgetBody className={`actualbudget-categories-widget${categories.length === 0 ? " actualbudget-categories-widget--empty" : ""}${data.privacyMode ? " actualbudget-widget--private" : ""}`}
    aria-label="Actual Budget categories" reserveNotice
    notice={<WidgetStaleNotice error={error} className="actualbudget-categories-widget__stale-error" />}>
    <WidgetList label="Budget categories" listClassName="actualbudget-categories-widget__list"
      empty={categories.length === 0 ? <WidgetState state="empty" className="actualbudget-categories-widget__hint">No categories to show</WidgetState> : undefined}>
      {categories.map(category => {
        const pct = percentSpent(category);
        const modifier = category.balance < 0 ? "over" : pct >= 85 ? "warn" : "ok";
        const tone = modifier === "over" ? "alert" : modifier === "warn" ? "warning" : "positive";
        const status = modifier === "over" ? " · Overspent" : modifier === "warn" ? " · Almost spent" : "";
        return <WidgetListItem key={category.id}
          className={`actualbudget-categories-widget__row actualbudget-categories-widget__row--${modifier}`}
          title={category.name} titleClassName="actualbudget-categories-widget__name"
          secondary={<>
            {category.groupName && <>{category.groupName} · </>}
            <span className="actualbudget-categories-widget__amounts">
              <Amount cents={Math.abs(category.spent)} currency={data.currency} locale={data.locale} />
              {" / "}
              <Amount cents={availableFor(category)} currency={data.currency} locale={data.locale} />
            </span>
          </>} wrapSecondary
          footer={<WidgetBar kind="usage" label={`Budget spent for ${category.name}`} value={pct} tone={tone}
            valueLabel={`${pct}%${status}`} className="actualbudget-categories-widget__progress-cell"
            trackClassName="actualbudget-categories-widget__progress-bar"
            fillClassName="actualbudget-categories-widget__progress-fill" labelClassName="actualbudget-categories-widget__progress-text" />} />;
      })}
    </WidgetList>
  </WidgetBody>;
}

registerWidget<ActualCategoriesConfig, ActualCategoriesData>({
  id: "actualbudget-categories",
  name: "Actual Budget Categories",
  preferredSize: "tall",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: {
    wrapper: "actualbudget-categories-widget actualbudget-categories-widget--empty",
    loading: "actualbudget-categories-widget__hint",
    error: "actualbudget-categories-widget__hint actualbudget-categories-widget__hint--error",
  },
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 4 }],
  serviceEditorPreset: {
    defaultName: "Actual Budget",
    defaultIconUrl:
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/actual-budget.svg",
  },
  configSchema: ActualCategoriesConfigSchema,
  fetchData: fetchCategoriesData,
  refreshInterval: 300_000,
  fetchTimeoutMs: 15_000,
  component: ActualBudgetCategoriesWidget,
  credentialScopeFields: ["url", "budget_sync_id"],
  configFields: [
    ...BASE_CONFIG_FIELDS,
    TIMEZONE_CONFIG_FIELD,
    {
      key: "limit",
      label: "Category limit",
      type: "number",
      required: false,
      placeholder: "8",
      description: "Maximum number of categories to display, sorted by percent spent.",
    },
    {
      key: "hide_income",
      label: "Hide income categories",
      type: "boolean",
      required: false,
      defaultValue: true,
      description: "Leaves income categories out of the list.",
    },
    {
      key: "hide_empty",
      label: "Hide untouched categories",
      type: "boolean",
      required: false,
      defaultValue: true,
      description: "Leaves out categories with nothing budgeted and nothing spent.",
    },
  ],
});
