import { z } from "zod";
import type { WidgetConfigField } from "@/widgets";
import { daysUntil, formatInTimeZone } from "./format";

// ── Config ───────────────────────────────────────────────────────────────────

// `url` is the actual-http-api sidecar, never the Actual Budget server itself:
// Actual has no read API, it speaks an encrypted CRDT sync stream. `api_key` is
// the sidecar's own key, and `encryption_password` is only needed for
// end-to-end-encrypted budgets. The API carries no currency information, so
// `currency`/`locale` are config rather than anything we can discover.
//
// `timezone` is an optional IANA name (e.g. "Europe/Warsaw") used to resolve
// "current month" and "days until" boundaries. No Dockerfile or compose file
// in this repo sets `TZ`, so the container runs UTC by default — without this,
// a user outside UTC gets the wrong budget month for several hours around
// every month boundary, and a schedule due today can read as "1d" away.
const BaseConfigSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
  budget_sync_id: z.string().min(1),
  encryption_password: z.string().optional(),
  currency: z.string().length(3).default("USD"),
  locale: z.string().optional(),
  privacy_mode: z.boolean().default(true),
  timezone: z.string().optional(),
});

export const ActualSummaryConfigSchema = BaseConfigSchema;

export const ActualCategoriesConfigSchema = BaseConfigSchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(8),
  hide_income: z.boolean().default(true),
  hide_empty: z.boolean().default(true),
});

export const ActualAccountsConfigSchema = BaseConfigSchema.extend({
  exclude_closed: z.boolean().default(true),
  exclude_offbudget: z.boolean().default(false),
});

export const ActualSchedulesConfigSchema = BaseConfigSchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(6),
  days_ahead: z.coerce.number().int().min(1).max(365).default(30),
});

export interface ActualBudgetBaseConfig {
  url: string;
  api_key: string;
  budget_sync_id: string;
  encryption_password?: string;
  currency: string;
  locale?: string;
  privacy_mode: boolean;
  /** IANA zone name (e.g. "Europe/Warsaw"). Omit to use the server's local time. */
  timezone?: string;
}

export type ActualSummaryConfig = ActualBudgetBaseConfig;

export interface ActualCategoriesConfig extends ActualBudgetBaseConfig {
  limit: number;
  hide_income: boolean;
  hide_empty: boolean;
}

// The two filters are optional on the type (not on the schema, which defaults
// them) so fetchSummary can reuse fetchAccounts with a plain base config.
export interface ActualAccountsConfig extends ActualBudgetBaseConfig {
  exclude_closed?: boolean;
  exclude_offbudget?: boolean;
}

export interface ActualSchedulesConfig extends ActualBudgetBaseConfig {
  limit: number;
  days_ahead: number;
}

// ── Shared config fields ─────────────────────────────────────────────────────

/**
 * The config fields every one of the four widgets exposes for
 * `ActualBudgetBaseConfig`, in display order. Each widget's `configFields`
 * spreads this array first and appends its own fields after — see
 * accountsWidget.tsx, categoriesWidget.tsx, schedulesWidget.tsx and
 * summaryWidget.tsx.
 *
 * Previously these ~8 definitions (label, placeholder, description, the lot)
 * were copy-pasted verbatim into all four files, and had already drifted:
 * `timezone`'s description differed across all four copies (accounts noted it
 * was shared-but-unused there, schedules described due-date resolution,
 * categories/summary described budget-month resolution). This single
 * definition is normative now; a per-widget nuance belongs in that widget's
 * own extra fields, not in a forked copy of a shared one.
 */
export const BASE_CONFIG_FIELDS: WidgetConfigField[] = [
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
      "Optional IANA timezone name (e.g. Europe/Warsaw) used to resolve the current budget month. Defaults to the server's timezone.",
  },
  {
    key: "privacy_mode",
    label: "Blur amounts until hover",
    type: "boolean",
    required: false,
    defaultValue: true,
    description: "Blurs monetary amounts on the tile until you hover over it.",
  },
];

// ── Widget-facing shapes ─────────────────────────────────────────────────────

export interface ActualAccount {
  id: string;
  name: string;
  offbudget: boolean;
  closed: boolean;
  /** Minor units. workingBalance when present, else clearedBalance, else 0. */
  balance: number;
}

export interface ActualCategory {
  id: string;
  name: string;
  /** Name of the containing category group, flattened in from categoryGroups. */
  groupName: string;
  isIncome: boolean;
  hidden: boolean;
  /** Minor units. */
  budgeted: number;
  /** Minor units, **negative** for outflows. Display Math.abs(spent). */
  spent: number;
  /** Minor units. `balance < 0` is the only correct overspent test. */
  balance: number;
  carryover: boolean;
}

export interface ActualBudgetMonth {
  /** `YYYY-MM`. */
  month: string;
  /** "To Be Budgeted", minor units. */
  toBudget: number;
  totalBudgeted: number;
  /** Minor units, **negative**. */
  totalSpent: number;
  totalBalance: number;
  totalIncome: number;
  categories: ActualCategory[];
}

export interface ActualSummary {
  month: ActualBudgetMonth;
  /** null when the best-effort accounts call failed. */
  accounts: ActualAccount[] | null;
  /** null when the best-effort accounts call failed. */
  netWorth: number | null;
}

export interface ActualSchedule {
  id: string;
  name: string | null;
  /** Resolved payee name, falling back to the schedule name, then an em dash. */
  payeeName: string;
  /** `YYYY-MM-DD`. */
  nextDate: string;
  /** Whole local days from today; negative when overdue. */
  daysUntil: number;
  /** Minor units. Midpoint of the range when amountOp is "isbetween". */
  amount: number;
  /** Set only for an "isbetween" schedule; null otherwise. */
  amountMin: number | null;
  /** Set only for an "isbetween" schedule; null otherwise. */
  amountMax: number | null;
  amountOp: string | null;
}

// ── Upstream schemas ─────────────────────────────────────────────────────────

// Every upstream object is passthrough: the sidecar tracks Actual's release
// line and adds fields between versions, and a widget must not break because a
// bump added one.

// The flat /categories endpoint returns is_income/hidden as raw 0/1 integers
// while /categorygroups normalises them to booleans. We only read the month
// endpoint's nested categoryGroups, which gives booleans today — coerce anyway
// rather than trusting that to hold.
const LooseBooleanSchema = z.union([z.boolean(), z.number()]).optional();

const AccountSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    offbudget: LooseBooleanSchema,
    closed: LooseBooleanSchema,
    // Present only when include_balances=true, which we always send.
    clearedBalance: z.number().optional(),
    unclearedBalance: z.number().optional(),
    workingBalance: z.number().optional(),
  })
  .passthrough();

const AccountsSchema = z.array(AccountSchema);

const MonthCategorySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    is_income: LooseBooleanSchema,
    hidden: LooseBooleanSchema,
    budgeted: z.number().optional(),
    // Income categories report "received" where expense categories report "spent".
    spent: z.number().optional(),
    received: z.number().optional(),
    balance: z.number().optional(),
    carryover: LooseBooleanSchema,
  })
  .passthrough();

const MonthCategoryGroupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    is_income: LooseBooleanSchema,
    hidden: LooseBooleanSchema,
    categories: z.array(MonthCategorySchema).optional(),
  })
  .passthrough();

const MonthSchema = z
  .object({
    month: z.string().optional(),
    toBudget: z.number().optional(),
    totalBudgeted: z.number().optional(),
    totalIncome: z.number().optional(),
    totalSpent: z.number().optional(),
    totalBalance: z.number().optional(),
    categoryGroups: z.array(MonthCategoryGroupSchema).optional(),
  })
  .passthrough();

const AmountRangeSchema = z
  .object({ num1: z.number(), num2: z.number() })
  .passthrough();

// `date` is deliberately not declared: it is either a date string or a
// RecurConfig object, and next_date already holds the computed due date for
// both. Passthrough carries it along untouched.
const ScheduleSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    next_date: z.string().nullish(),
    completed: LooseBooleanSchema,
    posts_transaction: LooseBooleanSchema,
    payee: z.string().nullish(),
    account: z.string().nullish(),
    amount: z.union([z.number(), AmountRangeSchema]).nullish(),
    amountOp: z.string().nullish(),
  })
  .passthrough();

const SchedulesSchema = z.array(ScheduleSchema);

const PayeeSchema = z
  .object({ id: z.string(), name: z.string().nullish() })
  .passthrough();

const PayeesSchema = z.array(PayeeSchema);

// ── Client ───────────────────────────────────────────────────────────────────

/**
 * Reads the sidecar's `{"error": "message"}` envelope for a non-2xx response.
 *
 * Only the status code and the upstream message ever reach the caller. Widget
 * errors are rendered in the browser, so the API key, the encryption password
 * and every other header value must stay out of this string.
 */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      body !== null &&
      typeof body === "object" &&
      typeof (body as { error?: unknown }).error === "string"
    ) {
      return `Actual Budget responded with ${response.status}: ${
        (body as { error: string }).error
      }`;
    }
  } catch {
    // Not JSON (a proxy's HTML error page, an empty body) — status only.
  }
  return `Actual Budget responded with ${response.status}`;
}

/**
 * GETs `{sidecar_url}/v1/budgets/{budget_sync_id}{path}` and validates the
 * unwrapped `{data: …}` payload.
 *
 * The sync ID is a path segment, not a header. The path is resolved relative to
 * the configured URL (with a trailing slash forced) rather than to its origin,
 * so a sidecar published under a reverse-proxy subpath keeps working — the same
 * convention as src/integrations/shared/http.ts.
 *
 * `signal` is forwarded, never replaced: the widget route owns the timeout.
 */
async function actualFetch<T>(
  config: ActualBudgetBaseConfig,
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal
): Promise<T> {
  const base = config.url.endsWith("/") ? config.url : `${config.url}/`;
  const url = new URL(
    `v1/budgets/${encodeURIComponent(config.budget_sync_id)}${path}`,
    base
  ).toString();

  const headers: Record<string, string> = { "x-api-key": config.api_key };
  if (config.encryption_password) {
    headers["budget-encryption-password"] = config.encryption_password;
  }

  const response = await fetch(url, { method: "GET", headers, signal });

  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error("Actual Budget returned invalid JSON.");
  }

  // Every successful GET is wrapped; a bare body means we are not talking to
  // actual-http-api (most likely the Actual server itself).
  if (raw === null || typeof raw !== "object" || !("data" in raw)) {
    throw new Error(
      "Actual Budget returned an unexpected response shape — check that the URL points at your actual-http-api sidecar."
    );
  }

  return schema.parse((raw as { data: unknown }).data);
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

/**
 * The current month as `YYYY-MM`, resolved in `timeZone` when given (falling
 * back to local time if the zone string is invalid — `Intl.DateTimeFormat`
 * throws `RangeError` on an unknown IANA name, which must not take down the
 * widget), and in local time otherwise.
 *
 * Deliberately not `toISOString()`: that is UTC and reports the wrong month
 * for the first or last hours of a month anywhere outside UTC. Local time is
 * itself only correct when the container's `TZ` matches the user — nothing in
 * this repo sets one, so the container runs UTC — which is exactly why
 * `timeZone` exists.
 */
export function currentMonth(now: Date = new Date(), timeZone?: string): string {
  const formatted = timeZone
    ? formatInTimeZone(now, timeZone, { year: "numeric", month: "2-digit" })
    : null;
  if (formatted) return formatted;

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Fetches every account with its balance in a single request. The filters are
 * only sent when enabled — actual-http-api treats a present query param as
 * truthy, so `exclude_closed=false` would still exclude closed accounts.
 */
export async function fetchAccounts(
  config: ActualAccountsConfig,
  signal?: AbortSignal
): Promise<ActualAccount[]> {
  // include_balances is always on: it returns every balance in one response,
  // and the two exclude filters are only honoured alongside it.
  const params = new URLSearchParams({ include_balances: "true" });
  if (config.exclude_closed) params.set("exclude_closed", "true");
  if (config.exclude_offbudget) params.set("exclude_offbudget", "true");

  const accounts = await actualFetch(
    config,
    `/accounts?${params.toString()}`,
    AccountsSchema,
    signal
  );

  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    offbudget: Boolean(account.offbudget),
    closed: Boolean(account.closed),
    balance: account.workingBalance ?? account.clearedBalance ?? 0,
  }));
}

/** Fetches one budget month (`YYYY-MM`) with its categories flattened. */
export async function fetchBudgetMonth(
  config: ActualBudgetBaseConfig,
  month: string,
  signal?: AbortSignal
): Promise<ActualBudgetMonth> {
  const raw = await actualFetch(
    config,
    `/months/${encodeURIComponent(month)}`,
    MonthSchema,
    signal
  );

  const categories: ActualCategory[] = [];
  for (const group of raw.categoryGroups ?? []) {
    for (const category of group.categories ?? []) {
      categories.push({
        id: category.id,
        name: category.name,
        groupName: group.name,
        // A category in an income or hidden group inherits that regardless of
        // its own flag, so hide_income/hidden filtering can't miss one.
        isIncome: Boolean(category.is_income) || Boolean(group.is_income),
        hidden: Boolean(category.hidden) || Boolean(group.hidden),
        budgeted: category.budgeted ?? 0,
        spent: category.spent ?? category.received ?? 0,
        balance: category.balance ?? 0,
        carryover: Boolean(category.carryover),
      });
    }
  }

  return {
    month: raw.month ?? month,
    toBudget: raw.toBudget ?? 0,
    totalBudgeted: raw.totalBudgeted ?? 0,
    totalSpent: raw.totalSpent ?? 0,
    totalBalance: raw.totalBalance ?? 0,
    totalIncome: raw.totalIncome ?? 0,
    categories,
  };
}

/**
 * Fetches the current month plus a net worth figure.
 *
 * The month is required; the accounts call is best-effort and degrades to null
 * so a net-worth failure never blanks the budget figures. Closed accounts are
 * excluded — they can retain a stale balance that would distort net worth.
 */
export async function fetchSummary(
  config: ActualBudgetBaseConfig,
  signal?: AbortSignal
): Promise<ActualSummary> {
  const [month, accounts] = await Promise.all([
    fetchBudgetMonth(config, currentMonth(new Date(), config.timezone), signal),
    fetchAccounts({ ...config, exclude_closed: true }, signal).catch(() => null),
  ]);

  return {
    month,
    accounts,
    netWorth:
      accounts === null
        ? null
        : accounts.reduce((total, account) => total + account.balance, 0),
  };
}

/**
 * Collapses a schedule's amount to a single figure, keeping the bounds when
 * amountOp is "isbetween" (where `amount` is `{num1, num2}` rather than a
 * number). Missing or malformed amounts become 0, never NaN.
 */
function normalizeAmount(amount: number | { num1: number; num2: number } | null | undefined): {
  amount: number;
  amountMin: number | null;
  amountMax: number | null;
} {
  if (typeof amount === "number") {
    return { amount, amountMin: null, amountMax: null };
  }
  if (amount) {
    return {
      amount: Math.round((amount.num1 + amount.num2) / 2),
      amountMin: Math.min(amount.num1, amount.num2),
      amountMax: Math.max(amount.num1, amount.num2),
    };
  }
  return { amount: 0, amountMin: null, amountMax: null };
}

/**
 * Fetches upcoming (and overdue) schedules within `days_ahead`, sorted by due
 * date.
 *
 * Does **not** slice to `limit`: that is a display concern (how many rows a
 * tile has room for), not a data-scoping one, and a widget footer that counts
 * "due within 7 days" needs the full filtered list to count correctly — a
 * caller that truncates here first would under-report whenever more than
 * `limit` schedules are due soon. Callers slice for display themselves.
 *
 * `next_date` is the computed next due date for one-off and recurring
 * schedules alike, so the RecurConfig on `date` is never decoded. Payee names
 * come from a best-effort /payees lookup — `payee` is an ID, and a failure
 * there falls back to the schedule's own name rather than dropping the widget.
 */
export async function fetchSchedules(
  config: ActualSchedulesConfig,
  signal?: AbortSignal
): Promise<ActualSchedule[]> {
  const [schedules, payees] = await Promise.all([
    actualFetch(config, "/schedules", SchedulesSchema, signal),
    actualFetch(config, "/payees", PayeesSchema, signal).catch(() => null),
  ]);

  const payeeNames = new Map<string, string>();
  for (const payee of payees ?? []) {
    if (payee.name) payeeNames.set(payee.id, payee.name);
  }

  const now = new Date();

  return schedules
    .filter((schedule) => !schedule.completed && Boolean(schedule.next_date))
    .map((schedule) => {
      const nextDate = schedule.next_date as string;
      return {
        id: schedule.id,
        name: schedule.name ?? null,
        payeeName:
          (schedule.payee ? payeeNames.get(schedule.payee) : undefined) ??
          schedule.name ??
          "—",
        nextDate,
        daysUntil: daysUntil(nextDate, now, config.timezone),
        ...normalizeAmount(schedule.amount),
        amountOp: schedule.amountOp ?? null,
      };
    })
    // Overdue schedules are kept: the widget renders them as such.
    .filter((schedule) => schedule.daysUntil <= config.days_ahead)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}
