// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerSecret, loadConfig, startConfigWatcher } = vi.hoisted(() => ({
  getServerSecret: vi.fn(),
  loadConfig: vi.fn(),
  startConfigWatcher: vi.fn(),
}));

vi.mock("@/auth/serverSecret", () => ({ getServerSecret }));
vi.mock("@/config/server", () => ({ loadConfig }));
vi.mock("@/config/watcher", () => ({ startConfigWatcher }));

describe("Node runtime initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("validates the server key before loading configuration or starting its watcher", async () => {
    await import("@/instrumentation.node");

    expect(getServerSecret).toHaveBeenCalledTimes(1);
    expect(getServerSecret.mock.invocationCallOrder[0]).toBeLessThan(loadConfig.mock.invocationCallOrder[0]);
    expect(loadConfig.mock.invocationCallOrder[0]).toBeLessThan(startConfigWatcher.mock.invocationCallOrder[0]);
  });

  it("fails startup without publishing configuration when the deployment key is invalid", async () => {
    getServerSecret.mockImplementation(() => { throw new Error("invalid deployment key"); });

    await expect(import("@/instrumentation.node")).rejects.toThrow("invalid deployment key");
    expect(loadConfig).not.toHaveBeenCalled();
    expect(startConfigWatcher).not.toHaveBeenCalled();
  });
});
