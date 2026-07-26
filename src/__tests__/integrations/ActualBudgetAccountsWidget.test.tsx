import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActualBudgetAccountsWidget } from "@/integrations/actualbudget/accountsWidget";
import type { ActualAccount } from "@/integrations/actualbudget/api";

const noop = () => {};

interface AccountsData {
  accounts: ActualAccount[];
  currency: string;
  locale?: string;
  privacyMode: boolean;
}

const CURRENT: ActualAccount = {
  id: "acc-1",
  name: "Current",
  offbudget: false,
  closed: false,
  balance: 210412,
};

const SAVINGS: ActualAccount = {
  id: "acc-2",
  name: "Savings",
  offbudget: true,
  closed: false,
  balance: 5000000,
};

const CREDIT_CARD: ActualAccount = {
  id: "acc-3",
  name: "Credit Card",
  offbudget: false,
  closed: false,
  balance: -45000,
};

const SAMPLE_DATA: AccountsData = {
  accounts: [CURRENT, SAVINGS, CREDIT_CARD],
  currency: "USD",
  locale: "en-US",
  privacyMode: false,
};

describe("ActualBudgetAccountsWidget", () => {
  it("renders the empty container class when data is null and neither loading nor error", () => {
    const { container } = render(
      <ActualBudgetAccountsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".actualbudget-accounts-widget--empty")
    ).toBeInTheDocument();
  });

  it("shows a loading hint when data is null and loading", () => {
    render(<ActualBudgetAccountsWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows the error message when data is null and error is set", () => {
    render(
      <ActualBudgetAccountsWidget
        data={null}
        loading={false}
        error="connection refused"
        refresh={noop}
      />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("renders a row per account with its name and balance", () => {
    render(
      <ActualBudgetAccountsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("$2,104.12")).toBeInTheDocument();
    expect(screen.getByText("Savings")).toBeInTheDocument();
    expect(screen.getByText("$50,000.00")).toBeInTheDocument();
    expect(screen.getByText("Credit Card")).toBeInTheDocument();
    expect(screen.getByText("-$450.00")).toBeInTheDocument();
  });

  it("renders the off-budget badge only for off-budget accounts", () => {
    const { container } = render(
      <ActualBudgetAccountsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    const badges = container.querySelectorAll(".actualbudget-accounts-widget__badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("Off-budget");

    const savingsRow = Array.from(
      container.querySelectorAll(".actualbudget-accounts-widget__row")
    ).find((el) => el.textContent?.includes("Savings"));
    expect(savingsRow?.querySelector(".actualbudget-accounts-widget__badge")).toBeInTheDocument();

    const currentRow = Array.from(
      container.querySelectorAll(".actualbudget-accounts-widget__row")
    ).find((el) => el.textContent?.includes("Current"));
    expect(
      currentRow?.querySelector(".actualbudget-accounts-widget__badge")
    ).not.toBeInTheDocument();
  });

  it("marks negative balances with the negative amount class", () => {
    const { container } = render(
      <ActualBudgetAccountsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    const creditCardRow = Array.from(
      container.querySelectorAll(".actualbudget-accounts-widget__row")
    ).find((el) => el.textContent?.includes("Credit Card"));
    const amount = creditCardRow?.querySelector(".actualbudget-amount");
    expect(amount?.className).toContain("actualbudget-amount--negative");

    const currentRow = Array.from(
      container.querySelectorAll(".actualbudget-accounts-widget__row")
    ).find((el) => el.textContent?.includes("Current"));
    const currentAmount = currentRow?.querySelector(".actualbudget-amount");
    expect(currentAmount?.className).not.toContain("actualbudget-amount--negative");
  });

  it("shows a footer total labelled Net worth equal to the sum of balances", () => {
    render(
      <ActualBudgetAccountsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    // 210412 + 5000000 - 45000 = 5165412 -> $51,654.12
    expect(screen.getByText("Net worth")).toBeInTheDocument();
    expect(screen.getByText("$51,654.12")).toBeInTheDocument();
  });

  it("shows the stale error alongside data when data is non-null and error is set", () => {
    render(
      <ActualBudgetAccountsWidget
        data={SAMPLE_DATA}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("Current")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("refresh failed");
  });

  it("adds the private class when privacy mode is on", () => {
    const { container } = render(
      <ActualBudgetAccountsWidget
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
      <ActualBudgetAccountsWidget
        data={{ ...SAMPLE_DATA, privacyMode: false }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(container.querySelector(".actualbudget-widget--private")).not.toBeInTheDocument();
  });

  it("renders an empty account list without crashing", () => {
    const { container } = render(
      <ActualBudgetAccountsWidget
        data={{ accounts: [], currency: "USD", locale: "en-US", privacyMode: false }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/no accounts to show/i)).toBeInTheDocument();
    expect(
      container.querySelector(".actualbudget-accounts-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("Net worth")).not.toBeInTheDocument();
  });
});
