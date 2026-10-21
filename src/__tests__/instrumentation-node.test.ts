// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerSecret, loadConfig, startDatabaseLifecycle, startConfigWatcher } = vi.hoisted(() => ({
  getServerSecret: vi.fn(),
  loadConfig: vi.fn(),
  startDatabaseLifecycle: vi.fn(),
  startConfigWatcher: vi.fn(),
}));

vi.mock("@/auth/serverSecret", () => ({ getServerSecret }));
vi.mock("@/config/server", () => ({ loadConfig }));
vi.mock("@/config/watcher", () => ({ startConfigWatcher }));
vi.mock("@/auth/databaseLifecycle", () => ({ startDatabaseLifecycle }));

describe("Node runtime initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    loadConfig.mockReturnValue({ auth: { enabled: true } });
  });

  it("validates the key, publishes config, initializes the DB lifecycle and starts its watcher in order", async () => {
    await import("@/instrumentation.node");

    expect(getServerSecret).toHaveBeenCalledTimes(1);
    expect(getServerSecret.mock.invocationCallOrder[0]).toBeLessThan(loadConfig.mock.invocationCallOrder[0]);
    expect(loadConfig).toHaveBeenCalledOnce();
    expect(startDatabaseLifecycle).toHaveBeenCalledExactlyOnceWith(loadConfig.mock.results[0].value);
    expect(startConfigWatcher).toHaveBeenCalledOnce();
    expect(loadConfig.mock.invocationCallOrder[0]).toBeLessThan(startDatabaseLifecycle.mock.invocationCallOrder[0]);
    expect(startDatabaseLifecycle.mock.invocationCallOrder[0]).toBeLessThan(startConfigWatcher.mock.invocationCallOrder[0]);
  });

  it("fails startup without publishing configuration when the deployment key is invalid", async () => {
    getServerSecret.mockImplementation(() => { throw new Error("invalid deployment key"); });

    await expect(import("@/instrumentation.node")).rejects.toThrow("invalid deployment key");
    expect(loadConfig).not.toHaveBeenCalled();
    expect(startDatabaseLifecycle).not.toHaveBeenCalled();
    expect(startConfigWatcher).not.toHaveBeenCalled();
  });
});
