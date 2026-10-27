// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
const fetch = vi.hoisted(() => vi.fn());
const snapshot = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ isRequestAuthenticated: auth }));
vi.mock("@/config/server", () => ({ getConfigSnapshot: snapshot, getPublishedConfigSnapshot: snapshot }));
vi.mock("@/lib/ssrfGuard", () => ({ ssrfSafeFetch: fetch }));
const id = "10000000-0000-4000-8000-000000000001";
const second = "10000000-0000-4000-8000-000000000002";
const request = (ids = id) => new Request(`http://localhost/api/status?ids=${ids}`);
const config = { services: [{ id, launch_url: "http://192.168.1.10/" }, { id: second, launch_url: "https://second.example/" }] };
let current: { state: string; config: typeof config | null; source: string | null };
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  current = { state: "ready", config, source: "private configuration with credentials" };
  snapshot.mockImplementation(() => current); auth.mockResolvedValue(true);
  fetch.mockImplementation(async () => new Response(null, { status: 401 }));
});
afterEach(() => vi.useRealTimers());

describe("GET /api/status", () => {
  it("batches saved IDs, shares observations across requests and disables HTTP caching", async () => {
    const { GET } = await import("@/app/api/status/route");
    const one = await GET(request(`${id},${second},${id}`));
    expect(one.status).toBe(200);
    expect(one.headers.get("Cache-Control")).toBe("private, no-store");
    expect(one.headers.get("Vary")).toBe("Cookie");
    const body = await one.json();
    expect(Object.keys(body.statuses)).toEqual([id, second]);
    expect(body.statuses[id]).toMatchObject({ reachable: true, status: 401, assessment: "authentication-required" });
    const again = await (await GET(request())).json();
    expect(again.statuses[id]).toEqual(body.statuses[id]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(config.services[0].launch_url, expect.objectContaining({ method: "HEAD", followRedirects: false, allowPrivateNetworks: true }));
    expect(JSON.stringify(body)).not.toMatch(/192\.168|credentials|private configuration/);
  });
  it("validates the whole batch before starting outbound work", async () => {
    const { GET } = await import("@/app/api/status/route");
    for (const url of [request(""), request("http://169.254.169.254/"), request(Array(21).fill(id).join(",")), request(`${id},invalid`)]) expect((await GET(url)).status).toBe(400);
    expect((await GET(request(`${id},20000000-0000-4000-8000-000000000001`))).status).toBe(404);
    current.config = { services: [{ id, launch_url: "ftp://private.example/" }] };
    expect((await GET(request())).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed on unauthorized or dirty configuration before admission", async () => {
    const { GET } = await import("@/app/api/status/route");
    auth.mockResolvedValueOnce(false); expect((await GET(request())).status).toBe(401);
    current.state = "dirty"; expect((await GET(request())).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rechecks configuration after initial authorization before starting requests", async () => {
    const { GET } = await import("@/app/api/status/route");
    auth.mockImplementationOnce(async () => { current = { ...current, source: "new" }; return true; });
    expect((await GET(request())).status).toBe(409); expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed if the configuration changes while final authorization is yielding", async () => {
    const { GET } = await import("@/app/api/status/route");
    auth.mockResolvedValueOnce(true).mockImplementationOnce(async () => {
      current = { ...current, source: "replacement configuration" }; return true;
    });
    const response = await GET(request());
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("statuses");
  });
  it.each(["config", "authorization"])("does not expose an observation after in-flight %s changes", async kind => {
    let finish!: (value: Response) => void;
    fetch.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    const { GET } = await import("@/app/api/status/route");
    const pending = GET(request());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    if (kind === "config") current = { ...current, source: "changed" };
    else auth.mockResolvedValue(false);
    finish(new Response(null, { status: 200 }));
    const response = await pending;
    expect(response.status).toBe(kind === "config" ? 409 : 401);
    expect(await response.json()).not.toHaveProperty("statuses");
  });
});
