// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import { fetchStats } from "@/integrations/unraid/api";

const BASE_CONFIG = {
  url: "http://unraid.local",
  api_key: "abc123secret",
};

function makeGraphqlResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data }),
  };
}

function makeErrorResponse(status: number) {
  return { ok: false, status };
}

const BASE_ARRAY = {
  state: "STARTED",
  capacity: {
    kilobytes: { total: 10_000_000, used: 4_000_000 },
  },
  disks: [
    { type: "Data", status: "DISK_OK" },
    { type: "Data", status: "DISK_OK" },
    { type: "Parity", status: "DISK_OK" },
  ],
};

const BASE_VARS = {
  mdNumDisks: 2,
  mdNumInvalid: 0,
  parity1status: "",
  parity1errors: 0,
  parity1date: "2026-06-01",
};

// ---------------------------------------------------------------------------
// fetchStats
// ---------------------------------------------------------------------------

describe("fetchStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("computes correct stats from a well-formed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeGraphqlResponse({ array: BASE_ARRAY, vars: BASE_VARS })
      )
    );

    const result = await fetchStats(BASE_CONFIG);

    expect(result.arrayState).toBe("STARTED");
    expect(result.totalBytes).toBe(10_000_000 * 1024);
    expect(result.usedBytes).toBe(4_000_000 * 1024);
    expect(result.diskCount).toBe(2);
    expect(result.diskErrors).toBe(0);
    expect(result.parityStatus).toBe("");
    expect(result.parityErrors).toBe(0);
    expect(result.parityDate).toBe("2026-06-01");
  });

  it("POSTs to the graphql endpoint with the query and auth header", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeGraphqlResponse({ array: BASE_ARRAY, vars: BASE_VARS }));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats(BASE_CONFIG);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/graphql");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer abc123secret");
    expect(options.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(options.body);
    expect(body.query).toContain("array");
  });

  it("falls back to counting Data disks when vars.mdNumDisks is null", async () => {
    const vars = { ...BASE_VARS, mdNumDisks: null };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeGraphqlResponse({ array: BASE_ARRAY, vars }))
    );

    const result = await fetchStats(BASE_CONFIG);

    // BASE_ARRAY has 2 disks with type "Data"
    expect(result.diskCount).toBe(2);
  });

  it("falls back to counting failing Data disks when vars.mdNumInvalid is null", async () => {
    const array = {
      ...BASE_ARRAY,
      disks: [
        { type: "Data", status: "DISK_OK" },
        { type: "Data", status: "DISK_DBL" }, // failing
        { type: "Data", status: "DISK_NP" }, // not-present, excluded
        { type: "Parity", status: "DISK_DBL" }, // not Data, excluded
      ],
    };
    const vars = { ...BASE_VARS, mdNumInvalid: null };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeGraphqlResponse({ array, vars }))
    );

    const result = await fetchStats(BASE_CONFIG);

    expect(result.diskErrors).toBe(1);
  });

  it("uses vars.mdNumDisks/mdNumInvalid directly when present", async () => {
    const vars = { ...BASE_VARS, mdNumDisks: 5, mdNumInvalid: 2 };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeGraphqlResponse({ array: BASE_ARRAY, vars }))
    );

    const result = await fetchStats(BASE_CONFIG);

    expect(result.diskCount).toBe(5);
    expect(result.diskErrors).toBe(2);
  });

  it("throws when the HTTP response is non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeErrorResponse(401)));

    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow("Unraid responded with 401");
  });

  it("throws when the response body contains GraphQL errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          errors: [{ message: "not authorized" }, { message: "bad query" }],
        }),
      })
    );

    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow(
      "Unraid returned GraphQL errors: not authorized; bad query"
    );
  });

  it("throws a descriptive error when the JSON body cannot be parsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token");
        },
      })
    );

    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow(
      "Unraid returned invalid JSON from the GraphQL endpoint."
    );
  });

  it("throws a zod validation error on structurally-invalid data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeGraphqlResponse({
          array: { state: "STARTED" }, // missing capacity/disks
          vars: BASE_VARS,
        })
      )
    );

    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow();
  });

  it("forwards AbortSignal", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeGraphqlResponse({ array: BASE_ARRAY, vars: BASE_VARS }));
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchStats(BASE_CONFIG, controller.signal);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBe(controller.signal);
  });

  it("sets parityStatus/parityErrors/parityDate to null when absent from vars", async () => {
    const vars = {
      mdNumDisks: 2,
      mdNumInvalid: 0,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeGraphqlResponse({ array: BASE_ARRAY, vars }))
    );

    const result = await fetchStats(BASE_CONFIG);

    expect(result.parityStatus).toBeNull();
    expect(result.parityErrors).toBeNull();
    expect(result.parityDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Widget registration
// ---------------------------------------------------------------------------

describe("unraid-stats widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'unraid-stats' on import", async () => {
    await import("@/integrations/unraid/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("unraid-stats")).toBeDefined();
  });

  it("widget name is 'Unraid Stats'", async () => {
    await import("@/integrations/unraid/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("unraid-stats")?.name).toBe("Unraid Stats");
  });

  it("refreshInterval is 30000", async () => {
    await import("@/integrations/unraid/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("unraid-stats")?.refreshInterval).toBe(30_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/unraid/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("unraid-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10",
      api_key: "myapikey",
    });
    expect(result.success).toBe(true);
  });

  it("configSchema rejects invalid URL", async () => {
    await import("@/integrations/unraid/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("unraid-stats")!.configSchema.safeParse({
      url: "not-a-url",
      api_key: "myapikey",
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects empty api_key", async () => {
    await import("@/integrations/unraid/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("unraid-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10",
      api_key: "",
    });
    expect(result.success).toBe(false);
  });

  it("configFields contains url and api_key keys", async () => {
    await import("@/integrations/unraid/statsWidget");
    const { getWidget } = await import("@/widgets");
    const fields = getWidget("unraid-stats")?.configFields ?? [];
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("url");
    expect(keys).toContain("api_key");
  });
});
