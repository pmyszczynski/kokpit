// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ActualAccountsConfigSchema,
  ActualCategoriesConfigSchema,
  ActualSchedulesConfigSchema,
  ActualSummaryConfigSchema,
  currentMonth,
  fetchAccounts,
  fetchBudgetMonth,
  fetchSchedules,
  fetchSummary,
} from "@/integrations/actualbudget/api";
import {
  centsToUnits,
  daysUntil,
  formatMoney,
} from "@/integrations/actualbudget/format";
import { clearRegistry } from "@/widgets";

const API_KEY = "sk-super-secret-api-key";
const ENCRYPTION_PASSWORD = "correct-horse-battery-staple";

const BASE_CONFIG = {
  url: "http://actual-http-api:5007",
  api_key: API_KEY,
  budget_sync_id: "b1e2c3d4-sync",
  currency: "USD",
  privacy_mode: true,
};

const MOCK_ACCOUNTS = [
  {
    id: "acc-1",
    name: "Current",
    offbudget: false,
    closed: false,
    clearedBalance: 210412,
    unclearedBalance: 0,
    workingBalance: 210412,
  },
  {
    id: "acc-2",
    name: "Savings",
    offbudget: true,
    closed: false,
    clearedBalance: 5000000,
    unclearedBalance: 0,
    workingBalance: 5000000,
  },
];

const MOCK_MONTH = {
  month: "2026-07",
  toBudget: 41200,
  incomeAvailable: 500000,
  fromLastMonth: 1000,
  lastMonthOverspent: 0,
  forNextMonth: 0,
  totalBudgeted: 120000,
  totalIncome: 500000,
  totalSpent: -93400,
  totalBalance: 26600,
  categoryGroups: [
    {
      id: "grp-1",
      name: "Everyday",
      is_income: false,
      hidden: false,
      budgeted: 120000,
      spent: -93400,
      balance: 26600,
      categories: [
        {
          id: "cat-1",
          name: "Groceries",
          is_income: false,
          hidden: false,
          group_id: "grp-1",
          budgeted: 40000,
          spent: -31200,
          balance: 8800,
          carryover: false,
        },
        {
          id: "cat-2",
          name: "Dining",
          is_income: false,
          hidden: false,
          group_id: "grp-1",
          budgeted: 20000,
          spent: -62200,
          balance: -42200,
          carryover: false,
        },
      ],
    },
    {
      id: "grp-2",
      name: "Income",
      is_income: true,
      hidden: false,
      budgeted: 0,
      received: 500000,
      balance: 500000,
      categories: [
        {
          id: "cat-3",
          name: "Salary",
          is_income: true,
          hidden: false,
          group_id: "grp-2",
          budgeted: 0,
          received: 500000,
          balance: 500000,
          carryover: false,
        },
      ],
    },
  ],
};

const MOCK_SCHEDULES = [
  {
    id: "sch-1",
    name: "Mortgage",
    next_date: "2026-08-01",
    completed: false,
    posts_transaction: false,
    payee: "payee-1",
    account: "acc-1",
    amount: -124000,
    amountOp: "is",
    date: { frequency: "monthly", interval: 1 },
  },
  {
    id: "sch-2",
    name: "Electricity",
    next_date: "2026-07-28",
    completed: false,
    posts_transaction: false,
    payee: "payee-2",
    account: "acc-1",
    amount: { num1: -9000, num2: -7000 },
    amountOp: "isbetween",
    date: "2026-07-28",
  },
  {
    id: "sch-3",
    name: "Old subscription",
    next_date: "2026-07-20",
    completed: true,
    posts_transaction: false,
    payee: "payee-1",
    account: "acc-1",
    amount: -999,
    amountOp: "is",
    date: "2026-07-20",
  },
];

const MOCK_PAYEES = [
  { id: "payee-1", name: "Big Bank" },
  { id: "payee-2", name: "Power Co" },
];

function makeJsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => ({ data: body }) };
}

/** Wraps a body verbatim — used to test envelope handling directly. */
function makeRawResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

/** `body === undefined` simulates a non-JSON error body (HTML from a proxy). */
function makeErrorResponse(status: number, body?: unknown) {
  return {
    ok: false,
    status,
    json: async () => {
      if (body === undefined) {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      }
      return body;
    },
  };
}

/**
 * Routes by URL fragment. A value that is an Error is thrown instead of
 * returned, simulating a network-level failure for that endpoint.
 */
function makeFetchMock(
  routes: Record<string, unknown>
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (url: string) => {
    for (const [fragment, response] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        if (response instanceof Error) throw response;
        return response;
      }
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

function firstCall(mock: ReturnType<typeof vi.fn>, fragment: string) {
  const call = mock.mock.calls.find((c) => (c[0] as string).includes(fragment));
  expect(call).toBeDefined();
  return call as [string, RequestInit];
}

function headersOf(options: RequestInit): Record<string, string> {
  return options.headers as Record<string, string>;
}

/** Runs `fn` with process.env.TZ pinned, restoring the previous value after. */
function withTimeZone<T>(tz: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previous;
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

describe("actual-http-api request construction", () => {
  it("nests the budget sync id as a path segment under /v1/budgets", async () => {
    const mockFetch = makeFetchMock({ "/accounts": makeJsonResponse(MOCK_ACCOUNTS) });
    vi.stubGlobal("fetch", mockFetch);

    await fetchAccounts(BASE_CONFIG);

    const [url] = firstCall(mockFetch, "/accounts");
    expect(url).toContain(
      "http://actual-http-api:5007/v1/budgets/b1e2c3d4-sync/accounts"
    );
  });

  it("URL-encodes a sync id containing reserved characters", async () => {
    const mockFetch = makeFetchMock({ "/accounts": makeJsonResponse(MOCK_ACCOUNTS) });
    vi.stubGlobal("fetch", mockFetch);

    await fetchAccounts({ ...BASE_CONFIG, budget_sync_id: "a b/c?d" });

    const [url] = firstCall(mockFetch, "/accounts");
    expect(url).toContain("/v1/budgets/a%20b%2Fc%3Fd/accounts");
  });

  it("preserves a base path when the sidecar is behind a reverse-proxy subpath", async () => {
    const mockFetch = makeFetchMock({ "/accounts": makeJsonResponse(MOCK_ACCOUNTS) });
    vi.stubGlobal("fetch", mockFetch);

    await fetchAccounts({ ...BASE_CONFIG, url: "http://proxy.local/actual" });

    const [url] = firstCall(mockFetch, "/accounts");
    expect(url).toContain("http://proxy.local/actual/v1/budgets/");
  });

  it("always requests include_balances=true", async () => {
    const mockFetch = makeFetchMock({ "/accounts": makeJsonResponse(MOCK_ACCOUNTS) });
    vi.stubGlobal("fetch", mockFetch);

    await fetchAccounts(BASE_CONFIG);

    const [url] = firstCall(mockFetch, "/accounts");
    expect(url).toContain("include_balances=true");
  });

  it("sends exclude_closed and exclude_offbudget only when enabled", async () => {
    const mockFetch = makeFetchMock({ "/accounts": makeJsonResponse(MOCK_ACCOUNTS) });
    vi.stubGlobal("fetch", mockFetch);

    await fetchAccounts({
      ...BASE_CONFIG,
      exclude_closed: true,
      exclude_offbudget: true,
    });

    const [withFilters] = firstCall(mockFetch, "/accounts");
    expect(withFilters).toContain("exclude_closed=true");
    expect(withFilters).toContain("exclude_offbudget=true");

    mockFetch.mockClear();
    await fetchAccounts({
      ...BASE_CONFIG,
      exclude_closed: false,
      exclude_offbudget: false,
    });

    const [withoutFilters] = firstCall(mockFetch, "/accounts");
    expect(withoutFilters).not.toContain("exclude_closed");
    expect(withoutFilters).not.toContain("exclude_offbudget");
  });

  it("sends the x-api-key header", async () => {
    const mockFetch = makeFetchMock({ "/accounts": makeJsonResponse(MOCK_ACCOUNTS) });
    vi.stubGlobal("fetch", mockFetch);

    await fetchAccounts(BASE_CONFIG);

    const [, options] = firstCall(mockFetch, "/accounts");
    expect(headersOf(options)["x-api-key"]).toBe(API_KEY);
  });

  it("omits budget-encryption-password when no encryption password is configured", async () => {
    const mockFetch = makeFetchMock({ "/accounts": makeJsonResponse(MOCK_ACCOUNTS) });
    vi.stubGlobal("fetch", mockFetch);

    await fetchAccounts(BASE_CONFIG);

    const [, options] = firstCall(mockFetch, "/accounts");
    expect(headersOf(options)["budget-encryption-password"]).toBeUndefined();
  });

  it("sends budget-encryption-password when configured", async () => {
    const mockFetch = makeFetchMock({ "/accounts": makeJsonResponse(MOCK_ACCOUNTS) });
    vi.stubGlobal("fetch", mockFetch);

    await fetchAccounts({
      ...BASE_CONFIG,
      encryption_password: ENCRYPTION_PASSWORD,
    });

    const [, options] = firstCall(mockFetch, "/accounts");
    expect(headersOf(options)["budget-encryption-password"]).toBe(
      ENCRYPTION_PASSWORD
    );
  });

  it("forwards the AbortSignal instead of creating its own timeout", async () => {
    const mockFetch = makeFetchMock({
      "/months/": makeJsonResponse(MOCK_MONTH),
      "/accounts": makeJsonResponse(MOCK_ACCOUNTS),
    });
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchSummary(BASE_CONFIG, controller.signal);

    const [, monthOptions] = firstCall(mockFetch, "/months/");
    expect(monthOptions).toMatchObject({ signal: controller.signal });
    const [, accountsOptions] = firstCall(mockFetch, "/accounts");
    expect(accountsOptions).toMatchObject({ signal: controller.signal });
  });
});

// ---------------------------------------------------------------------------
// Envelope and error handling
// ---------------------------------------------------------------------------

describe("actual-http-api response handling", () => {
  it("unwraps the {data: …} success envelope", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ "/accounts": makeJsonResponse(MOCK_ACCOUNTS) })
    );

    const accounts = await fetchAccounts(BASE_CONFIG);

    expect(accounts).toHaveLength(2);
    expect(accounts[0].id).toBe("acc-1");
  });

  it("throws when the success envelope has no data key", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ "/accounts": makeRawResponse(MOCK_ACCOUNTS) })
    );

    await expect(fetchAccounts(BASE_CONFIG)).rejects.toThrow(
      /unexpected response/i
    );
  });

  it("keeps unknown upstream fields from breaking parsing", async () => {
    const withNewFields = [
      {
        ...MOCK_ACCOUNTS[0],
        someFutureSidecarField: { nested: true },
        anotherOne: 42,
      },
    ];
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ "/accounts": makeJsonResponse(withNewFields) })
    );

    const accounts = await fetchAccounts(BASE_CONFIG);

    expect(accounts[0].balance).toBe(210412);
  });

  it("surfaces the {error: …} message on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/accounts": makeErrorResponse(404, { error: "Budget not found" }),
      })
    );

    await expect(fetchAccounts(BASE_CONFIG)).rejects.toThrow(
      "Actual Budget responded with 404: Budget not found"
    );
  });

  it("reports 403 Forbidden from a bad or missing API key", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ "/accounts": makeErrorResponse(403, { error: "Forbidden" }) })
    );

    await expect(fetchAccounts(BASE_CONFIG)).rejects.toThrow(
      "Actual Budget responded with 403: Forbidden"
    );
  });

  it("falls back to a status-only message when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ "/accounts": makeErrorResponse(502) })
    );

    await expect(fetchAccounts(BASE_CONFIG)).rejects.toThrow(
      "Actual Budget responded with 502"
    );
  });

  it("never leaks the API key or encryption password into a thrown message", async () => {
    const config = {
      ...BASE_CONFIG,
      encryption_password: ENCRYPTION_PASSWORD,
    };

    for (const response of [
      makeErrorResponse(403, { error: "Forbidden" }),
      makeErrorResponse(500, { error: "upstream exploded" }),
      makeErrorResponse(400),
      makeRawResponse({ nope: true }),
    ]) {
      vi.stubGlobal("fetch", makeFetchMock({ "/accounts": response }));

      const error = await fetchAccounts(config).then(
        () => null,
        (e: unknown) => e as Error
      );

      expect(error).toBeInstanceOf(Error);
      const text = `${error?.message} ${error?.stack ?? ""}`;
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain(ENCRYPTION_PASSWORD);
      expect(text).not.toContain("x-api-key");
    }
  });
});

// ---------------------------------------------------------------------------
// fetchAccounts
// ---------------------------------------------------------------------------

describe("fetchAccounts", () => {
  it("normalizes accounts to the widget-facing shape", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ "/accounts": makeJsonResponse(MOCK_ACCOUNTS) })
    );

    const accounts = await fetchAccounts(BASE_CONFIG);

    expect(accounts).toEqual([
      {
        id: "acc-1",
        name: "Current",
        offbudget: false,
        closed: false,
        balance: 210412,
      },
      {
        id: "acc-2",
        name: "Savings",
        offbudget: true,
        closed: false,
        balance: 5000000,
      },
    ]);
  });

  it("falls back from workingBalance to clearedBalance and then to 0", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/accounts": makeJsonResponse([
          { id: "a", name: "Cleared only", clearedBalance: 1234 },
          { id: "b", name: "No balances at all" },
        ]),
      })
    );

    const accounts = await fetchAccounts(BASE_CONFIG);

    expect(accounts[0].balance).toBe(1234);
    expect(accounts[1].balance).toBe(0);
  });

  it("coerces 0/1 integer flags to booleans", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/accounts": makeJsonResponse([
          { id: "a", name: "Legacy", offbudget: 1, closed: 0, workingBalance: 10 },
        ]),
      })
    );

    const accounts = await fetchAccounts(BASE_CONFIG);

    expect(accounts[0].offbudget).toBe(true);
    expect(accounts[0].closed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchBudgetMonth
// ---------------------------------------------------------------------------

describe("fetchBudgetMonth", () => {
  it("requests the given month", async () => {
    const mockFetch = makeFetchMock({ "/months/": makeJsonResponse(MOCK_MONTH) });
    vi.stubGlobal("fetch", mockFetch);

    await fetchBudgetMonth(BASE_CONFIG, "2026-07");

    const [url] = firstCall(mockFetch, "/months/");
    expect(url).toContain("/v1/budgets/b1e2c3d4-sync/months/2026-07");
  });

  it("returns the month totals unchanged, keeping totalSpent negative", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ "/months/": makeJsonResponse(MOCK_MONTH) })
    );

    const month = await fetchBudgetMonth(BASE_CONFIG, "2026-07");

    expect(month.month).toBe("2026-07");
    expect(month.toBudget).toBe(41200);
    expect(month.totalBudgeted).toBe(120000);
    expect(month.totalIncome).toBe(500000);
    expect(month.totalBalance).toBe(26600);
    expect(month.totalSpent).toBe(-93400);
    expect(month.totalSpent).toBeLessThan(0);
  });

  it("flattens categories out of categoryGroups with the group name attached", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ "/months/": makeJsonResponse(MOCK_MONTH) })
    );

    const month = await fetchBudgetMonth(BASE_CONFIG, "2026-07");

    expect(month.categories.map((c) => c.id)).toEqual(["cat-1", "cat-2", "cat-3"]);
    expect(month.categories[0]).toEqual({
      id: "cat-1",
      name: "Groceries",
      groupName: "Everyday",
      isIncome: false,
      hidden: false,
      budgeted: 40000,
      spent: -31200,
      balance: 8800,
      carryover: false,
    });
  });

  it("keeps category spent negative and marks overspend by a negative balance", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ "/months/": makeJsonResponse(MOCK_MONTH) })
    );

    const month = await fetchBudgetMonth(BASE_CONFIG, "2026-07");
    const dining = month.categories.find((c) => c.id === "cat-2")!;

    expect(dining.spent).toBe(-62200);
    expect(dining.balance).toBeLessThan(0);
    // The naive "spent > budgeted" test would be false here even though the
    // category is overspent — balance is the only correct signal.
    expect(dining.spent > dining.budgeted).toBe(false);
  });

  it("reads `received` for income categories that carry no `spent`", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ "/months/": makeJsonResponse(MOCK_MONTH) })
    );

    const month = await fetchBudgetMonth(BASE_CONFIG, "2026-07");
    const salary = month.categories.find((c) => c.id === "cat-3")!;

    expect(salary.isIncome).toBe(true);
    expect(salary.spent).toBe(500000);
    expect(Number.isNaN(salary.spent)).toBe(false);
  });

  it("inherits is_income and hidden from the parent group", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/months/": makeJsonResponse({
          month: "2026-07",
          categoryGroups: [
            {
              id: "g",
              name: "Hidden group",
              is_income: 1,
              hidden: 1,
              categories: [
                { id: "c", name: "Child", is_income: false, hidden: false },
              ],
            },
          ],
        }),
      })
    );

    const month = await fetchBudgetMonth(BASE_CONFIG, "2026-07");

    expect(month.categories[0].isIncome).toBe(true);
    expect(month.categories[0].hidden).toBe(true);
  });

  it("defaults missing amounts to 0 rather than NaN", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/months/": makeJsonResponse({
          month: "2026-07",
          categoryGroups: [
            { id: "g", name: "G", categories: [{ id: "c", name: "C" }] },
          ],
        }),
      })
    );

    const month = await fetchBudgetMonth(BASE_CONFIG, "2026-07");

    expect(month.toBudget).toBe(0);
    expect(month.totalSpent).toBe(0);
    expect(month.categories[0]).toMatchObject({
      budgeted: 0,
      spent: 0,
      balance: 0,
      carryover: false,
    });
  });

  it("tolerates a month with no category groups", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ "/months/": makeJsonResponse({ month: "2026-07" }) })
    );

    const month = await fetchBudgetMonth(BASE_CONFIG, "2026-07");

    expect(month.categories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// currentMonth (local time, not UTC)
// ---------------------------------------------------------------------------

describe("currentMonth", () => {
  it("formats the injected date as local-time YYYY-MM", () => {
    expect(currentMonth(new Date(2026, 6, 15, 12, 0))).toBe("2026-07");
  });

  it("zero-pads single-digit months", () => {
    expect(currentMonth(new Date(2026, 0, 1, 12, 0))).toBe("2026-01");
  });

  it("uses the local month, not the UTC month, east of UTC", () => {
    withTimeZone("Pacific/Kiritimati", () => {
      // Local 2026-08-01T00:30 is still 2026-07-31T10:30Z — toISOString()
      // would report July for a date that is locally already August.
      const localAugust = new Date(2026, 7, 1, 0, 30);
      expect(localAugust.toISOString().slice(0, 7)).toBe("2026-07");
      expect(currentMonth(localAugust)).toBe("2026-08");
    });
  });

  it("uses the local month, not the UTC month, west of UTC", () => {
    withTimeZone("Pacific/Midway", () => {
      // Local 2026-07-31T23:30 is already 2026-08-01T10:30Z.
      const localJuly = new Date(2026, 6, 31, 23, 30);
      expect(localJuly.toISOString().slice(0, 7)).toBe("2026-08");
      expect(currentMonth(localJuly)).toBe("2026-07");
    });
  });

  it("defaults to now when no date is injected", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    expect(currentMonth()).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// currentMonth with an explicit `timezone` config field
// ---------------------------------------------------------------------------

describe("currentMonth with an explicit IANA time zone", () => {
  it("resolves a boundary instant to a different month in Europe/Warsaw than in UTC", () => {
    withTimeZone("UTC", () => {
      // 2026-07-31T23:30:00Z is still July in UTC but already 2026-08-01T01:30
      // local in Warsaw (UTC+2 in summer) — already August there.
      const instant = new Date("2026-07-31T23:30:00Z");
      expect(currentMonth(instant)).toBe("2026-07");
      expect(currentMonth(instant, "Europe/Warsaw")).toBe("2026-08");
    });
  });

  it("falls back to local time when the time zone string is invalid, instead of throwing", () => {
    withTimeZone("UTC", () => {
      // Intl.DateTimeFormat throws RangeError for an unknown IANA name; that
      // must not take down the widget over a typo'd config field.
      const instant = new Date("2026-07-31T23:30:00Z");
      expect(() => currentMonth(instant, "Not/AZone")).not.toThrow();
      expect(currentMonth(instant, "Not/AZone")).toBe("2026-07");
    });
  });
});

// ---------------------------------------------------------------------------
// fetchSummary
// ---------------------------------------------------------------------------

describe("fetchSummary", () => {
  it("returns the current month plus accounts and a summed net worth", async () => {
    const mockFetch = makeFetchMock({
      "/months/": makeJsonResponse(MOCK_MONTH),
      "/accounts": makeJsonResponse(MOCK_ACCOUNTS),
    });
    vi.stubGlobal("fetch", mockFetch);

    const summary = await fetchSummary(BASE_CONFIG);

    expect(summary.month.toBudget).toBe(41200);
    expect(summary.accounts).toHaveLength(2);
    expect(summary.netWorth).toBe(210412 + 5000000);
  });

  it("requests the current local month", async () => {
    const mockFetch = makeFetchMock({
      "/months/": makeJsonResponse(MOCK_MONTH),
      "/accounts": makeJsonResponse(MOCK_ACCOUNTS),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchSummary(BASE_CONFIG);

    const [url] = firstCall(mockFetch, "/months/");
    expect(url).toContain(`/months/${currentMonth()}`);
  });

  it("excludes closed accounts from the net-worth call", async () => {
    const mockFetch = makeFetchMock({
      "/months/": makeJsonResponse(MOCK_MONTH),
      "/accounts": makeJsonResponse(MOCK_ACCOUNTS),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchSummary(BASE_CONFIG);

    const [url] = firstCall(mockFetch, "/accounts");
    expect(url).toContain("exclude_closed=true");
  });

  it("degrades to a null net worth when the accounts call fails", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/months/": makeJsonResponse(MOCK_MONTH),
        "/accounts": makeErrorResponse(500, { error: "boom" }),
      })
    );

    const summary = await fetchSummary(BASE_CONFIG);

    expect(summary.accounts).toBeNull();
    expect(summary.netWorth).toBeNull();
    // The month data is untouched by the accounts failure.
    expect(summary.month.toBudget).toBe(41200);
  });

  it("degrades to a null net worth when the accounts request rejects", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/months/": makeJsonResponse(MOCK_MONTH),
        "/accounts": new Error("network error"),
      })
    );

    const summary = await fetchSummary(BASE_CONFIG);

    expect(summary.accounts).toBeNull();
    expect(summary.netWorth).toBeNull();
    expect(summary.month.categories).toHaveLength(3);
  });

  it("rejects when the required month call fails", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/months/": makeErrorResponse(500, { error: "Budget sync failed" }),
        "/accounts": makeJsonResponse(MOCK_ACCOUNTS),
      })
    );

    await expect(fetchSummary(BASE_CONFIG)).rejects.toThrow(
      "Actual Budget responded with 500: Budget sync failed"
    );
  });

  it("requests the config.timezone month, not the host-local month, at a boundary instant", async () => {
    // At this instant, UTC (and this test runner, whatever its host TZ) would
    // resolve to July, but Europe/Warsaw is already in August — proving
    // config.timezone, not the container's local time, drives which month is
    // requested.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T23:30:00Z"));
    const mockFetch = makeFetchMock({
      "/months/": makeJsonResponse(MOCK_MONTH),
      "/accounts": makeJsonResponse(MOCK_ACCOUNTS),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchSummary({ ...BASE_CONFIG, timezone: "Europe/Warsaw" });

    const [url] = firstCall(mockFetch, "/months/");
    expect(url).toContain("/months/2026-08");
  });
});

// ---------------------------------------------------------------------------
// fetchSchedules
// ---------------------------------------------------------------------------

describe("fetchSchedules", () => {
  const SCHEDULES_CONFIG = { ...BASE_CONFIG, limit: 6, days_ahead: 30 };

  function stubClock(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  it("returns upcoming schedules sorted ascending by next_date", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse(MOCK_SCHEDULES),
        "/payees": makeJsonResponse(MOCK_PAYEES),
      })
    );

    const schedules = await fetchSchedules(SCHEDULES_CONFIG);

    expect(schedules.map((s) => s.id)).toEqual(["sch-2", "sch-1"]);
    expect(schedules[0].nextDate).toBe("2026-07-28");
  });

  it("resolves payee names via the payees endpoint", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse(MOCK_SCHEDULES),
        "/payees": makeJsonResponse(MOCK_PAYEES),
      })
    );

    const schedules = await fetchSchedules(SCHEDULES_CONFIG);

    expect(schedules.find((s) => s.id === "sch-1")?.payeeName).toBe("Big Bank");
    expect(schedules.find((s) => s.id === "sch-2")?.payeeName).toBe("Power Co");
  });

  it("falls back to the schedule name, then an em dash, when the payee is unknown", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse([
          {
            id: "s1",
            name: "Named schedule",
            next_date: "2026-07-27",
            completed: false,
            payee: "unknown-payee",
            amount: -100,
            amountOp: "is",
          },
          {
            id: "s2",
            name: null,
            next_date: "2026-07-28",
            completed: false,
            payee: null,
            amount: -100,
            amountOp: "is",
          },
        ]),
        "/payees": makeJsonResponse(MOCK_PAYEES),
      })
    );

    const schedules = await fetchSchedules(SCHEDULES_CONFIG);

    expect(schedules[0].payeeName).toBe("Named schedule");
    expect(schedules[1].payeeName).toBe("—");
  });

  it("still returns schedules when the best-effort payees call fails", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse(MOCK_SCHEDULES),
        "/payees": makeErrorResponse(500, { error: "boom" }),
      })
    );

    const schedules = await fetchSchedules(SCHEDULES_CONFIG);

    expect(schedules).toHaveLength(2);
    expect(schedules.find((s) => s.id === "sch-1")?.payeeName).toBe("Mortgage");
  });

  it("still returns schedules when the payees request rejects", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse(MOCK_SCHEDULES),
        "/payees": new Error("network error"),
      })
    );

    const schedules = await fetchSchedules(SCHEDULES_CONFIG);

    expect(schedules).toHaveLength(2);
    expect(schedules[0].payeeName).toBe("Electricity");
  });

  it("rejects when the required schedules call fails", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeErrorResponse(403, { error: "Forbidden" }),
        "/payees": makeJsonResponse(MOCK_PAYEES),
      })
    );

    await expect(fetchSchedules(SCHEDULES_CONFIG)).rejects.toThrow(
      "Actual Budget responded with 403: Forbidden"
    );
  });

  it("drops completed schedules", async () => {
    stubClock("2026-07-19T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse(MOCK_SCHEDULES),
        "/payees": makeJsonResponse(MOCK_PAYEES),
      })
    );

    const schedules = await fetchSchedules(SCHEDULES_CONFIG);

    expect(schedules.map((s) => s.id)).not.toContain("sch-3");
  });

  it("drops schedules beyond days_ahead but keeps overdue ones", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse([
          {
            id: "overdue",
            name: "Overdue",
            next_date: "2026-07-20",
            completed: false,
            amount: -100,
          },
          {
            id: "soon",
            name: "Soon",
            next_date: "2026-07-30",
            completed: false,
            amount: -100,
          },
          {
            id: "far",
            name: "Far away",
            next_date: "2026-10-01",
            completed: false,
            amount: -100,
          },
        ]),
        "/payees": makeJsonResponse([]),
      })
    );

    const schedules = await fetchSchedules({ ...SCHEDULES_CONFIG, days_ahead: 30 });

    expect(schedules.map((s) => s.id)).toEqual(["overdue", "soon"]);
    expect(schedules[0].daysUntil).toBe(-6);
    expect(schedules[1].daysUntil).toBe(4);
  });

  it("does not truncate to limit — truncation for display is the widget's job, not the data layer's", async () => {
    // This behaviour moved: fetchSchedules used to slice(0, config.limit),
    // which meant a widget computing "due within 7 days" from this array
    // under-reported whenever more than `limit` schedules qualified. The
    // limit is now applied by the widget's fetchData wrapper after it has
    // counted from the full list (see ActualBudgetSchedulesWidget tests and
    // the "actualbudget-schedules fetchData wrapper" describe block below).
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse(
          Array.from({ length: 10 }, (_, i) => ({
            id: `s${i}`,
            name: `Schedule ${i}`,
            next_date: `2026-08-${String(i + 1).padStart(2, "0")}`,
            completed: false,
            amount: -100,
          }))
        ),
        "/payees": makeJsonResponse([]),
      })
    );

    const schedules = await fetchSchedules({ ...SCHEDULES_CONFIG, limit: 3 });

    expect(schedules.map((s) => s.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `s${i}`)
    );
  });

  it("collapses an isbetween amount to a midpoint and exposes the range", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse(MOCK_SCHEDULES),
        "/payees": makeJsonResponse(MOCK_PAYEES),
      })
    );

    const schedules = await fetchSchedules(SCHEDULES_CONFIG);
    const electricity = schedules.find((s) => s.id === "sch-2")!;

    expect(electricity.amountOp).toBe("isbetween");
    expect(electricity.amount).toBe(-8000);
    expect(Number.isNaN(electricity.amount)).toBe(false);
    expect(electricity.amountMin).toBe(-9000);
    expect(electricity.amountMax).toBe(-7000);
  });

  it("leaves amountMin and amountMax null for a plain numeric amount", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse(MOCK_SCHEDULES),
        "/payees": makeJsonResponse(MOCK_PAYEES),
      })
    );

    const schedules = await fetchSchedules(SCHEDULES_CONFIG);
    const mortgage = schedules.find((s) => s.id === "sch-1")!;

    expect(mortgage.amount).toBe(-124000);
    expect(mortgage.amountMin).toBeNull();
    expect(mortgage.amountMax).toBeNull();
  });

  it("never produces NaN for a missing or malformed amount", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse([
          { id: "a", name: "No amount", next_date: "2026-07-27", completed: false },
          {
            id: "b",
            name: "Null amount",
            next_date: "2026-07-28",
            completed: false,
            amount: null,
          },
        ]),
        "/payees": makeJsonResponse([]),
      })
    );

    const schedules = await fetchSchedules(SCHEDULES_CONFIG);

    for (const schedule of schedules) {
      expect(Number.isNaN(schedule.amount)).toBe(false);
      expect(schedule.amount).toBe(0);
    }
  });

  it("ignores schedules with no next_date", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse([
          { id: "a", name: "No date", next_date: null, completed: false, amount: -1 },
          {
            id: "b",
            name: "Dated",
            next_date: "2026-07-27",
            completed: false,
            amount: -1,
          },
        ]),
        "/payees": makeJsonResponse([]),
      })
    );

    const schedules = await fetchSchedules(SCHEDULES_CONFIG);

    expect(schedules.map((s) => s.id)).toEqual(["b"]);
  });

  it("does not decode the recurrence config on the date field", async () => {
    stubClock("2026-07-26T12:00:00");
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse([
          {
            id: "a",
            name: "Recurring",
            next_date: "2026-07-27",
            completed: false,
            amount: -1,
            date: { frequency: "monthly", interval: 1, patterns: [{ type: "day" }] },
          },
        ]),
        "/payees": makeJsonResponse([]),
      })
    );

    const schedules = await fetchSchedules(SCHEDULES_CONFIG);

    expect(schedules).toHaveLength(1);
    expect(schedules[0].nextDate).toBe("2026-07-27");
  });

  it("resolves daysUntil in config.timezone, not host-local time, at a boundary instant", async () => {
    // At this instant a schedule due 2026-08-01 is still a day away in UTC,
    // but Europe/Warsaw is already past midnight into 2026-08-01 — so the
    // same schedule is due "today" there. Proves config.timezone reaches
    // daysUntil rather than being dropped on the way from fetchSchedules.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T23:30:00Z"));
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        "/schedules": makeJsonResponse([
          {
            id: "s1",
            name: "Rent",
            next_date: "2026-08-01",
            completed: false,
            amount: -100,
          },
        ]),
        "/payees": makeJsonResponse([]),
      })
    );

    const schedules = await fetchSchedules({
      ...SCHEDULES_CONFIG,
      timezone: "Europe/Warsaw",
    });

    expect(schedules[0].daysUntil).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// format.ts
// ---------------------------------------------------------------------------

describe("centsToUnits", () => {
  it("converts integer minor units to major units", () => {
    expect(centsToUnits(12030)).toBe(120.3);
    expect(centsToUnits(-31200)).toBe(-312);
    expect(centsToUnits(0)).toBe(0);
  });
});

describe("formatMoney", () => {
  it("formats cents as a currency amount", () => {
    expect(formatMoney(12030, "USD", "en-US")).toBe("$120.30");
  });

  it("formats a negative amount", () => {
    expect(formatMoney(-31200, "USD", "en-US")).toBe("-$312.00");
  });

  it("honours the configured currency", () => {
    expect(formatMoney(12030, "EUR", "en-US")).toBe("€120.30");
  });

  it("falls back to a plain number when the currency code is invalid", () => {
    const result = formatMoney(12030, "NOTACURRENCY", "en-US");
    expect(result).toContain("120.30");
    expect(result).not.toContain("NOTACURRENCY");
  });

  it("falls back to a plain number when the locale tag is invalid", () => {
    const result = formatMoney(12030, "USD", "not a locale");
    expect(result).toContain("120.30");
  });

  it("works with no locale supplied", () => {
    expect(formatMoney(12030, "USD")).toContain("120.30");
  });
});

describe("daysUntil", () => {
  it("returns 0 for today", () => {
    expect(daysUntil("2026-07-26", new Date(2026, 6, 26, 9, 0))).toBe(0);
  });

  it("returns a positive count for a future date", () => {
    expect(daysUntil("2026-08-01", new Date(2026, 6, 26, 23, 59))).toBe(6);
  });

  it("returns a negative count for an overdue date", () => {
    expect(daysUntil("2026-07-20", new Date(2026, 6, 26, 0, 1))).toBe(-6);
  });

  it("treats the ISO date as local, not UTC", () => {
    withTimeZone("Pacific/Midway", () => {
      // new Date("2026-08-01") is UTC midnight, which is 2026-07-31 locally
      // here — a naive implementation would report 5 days instead of 6.
      expect(daysUntil("2026-08-01", new Date(2026, 6, 26, 12, 0))).toBe(6);
    });
  });

  it("survives a DST transition without an off-by-one", () => {
    withTimeZone("America/New_York", () => {
      // 2026-03-08 is the US spring-forward day (a 23-hour local day).
      expect(daysUntil("2026-03-09", new Date(2026, 2, 7, 12, 0))).toBe(2);
    });
  });

  it("returns 0 rather than NaN for an unparseable date", () => {
    expect(daysUntil("not-a-date", new Date(2026, 6, 26))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// daysUntil with an explicit `timezone` config field
// ---------------------------------------------------------------------------

describe("daysUntil with an explicit IANA time zone", () => {
  it("resolves a boundary instant to a different day-count in Europe/Warsaw than in UTC", () => {
    withTimeZone("UTC", () => {
      // 2026-07-31T23:30:00Z is still 2026-07-31 in UTC (a schedule due
      // 2026-08-01 is a day away) but already 2026-08-01T01:30 local in
      // Warsaw, where the same schedule is due "today".
      const instant = new Date("2026-07-31T23:30:00Z");
      expect(daysUntil("2026-08-01", instant)).toBe(1);
      expect(daysUntil("2026-08-01", instant, "Europe/Warsaw")).toBe(0);
    });
  });

  it("falls back to local time when the time zone string is invalid, instead of throwing", () => {
    withTimeZone("UTC", () => {
      const instant = new Date("2026-07-31T23:30:00Z");
      expect(() => daysUntil("2026-08-01", instant, "Not/AZone")).not.toThrow();
      expect(daysUntil("2026-08-01", instant, "Not/AZone")).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Config schemas
// ---------------------------------------------------------------------------

describe("actualbudget config schemas", () => {
  const MINIMAL = {
    url: "http://actual-http-api:5007",
    api_key: "key",
    budget_sync_id: "sync-id",
  };

  it("accepts a minimal config and applies the shared defaults", () => {
    const result = ActualSummaryConfigSchema.safeParse(MINIMAL);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      currency: "USD",
      privacy_mode: true,
    });
  });

  it("rejects a missing or invalid url", () => {
    expect(
      ActualSummaryConfigSchema.safeParse({ ...MINIMAL, url: undefined }).success
    ).toBe(false);
    expect(
      ActualSummaryConfigSchema.safeParse({ ...MINIMAL, url: "not-a-url" }).success
    ).toBe(false);
  });

  it("rejects a missing api_key or budget_sync_id", () => {
    expect(
      ActualSummaryConfigSchema.safeParse({ ...MINIMAL, api_key: "" }).success
    ).toBe(false);
    expect(
      ActualSummaryConfigSchema.safeParse({ ...MINIMAL, budget_sync_id: "" })
        .success
    ).toBe(false);
  });

  it("rejects a currency code that is not three characters", () => {
    expect(
      ActualSummaryConfigSchema.safeParse({ ...MINIMAL, currency: "US" }).success
    ).toBe(false);
  });

  it("accepts an optional timezone (IANA name), leaving it undefined by default", () => {
    const withoutTz = ActualSummaryConfigSchema.safeParse(MINIMAL);
    expect(withoutTz.success).toBe(true);
    expect(withoutTz.data?.timezone).toBeUndefined();

    const withTz = ActualSummaryConfigSchema.safeParse({
      ...MINIMAL,
      timezone: "Europe/Warsaw",
    });
    expect(withTz.success).toBe(true);
    expect(withTz.data?.timezone).toBe("Europe/Warsaw");
  });

  it("accepts an optional encryption password and locale", () => {
    const result = ActualSummaryConfigSchema.safeParse({
      ...MINIMAL,
      encryption_password: "hunter2",
      locale: "de-DE",
    });
    expect(result.success).toBe(true);
    expect(result.data?.encryption_password).toBe("hunter2");
    expect(result.data?.locale).toBe("de-DE");
  });

  it("applies the categories widget defaults", () => {
    const result = ActualCategoriesConfigSchema.safeParse(MINIMAL);
    expect(result.data).toMatchObject({
      limit: 8,
      hide_income: true,
      hide_empty: true,
    });
  });

  it("applies the accounts widget defaults", () => {
    const result = ActualAccountsConfigSchema.safeParse(MINIMAL);
    expect(result.data).toMatchObject({
      exclude_closed: true,
      exclude_offbudget: false,
    });
  });

  it("applies the schedules widget defaults", () => {
    const result = ActualSchedulesConfigSchema.safeParse(MINIMAL);
    expect(result.data).toMatchObject({ limit: 6, days_ahead: 30 });
  });

  it("coerces numeric options supplied as YAML strings", () => {
    const result = ActualCategoriesConfigSchema.safeParse({
      ...MINIMAL,
      limit: "12",
    });
    expect(result.success).toBe(true);
    expect(result.data?.limit).toBe(12);
  });

  it("rejects a non-positive limit", () => {
    expect(
      ActualCategoriesConfigSchema.safeParse({ ...MINIMAL, limit: 0 }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Widget registration
// ---------------------------------------------------------------------------

const EXPECTED_PRESET = {
  defaultName: "Actual Budget",
  defaultIconUrl:
    "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/actual-budget.svg",
};

/** Minimal config every Actual Budget schema accepts, for default probing. */
const MINIMAL_CONFIG = {
  url: "http://actual-http-api:5007",
  api_key: "key",
  budget_sync_id: "sync-id",
};

async function loadWidget(importWidget: () => Promise<unknown>, id: string) {
  await importWidget();
  const { getWidget } = await import("@/widgets");
  const def = getWidget(id);
  if (!def) throw new Error(`widget "${id}" did not register`);
  return def;
}

function fieldByKey(
  def: { configFields?: Array<{ key: string }> },
  key: string
) {
  return def.configFields?.find((f) => f.key === key);
}

/**
 * The contract behind `WidgetConfigField.defaultValue`: the checkbox shown for
 * an absent key must match what the schema actually does, or the settings UI
 * misreports live behaviour and a double toggle flips the real setting.
 */
function expectBooleanFieldDefaultsMatchSchema(def: {
  configFields?: Array<{ key: string; type: string; defaultValue?: boolean }>;
  configSchema: { parse: (v: unknown) => unknown };
}) {
  const parsed = def.configSchema.parse(MINIMAL_CONFIG) as Record<string, unknown>;
  const booleanFields = (def.configFields ?? []).filter((f) => f.type === "boolean");
  expect(booleanFields.length).toBeGreaterThan(0);
  for (const field of booleanFields) {
    expect(typeof field.defaultValue).toBe("boolean");
    expect({ [field.key]: field.defaultValue }).toEqual({
      [field.key]: parsed[field.key],
    });
  }
}

describe("actualbudget widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  describe("actualbudget-summary", () => {
    it("registers a widget with id 'actualbudget-summary' on import", async () => {
      await import("@/integrations/actualbudget/summaryWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-summary")).toBeDefined();
    });

    it("widget name is 'Actual Budget Summary'", async () => {
      await import("@/integrations/actualbudget/summaryWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-summary")?.name).toBe("Actual Budget Summary");
    });

    it("refreshInterval is 300000", async () => {
      await import("@/integrations/actualbudget/summaryWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-summary")?.refreshInterval).toBe(300_000);
    });

    it("fetchTimeoutMs is 15000", async () => {
      await import("@/integrations/actualbudget/summaryWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-summary")?.fetchTimeoutMs).toBe(15_000);
    });

    it("preferredSize is 'normal'", async () => {
      await import("@/integrations/actualbudget/summaryWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-summary")?.preferredSize).toBe("normal");
    });

    it("serviceEditorPreset has the expected default name and icon", async () => {
      await import("@/integrations/actualbudget/summaryWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-summary")?.serviceEditorPreset).toEqual(
        EXPECTED_PRESET
      );
    });

    it("configSchema accepts a minimal valid config", async () => {
      await import("@/integrations/actualbudget/summaryWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-summary")!.configSchema.safeParse({
        url: "http://actual-http-api:5007",
        api_key: "key",
        budget_sync_id: "sync-id",
      });
      expect(result.success).toBe(true);
    });

    it("configSchema rejects a missing url", async () => {
      await import("@/integrations/actualbudget/summaryWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-summary")!.configSchema.safeParse({
        api_key: "key",
        budget_sync_id: "sync-id",
      });
      expect(result.success).toBe(false);
    });

    it("configSchema rejects an invalid url", async () => {
      await import("@/integrations/actualbudget/summaryWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-summary")!.configSchema.safeParse({
        url: "not-a-url",
        api_key: "key",
        budget_sync_id: "sync-id",
      });
      expect(result.success).toBe(false);
    });

    it("exposes privacy_mode as a boolean field defaulting to true", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/summaryWidget"),
        "actualbudget-summary"
      );
      expect(fieldByKey(def, "privacy_mode")).toMatchObject({
        type: "boolean",
        defaultValue: true,
      });
    });

    it("exposes timezone as an optional text field", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/summaryWidget"),
        "actualbudget-summary"
      );
      expect(fieldByKey(def, "timezone")).toMatchObject({
        type: "text",
        required: false,
      });
    });

    it("configSchema accepts an explicit timezone", async () => {
      await import("@/integrations/actualbudget/summaryWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-summary")!.configSchema.safeParse({
        ...MINIMAL_CONFIG,
        timezone: "Europe/Warsaw",
      });
      expect(result.success).toBe(true);
    });

    it("every boolean field's defaultValue matches the schema default", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/summaryWidget"),
        "actualbudget-summary"
      );
      expectBooleanFieldDefaultsMatchSchema(def);
    });
  });

  describe("actualbudget-categories", () => {
    it("registers a widget with id 'actualbudget-categories' on import", async () => {
      await import("@/integrations/actualbudget/categoriesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-categories")).toBeDefined();
    });

    it("widget name is 'Actual Budget Categories'", async () => {
      await import("@/integrations/actualbudget/categoriesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-categories")?.name).toBe(
        "Actual Budget Categories"
      );
    });

    it("refreshInterval is 300000", async () => {
      await import("@/integrations/actualbudget/categoriesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-categories")?.refreshInterval).toBe(300_000);
    });

    it("fetchTimeoutMs is 15000", async () => {
      await import("@/integrations/actualbudget/categoriesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-categories")?.fetchTimeoutMs).toBe(15_000);
    });

    it("preferredSize is 'tall'", async () => {
      await import("@/integrations/actualbudget/categoriesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-categories")?.preferredSize).toBe("tall");
    });

    it("serviceEditorPreset has the expected default name and icon", async () => {
      await import("@/integrations/actualbudget/categoriesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-categories")?.serviceEditorPreset).toEqual(
        EXPECTED_PRESET
      );
    });

    it("configSchema accepts a minimal valid config and applies category defaults", async () => {
      await import("@/integrations/actualbudget/categoriesWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-categories")!.configSchema.safeParse({
        url: "http://actual-http-api:5007",
        api_key: "key",
        budget_sync_id: "sync-id",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toMatchObject({
          limit: 8,
          hide_income: true,
          hide_empty: true,
        });
      }
    });

    it("configSchema rejects a missing url", async () => {
      await import("@/integrations/actualbudget/categoriesWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-categories")!.configSchema.safeParse({
        api_key: "key",
        budget_sync_id: "sync-id",
      });
      expect(result.success).toBe(false);
    });

    it("configSchema rejects a non-positive limit", async () => {
      await import("@/integrations/actualbudget/categoriesWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-categories")!.configSchema.safeParse({
        url: "http://actual-http-api:5007",
        api_key: "key",
        budget_sync_id: "sync-id",
        limit: 0,
      });
      expect(result.success).toBe(false);
    });

    it("exposes privacy_mode, hide_income and hide_empty as boolean fields", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/categoriesWidget"),
        "actualbudget-categories"
      );
      expect(fieldByKey(def, "privacy_mode")).toMatchObject({
        type: "boolean",
        defaultValue: true,
      });
      expect(fieldByKey(def, "hide_income")).toMatchObject({
        type: "boolean",
        defaultValue: true,
      });
      expect(fieldByKey(def, "hide_empty")).toMatchObject({
        type: "boolean",
        defaultValue: true,
      });
    });

    it("exposes timezone as an optional text field", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/categoriesWidget"),
        "actualbudget-categories"
      );
      expect(fieldByKey(def, "timezone")).toMatchObject({
        type: "text",
        required: false,
      });
    });

    it("configSchema accepts an explicit timezone", async () => {
      await import("@/integrations/actualbudget/categoriesWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-categories")!.configSchema.safeParse({
        ...MINIMAL_CONFIG,
        timezone: "Europe/Warsaw",
      });
      expect(result.success).toBe(true);
    });

    it("exposes limit as a number field", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/categoriesWidget"),
        "actualbudget-categories"
      );
      expect(fieldByKey(def, "limit")).toMatchObject({ type: "number" });
    });

    it("every boolean field's defaultValue matches the schema default", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/categoriesWidget"),
        "actualbudget-categories"
      );
      expectBooleanFieldDefaultsMatchSchema(def);
    });
  });

  describe("actualbudget-accounts", () => {
    it("registers a widget with id 'actualbudget-accounts' on import", async () => {
      await import("@/integrations/actualbudget/accountsWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-accounts")).toBeDefined();
    });

    it("widget name is 'Actual Budget Accounts'", async () => {
      await import("@/integrations/actualbudget/accountsWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-accounts")?.name).toBe("Actual Budget Accounts");
    });

    it("refreshInterval is 300000", async () => {
      await import("@/integrations/actualbudget/accountsWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-accounts")?.refreshInterval).toBe(300_000);
    });

    it("fetchTimeoutMs is 15000", async () => {
      await import("@/integrations/actualbudget/accountsWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-accounts")?.fetchTimeoutMs).toBe(15_000);
    });

    it("preferredSize is 'tall'", async () => {
      await import("@/integrations/actualbudget/accountsWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-accounts")?.preferredSize).toBe("tall");
    });

    it("serviceEditorPreset has the expected default name and icon", async () => {
      await import("@/integrations/actualbudget/accountsWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-accounts")?.serviceEditorPreset).toEqual(
        EXPECTED_PRESET
      );
    });

    it("configSchema accepts a minimal valid config and applies account defaults", async () => {
      await import("@/integrations/actualbudget/accountsWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-accounts")!.configSchema.safeParse({
        url: "http://actual-http-api:5007",
        api_key: "key",
        budget_sync_id: "sync-id",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toMatchObject({
          exclude_closed: true,
          exclude_offbudget: false,
        });
      }
    });

    it("configSchema rejects a missing api_key", async () => {
      await import("@/integrations/actualbudget/accountsWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-accounts")!.configSchema.safeParse({
        url: "http://actual-http-api:5007",
        api_key: "",
        budget_sync_id: "sync-id",
      });
      expect(result.success).toBe(false);
    });

    it("configSchema rejects an invalid url", async () => {
      await import("@/integrations/actualbudget/accountsWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-accounts")!.configSchema.safeParse({
        url: "not-a-url",
        api_key: "key",
        budget_sync_id: "sync-id",
      });
      expect(result.success).toBe(false);
    });

    it("exposes privacy_mode, exclude_closed and exclude_offbudget as boolean fields", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/accountsWidget"),
        "actualbudget-accounts"
      );
      expect(fieldByKey(def, "privacy_mode")).toMatchObject({
        type: "boolean",
        defaultValue: true,
      });
      expect(fieldByKey(def, "exclude_closed")).toMatchObject({
        type: "boolean",
        defaultValue: true,
      });
      // The one default-false option — a `defaultValue: true` copy-paste here
      // would render the box checked and misreport what the widget does.
      expect(fieldByKey(def, "exclude_offbudget")).toMatchObject({
        type: "boolean",
        defaultValue: false,
      });
    });

    it("exposes timezone as an optional text field", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/accountsWidget"),
        "actualbudget-accounts"
      );
      expect(fieldByKey(def, "timezone")).toMatchObject({
        type: "text",
        required: false,
      });
    });

    it("configSchema accepts an explicit timezone", async () => {
      await import("@/integrations/actualbudget/accountsWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-accounts")!.configSchema.safeParse({
        ...MINIMAL_CONFIG,
        timezone: "Europe/Warsaw",
      });
      expect(result.success).toBe(true);
    });

    it("every boolean field's defaultValue matches the schema default", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/accountsWidget"),
        "actualbudget-accounts"
      );
      expectBooleanFieldDefaultsMatchSchema(def);
    });
  });

  describe("actualbudget-schedules", () => {
    it("registers a widget with id 'actualbudget-schedules' on import", async () => {
      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-schedules")).toBeDefined();
    });

    it("widget name is 'Actual Budget Schedules'", async () => {
      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-schedules")?.name).toBe(
        "Actual Budget Schedules"
      );
    });

    it("refreshInterval is 300000", async () => {
      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-schedules")?.refreshInterval).toBe(300_000);
    });

    it("fetchTimeoutMs is 15000", async () => {
      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-schedules")?.fetchTimeoutMs).toBe(15_000);
    });

    it("preferredSize is 'tall'", async () => {
      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-schedules")?.preferredSize).toBe("tall");
    });

    it("serviceEditorPreset has the expected default name and icon", async () => {
      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      expect(getWidget("actualbudget-schedules")?.serviceEditorPreset).toEqual(
        EXPECTED_PRESET
      );
    });

    it("configSchema accepts a minimal valid config and applies schedule defaults", async () => {
      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-schedules")!.configSchema.safeParse({
        url: "http://actual-http-api:5007",
        api_key: "key",
        budget_sync_id: "sync-id",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toMatchObject({ limit: 6, days_ahead: 30 });
      }
    });

    it("configSchema rejects a missing budget_sync_id", async () => {
      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-schedules")!.configSchema.safeParse({
        url: "http://actual-http-api:5007",
        api_key: "key",
        budget_sync_id: "",
      });
      expect(result.success).toBe(false);
    });

    it("configSchema rejects an out-of-range days_ahead", async () => {
      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-schedules")!.configSchema.safeParse({
        url: "http://actual-http-api:5007",
        api_key: "key",
        budget_sync_id: "sync-id",
        days_ahead: 0,
      });
      expect(result.success).toBe(false);
    });

    it("exposes privacy_mode as a boolean field defaulting to true", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/schedulesWidget"),
        "actualbudget-schedules"
      );
      expect(fieldByKey(def, "privacy_mode")).toMatchObject({
        type: "boolean",
        defaultValue: true,
      });
    });

    it("exposes limit and days_ahead as number fields", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/schedulesWidget"),
        "actualbudget-schedules"
      );
      expect(fieldByKey(def, "limit")).toMatchObject({ type: "number" });
      expect(fieldByKey(def, "days_ahead")).toMatchObject({ type: "number" });
    });

    it("exposes timezone as an optional text field", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/schedulesWidget"),
        "actualbudget-schedules"
      );
      expect(fieldByKey(def, "timezone")).toMatchObject({
        type: "text",
        required: false,
      });
    });

    it("configSchema accepts an explicit timezone", async () => {
      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      const result = getWidget("actualbudget-schedules")!.configSchema.safeParse({
        ...MINIMAL_CONFIG,
        timezone: "Europe/Warsaw",
      });
      expect(result.success).toBe(true);
    });

    it("every boolean field's defaultValue matches the schema default", async () => {
      const def = await loadWidget(
        () => import("@/integrations/actualbudget/schedulesWidget"),
        "actualbudget-schedules"
      );
      expectBooleanFieldDefaultsMatchSchema(def);
    });
  });

  describe("actualbudget-schedules fetchData wrapper", () => {
    it("reports dueSoonCount from the full due-soon list, computed before truncating to limit for display", async () => {
      // Fix: fetchSchedules used to slice(0, config.limit) itself, and the
      // widget derived "due within 7 days" from that already-truncated
      // array — under-reporting whenever more than `limit` schedules were
      // due soon. fetchSchedules no longer truncates; this wrapper counts
      // from the full list first, then slices `schedules` for display.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-26T12:00:00"));
      vi.stubGlobal(
        "fetch",
        makeFetchMock({
          "/schedules": makeJsonResponse(
            Array.from({ length: 10 }, (_, i) => ({
              id: `s${i}`,
              name: `Schedule ${i}`,
              // Every schedule is 1 day out — all 10 are "due soon".
              next_date: "2026-07-27",
              completed: false,
              amount: -100,
            }))
          ),
          "/payees": makeJsonResponse([]),
        })
      );

      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      const widget = getWidget("actualbudget-schedules")!;

      const data = (await widget.fetchData({
        ...MINIMAL_CONFIG,
        currency: "USD",
        privacy_mode: true,
        limit: 3,
        days_ahead: 30,
      })) as { schedules: unknown[]; dueSoonCount: number };

      expect(data.schedules).toHaveLength(3);
      expect(data.dueSoonCount).toBe(10);
    });

    it("counts overdue schedules (negative daysUntil) in dueSoonCount rather than excluding them", async () => {
      // Fix: dueSoonCount used to filter `daysUntil >= 0 && daysUntil <= 7`,
      // so a tile listing only overdue bills reported 0 under a "due soon"
      // label — an overdue bill is still due, more urgently, not less. The
      // lower bound is gone; only the `daysUntil <= 7` upper bound remains.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-26T12:00:00"));
      vi.stubGlobal(
        "fetch",
        makeFetchMock({
          "/schedules": makeJsonResponse([
            { id: "overdue-1", name: "Overdue 1", next_date: "2026-07-19", completed: false, amount: -100 },
            { id: "overdue-2", name: "Overdue 2", next_date: "2026-07-23", completed: false, amount: -100 },
            { id: "today", name: "Today", next_date: "2026-07-26", completed: false, amount: -100 },
            { id: "soon", name: "Soon", next_date: "2026-07-30", completed: false, amount: -100 },
            { id: "far", name: "Far", next_date: "2026-08-15", completed: false, amount: -100 },
          ]),
          "/payees": makeJsonResponse([]),
        })
      );

      await import("@/integrations/actualbudget/schedulesWidget");
      const { getWidget } = await import("@/widgets");
      const widget = getWidget("actualbudget-schedules")!;

      const data = (await widget.fetchData({
        ...MINIMAL_CONFIG,
        currency: "USD",
        privacy_mode: true,
        limit: 6,
        days_ahead: 30,
      })) as { schedules: unknown[]; dueSoonCount: number };

      // overdue-1 (-7d), overdue-2 (-3d), today (0d) and soon (4d) all
      // qualify (<= 7); far (20d) does not.
      expect(data.dueSoonCount).toBe(4);
    });
  });
});
