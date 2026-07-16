import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { pushMock, refreshMock, resetNavigationMock } from "@/test/mocks/navigation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import SetupForm from "@/app/setup/SetupForm";

function fillAndSubmit(username: string, password: string, confirm: string) {
  fireEvent.change(screen.getByPlaceholderText("Username"), {
    target: { value: username },
  });
  fireEvent.change(screen.getByPlaceholderText("Password (min 8 chars)"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByPlaceholderText("Confirm password"), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByRole("button", { name: /create admin account/i }));
}

describe("SetupForm", () => {
  beforeEach(() => {
    resetNavigationMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the setup heading and fields", () => {
    render(<SetupForm />);
    expect(screen.getByText("Welcome to Kokpit")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Username")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password (min 8 chars)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Confirm password")).toBeInTheDocument();
  });

  it("shows an error and makes no request when passwords do not match", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SetupForm />);
    await act(async () => {
      fillAndSubmit("admin", "password1", "password2");
    });
    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("submits to /api/setup and shows the recovery code screen on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ recoveryCode: "aaaaaaaa-bbbbbbbb-cccccccc-dddddddd" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<SetupForm />);
    await act(async () => {
      fillAndSubmit("admin", "password1", "password1");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/setup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "password1" }),
      })
    );
    expect(screen.getByText("Save your recovery code")).toBeInTheDocument();
    expect(screen.getByText("aaaaaaaa-bbbbbbbb-cccccccc-dddddddd")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("only navigates to /login once the recovery code is confirmed saved", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ recoveryCode: "aaaaaaaa-bbbbbbbb-cccccccc-dddddddd" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<SetupForm />);
    await act(async () => {
      fillAndSubmit("admin", "password1", "password1");
    });

    const continueButton = screen.getByRole("button", { name: /continue to login/i });
    expect(continueButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(continueButton).toBeEnabled();

    fireEvent.click(continueButton);
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it("shows the server error message on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Username already taken" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<SetupForm />);
    await act(async () => {
      fillAndSubmit("admin", "password1", "password1");
    });
    expect(screen.getByText("Username already taken")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a fallback error and no recovery screen when the success body has no valid recoveryCode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<SetupForm />);
    await act(async () => {
      fillAndSubmit("admin", "password1", "password1");
    });
    expect(screen.queryByText("Save your recovery code")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't be read/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a fallback error when the success response body fails to parse as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error("not json")),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<SetupForm />);
    await act(async () => {
      fillAndSubmit("admin", "password1", "password1");
    });
    expect(screen.getByText(/couldn't be read/i)).toBeInTheDocument();
  });

  it("falls back to 'Setup failed' when the error body has no message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<SetupForm />);
    await act(async () => {
      fillAndSubmit("admin", "password1", "password1");
    });
    expect(screen.getByText("Setup failed")).toBeInTheDocument();
  });
});
