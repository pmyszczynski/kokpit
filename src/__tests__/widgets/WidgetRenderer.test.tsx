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
      render(<WidgetRenderer type="unknown-widget" tileId="tile-id" />);
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
      render(<WidgetRenderer type="mock-widget" tileId="tile-id" />);
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

    render(<WidgetRenderer type="data-widget" tileId="tile-id" />);

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

    render(<WidgetRenderer type="error-widget" tileId="tile-id" />);

    // WidgetRenderer shows its own .widget-error when data is null
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument()
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("does not pass old data to a new widget type sharing the same tile", async () => {
    function OldWidget({ data }: WidgetProps) {
      return <div>old-widget: {(data as { label: string } | null)?.label}</div>;
    }
    function NewWidget({ data }: WidgetProps) {
      return <div>new-widget: {(data as { label: string } | null)?.label}</div>;
    }
    registerWidget({ id: "old-widget", name: "Old", configSchema: z.object({}), fetchData: async () => ({}), component: OldWidget });
    registerWidget({ id: "new-widget", name: "New", configSchema: z.object({}), fetchData: async () => ({}), component: NewWidget });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, data: { label: "old" } }) } as Response)
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: false, error: "Widget type changed", data: { label: "old" } }) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<WidgetRenderer type="old-widget" tileId="tile-id" />);
    await waitFor(() => expect(screen.getByText("old-widget: old")).toBeInTheDocument());

    rerender(<WidgetRenderer type="new-widget" tileId="tile-id" />);

    expect(screen.queryByText("old-widget: old")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Widget type changed"));
    expect(screen.queryByText("new-widget: old")).not.toBeInTheDocument();
  });

  it("recovers from a widget error boundary when the widget type changes", async () => {
    function CrashingWidget(): never {
      throw new Error("widget crashed");
    }
    function HealthyWidget() {
      return <div>healthy-widget</div>;
    }
    registerWidget({ id: "crashing-widget", name: "Crashing", configSchema: z.object({}), fetchData: async () => ({}), component: CrashingWidget });
    registerWidget({ id: "healthy-widget", name: "Healthy", configSchema: z.object({}), fetchData: async () => ({}), component: HealthyWidget });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: true, data: {} }) } as Response));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(<WidgetRenderer type="crashing-widget" tileId="tile-id" />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("widget crashed"));

    rerender(<WidgetRenderer type="healthy-widget" tileId="tile-id" />);

    await waitFor(() => expect(screen.getByText("healthy-widget")).toBeInTheDocument());
  });
});
