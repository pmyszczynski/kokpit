import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetList, WidgetListItem, WidgetState, WidgetStaleNotice, WidgetBadge } from "@/widgets/ui";
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
  data, loading, error,
}: WidgetProps<ActualAccountsData>) {
  if (!data) {
    return <WidgetBody centered className="actualbudget-accounts-widget actualbudget-accounts-widget--empty">
      <WidgetState state={loading ? "loading" : error ? "error" : "empty"}
        className="actualbudget-accounts-widget__hint" labelClassName="actualbudget-accounts-widget__hint--error">
        {loading ? "Loading…" : error ?? undefined}
      </WidgetState>
    </WidgetBody>;
  }

  const netWorth = data.accounts.reduce((total, account) => total + account.balance, 0);
  return <WidgetBody className={`actualbudget-accounts-widget${data.accounts.length === 0 ? " actualbudget-accounts-widget--empty" : ""}${data.privacyMode ? " actualbudget-widget--private" : ""}`}
    aria-label="Actual Budget accounts" reserveNotice
    notice={<WidgetStaleNotice error={error} className="actualbudget-accounts-widget__stale-error" />}>
    <WidgetList label="Budget accounts" listClassName="actualbudget-accounts-widget__list"
      empty={data.accounts.length === 0 ? <WidgetState state="empty" className="actualbudget-accounts-widget__hint">No accounts to show</WidgetState> : undefined}
      footerSummary={data.accounts.length === 0 ? undefined : {
        primary: "Net worth", secondary: <Amount cents={netWorth} currency={data.currency} locale={data.locale} />,
        secondaryTone: netWorth < 0 ? "alert" : "info", className: "actualbudget-accounts-widget__footer",
        primaryClassName: "actualbudget-accounts-widget__footer-label", secondaryClassName: "actualbudget-accounts-widget__footer-value",
      }}>
      {data.accounts.map(account => <WidgetListItem key={account.id} className="actualbudget-accounts-widget__row"
        title={account.name} titleClassName="actualbudget-accounts-widget__name"
        secondary={account.offbudget ? <WidgetBadge className="actualbudget-accounts-widget__badge">Off-budget</WidgetBadge> : undefined}
        trailing={<span className="actualbudget-accounts-widget__balance">
          <Amount cents={account.balance} currency={data.currency} locale={data.locale} />
        </span>} wrapTrailing />)}
    </WidgetList>
  </WidgetBody>;
}

registerWidget<ActualAccountsConfig, ActualAccountsData>({
  id: "actualbudget-accounts",
  name: "Actual Budget Accounts",
  preferredSize: "tall",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: {
    wrapper: "actualbudget-accounts-widget actualbudget-accounts-widget--empty",
    loading: "actualbudget-accounts-widget__hint",
    error: "actualbudget-accounts-widget__hint actualbudget-accounts-widget__hint--error",
  },
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 4 }],
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
  credentialScopeFields: ["url", "budget_sync_id"],
  preservedConfigFields: [{ key: "timezone", type: "text" }],
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
