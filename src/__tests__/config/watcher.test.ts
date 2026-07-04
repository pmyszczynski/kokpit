// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("fs", () => {
  const watch = vi.fn();
  return { watch };
});

vi.mock("@/config/loader", () => {
  const invalidateCache = vi.fn();
  const getConfigPath = vi.fn(() => "/tmp/fake-kokpit/settings.yaml");
  return { invalidateCache, getConfigPath };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("config watcher", () => {
  it("startConfigWatcher() calls fs.watch() exactly once even when called multiple times", async () => {
    const fs = await import("fs");
    const watcherModule = await import("@/config/watcher");
    const mockWatcher = { close: vi.fn() };
    vi.mocked(fs.watch).mockReturnValue(mockWatcher as unknown as ReturnType<typeof fs.watch>);

    watcherModule.startConfigWatcher();
    watcherModule.startConfigWatcher();
    watcherModule.startConfigWatcher();

    expect(fs.watch).toHaveBeenCalledTimes(1);
  });

  it("the watch callback calls invalidateCache()", async () => {
    const fs = await import("fs");
    const loader = await import("@/config/loader");
    const watcherModule = await import("@/config/watcher");

    const mockWatcher = { close: vi.fn() };
    let capturedCallback: (() => void) | undefined;
    vi.mocked(fs.watch).mockImplementation(((_path: string, cb: () => void) => {
      capturedCallback = cb;
      return mockWatcher;
    }) as unknown as typeof fs.watch);

    watcherModule.startConfigWatcher();

    expect(capturedCallback).toBeDefined();
    expect(loader.invalidateCache).not.toHaveBeenCalled();

    capturedCallback?.();

    expect(loader.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it("stopConfigWatcher() closes the watcher and resets the singleton so a new watcher is created next time", async () => {
    const fs = await import("fs");
    const watcherModule = await import("@/config/watcher");

    const mockWatcher1 = { close: vi.fn() };
    const mockWatcher2 = { close: vi.fn() };
    vi.mocked(fs.watch)
      .mockReturnValueOnce(mockWatcher1 as unknown as ReturnType<typeof fs.watch>)
      .mockReturnValueOnce(mockWatcher2 as unknown as ReturnType<typeof fs.watch>);

    watcherModule.startConfigWatcher();
    expect(fs.watch).toHaveBeenCalledTimes(1);

    watcherModule.stopConfigWatcher();
    expect(mockWatcher1.close).toHaveBeenCalledTimes(1);

    // Idempotent stop: calling again should not throw even though watcher is already null.
    expect(() => watcherModule.stopConfigWatcher()).not.toThrow();

    watcherModule.startConfigWatcher();
    expect(fs.watch).toHaveBeenCalledTimes(2);

    watcherModule.stopConfigWatcher();
    expect(mockWatcher2.close).toHaveBeenCalledTimes(1);
  });
});
