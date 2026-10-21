import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { pushMock, refreshMock, resetNavigationMock } from "@/test/mocks/navigation";
import { useState } from "react";
import { UnsavedChangesProvider, useUnsavedSource } from "@/components/unsaved/UnsavedChangesProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import LogoutButton from "@/components/LogoutButton";

function Draft() {
  const [value, setValue] = useState("Keep my draft");
  useUnsavedSource("logout-test", { label: "Editor draft", dirty: Boolean(value), version: value, discard: () => setValue("") });
  return <input aria-label="Editor draft" value={value} onChange={(event) => setValue(event.target.value)} />;
}

describe("LogoutButton", () => {
  beforeEach(() => {
    resetNavigationMock();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a Sign out button", () => {
    render(<LogoutButton />);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("logs out and navigates to /login on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
    render(<LogoutButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    });
    expect(global.fetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", headers: { "X-Kokpit-Request": "1" } });
    expect(pushMock).toHaveBeenCalledWith("/login");
    expect(refreshMock).toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("alerts and does not navigate when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false } as Response));
    render(<LogoutButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    });
    expect(window.alert).toHaveBeenCalledWith("Sign out failed. Please try again.");
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("alerts and does not navigate when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    render(<LogoutButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    });
    expect(window.alert).toHaveBeenCalledWith("Sign out failed. Please try again.");
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("Stay sends no request and Discard retains the draft until logout succeeds", async () => {
    let complete!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UnsavedChangesProvider><Draft /><LogoutButton /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Editor draft")).toHaveValue("Keep my draft");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard and continue" })); });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Editor draft")).toHaveValue("Keep my draft");
    expect(pushMock).not.toHaveBeenCalled();
    await act(async () => { complete(new Response(null)); });
    expect(screen.getByLabelText("Editor draft")).toHaveValue("");
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it.each(["response", "network"])("retains unsaved work when logout fails: %s", async (failure) => {
    vi.stubGlobal("fetch", failure === "response"
      ? vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
      : vi.fn().mockRejectedValue(new Error("unavailable")));
    render(<UnsavedChangesProvider><Draft /><LogoutButton /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard and continue" })); });
    expect(window.alert).toHaveBeenCalledWith("Sign out failed. Please try again.");
    expect(screen.getByLabelText("Editor draft")).toHaveValue("Keep my draft");
    expect(pushMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  });
});
