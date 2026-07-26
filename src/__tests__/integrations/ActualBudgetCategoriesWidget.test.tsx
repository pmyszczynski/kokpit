import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActualBudgetCategoriesWidget } from "@/integrations/actualbudget/categoriesWidget";
import type { ActualBudgetMonth, ActualCategory } from "@/integrations/actualbudget/api";

const noop = () => {};

type CategoriesData = ActualBudgetMonth & {
  currency: string;
  locale?: string;
  privacyMode: boolean;
  hideIncome: boolean;
  hideEmpty: boolean;
  limit: number;
};

// budgeted=100000, spent=-95000 -> 95% spent, balance still positive: --warn.
const RENT: ActualCategory = {
  id: "cat-rent",
  name: "Rent",
  groupName: "Housing",
  isIncome: false,
  hidden: false,
  budgeted: 100000,
  spent: -95000,
  balance: 5000,
  carryover: false,
};

// budgeted=40000, spent=-31200 -> 78% spent, balance positive: --ok.
const GROCERIES: ActualCategory = {
  id: "cat-groceries",
  name: "Groceries",
  groupName: "Everyday",
  isIncome: false,
  hidden: false,
  budgeted: 40000,
  spent: -31200,
  balance: 8800,
  carryover: false,
};

// budgeted=20000, spent=-25000 -> over budget, balance negative: --over.
const ENTERTAINMENT: ActualCategory = {
  id: "cat-entertainment",
  name: "Entertainment",
  groupName: "Everyday",
  isIncome: false,
  hidden: false,
  budgeted: 20000,
  spent: -25000,
  balance: -5000,
  carryover: false,
};

// budgeted === 0 && spent === 0: dropped by hide_empty.
const GIFTS: ActualCategory = {
  id: "cat-gifts",
  name: "Gifts",
  groupName: "Everyday",
  isIncome: false,
  hidden: false,
  budgeted: 0,
  spent: 0,
  balance: 0,
  carryover: false,
};

// Income category: dropped by hide_income.
const SALARY: ActualCategory = {
  id: "cat-salary",
  name: "Salary",
  groupName: "Income",
  isIncome: true,
  hidden: false,
  budgeted: 0,
  spent: 500000,
  balance: 500000,
  carryover: false,
};

// budgeted === 0, spent < 0: nothing budgeted but real spending happened.
// hide_empty does NOT drop this (that only catches budgeted AND spent both
// 0), so it must rank as 100% spent — not 0%, which would sort it last and
// let `limit` cut exactly the category a user most needs to see.
const UNBUDGETED_SPENT: ActualCategory = {
  id: "cat-unbudgeted",
  name: "Miscellaneous",
  groupName: "Everyday",
  isIncome: false,
  hidden: false,
  budgeted: 0,
  spent: -5000,
  balance: -5000,
  carryover: false,
};

// budgeted === 0, spent < 0, balance > 0: a category carrying a positive
// balance from a prior month (100.00 carried, 0 assigned this month, 50.00
// spent). available = balance + |spent| = 5000 + 5000 = 10000, so 50% spent
// — not 100%. This is the carrying-funds case the balance-derived formula
// exists to get right; the old budgeted===0-implies-100% special case
// treated it identically to a truly unbudgeted overspend.
const CARRYOVER_PARTIAL: ActualCategory = {
  id: "cat-carryover",
  name: "Carryover Fund",
  groupName: "Everyday",
  isIncome: false,
  hidden: false,
  budgeted: 0,
  spent: -5000,
  balance: 5000,
  carryover: true,
};

// hidden === true: archived in Actual. Never something to show, and not a
// configurable option — must be dropped unconditionally, before it can
// consume a `limit` slot ahead of a visible category.
const ARCHIVED: ActualCategory = {
  id: "cat-archived",
  name: "Archived Category",
  groupName: "Everyday",
  isIncome: false,
  hidden: true,
  budgeted: 10000,
  spent: -10000,
  balance: 0,
  carryover: false,
};

const ALL_CATEGORIES = [GROCERIES, RENT, SALARY, GIFTS, ENTERTAINMENT];

function makeData(overrides: Partial<CategoriesData> = {}): CategoriesData {
  return {
    month: "2026-07",
    toBudget: 41200,
    totalBudgeted: 160000,
    totalSpent: -151200,
    totalBalance: 8800,
    totalIncome: 500000,
    categories: ALL_CATEGORIES,
    currency: "USD",
    locale: "en-US",
    privacyMode: false,
    hideIncome: true,
    hideEmpty: true,
    limit: 10,
    ...overrides,
  };
}

function rowNames(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(".actualbudget-categories-widget__name")
  ).map((el) => el.textContent);
}

describe("ActualBudgetCategoriesWidget", () => {
  it("renders the empty container class when data is null and neither loading nor error", () => {
    const { container } = render(
      <ActualBudgetCategoriesWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".actualbudget-categories-widget--empty")
    ).toBeInTheDocument();
  });

  it("shows a loading hint when data is null and loading", () => {
    render(
      <ActualBudgetCategoriesWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows the error message when data is null and error is set", () => {
    render(
      <ActualBudgetCategoriesWidget
        data={null}
        loading={false}
        error="connection refused"
        refresh={noop}
      />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("renders category rows sorted by percent spent descending", () => {
    const { container } = render(
      <ActualBudgetCategoriesWidget
        data={makeData()}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    // hide_income and hide_empty are both on by default here, dropping Salary
    // and Gifts; the remaining three sort Entertainment(100%) > Rent(95%) >
    // Groceries(78%).
    expect(rowNames(container)).toEqual(["Entertainment", "Rent", "Groceries"]);
  });

  it("drops income categories when hide_income is set", () => {
    render(
      <ActualBudgetCategoriesWidget
        data={makeData({ hideIncome: true, hideEmpty: true })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.queryByText("Salary")).not.toBeInTheDocument();
  });

  it("keeps income categories when hide_income is off", () => {
    render(
      <ActualBudgetCategoriesWidget
        data={makeData({ hideIncome: false, hideEmpty: true })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("Salary")).toBeInTheDocument();
  });

  it("drops categories with zero budgeted and zero spent when hide_empty is set", () => {
    render(
      <ActualBudgetCategoriesWidget
        data={makeData({ hideIncome: true, hideEmpty: true })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.queryByText("Gifts")).not.toBeInTheDocument();
  });

  it("keeps zero-activity categories when hide_empty is off", () => {
    render(
      <ActualBudgetCategoriesWidget
        data={makeData({ hideIncome: true, hideEmpty: false })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("Gifts")).toBeInTheDocument();
  });

  it("truncates the list to the configured limit after sorting", () => {
    const { container } = render(
      <ActualBudgetCategoriesWidget
        data={makeData({ hideIncome: true, hideEmpty: true, limit: 2 })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    // The top 2 by percent spent: Entertainment(100%), Rent(95%). Groceries
    // (78%) is truncated.
    expect(rowNames(container)).toEqual(["Entertainment", "Rent"]);
  });

  it("applies the --over modifier when balance is negative", () => {
    const { container } = render(
      <ActualBudgetCategoriesWidget
        data={makeData()}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const row = Array.from(
      container.querySelectorAll(".actualbudget-categories-widget__row")
    ).find((el) => el.textContent?.includes("Entertainment"));
    expect(row?.className).toContain("actualbudget-categories-widget__row--over");
  });

  it("applies the --warn modifier at 85% or more spent with a positive balance", () => {
    const { container } = render(
      <ActualBudgetCategoriesWidget
        data={makeData()}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const row = Array.from(
      container.querySelectorAll(".actualbudget-categories-widget__row")
    ).find((el) => el.textContent?.includes("Rent"));
    expect(row?.className).toContain("actualbudget-categories-widget__row--warn");
  });

  it("never renders a hidden (archived) category", () => {
    render(
      <ActualBudgetCategoriesWidget
        data={makeData({
          categories: [ARCHIVED, GROCERIES],
          hideIncome: true,
          hideEmpty: true,
        })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.queryByText("Archived Category")).not.toBeInTheDocument();
  });

  it("does not let a hidden category consume a limit slot and displace a visible one", () => {
    const { container } = render(
      <ActualBudgetCategoriesWidget
        data={makeData({
          categories: [ARCHIVED, RENT, GROCERIES],
          hideIncome: true,
          hideEmpty: true,
          limit: 2,
        })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    // Unfiltered, Archived's 100% would rank #1 and, at limit 2, push
    // Groceries out of the top two. Filtering hidden categories first
    // restores the correct top two: Rent (95%), Groceries (78%).
    expect(rowNames(container)).toEqual(["Rent", "Groceries"]);
    expect(screen.queryByText("Archived Category")).not.toBeInTheDocument();
  });

  it("treats an unbudgeted category with real spending as 100% spent, not 0%", () => {
    render(
      <ActualBudgetCategoriesWidget
        data={makeData({
          categories: [UNBUDGETED_SPENT],
          hideIncome: true,
          hideEmpty: true,
        })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const row = screen
      .getByText("Miscellaneous")
      .closest(".actualbudget-categories-widget__row");
    expect(row).toHaveTextContent("100%");
  });

  it("applies the --over modifier to an unbudgeted category with real spending", () => {
    const { container } = render(
      <ActualBudgetCategoriesWidget
        data={makeData({
          categories: [UNBUDGETED_SPENT],
          hideIncome: true,
          hideEmpty: true,
        })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const row = container.querySelector(".actualbudget-categories-widget__row");
    // budgeted: 0, spent: -5000 -> balance -5000, which is < 0 -> --over. This
    // pins that the overspent test (balance < 0) already gets this case right
    // independent of the percent-spent fix.
    expect(row?.className).toContain("actualbudget-categories-widget__row--over");
  });

  it("ranks an unbudgeted category with real spending above ordinary partially-spent categories instead of sorting it last", () => {
    const { container } = render(
      <ActualBudgetCategoriesWidget
        data={makeData({
          categories: [GROCERIES, UNBUDGETED_SPENT, RENT],
          hideIncome: true,
          hideEmpty: true,
          limit: 2,
        })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    // Before the fix, calcProgress(0, …) returned 0 for the unbudgeted
    // category, sorting it last and letting `limit` cut it — exactly the
    // category a user most needs to see. It must rank among the top spenders
    // (100%, ahead of Rent's 95%), not get truncated behind Groceries (78%).
    expect(rowNames(container)).toEqual(["Miscellaneous", "Rent"]);
  });

  it("computes percent spent for a category carrying a balance from a prior month as 50%, not 100%", () => {
    render(
      <ActualBudgetCategoriesWidget
        data={makeData({
          categories: [CARRYOVER_PARTIAL],
          hideIncome: true,
          hideEmpty: true,
        })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const row = screen
      .getByText("Carryover Fund")
      .closest(".actualbudget-categories-widget__row");
    expect(row).toHaveTextContent("50%");
  });

  it("does not apply the --over modifier to a carrying category with a positive balance", () => {
    const { container } = render(
      <ActualBudgetCategoriesWidget
        data={makeData({
          categories: [CARRYOVER_PARTIAL],
          hideIncome: true,
          hideEmpty: true,
        })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const row = container.querySelector(".actualbudget-categories-widget__row");
    expect(row?.className).not.toContain("actualbudget-categories-widget__row--over");
  });

  // The four cases from the fix's verification table, each pinned directly:
  // ordinary, carrying a balance, truly unbudgeted overspend, and untouched.
  describe("percentSpent: available = balance + |spent|", () => {
    it("ordinary category (budgeted 40000, spent -31200, balance 8800): 78%", () => {
      render(
        <ActualBudgetCategoriesWidget
          data={makeData({ categories: [GROCERIES], hideEmpty: false })}
          loading={false}
          error={null}
          refresh={noop}
        />
      );
      const row = screen
        .getByText("Groceries")
        .closest(".actualbudget-categories-widget__row");
      expect(row).toHaveTextContent("78%");
    });

    it("carrying 10000 available (budgeted 0, spent -5000, balance 5000): 50%", () => {
      render(
        <ActualBudgetCategoriesWidget
          data={makeData({ categories: [CARRYOVER_PARTIAL], hideEmpty: false })}
          loading={false}
          error={null}
          refresh={noop}
        />
      );
      const row = screen
        .getByText("Carryover Fund")
        .closest(".actualbudget-categories-widget__row");
      expect(row).toHaveTextContent("50%");
    });

    it("truly unbudgeted overspend (budgeted 0, spent -5000, balance -5000): 100%", () => {
      render(
        <ActualBudgetCategoriesWidget
          data={makeData({ categories: [UNBUDGETED_SPENT], hideEmpty: false })}
          loading={false}
          error={null}
          refresh={noop}
        />
      );
      const row = screen
        .getByText("Miscellaneous")
        .closest(".actualbudget-categories-widget__row");
      expect(row).toHaveTextContent("100%");
    });

    it("nothing budgeted, nothing spent (budgeted 0, spent 0, balance 0): 0%", () => {
      render(
        <ActualBudgetCategoriesWidget
          data={makeData({ categories: [GIFTS], hideEmpty: false })}
          loading={false}
          error={null}
          refresh={noop}
        />
      );
      const row = screen.getByText("Gifts").closest(".actualbudget-categories-widget__row");
      expect(row).toHaveTextContent("0%");
    });
  });

  it("shows the stale error alongside data when data is non-null and error is set", () => {
    render(
      <ActualBudgetCategoriesWidget
        data={makeData()}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("Entertainment")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("refresh failed");
  });

  it("adds the private class when privacy mode is on", () => {
    const { container } = render(
      <ActualBudgetCategoriesWidget
        data={makeData({ privacyMode: true })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(container.querySelector(".actualbudget-widget--private")).toBeInTheDocument();
  });

  it("omits the private class when privacy mode is off", () => {
    const { container } = render(
      <ActualBudgetCategoriesWidget
        data={makeData({ privacyMode: false })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(container.querySelector(".actualbudget-widget--private")).not.toBeInTheDocument();
  });

  it("renders without crashing when every category is filtered out", () => {
    render(
      <ActualBudgetCategoriesWidget
        data={makeData({ categories: [GIFTS], hideEmpty: true })}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/no categories to show/i)).toBeInTheDocument();
  });
});
