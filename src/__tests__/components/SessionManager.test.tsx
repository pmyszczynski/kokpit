import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { pushMock, refreshMock, resetNavigationMock } from "@/test/mocks/navigation";
import { useState } from "react";
import { UnsavedChangesProvider, useUnsavedSource } from "@/components/unsaved/UnsavedChangesProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import SessionManager from "@/components/SessionManager";

const sessions = [
  { id: "current", device: "Firefox on macOS", createdAt: 1_700_000_000_000, lastSeenAt: 1_700_000_100_000, current: true },
  { id: "other", device: "Chrome on Linux", createdAt: 1_700_000_000_000, lastSeenAt: 1_700_000_100_000, current: false },
];

function Draft() {
  const [value, setValue] = useState("Retained editor work");
  useUnsavedSource("session-test", { label: "Editor draft", dirty: Boolean(value), version: value, discard: () => setValue("") });
  return <input aria-label="Editor draft" value={value} onChange={(event) => setValue(event.target.value)} />;
}

describe("SessionManager", () => {
  beforeEach(() => {
    resetNavigationMock();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("labels the current session and signs it out without a password", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sessions }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionManager />);
    await screen.findByText(/This device/);

    fireEvent.click(screen.getByRole("button", { name: "Sign out this device" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm" })); });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sessions", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kokpit-Request": "1" },
      body: JSON.stringify({ action: "revoke", sessionId: "current" }),
    }));
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it("requires a password before signing another device out", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sessions }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sessions: [sessions[0]] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionManager />);
    await screen.findByText("Chrome on Linux");

    fireEvent.click(screen.getAllByRole("button", { name: "Sign out device" })[0]);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "password" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm" })); });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sessions", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kokpit-Request": "1" },
      body: JSON.stringify({ action: "revoke", sessionId: "other", password: "password" }),
    }));
    await waitFor(() => expect(screen.queryByText("Chrome on Linux")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    { status: 401, error: "Invalid password" },
    { status: 429, error: "Too many attempts" },
  ])("retains editor and confirmation values when revoke-all fails: $status", async ({ status, error }) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessions })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error }), { status }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UnsavedChangesProvider><Draft /><SessionManager /></UnsavedChangesProvider>);
    await screen.findByText(/This device/);
    fireEvent.click(screen.getByRole("button", { name: "Sign out all devices" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong-attempt" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard and continue" })); });
    expect(screen.getByRole("alert")).toHaveTextContent(error);
    expect(screen.getByLabelText("Editor draft")).toHaveValue("Retained editor work");
    expect(screen.getByLabelText("Current password")).toHaveValue("wrong-attempt");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
