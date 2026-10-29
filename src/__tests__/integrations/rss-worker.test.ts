// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEmitter } from "node:events";
import type { RssData } from "@/integrations/rss/api";

interface ParserWorker extends EventEmitter {
  filename: string;
  options: { workerData: unknown; resourceLimits: Record<string, number> };
  terminate: ReturnType<typeof vi.fn<() => Promise<number>>>;
  stdout: { resume: ReturnType<typeof vi.fn> };
  stderr: { resume: ReturnType<typeof vi.fn> };
}

const mocked = vi.hoisted(() => ({ workers: [] as ParserWorker[], constructed: vi.fn() }));
vi.mock("@/lib/ssrfGuard", () => ({ ssrfSafeFetch: vi.fn() }));
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Worker: class extends EventEmitter {
      terminate = vi.fn(async () => 0);
      stdout = { resume: vi.fn() };
      stderr = { resume: vi.fn() };
      constructor(public filename: string, public options: ParserWorker["options"]) {
        super();
        mocked.constructed(filename, options);
        mocked.workers.push(this);
      }
    },
  };
});

let parseFeedIsolated: typeof import("@/integrations/rss/server").parseFeedIsolated;
const xml = "<rss><channel><title>Feed</title></channel></rss>";
const feedUrl = "https://example.com/feed";
const data: RssData = { title: "Feed", articles: [] };

beforeEach(async () => {
  vi.resetModules();
  mocked.workers.length = 0;
  mocked.constructed.mockClear();
  ({ parseFeedIsolated } = await import("@/integrations/rss/server"));
});
afterEach(() => vi.useRealTimers());

describe("isolated RSS parsing", () => {
  it("runs a bounded worker and terminates it before delivering the result", async () => {
    const pending = parseFeedIsolated(xml, feedUrl, 10);
    const worker = mocked.workers[0];
    expect(worker.filename).toMatch(/src\/integrations\/rss\/parser\.cjs$/);
    expect(worker.options).toMatchObject({
      workerData: { xml, feedUrl, maxItems: 10 },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    });
    expect(worker.stdout.resume).toHaveBeenCalled();
    expect(worker.stderr.resume).toHaveBeenCalled();
    worker.emit("message", { data });
    await expect(pending).resolves.toEqual(data);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    // A late exit or error cannot resolve/reject the request a second time.
    worker.emit("exit", 1);
    worker.emit("error", new Error("private upstream detail"));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not start a worker for an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(parseFeedIsolated(xml, feedUrl, 10, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocked.constructed).not.toHaveBeenCalled();
  });

  it("terminates active parsing when its consumer aborts", async () => {
    const controller = new AbortController();
    const pending = parseFeedIsolated(xml, feedUrl, 10, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(mocked.workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it.each([false, 0, ""])("preserves the falsy explicit abort reason %j as a rejection", async reason => {
    const controller = new AbortController();
    const pending = parseFeedIsolated(xml, feedUrl, 10, controller.signal);
    const rejected = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    expect(mocked.workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it("interrupts a parser that does not respond within its time budget", async () => {
    vi.useFakeTimers();
    const pending = parseFeedIsolated(xml, feedUrl, 10);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "widget_invalid_response",
      diagnostic: { integration: "rss", stage: "parse-budget" },
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await rejected;
    expect(mocked.workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "exit", "invalid-result"])("bounds worker %s failures and releases the worker", async failure => {
    const pending = parseFeedIsolated(xml, feedUrl, 10);
    const rejected = expect(pending).rejects.toMatchObject({ code: "widget_invalid_response", message: "Widget integration failure" });
    const worker = mocked.workers[0];
    if (failure === "error") worker.emit("error", new Error("https://private.example/secret"));
    else if (failure === "exit") worker.emit("exit", 1);
    else worker.emit("message", { error: true });
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("holds concurrency capacity until a terminated worker has actually exited", async () => {
    const requests = Array.from({ length: 4 }, () => parseFeedIsolated(xml, feedUrl, 10));
    await expect(parseFeedIsolated(xml, feedUrl, 10)).rejects.toMatchObject({ diagnostic: { integration: "rss", stage: "busy", retryable: true } });
    expect(mocked.constructed).toHaveBeenCalledTimes(4);

    let stopped!: (exitCode: number) => void;
    mocked.workers[0].terminate.mockImplementation(() => new Promise<number>(resolve => { stopped = resolve; }));
    mocked.workers[0].emit("message", { data });
    await expect(parseFeedIsolated(xml, feedUrl, 10)).rejects.toMatchObject({ diagnostic: { stage: "busy" } });
    expect(mocked.constructed).toHaveBeenCalledTimes(4);

    stopped(0);
    await expect(requests[0]).resolves.toEqual(data);
    const replacement = parseFeedIsolated(xml, feedUrl, 10);
    expect(mocked.constructed).toHaveBeenCalledTimes(5);
    for (const worker of mocked.workers.slice(1)) worker.emit("message", { data });
    await expect(Promise.all([...requests.slice(1), replacement])).resolves.toHaveLength(4);
  });
});
