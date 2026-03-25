import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { z } from "zod";
import { registerWidget, clearRegistry } from "@/widgets";
import { WidgetRenderer } from "@/components/WidgetRenderer";
import type { WidgetProps } from "@/widgets";

function MockWidgetComponent({ data, loading, error }: WidgetProps) {
  const typed = data as { label: string } | null;
  if (loading && !data) return <div>widget-loading-state</div>;
  if (error) return <div>widget-error-state: {error}</div>;
  return <div>widget-data: {typed?.label}</div>;
}

describe("WidgetRenderer", () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows error for unknown widget type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise(() => {}))
    );

    await act(async () => {
      render(<WidgetRenderer type="unknown-widget" serviceName="TestService" />);
    });

    expect(screen.getByText(/Unknown widget type/)).toBeInTheDocument();
    expect(screen.getByText(/unknown-widget/)).toBeInTheDocument();
  });

  it("shows loading spinner while fetching", async () => {
    registerWidget({
      id: "mock-widget",
      name: "Mock Widget",
      configSchema: z.object({}),
      fetchData: async () => ({ label: "hello" }),
      component: MockWidgetComponent,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise(() => {})) // never resolves
    );

    await act(async () => {
      render(<WidgetRenderer type="mock-widget" serviceName="TestService" />);
    });

    expect(screen.getByLabelText("Loading widget")).toBeInTheDocument();
  });

  it("renders widget component with data after fetch succeeds", async () => {
    registerWidget({
      id: "data-widget",
      name: "Data Widget",
      configSchema: z.object({}),
      fetchData: async () => ({ label: "hello" }),
      component: MockWidgetComponent,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, data: { label: "hello" } }),
      } as Response)
    );

    render(<WidgetRenderer type="data-widget" serviceName="TestService" />);

    await waitFor(() =>
      expect(screen.getByText("widget-data: hello")).toBeInTheDocument()
    );
  });

  it("shows inline error when fetch fails and no data available", async () => {
    registerWidget({
      id: "error-widget",
      name: "Error Widget",
      configSchema: z.object({}),
      fetchData: async () => { throw new Error("boom"); },
      component: MockWidgetComponent,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: false, error: "boom" }),
      } as Response)
    );

    render(<WidgetRenderer type="error-widget" serviceName="TestService" />);

    // WidgetRenderer shows its own .widget-error when data is null
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument()
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
