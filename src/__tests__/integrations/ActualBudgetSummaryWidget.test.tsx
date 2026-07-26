import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActualBudgetSummaryWidget } from "@/integrations/actualbudget/summaryWidget";
import type { ActualSummary } from "@/integrations/actualbudget/api";

const noop = () => {};

type SummaryData = ActualSummary & {
  currency: string;
  locale?: string;
  privacyMode: boolean;
};

const SAMPLE_DATA: SummaryData = {
  month: {
    month: "2026-07",
    toBudget: 41200,
    totalBudgeted: 120000,
    // Outflows arrive negative from the sidecar.
    totalSpent: -93400,
    totalBalance: 26600,
    totalIncome: 500000,
    categories: [
      {
        id: "cat-1",
        name: "Groceries",
        groupName: "Everyday",
        isIncome: false,
        hidden: false,
        budgeted: 40000,
        spent: -31200,
        balance: 8800,
        carryover: false,
      },
      {
        id: "cat-2",
        name: "Dining",
        groupName: "Everyday",
        isIncome: false,
        hidden: false,
        budgeted: 20000,
        spent: -62200,
        balance: -42200,
        carryover: false,
      },
      {
        id: "cat-3",
        name: "Entertainment",
        groupName: "Everyday",
        isIncome: false,
        hidden: false,
        budgeted: 10000,
        spent: -12000,
        balance: -2000,
        carryover: false,
      },
    ],
  },
  accounts: [
    { id: "acc-1", name: "Current", offbudget: false, closed: false, balance: 210412 },
    { id: "acc-2", name: "Savings", offbudget: true, closed: false, balance: 5000000 },
  ],
  netWorth: 5210412,
  currency: "USD",
  locale: "en-US",
  privacyMode: false,
};

describe("ActualBudgetSummaryWidget", () => {
  it("renders the empty container class when data is null and neither loading nor error", () => {
    const { container } = render(
      <ActualBudgetSummaryWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".actualbudget-summary-widget--empty")
    ).toBeInTheDocument();
  });

  it("shows a loading hint when data is null and loading", () => {
    render(<ActualBudgetSummaryWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows the error message when data is null and error is set", () => {
    render(
      <ActualBudgetSummaryWidget
        data={null}
        loading={false}
        error="connection refused"
        refresh={noop}
      />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("renders To Assign, Budgeted, Remaining and the overspent count", () => {
    render(
      <ActualBudgetSummaryWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("$412.00")).toBeInTheDocument();
    expect(screen.getByText("To Assign")).toBeInTheDocument();
    expect(screen.getByText("$1,200.00")).toBeInTheDocument();
    expect(screen.getByText("Budgeted")).toBeInTheDocument();
    expect(screen.getByText("$266.00")).toBeInTheDocument();
    expect(screen.getByText("Remaining")).toBeInTheDocument();
  });

  it("shows Spent as a positive figure even though totalSpent arrives negative", () => {
    render(
      <ActualBudgetSummaryWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    // totalSpent is -93400 (i.e. -$934.00); the widget must display the
    // absolute value, never a leading minus sign.
    expect(screen.getByText("$934.00")).toBeInTheDocument();
    expect(screen.queryByText("-$934.00")).not.toBeInTheDocument();
    expect(screen.getByText("Spent")).toBeInTheDocument();
  });

  it("derives the overspent count from categories with a negative balance", () => {
    render(
      <ActualBudgetSummaryWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    // cat-2 (balance -42200) and cat-3 (balance -2000) are overspent;
    // cat-1 (balance 8800) is not.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Overspent")).toBeInTheDocument();
  });

  it("renders net worth from the accounts total", () => {
    render(
      <ActualBudgetSummaryWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("$52,104.12")).toBeInTheDocument();
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
  });

  it("renders an em-dash for net worth when the best-effort accounts call failed", () => {
    render(
      <ActualBudgetSummaryWidget
        data={{ ...SAMPLE_DATA, accounts: null, netWorth: null }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
  });

  it("shows the stale error alongside data when data is non-null and error is set", () => {
    render(
      <ActualBudgetSummaryWidget
        data={SAMPLE_DATA}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("$412.00")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("refresh failed");
  });

  it("adds the private class when privacy mode is on", () => {
    const { container } = render(
      <ActualBudgetSummaryWidget
        data={{ ...SAMPLE_DATA, privacyMode: true }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(container.querySelector(".actualbudget-widget--private")).toBeInTheDocument();
  });

  it("omits the private class when privacy mode is off", () => {
    const { container } = render(
      <ActualBudgetSummaryWidget
        data={{ ...SAMPLE_DATA, privacyMode: false }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(container.querySelector(".actualbudget-widget--private")).not.toBeInTheDocument();
  });
});
