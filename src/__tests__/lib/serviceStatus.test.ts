import { describe, expect, it } from "vitest";
import { assessHttpStatus, parseServiceProbe } from "@/lib/serviceStatus";

describe("service probe result boundary", () => {
  it("keeps legacy successful observations but derives the assessment from actual HTTP status", () => {
    expect(parseServiceProbe({ ok: true, status: 503, assessment: "reachable" })).toEqual({
      ok: true, reachable: true, status: 503, assessment: "degraded", checkedAt: null, responseTimeMs: null,
    });
    expect(assessHttpStatus(501)).toBe("method-unsupported");
  });

  it.each([{}, { reachable: true }])("retains legacy or explicit successful observations and valid metadata %#", payload => {
    expect(parseServiceProbe({
      ok: true, status: 503, assessment: "reachable", checkedAt: 1_729_512_000_000,
      responseTimeMs: 12.5, ...payload,
    })).toEqual({
      ok: true, reachable: true, status: 503, assessment: "degraded",
      checkedAt: 1_729_512_000_000, responseTimeMs: 12.5,
    });
  });

  it.each([
    { reachable: false }, { reachable: null }, { reachable: undefined },
    { reachable: 0 }, { reachable: 1 }, { reachable: "true" }, { reachable: "false" },
    { reachable: [] }, { reachable: {} },
  ])("rejects contradictory or malformed reachability in successful observations %#", payload => {
    expect(parseServiceProbe({
      ok: true, status: 200, checkedAt: 1_729_512_000_000, responseTimeMs: 12.5, ...payload,
    })).toBeNull();
  });

  it.each([null, [], "invalid", { ok: false }, { ok: true }, { ok: true, status: 999 },
    { ok: false, reachable: false, assessment: "unreachable", reason: "private arbitrary failure" },
  ])("rejects ambiguous or malformed responses %#", value => {
    expect(parseServiceProbe(value)).toBeNull();
  });

  it("ignores impossible timestamps and invalid latency without allowing date formatting to throw", () => {
    expect(parseServiceProbe({ ok: true, status: 200, checkedAt: 1e300, responseTimeMs: -1 })).toMatchObject({
      checkedAt: null, responseTimeMs: null,
    });
  });
});
