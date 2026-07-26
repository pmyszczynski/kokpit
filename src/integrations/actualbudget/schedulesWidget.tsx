import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import {
  fetchSchedules,
  ActualSchedulesConfigSchema,
  BASE_CONFIG_FIELDS,
  TIMEZONE_CONFIG_FIELD,
} from "./api";
import type { ActualSchedulesConfig, ActualSchedule } from "./api";
import { Amount } from "./Amount";

// See summaryWidget.tsx: WidgetProps carries no config, so this file's own
// fetchData wrapper folds the display settings the component needs
// (currency/locale/privacy_mode) into the returned data, wrapped in an object
// rather than stuck onto the array (JSON.stringify drops non-index
// properties on an array — see accountsWidget.tsx).
//
// `dueSoonCount` is computed here, from the full (unsliced) list fetchSchedules
// returns, *before* truncating `schedules` to `config.limit` for display. If
// the count were derived from the already-truncated array instead, the
// footer would under-report whenever more than `limit` schedules fall within
// the window — exactly the case this count exists to surface.
//
// The window has no lower bound: `daysUntil <= dueSoonWindowDays` counts
// overdue schedules too (negative daysUntil), not just 0–N. An overdue bill
// is still due — more urgently, not less — so excluding it from "how many
// need attention soon" would be exactly backwards.
//
// `dueSoonWindowDays` is `Math.min(7, config.days_ahead)`, not a bare 7:
// fetchSchedules already filters its result to `days_ahead` before this file
// ever sees it, so a bill due in 5 days simply isn't in `schedules` when
// `days_ahead` is 3 — a footer that still claimed "due within 7 days" would
// be promising a window the data can never actually cover. Threading the
// effective number into the data (the same way privacyMode/currency ride
// along) lets both the count and the label agree with what was actually
// fetched.
interface ActualSchedulesData {
  schedules: ActualSchedule[];
  dueSoonCount: number;
  dueSoonWindowDays: number;
  currency: string;
  locale?: string;
  privacyMode: boolean;
}

async function fetchSchedulesData(
  config: ActualSchedulesConfig,
  signal?: AbortSignal
): Promise<ActualSchedulesData> {
  const schedules = await fetchSchedules(config, signal);
  const dueSoonWindowDays = Math.min(7, config.days_ahead);
  const dueSoonCount = schedules.filter(
    (schedule) => schedule.daysUntil <= dueSoonWindowDays
  ).length;
  return {
    schedules: schedules.slice(0, config.limit),
    dueSoonCount,
    dueSoonWindowDays,
    currency: config.currency,
    locale: config.locale,
    privacyMode: config.privacy_mode,
  };
}

function dueLabel(daysUntil: number): string {
  if (daysUntil < 0) return "overdue";
  if (daysUntil === 0) return "today";
  return `${daysUntil}d`;
}

/** "Due within 7 days or overdue" — pluralized, and reflecting the actual
 * effective window rather than a hardcoded 7 (see ActualSchedulesData). */
function dueSoonFooterLabel(windowDays: number): string {
  return `Due within ${windowDays} day${windowDays === 1 ? "" : "s"} or overdue`;
}

export function ActualBudgetSchedulesWidget({
  data,
  loading,
  error,
}: WidgetProps<ActualSchedulesData>) {
  if (!data) {
    return (
      <div className="actualbudget-schedules-widget actualbudget-schedules-widget--empty">
        {loading && (
          <span className="actualbudget-schedules-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="actualbudget-schedules-widget__hint actualbudget-schedules-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  const privateClass = data.privacyMode ? " actualbudget-widget--private" : "";

  if (data.schedules.length === 0) {
    return (
      <div
        className={`actualbudget-schedules-widget actualbudget-schedules-widget--empty${privateClass}`}
      >
        <span className="actualbudget-schedules-widget__hint">
          No upcoming schedules
        </span>
        {error && (
          <span className="actualbudget-schedules-widget__stale-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`actualbudget-schedules-widget${privateClass}`}
      aria-label="Actual Budget schedules"
    >
      <div className="actualbudget-schedules-widget__list">
        {data.schedules.map((schedule) => {
          const overdue = schedule.daysUntil < 0;
          return (
            <div key={schedule.id} className="actualbudget-schedules-widget__row">
              <span
                className="actualbudget-schedules-widget__name"
                title={schedule.payeeName}
              >
                {schedule.payeeName}
              </span>
              <span className="actualbudget-schedules-widget__amount">
                {schedule.amountMin !== null && schedule.amountMax !== null ? (
                  <>
                    <Amount
                      cents={schedule.amountMin}
                      currency={data.currency}
                      locale={data.locale}
                    />
                    {"–"}
                    <Amount
                      cents={schedule.amountMax}
                      currency={data.currency}
                      locale={data.locale}
                    />
                  </>
                ) : (
                  <Amount
                    cents={schedule.amount}
                    currency={data.currency}
                    locale={data.locale}
                  />
                )}
              </span>
              <span
                className={`actualbudget-schedules-widget__due${overdue ? " actualbudget-schedules-widget__due--overdue" : ""}`}
              >
                {dueLabel(schedule.daysUntil)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="actualbudget-schedules-widget__footer">
        <span className="actualbudget-schedules-widget__footer-label">
          {dueSoonFooterLabel(data.dueSoonWindowDays)}
        </span>
        <span className="actualbudget-schedules-widget__footer-value">{data.dueSoonCount}</span>
      </div>
      {error && (
        <span className="actualbudget-schedules-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<ActualSchedulesConfig, ActualSchedulesData>({
  id: "actualbudget-schedules",
  name: "Actual Budget Schedules",
  preferredSize: "tall",
  serviceEditorPreset: {
    defaultName: "Actual Budget",
    defaultIconUrl:
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/actual-budget.svg",
  },
  configSchema: ActualSchedulesConfigSchema,
  fetchData: fetchSchedulesData,
  refreshInterval: 300_000,
  fetchTimeoutMs: 15_000,
  component: ActualBudgetSchedulesWidget,
  configFields: [
    ...BASE_CONFIG_FIELDS,
    TIMEZONE_CONFIG_FIELD,
    {
      key: "limit",
      label: "Schedule limit",
      type: "number",
      required: false,
      placeholder: "6",
      description: "Maximum number of upcoming schedules to display.",
    },
    {
      key: "days_ahead",
      label: "Days ahead",
      type: "number",
      required: false,
      placeholder: "30",
      description: "Only show schedules due within this many days.",
    },
  ],
});
