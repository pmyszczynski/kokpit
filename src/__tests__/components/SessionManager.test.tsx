import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { pushMock, refreshMock, resetNavigationMock } from "@/test/mocks/navigation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import SessionManager from "@/components/SessionManager";

const sessions = [
  { id: "current", device: "Firefox on macOS", createdAt: 1_700_000_000_000, lastSeenAt: 1_700_000_100_000, current: true },
  { id: "other", device: "Chrome on Linux", createdAt: 1_700_000_000_000, lastSeenAt: 1_700_000_100_000, current: false },
];

describe("SessionManager", () => {
  beforeEach(() => resetNavigationMock());
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
      body: JSON.stringify({ action: "revoke", sessionId: "current" }),
    }));
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it("requires a password before signing another device out", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sessions }) } as Response)
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
      body: JSON.stringify({ action: "revoke", sessionId: "other", password: "password" }),
    }));
  });
});
