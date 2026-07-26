import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActualBudgetSchedulesWidget } from "@/integrations/actualbudget/schedulesWidget";
import type { ActualSchedule } from "@/integrations/actualbudget/api";

const noop = () => {};

interface SchedulesData {
  schedules: ActualSchedule[];
  dueSoonCount: number;
  currency: string;
  locale?: string;
  privacyMode: boolean;
}

const OVERDUE: ActualSchedule = {
  id: "sch-overdue",
  name: "Old Subscription",
  payeeName: "Streaming Co",
  nextDate: "2026-07-20",
  daysUntil: -6,
  amount: -1500,
  amountMin: null,
  amountMax: null,
  amountOp: "is",
};

const DUE_TODAY: ActualSchedule = {
  id: "sch-today",
  name: "Rent",
  payeeName: "Landlord",
  nextDate: "2026-07-26",
  daysUntil: 0,
  amount: -120000,
  amountMin: null,
  amountMax: null,
  amountOp: "is",
};

const DUE_SOON: ActualSchedule = {
  id: "sch-soon",
  name: "Electricity",
  payeeName: "Power Co",
  nextDate: "2026-07-28",
  daysUntil: 2,
  amount: -8000,
  amountMin: -9000,
  amountMax: -7000,
  amountOp: "isbetween",
};

const DUE_FAR = {
  id: "sch-far",
  name: "Insurance",
  payeeName: "Insure Co",
  nextDate: "2026-09-01",
  daysUntil: 37,
  amount: -50000,
  amountMin: null,
  amountMax: null,
  amountOp: "is",
} satisfies ActualSchedule;

const SAMPLE_DATA: SchedulesData = {
  schedules: [OVERDUE, DUE_TODAY, DUE_SOON, DUE_FAR],
  // sch-today (0) and sch-soon (2) qualify; sch-overdue (-6) and sch-far (37)
  // do not.
  dueSoonCount: 2,
  currency: "USD",
  locale: "en-US",
  privacyMode: false,
};

function rowFor(container: HTMLElement, payeeName: string): Element | undefined {
  return Array.from(
    container.querySelectorAll(".actualbudget-schedules-widget__row")
  ).find((el) => el.textContent?.includes(payeeName));
}

describe("ActualBudgetSchedulesWidget", () => {
  it("renders the empty container class when data is null and neither loading nor error", () => {
    const { container } = render(
      <ActualBudgetSchedulesWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".actualbudget-schedules-widget--empty")
    ).toBeInTheDocument();
  });

  it("shows a loading hint when data is null and loading", () => {
    render(
      <ActualBudgetSchedulesWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows the error message when data is null and error is set", () => {
    render(
      <ActualBudgetSchedulesWidget
        data={null}
        loading={false}
        error="connection refused"
        refresh={noop}
      />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("renders a row per schedule with the resolved payee name", () => {
    render(
      <ActualBudgetSchedulesWidget
        data={SAMPLE_DATA}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("Streaming Co")).toBeInTheDocument();
    expect(screen.getByText("Landlord")).toBeInTheDocument();
    expect(screen.getByText("Power Co")).toBeInTheDocument();
    expect(screen.getByText("Insure Co")).toBeInTheDocument();
  });

  it('renders "overdue" for a negative daysUntil', () => {
    const { container } = render(
      <ActualBudgetSchedulesWidget
        data={SAMPLE_DATA}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const row = rowFor(container, "Streaming Co");
    expect(row).toHaveTextContent("overdue");
    expect(
      row?.querySelector(".actualbudget-schedules-widget__due--overdue")
    ).toBeInTheDocument();
  });

  it('renders "today" when daysUntil is 0', () => {
    const { container } = render(
      <ActualBudgetSchedulesWidget
        data={SAMPLE_DATA}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const row = rowFor(container, "Landlord");
    expect(row).toHaveTextContent("today");
    expect(
      row?.querySelector(".actualbudget-schedules-widget__due--overdue")
    ).not.toBeInTheDocument();
  });

  it("renders an Nd label for other positive daysUntil values", () => {
    const { container } = render(
      <ActualBudgetSchedulesWidget
        data={SAMPLE_DATA}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(rowFor(container, "Power Co")).toHaveTextContent("2d");
    expect(rowFor(container, "Insure Co")).toHaveTextContent("37d");
  });

  it("renders amountMin/amountMax as a range when non-null", () => {
    const { container } = render(
      <ActualBudgetSchedulesWidget
        data={SAMPLE_DATA}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const row = rowFor(container, "Power Co");
    const amount = row?.querySelector(".actualbudget-schedules-widget__amount");
    expect(amount).toHaveTextContent("-$90.00");
    expect(amount).toHaveTextContent("-$70.00");
  });

  it("renders a single amount when amountMin/amountMax are null", () => {
    const { container } = render(
      <ActualBudgetSchedulesWidget
        data={SAMPLE_DATA}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const row = rowFor(container, "Landlord");
    const amount = row?.querySelector(".actualbudget-schedules-widget__amount");
    expect(amount).toHaveTextContent("-$1,200.00");
  });

  it("shows data.dueSoonCount in the footer", () => {
    render(
      <ActualBudgetSchedulesWidget
        data={SAMPLE_DATA}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    // sch-today (0) and sch-soon (2) qualify; sch-overdue (-6) and sch-far
    // (37) do not — matching SAMPLE_DATA.dueSoonCount, precomputed above.
    expect(screen.getByText("Due within 7 days or overdue")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("reads the footer count from data.dueSoonCount rather than recomputing it from the (already limit-truncated) displayed list", () => {
    // If the component recomputed the count from `data.schedules`, this would
    // show 1 (only DUE_TODAY is in the truncated display list and due soon).
    // The fetchData wrapper computes dueSoonCount from the full list before
    // truncating for display, so a value that disagrees with the displayed
    // list's own count proves the component defers to it rather than
    // recomputing — the exact bug this fixes: more due-soon schedules than
    // `limit` would otherwise under-report in the footer.
    render(
      <ActualBudgetSchedulesWidget
        data={{ ...SAMPLE_DATA, schedules: [DUE_TODAY], dueSoonCount: 9 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("Due within 7 days or overdue")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("shows the stale error alongside data when data is non-null and error is set", () => {
    render(
      <ActualBudgetSchedulesWidget
        data={SAMPLE_DATA}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("Landlord")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("refresh failed");
  });

  it("adds the private class when privacy mode is on", () => {
    const { container } = render(
      <ActualBudgetSchedulesWidget
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
      <ActualBudgetSchedulesWidget
        data={{ ...SAMPLE_DATA, privacyMode: false }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(container.querySelector(".actualbudget-widget--private")).not.toBeInTheDocument();
  });

  it("renders an empty schedule list without crashing", () => {
    const { container } = render(
      <ActualBudgetSchedulesWidget
        data={{
          schedules: [],
          dueSoonCount: 0,
          currency: "USD",
          locale: "en-US",
          privacyMode: false,
        }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/no upcoming schedules/i)).toBeInTheDocument();
    expect(
      container.querySelector(".actualbudget-schedules-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("Due within 7 days or overdue")).not.toBeInTheDocument();
  });
});
