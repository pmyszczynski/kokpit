// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/config", () => ({
  getConfig: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));
vi.mock("@/auth/session", () => ({
  SESSION_COOKIE_NAME: "session",
  getAuthUser: vi.fn(),
}));

import { cookies } from "next/headers";
import { getConfig } from "@/config";
import { getAuthUser } from "@/auth/session";
import { isRequestAuthenticated } from "@/auth/apiAuth";
import type { KokpitConfig } from "@/config";
import type { User } from "@/auth";

function configWithAuth(enabled: boolean): KokpitConfig {
  return { auth: { enabled, session_ttl_hours: 24 } } as KokpitConfig;
}

function stubCookie(token: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) =>
      name === "session" && token !== undefined ? { name, value: token } : undefined,
    // Only `get` is exercised; the rest of the ReadonlyRequestCookies
    // surface is irrelevant here.
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

const SAMPLE_USER = { id: "u1", username: "admin" } as User;

describe("isRequestAuthenticated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KOKPIT_AUTH_DISABLED;
  });

  afterEach(() => {
    delete process.env.KOKPIT_AUTH_DISABLED;
  });

  it("returns true without touching cookies when auth is disabled in config", async () => {
    vi.mocked(getConfig).mockReturnValue(configWithAuth(false));
    await expect(isRequestAuthenticated()).resolves.toBe(true);
    expect(cookies).not.toHaveBeenCalled();
  });

  it("returns true when KOKPIT_AUTH_DISABLED overrides enabled auth", async () => {
    process.env.KOKPIT_AUTH_DISABLED = "true";
    vi.mocked(getConfig).mockReturnValue(configWithAuth(true));
    await expect(isRequestAuthenticated()).resolves.toBe(true);
    expect(cookies).not.toHaveBeenCalled();
  });

  it("returns false when auth is enabled and no session cookie is present", async () => {
    vi.mocked(getConfig).mockReturnValue(configWithAuth(true));
    stubCookie(undefined);
    vi.mocked(getAuthUser).mockResolvedValue(null);
    await expect(isRequestAuthenticated()).resolves.toBe(false);
    expect(getAuthUser).toHaveBeenCalledWith(undefined);
  });

  it("returns true when the session cookie resolves to a user", async () => {
    vi.mocked(getConfig).mockReturnValue(configWithAuth(true));
    stubCookie("valid-token");
    vi.mocked(getAuthUser).mockResolvedValue(SAMPLE_USER);
    await expect(isRequestAuthenticated()).resolves.toBe(true);
    expect(getAuthUser).toHaveBeenCalledWith("valid-token");
  });

  it("returns false when the session token does not resolve to a user", async () => {
    vi.mocked(getConfig).mockReturnValue(configWithAuth(true));
    stubCookie("expired-token");
    vi.mocked(getAuthUser).mockResolvedValue(null);
    await expect(isRequestAuthenticated()).resolves.toBe(false);
  });
});
