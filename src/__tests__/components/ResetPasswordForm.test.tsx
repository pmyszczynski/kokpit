import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import ResetPasswordForm from "@/app/reset-password/ResetPasswordForm";

function fillAndSubmit(username: string, recoveryCode: string, newPassword: string, confirm: string) {
  fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText("Recovery code"), { target: { value: recoveryCode } });
  fireEvent.change(screen.getByPlaceholderText("New password (min 8 chars)"), {
    target: { value: newPassword },
  });
  fireEvent.change(screen.getByPlaceholderText("Confirm new password"), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByRole("button", { name: /reset password/i }));
}

describe("ResetPasswordForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the reset heading and fields", () => {
    render(<ResetPasswordForm />);
    expect(screen.getByText("Reset your password")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Username")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Recovery code")).toBeInTheDocument();
  });

  it("shows an error and makes no request when passwords do not match", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetPasswordForm />);
    await act(async () => {
      fillAndSubmit("admin", "aaaaaaaa-bbbbbbbb-cccccccc-dddddddd", "password1", "password2");
    });
    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits to /api/auth/reset-password and shows a success screen", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, totpStillEnabled: false }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetPasswordForm />);
    await act(async () => {
      fillAndSubmit("admin", "aaaaaaaa-bbbbbbbb-cccccccc-dddddddd", "password1", "password1");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/reset-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "admin",
          recoveryCode: "aaaaaaaa-bbbbbbbb-cccccccc-dddddddd",
          newPassword: "password1",
        }),
      })
    );
    expect(screen.getByText("Password reset")).toBeInTheDocument();
  });

  it("mentions that 2FA is still required when totpStillEnabled is true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, totpStillEnabled: true }),
      } as Response)
    );
    render(<ResetPasswordForm />);
    await act(async () => {
      fillAndSubmit("admin", "aaaaaaaa-bbbbbbbb-cccccccc-dddddddd", "password1", "password1");
    });
    expect(screen.getByText(/authenticator app is still required/i)).toBeInTheDocument();
  });

  it("shows the server error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Invalid username or recovery code" }),
      } as Response)
    );
    render(<ResetPasswordForm />);
    await act(async () => {
      fillAndSubmit("admin", "wrong-code", "password1", "password1");
    });
    expect(screen.getByText("Invalid username or recovery code")).toBeInTheDocument();
  });
});
