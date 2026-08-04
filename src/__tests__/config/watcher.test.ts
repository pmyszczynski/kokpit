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
  vi.useRealTimers();
});

function createMockWatcher() {
  const errorHandlers: Array<(error: Error) => void> = [];
  const mockWatcher = {
    close: vi.fn(),
    on: vi.fn((event: string, handler: (error: Error) => void) => {
      if (event === "error") errorHandlers.push(handler);
      return mockWatcher;
    }),
    emitError(error = new Error("watch failed")) {
      errorHandlers.forEach((handler) => handler(error));
    },
  };
  return mockWatcher;
}

describe("config watcher", () => {
  it("startConfigWatcher() calls fs.watch() exactly once even when called multiple times", async () => {
    const fs = await import("fs");
    const watcherModule = await import("@/config/watcher");
    const mockWatcher = createMockWatcher();
    vi.mocked(fs.watch).mockReturnValue(mockWatcher as unknown as ReturnType<typeof fs.watch>);

    watcherModule.startConfigWatcher();
    watcherModule.startConfigWatcher();
    watcherModule.startConfigWatcher();

    expect(fs.watch).toHaveBeenCalledTimes(1);
    expect(fs.watch).toHaveBeenCalledWith("/tmp/fake-kokpit", expect.any(Function));
  });

  it("the watch callback calls invalidateCache()", async () => {
    const fs = await import("fs");
    const loader = await import("@/config/loader");
    const watcherModule = await import("@/config/watcher");

    const mockWatcher = createMockWatcher();
    let capturedCallback: ((eventType: string, filename?: string | Buffer) => void) | undefined;
    vi.mocked(fs.watch).mockImplementation(((_path: string, cb: (eventType: string, filename?: string | Buffer) => void) => {
      capturedCallback = cb;
      return mockWatcher;
    }) as unknown as typeof fs.watch);

    watcherModule.startConfigWatcher();

    expect(capturedCallback).toBeDefined();
    expect(loader.invalidateCache).not.toHaveBeenCalled();

    capturedCallback?.("rename", "settings.yaml");

    expect(loader.invalidateCache).toHaveBeenCalledTimes(1);

    capturedCallback?.("rename", "settings.yaml");
    expect(loader.invalidateCache).toHaveBeenCalledTimes(2);

    capturedCallback?.("change", "settings.yaml.tmp");
    expect(loader.invalidateCache).toHaveBeenCalledTimes(2);
  });

  it("stopConfigWatcher() closes the watcher and resets the singleton so a new watcher is created next time", async () => {
    const fs = await import("fs");
    const watcherModule = await import("@/config/watcher");

    const mockWatcher1 = createMockWatcher();
    const mockWatcher2 = createMockWatcher();
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

  it("closes and restarts after a runtime error, then handles later target-file events", async () => {
    vi.useFakeTimers();
    const fs = await import("fs");
    const loader = await import("@/config/loader");
    const watcherModule = await import("@/config/watcher");
    const callbacks: Array<(eventType: string, filename?: string | Buffer) => void> = [];
    const failedWatcher = createMockWatcher();
    const recoveredWatcher = createMockWatcher();
    vi.mocked(fs.watch)
      .mockImplementationOnce(((_path: string, callback: (eventType: string, filename?: string | Buffer) => void) => {
        callbacks.push(callback);
        return failedWatcher;
      }) as unknown as typeof fs.watch)
      .mockImplementationOnce(((_path: string, callback: (eventType: string, filename?: string | Buffer) => void) => {
        callbacks.push(callback);
        return recoveredWatcher;
      }) as unknown as typeof fs.watch);

    watcherModule.startConfigWatcher();
    failedWatcher.emitError();

    expect(failedWatcher.close).toHaveBeenCalledTimes(1);
    expect(fs.watch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);

    expect(fs.watch).toHaveBeenCalledTimes(2);
    callbacks[1]("rename", "settings.yaml");
    expect(loader.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it("cancels a scheduled restart when stopped", async () => {
    vi.useFakeTimers();
    const fs = await import("fs");
    const watcherModule = await import("@/config/watcher");
    const mockWatcher = createMockWatcher();
    vi.mocked(fs.watch).mockReturnValue(mockWatcher as unknown as ReturnType<typeof fs.watch>);

    watcherModule.startConfigWatcher();
    mockWatcher.emitError();
    watcherModule.stopConfigWatcher();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(fs.watch).toHaveBeenCalledTimes(1);
    expect(mockWatcher.close).toHaveBeenCalledTimes(1);
  });
});
