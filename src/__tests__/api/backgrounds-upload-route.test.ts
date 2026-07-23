// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ isRequestAuthenticated: () => authMock() }));

let uploadsDir: string;

beforeEach(() => {
  authMock.mockReset();
  uploadsDir = mkdtempSync(path.join(tmpdir(), "kokpit-bg-route-"));
  process.env.KOKPIT_UPLOADS_PATH = uploadsDir;
});

afterEach(() => {
  rmSync(uploadsDir, { recursive: true, force: true });
  delete process.env.KOKPIT_UPLOADS_PATH;
});

function uploadRequest(file: File): Request {
  const body = new FormData();
  body.append("file", file);
  return new Request("http://localhost/api/backgrounds/upload", { method: "POST", body });
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe("POST /api/backgrounds/upload", () => {
  it("returns 401 when not authenticated", async () => {
    authMock.mockResolvedValue(false);
    const { POST } = await import("../../app/api/backgrounds/upload/route");
    const res = await POST(uploadRequest(new File([PNG], "a.png", { type: "image/png" })));
    expect(res.status).toBe(401);
  });

  it("rejects an SVG (raster-only allowlist)", async () => {
    authMock.mockResolvedValue(true);
    const { POST } = await import("../../app/api/backgrounds/upload/route");
    const svg = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'],
      "a.svg",
      { type: "image/svg+xml" }
    );
    const res = await POST(uploadRequest(svg));
    expect(res.status).toBe(415);
  });

  it("stores a valid PNG and returns its served backgrounds path", async () => {
    authMock.mockResolvedValue(true);
    const { POST } = await import("../../app/api/backgrounds/upload/route");
    const res = await POST(uploadRequest(new File([PNG], "bg.png", { type: "image/png" })));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { path: string };
    expect(json.path).toMatch(/^\/api\/backgrounds\/user\/[a-f0-9]{32}\.png$/);
  });

  it("serves a stored background back through the GET route", async () => {
    authMock.mockResolvedValue(true);
    const { POST } = await import("../../app/api/backgrounds/upload/route");
    const uploadRes = await POST(
      uploadRequest(new File([PNG], "bg.png", { type: "image/png" }))
    );
    const { path: served } = (await uploadRes.json()) as { path: string };
    const file = served.split("/").pop() as string;

    const { GET } = await import("../../app/api/backgrounds/user/[file]/route");
    const getRes = await GET(new Request(`http://localhost${served}`), {
      params: Promise.resolve({ file }),
    });
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("Content-Type")).toBe("image/png");
    expect(getRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(getRes.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("rejects an oversized Content-Length up front, without parsing the body", async () => {
    authMock.mockResolvedValue(true);
    const { POST } = await import("../../app/api/backgrounds/upload/route");
    const req = new Request("http://localhost/api/backgrounds/upload", {
      method: "POST",
      headers: { "content-length": String(20 * 1024 * 1024) }, // well over the 8 MB cap
      body: "irrelevant",
    });
    const formDataSpy = vi.spyOn(req, "formData");
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect((await res.json()) as { error: string }).toEqual({
      error: "File exceeds the 8 MB limit",
    });
    expect(formDataSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/backgrounds/user/[file]", () => {
  it("returns 401 when not authenticated", async () => {
    authMock.mockResolvedValue(false);
    const { GET } = await import("../../app/api/backgrounds/user/[file]/route");
    const res = await GET(new Request("http://localhost/api/backgrounds/user/abc.png"), {
      params: Promise.resolve({ file: "deadbeefdeadbeefdeadbeefdeadbeef.png" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a path-traversal filename", async () => {
    authMock.mockResolvedValue(true);
    const { GET } = await import("../../app/api/backgrounds/user/[file]/route");
    const res = await GET(new Request("http://localhost/api/backgrounds/user/x"), {
      params: Promise.resolve({ file: "../../etc/passwd" }),
    });
    expect(res.status).toBe(404);
  });
});
