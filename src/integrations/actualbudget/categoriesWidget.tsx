import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import {
  fetchBudgetMonth,
  currentMonth,
  ActualCategoriesConfigSchema,
  BASE_CONFIG_FIELDS,
} from "./api";
import type { ActualCategoriesConfig, ActualBudgetMonth, ActualCategory } from "./api";
import { calcProgress } from "@/integrations/shared/queue";
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
 * Percent of budgeted spent, 0–100. `spent` is negative, so abs it first.
 *
 * `calcProgress` returns 0 whenever `budgeted` is 0 — correct for a category
 * with nothing budgeted and nothing spent, but wrong for one with real
 * spending and no budget at all. That is exactly the category a user most
 * needs to see, and `hide_empty` doesn't catch it (it only drops categories
 * where budgeted *and* spent are both 0), so without this it silently sorts
 * to the bottom and gets cut by `limit`. Treat unbudgeted-but-spent as fully
 * consumed instead.
 */
function percentSpent(category: ActualCategory): number {
  if (category.budgeted === 0) {
    return Math.abs(category.spent) > 0 ? 100 : 0;
  }
  return calcProgress(category.budgeted, category.budgeted - Math.abs(category.spent));
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
  data,
  loading,
  error,
}: WidgetProps<ActualCategoriesData>) {
  if (!data) {
    return (
      <div className="actualbudget-categories-widget actualbudget-categories-widget--empty">
        {loading && (
          <span className="actualbudget-categories-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="actualbudget-categories-widget__hint actualbudget-categories-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  const categories = visibleCategories(data);
  const privateClass = data.privacyMode ? " actualbudget-widget--private" : "";

  if (categories.length === 0) {
    return (
      <div
        className={`actualbudget-categories-widget actualbudget-categories-widget--empty${privateClass}`}
      >
        <span className="actualbudget-categories-widget__hint">
          No categories to show
        </span>
        {error && (
          <span className="actualbudget-categories-widget__stale-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`actualbudget-categories-widget${privateClass}`}
      aria-label="Actual Budget categories"
    >
      <div className="actualbudget-categories-widget__list">
        {categories.map((category) => {
          const pct = percentSpent(category);
          const modifier = category.balance < 0 ? "over" : pct >= 85 ? "warn" : "ok";
          return (
            <div
              key={category.id}
              className={`actualbudget-categories-widget__row actualbudget-categories-widget__row--${modifier}`}
            >
              <span className="actualbudget-categories-widget__name" title={category.name}>
                {category.name}
              </span>
              <span className="actualbudget-categories-widget__amounts">
                <Amount
                  cents={Math.abs(category.spent)}
                  currency={data.currency}
                  locale={data.locale}
                />
                {" / "}
                <Amount
                  cents={category.budgeted}
                  currency={data.currency}
                  locale={data.locale}
                />
              </span>
              <div className="actualbudget-categories-widget__progress-cell">
                <div className="actualbudget-categories-widget__progress-bar">
                  <div
                    className="actualbudget-categories-widget__progress-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="actualbudget-categories-widget__progress-text">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <span className="actualbudget-categories-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<ActualCategoriesConfig, ActualCategoriesData>({
  id: "actualbudget-categories",
  name: "Actual Budget Categories",
  preferredSize: "tall",
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
  configFields: [
    ...BASE_CONFIG_FIELDS,
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
