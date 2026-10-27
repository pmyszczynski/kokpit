// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createServiceStatusScheduler } from "@/lib/serviceStatusScheduler";
import type { ServiceProbeResult } from "@/lib/serviceStatus";

const result: ServiceProbeResult = { ok: true, reachable: true, assessment: "reachable", status: 200, checkedAt: 1000, responseTimeMs: 2 };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("shared service status scheduler", () => {
  it("shares pending work and original observations across staggered requests for 30 seconds", async () => {
    let now = 1000;
    let finish!: (value: ServiceProbeResult) => void;
    const probe = vi.fn(() => new Promise<ServiceProbeResult>(resolve => { finish = resolve; }));
    const scheduler = createServiceStatusScheduler({ probe, isCurrent: () => true, now: () => now });
    const first = scheduler.get("one", "http://saved", "generation");
    expect(scheduler.get("one", "http://saved", "generation")).toBe(first);
    finish(result); await first;
    now += 29_999;
    expect(await scheduler.get("one", "http://saved", "generation")).toEqual(result);
    expect(probe).toHaveBeenCalledTimes(1);
    now++;
    const second = scheduler.get("one", "http://saved", "generation");
    expect(probe).toHaveBeenCalledTimes(2);
    finish(result); await second;
  });
  it("bounds concurrency at eight and pending admission at one hundred without evicting active work", async () => {
    const finishes: ((value: ServiceProbeResult) => void)[] = [];
    const probe = vi.fn(() => new Promise<ServiceProbeResult>(resolve => finishes.push(resolve)));
    const scheduler = createServiceStatusScheduler({ probe, isCurrent: () => true });
    const pending = Array.from({ length: 100 }, (_, i) => scheduler.get(String(i), `http://saved/${i}`, "g"));
    expect(probe).toHaveBeenCalledTimes(8);
    expect(scheduler.get("0", "http://saved/0", "g")).toBe(pending[0]);
    expect(await scheduler.get("over-capacity", "http://saved/extra", "g")).toMatchObject({ reachable: null, reason: "capacity" });
    for (let i = 0; i < 100; i++) { finishes[i](result); await flush(); }
    await Promise.all(pending);
    expect(probe).toHaveBeenCalledTimes(100);
  });
  it("does not start queued destinations or cache results after their configuration changes", async () => {
    let generation = "old";
    const finishes: ((value: ServiceProbeResult) => void)[] = [];
    const probe = vi.fn(() => new Promise<ServiceProbeResult>(resolve => finishes.push(resolve)));
    const scheduler = createServiceStatusScheduler({ probe, isCurrent: value => generation === value });
    const pending = Array.from({ length: 10 }, (_, i) => scheduler.get(String(i), "http://old", "old"));
    generation = "new";
    for (const finish of finishes) finish(result);
    expect((await Promise.all(pending)).every(value => value.reachable === null && value.reason === "configuration-changed")).toBe(true);
    expect(probe).toHaveBeenCalledTimes(8);
    const replacement = scheduler.get("replacement", "http://new", "new");
    expect(probe).toHaveBeenCalledTimes(9);
    finishes[8](result); expect(await replacement).toEqual(result);
  });
  it("backs off unsuccessful services independently and resets after recovery", async () => {
    let now = 0;
    const failed: ServiceProbeResult = { ok: false, reachable: false, assessment: "unreachable", reason: "timeout", checkedAt: 0, responseTimeMs: 5000 };
    const probe = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(failed).mockResolvedValue(result);
    const scheduler = createServiceStatusScheduler({ probe, isCurrent: () => true, now: () => now });
    await scheduler.get("one", "http://saved", "g"); now = 30_000;
    await scheduler.get("one", "http://saved", "g"); now += 59_999;
    await scheduler.get("one", "http://saved", "g"); expect(probe).toHaveBeenCalledTimes(2);
    now++; await scheduler.get("one", "http://saved", "g"); now += 30_000;
    await scheduler.get("one", "http://saved", "g"); expect(probe).toHaveBeenCalledTimes(4);
  });
});
