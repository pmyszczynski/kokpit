import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchAccounts, ActualAccountsConfigSchema, BASE_CONFIG_FIELDS } from "./api";
import type { ActualAccountsConfig, ActualAccount } from "./api";
import { Amount } from "./Amount";

// See summaryWidget.tsx: WidgetProps carries no config, so this file's own
// fetchData wrapper folds the display settings the component needs
// (currency/locale/privacy_mode) into the returned data. api.ts's
// fetchAccounts still returns a plain ActualAccount[]; it is wrapped in an
// object here rather than mutated, because the widget route JSON-serializes
// the result and extra properties stuck onto an array are dropped by
// JSON.stringify (only index keys survive).
interface ActualAccountsData {
  accounts: ActualAccount[];
  currency: string;
  locale?: string;
  privacyMode: boolean;
}

async function fetchAccountsData(
  config: ActualAccountsConfig,
  signal?: AbortSignal
): Promise<ActualAccountsData> {
  const accounts = await fetchAccounts(config, signal);
  return {
    accounts,
    currency: config.currency,
    locale: config.locale,
    privacyMode: config.privacy_mode,
  };
}

export function ActualBudgetAccountsWidget({
  data,
  loading,
  error,
}: WidgetProps<ActualAccountsData>) {
  if (!data) {
    return (
      <div className="actualbudget-accounts-widget actualbudget-accounts-widget--empty">
        {loading && (
          <span className="actualbudget-accounts-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="actualbudget-accounts-widget__hint actualbudget-accounts-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  const privateClass = data.privacyMode ? " actualbudget-widget--private" : "";

  if (data.accounts.length === 0) {
    return (
      <div
        className={`actualbudget-accounts-widget actualbudget-accounts-widget--empty${privateClass}`}
      >
        <span className="actualbudget-accounts-widget__hint">No accounts to show</span>
        {error && (
          <span className="actualbudget-accounts-widget__stale-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  const netWorth = data.accounts.reduce((total, account) => total + account.balance, 0);

  return (
    <div
      className={`actualbudget-accounts-widget${privateClass}`}
      aria-label="Actual Budget accounts"
    >
      <div className="actualbudget-accounts-widget__list">
        {data.accounts.map((account) => (
          <div key={account.id} className="actualbudget-accounts-widget__row">
            <span className="actualbudget-accounts-widget__name" title={account.name}>
              {account.name}
            </span>
            {account.offbudget && (
              <span className="actualbudget-accounts-widget__badge">Off-budget</span>
            )}
            <span className="actualbudget-accounts-widget__balance">
              <Amount cents={account.balance} currency={data.currency} locale={data.locale} />
            </span>
          </div>
        ))}
      </div>
      <div className="actualbudget-accounts-widget__footer">
        <span className="actualbudget-accounts-widget__footer-label">Net worth</span>
        <span className="actualbudget-accounts-widget__footer-value">
          <Amount cents={netWorth} currency={data.currency} locale={data.locale} />
        </span>
      </div>
      {error && (
        <span className="actualbudget-accounts-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<ActualAccountsConfig, ActualAccountsData>({
  id: "actualbudget-accounts",
  name: "Actual Budget Accounts",
  preferredSize: "tall",
  serviceEditorPreset: {
    defaultName: "Actual Budget",
    defaultIconUrl:
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/actual-budget.svg",
  },
  configSchema: ActualAccountsConfigSchema,
  fetchData: fetchAccountsData,
  refreshInterval: 300_000,
  fetchTimeoutMs: 15_000,
  component: ActualBudgetAccountsWidget,
  credentialScopeFields: ["url"],
  configFields: [
    ...BASE_CONFIG_FIELDS,
    {
      key: "exclude_closed",
      label: "Hide closed accounts",
      type: "boolean",
      required: false,
      defaultValue: true,
      description:
        "Leaves closed accounts out of the list and out of the net worth total.",
    },
    {
      key: "exclude_offbudget",
      label: "Hide off-budget accounts",
      type: "boolean",
      required: false,
      defaultValue: false,
      description:
        "Leaves off-budget accounts out of the list and out of the net worth total.",
    },
  ],
});
