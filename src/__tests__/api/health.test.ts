// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import { GET } from "../../app/api/health/route";
import { readFileSync } from "node:fs";
import path from "node:path";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health", () => {
  it("returns 200 with status, version, and timestamp", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.version).toBe((JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string }).version);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(new Date(json.timestamp).getTime()).not.toBeNaN();
  });

  it("uses compiled artifact identity even when runtime version variables are changed", async () => {
    vi.stubEnv("npm_package_version", "999.0.0-spoofed");
    vi.stubEnv("KOKPIT_BUILD_VERSION", "999.0.0-spoofed");
    const packageVersion = (JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string }).version;
    expect((await (await GET()).json()).version).toBe(packageVersion);
  });
});
