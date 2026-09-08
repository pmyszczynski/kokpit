// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/config/server", () => ({
  getConfigSnapshot: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));
vi.mock("@/auth/session", () => ({
  SESSION_COOKIE_NAME: "session",
  getAuthUser: vi.fn(),
}));

import { cookies } from "next/headers";
import { getConfigSnapshot } from "@/config/server";
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
    vi.mocked(getConfigSnapshot).mockReturnValue({
      state: "ready",
      config: configWithAuth(true),
      source: "settings",
    });
    delete process.env.KOKPIT_AUTH_DISABLED;
  });

  afterEach(() => {
    delete process.env.KOKPIT_AUTH_DISABLED;
  });

  it("returns true without touching cookies when auth is disabled in config", async () => {
    vi.mocked(getConfigSnapshot).mockReturnValue({ state: "ready", config: configWithAuth(false), source: "settings" });
    await expect(isRequestAuthenticated()).resolves.toBe(true);
    expect(cookies).not.toHaveBeenCalled();
  });

  it("returns true when KOKPIT_AUTH_DISABLED overrides enabled auth", async () => {
    process.env.KOKPIT_AUTH_DISABLED = "true";
    vi.mocked(getConfigSnapshot).mockReturnValue({ state: "ready", config: configWithAuth(true), source: "settings" });
    await expect(isRequestAuthenticated()).resolves.toBe(true);
    expect(cookies).not.toHaveBeenCalled();
  });

  it("returns false when auth is enabled and no session cookie is present", async () => {
    vi.mocked(getConfigSnapshot).mockReturnValue({ state: "ready", config: configWithAuth(true), source: "settings" });
    stubCookie(undefined);
    vi.mocked(getAuthUser).mockResolvedValue(null);
    await expect(isRequestAuthenticated()).resolves.toBe(false);
    expect(getAuthUser).toHaveBeenCalledWith(undefined);
  });

  it("returns true when the session cookie resolves to a user", async () => {
    vi.mocked(getConfigSnapshot).mockReturnValue({ state: "ready", config: configWithAuth(true), source: "settings" });
    stubCookie("valid-token");
    vi.mocked(getAuthUser).mockResolvedValue(SAMPLE_USER);
    await expect(isRequestAuthenticated()).resolves.toBe(true);
    expect(getAuthUser).toHaveBeenCalledWith("valid-token");
  });

  it("returns false when the session token does not resolve to a user", async () => {
    vi.mocked(getConfigSnapshot).mockReturnValue({ state: "ready", config: configWithAuth(true), source: "settings" });
    stubCookie("expired-token");
    vi.mocked(getAuthUser).mockResolvedValue(null);
    await expect(isRequestAuthenticated()).resolves.toBe(false);
  });

  it("fails closed while the config source is being externally updated", async () => {
    vi.mocked(getConfigSnapshot).mockReturnValue({
      state: "dirty",
      config: configWithAuth(false),
      source: "previous-settings",
    });

    await expect(isRequestAuthenticated()).resolves.toBe(false);
    expect(cookies).not.toHaveBeenCalled();
  });

  it("uses a caller-provided stable config without reading a second snapshot", async () => {
    await expect(isRequestAuthenticated(configWithAuth(false))).resolves.toBe(true);
    expect(getConfigSnapshot).not.toHaveBeenCalled();
  });
});
