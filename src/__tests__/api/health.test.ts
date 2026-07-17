// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GET } from "../../app/api/health/route";

describe("GET /api/health", () => {
  it("returns 200 with status, version, and timestamp", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(typeof json.version).toBe("string");
    expect(new Date(json.timestamp).getTime()).not.toBeNaN();
  });
});
