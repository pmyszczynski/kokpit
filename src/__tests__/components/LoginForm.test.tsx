import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { pushMock, refreshMock, resetNavigationMock } from "@/test/mocks/navigation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import LoginForm from "@/app/login/LoginForm";

function fillCredentials(username: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText("Username"), {
    target: { value: username },
  });
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginForm - credentials step", () => {
  beforeEach(() => {
    resetNavigationMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the sign-in heading and fields", () => {
    render(<LoginForm />);
    expect(screen.getByText("Sign in to Kokpit")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Username")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
  });

  it("renders a Forgot password? link to /reset-password", () => {
    render(<LoginForm />);
    const link = screen.getByRole("link", { name: /forgot password/i });
    expect(link).toHaveAttribute("href", "/reset-password");
  });

  it("navigates home on success without requiresTotp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ requiresTotp: false }),
      } as Response)
    );
    render(<LoginForm />);
    await act(async () => {
      fillCredentials("admin", "secret");
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "secret" }),
      })
    );
    expect(pushMock).toHaveBeenCalledWith("/");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("switches to the TOTP step when requiresTotp and challengeToken are present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ requiresTotp: true, challengeToken: "chal-123" }),
      } as Response)
    );
    render(<LoginForm />);
    await act(async () => {
      fillCredentials("admin", "secret");
    });
    expect(screen.getByText("Two-Factor Authentication")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a missing challenge token error and stays on the credentials step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ requiresTotp: true }),
      } as Response)
    );
    render(<LoginForm />);
    await act(async () => {
      fillCredentials("admin", "secret");
    });
    expect(
      screen.getByText("Login failed: missing challenge token")
    ).toBeInTheDocument();
    expect(screen.getByText("Sign in to Kokpit")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows the server error message on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Invalid credentials" }),
      } as Response)
    );
    render(<LoginForm />);
    await act(async () => {
      fillCredentials("admin", "wrong");
    });
    expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
  });

  it("falls back to 'Login failed' when the error body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new Error("not json")),
      } as Response)
    );
    render(<LoginForm />);
    await act(async () => {
      fillCredentials("admin", "wrong");
    });
    expect(screen.getByText("Login failed")).toBeInTheDocument();
  });

  it("shows the thrown error's message when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));
    render(<LoginForm />);
    await act(async () => {
      fillCredentials("admin", "secret");
    });
    expect(screen.getByText("Network down")).toBeInTheDocument();
  });
});

describe("LoginForm - TOTP step", () => {
  beforeEach(() => {
    resetNavigationMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function goToTotpStep() {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ requiresTotp: true, challengeToken: "chal-123" }),
      } as Response)
    );
    render(<LoginForm />);
    await act(async () => {
      fillCredentials("admin", "secret");
    });
  }

  it("navigates home when the TOTP code is verified successfully", async () => {
    await goToTotpStep();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000000"), {
        target: { value: "123456" },
      });
      fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/totp/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ challengeToken: "chal-123", code: "123456" }),
      })
    );
    expect(pushMock).toHaveBeenCalledWith("/");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows an error when TOTP verification fails", async () => {
    await goToTotpStep();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Invalid code" }),
      } as Response)
    );

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000000"), {
        target: { value: "000000" },
      });
      fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    });

    expect(screen.getByText("Invalid code")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("Back button returns to the credentials step and clears state", async () => {
    await goToTotpStep();

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(screen.getByText("Sign in to Kokpit")).toBeInTheDocument();
    expect(screen.queryByText("Two-Factor Authentication")).not.toBeInTheDocument();
  });
});
