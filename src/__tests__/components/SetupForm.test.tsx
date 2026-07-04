import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();

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
    pushMock.mockReset();
    refreshMock.mockReset();
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

  it("submits to /api/setup and navigates to /login on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
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
