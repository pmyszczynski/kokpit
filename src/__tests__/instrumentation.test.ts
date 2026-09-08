import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const instrumentationNodeLoaded = vi.hoisted(() => vi.fn());

vi.mock("@/instrumentation.node", () => {
  instrumentationNodeLoaded();
  return {};
});

describe("instrumentation register", () => {
  beforeEach(() => {
    vi.resetModules();
    instrumentationNodeLoaded.mockClear();
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
  });

  afterEach(() => {
    delete process.env.NEXT_RUNTIME;
    delete process.env.NEXT_PHASE;
  });

  it("does not initialize runtime state during a production build", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    const { register } = await import("@/instrumentation");

    await register();

    expect(instrumentationNodeLoaded).not.toHaveBeenCalled();
  });

  it("initializes runtime state when the Node server starts", async () => {
    const { register } = await import("@/instrumentation");

    await register();

    expect(instrumentationNodeLoaded).toHaveBeenCalledTimes(1);
  });
});
