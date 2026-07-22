// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const searchMock = vi.fn();
vi.mock("@/auth", () => ({ isRequestAuthenticated: () => authMock() }));
vi.mock("@/lib/iconLibraries", () => ({
  searchIconLibraries: (...args: unknown[]) => searchMock(...args),
}));

async function route() {
  return import("../../app/api/icons/search/route");
}

beforeEach(() => {
  authMock.mockReset();
  searchMock.mockReset();
});

describe("GET /api/icons/search", () => {
  it("returns 401 when not authenticated", async () => {
    authMock.mockResolvedValue(false);
    const { GET } = await route();
    const res = await GET(new Request("http://localhost/api/icons/search?q=sonarr"));
    expect(res.status).toBe(401);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("returns an empty result set for a blank query without searching", async () => {
    authMock.mockResolvedValue(true);
    const { GET } = await route();
    const res = await GET(new Request("http://localhost/api/icons/search?q=%20%20"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("returns ranked results for a query", async () => {
    authMock.mockResolvedValue(true);
    const results = [
      { ref: "di-sonarr", name: "Sonarr", url: "https://cdn/x.svg", source: "dashboard-icons" },
    ];
    searchMock.mockResolvedValue(results);
    const { GET } = await route();
    const res = await GET(new Request("http://localhost/api/icons/search?q=sonarr"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results });
    expect(searchMock).toHaveBeenCalledWith("sonarr");
  });

  it("returns 502 when the search layer throws", async () => {
    authMock.mockResolvedValue(true);
    searchMock.mockRejectedValue(new Error("cdn down"));
    const { GET } = await route();
    const res = await GET(new Request("http://localhost/api/icons/search?q=sonarr"));
    expect(res.status).toBe(502);
  });
});
