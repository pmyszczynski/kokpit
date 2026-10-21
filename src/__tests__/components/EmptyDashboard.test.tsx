import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EditModeContextValue } from "@/components/edit/EditModeProvider";

const state = vi.hoisted(() => ({
  current: null as Partial<EditModeContextValue> | null,
  requestTileAdd: vi.fn(),
}));

vi.mock("@/components/edit/EditModeProvider", () => ({
  useEditModeOptional: () => state.current,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import EmptyDashboard from "@/components/EmptyDashboard";

beforeEach(() => {
  state.requestTileAdd.mockReset();
  state.current = { canEdit: true, status: "idle", error: null, requestTileAdd: state.requestTileAdd };
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("EmptyDashboard", () => {
  it("offers the existing service form and tile picker without starting edits or writes during rendering", () => {
    const { rerender } = render(<EmptyDashboard hasSavedServices={false} />);
    expect(screen.getByRole("region", { name: "Your dashboard is ready to make your own" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add your first service" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "More tile options" })).toBeEnabled();
    expect(screen.getByText("settings.yaml")).toBeInTheDocument();
    expect(state.requestTileAdd).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    rerender(<EmptyDashboard hasSavedServices />);
    expect(state.requestTileAdd).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requests a service form for the first-service action and the picker for other tile types", () => {
    render(<EmptyDashboard hasSavedServices={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Add your first service" }));
    expect(state.requestTileAdd).toHaveBeenNthCalledWith(1, "service");
    fireEvent.click(screen.getByRole("button", { name: "More tile options" }));
    expect(state.requestTileAdd).toHaveBeenNthCalledWith(2, "picker");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("guides users with saved catalog services toward tile placement and service management", () => {
    render(<EmptyDashboard hasSavedServices />);
    expect(screen.getByText(/saved services, but no tiles placed/i)).toHaveTextContent("Settings → Services");
    expect(screen.getByRole("link", { name: "Manage saved services" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("button", { name: "Add your first service" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More tile options" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a tile" }));
    expect(state.requestTileAdd).toHaveBeenCalledWith("picker");
  });

  it.each([null, { canEdit: false, status: "idle" } satisfies Partial<EditModeContextValue>])("shows non-interactive guidance when editing is unavailable: %j", context => {
    state.current = context;
    render(<EmptyDashboard hasSavedServices />);
    expect(screen.getByRole("heading", { name: "Your dashboard is ready to make your own" })).toBeInTheDocument();
    expect(screen.getByText(/ask an administrator to add tiles/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Manage saved services" })).not.toBeInTheDocument();
    expect(state.requestTileAdd).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])("disables entry actions while opening the editor for catalog=%s", hasSavedServices => {
    state.current = { ...state.current, status: "loading" };
    render(<EmptyDashboard hasSavedServices={hasSavedServices} />);
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");
    const primary = screen.getByRole("button", { name: "Opening editor…" });
    expect(primary).toBeDisabled(); fireEvent.click(primary);
    if (!hasSavedServices) {
      const secondary = screen.getByRole("button", { name: "More tile options" });
      expect(secondary).toBeDisabled(); fireEvent.click(secondary);
    }
    expect(state.requestTileAdd).not.toHaveBeenCalled();
  });

  it("announces an entry failure and leaves the action available for retry", () => {
    state.current = { ...state.current, status: "error", error: "Could not open editor. Try again." };
    render(<EmptyDashboard hasSavedServices={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not open editor. Try again.");
    const retry = screen.getByRole("button", { name: "Add your first service" });
    expect(retry).toBeEnabled(); fireEvent.click(retry);
    expect(state.requestTileAdd).toHaveBeenCalledWith("service");
  });

  it("renders error text as text and does not create an empty alert", () => {
    state.current = { ...state.current, status: "error", error: '<img src="invalid" onerror="alert(1)">' };
    const { container, rerender } = render(<EmptyDashboard hasSavedServices={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent('<img src="invalid" onerror="alert(1)">');
    expect(container.querySelector("img")).toBeNull();
    state.current = { ...state.current, error: null };
    rerender(<EmptyDashboard hasSavedServices={false} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
