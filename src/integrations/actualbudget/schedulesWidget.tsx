import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchSchedules, ActualSchedulesConfigSchema } from "./api";
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
// 7 days — exactly the case a "due soon" count exists to surface.
interface ActualSchedulesData {
  schedules: ActualSchedule[];
  dueSoonCount: number;
  currency: string;
  locale?: string;
  privacyMode: boolean;
}

async function fetchSchedulesData(
  config: ActualSchedulesConfig,
  signal?: AbortSignal
): Promise<ActualSchedulesData> {
  const schedules = await fetchSchedules(config, signal);
  const dueSoonCount = schedules.filter(
    (schedule) => schedule.daysUntil >= 0 && schedule.daysUntil <= 7
  ).length;
  return {
    schedules: schedules.slice(0, config.limit),
    dueSoonCount,
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
        <span className="actualbudget-schedules-widget__footer-label">Due within 7 days</span>
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
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://actual-http-api:5007",
      description:
        "URL of your actual-http-api sidecar, not your Actual Budget server.",
    },
    {
      key: "api_key",
      label: "API Key",
      type: "password",
      required: true,
      description: "The sidecar's own API_KEY, not your Actual server password.",
    },
    {
      key: "budget_sync_id",
      label: "Budget Sync ID",
      type: "text",
      required: true,
      description: "Actual → Settings → Show advanced settings → Sync ID.",
    },
    {
      key: "encryption_password",
      label: "Encryption Password",
      type: "password",
      required: false,
      description: "Only needed for end-to-end-encrypted budgets.",
    },
    {
      key: "currency",
      label: "Currency",
      type: "text",
      required: false,
      placeholder: "USD",
      description: "3-letter ISO currency code, e.g. USD, EUR, GBP.",
    },
    {
      key: "locale",
      label: "Locale",
      type: "text",
      required: false,
      placeholder: "en-US",
      description: "BCP 47 locale for number formatting, e.g. en-US, de-DE.",
    },
    {
      key: "timezone",
      label: "Timezone",
      type: "text",
      required: false,
      placeholder: "Europe/Warsaw",
      description:
        "Optional IANA timezone name (e.g. Europe/Warsaw) used to resolve due dates ('today', 'overdue'). Defaults to the server's timezone.",
    },
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
    {
      key: "privacy_mode",
      label: "Blur amounts until hover",
      type: "boolean",
      required: false,
      defaultValue: true,
      description: "Blurs monetary amounts on the tile until you hover over it.",
    },
  ],
});
