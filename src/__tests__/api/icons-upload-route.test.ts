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
  uploadsDir = mkdtempSync(path.join(tmpdir(), "kokpit-upload-route-"));
  process.env.KOKPIT_UPLOADS_PATH = uploadsDir;
});

afterEach(() => {
  rmSync(uploadsDir, { recursive: true, force: true });
  delete process.env.KOKPIT_UPLOADS_PATH;
});

function uploadRequest(file: File): Request {
  const body = new FormData();
  body.append("file", file);
  return new Request("http://localhost/api/icons/upload", { method: "POST", body });
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe("POST /api/icons/upload", () => {
  it("returns 401 when not authenticated", async () => {
    authMock.mockResolvedValue(false);
    const { POST } = await import("../../app/api/icons/upload/route");
    const res = await POST(uploadRequest(new File([PNG], "a.png", { type: "image/png" })));
    expect(res.status).toBe(401);
  });

  it("rejects a disallowed type", async () => {
    authMock.mockResolvedValue(true);
    const { POST } = await import("../../app/api/icons/upload/route");
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], "a.gif", { type: "image/gif" });
    const res = await POST(uploadRequest(gif));
    expect(res.status).toBe(415);
  });

  it("stores a valid PNG and returns its served path", async () => {
    authMock.mockResolvedValue(true);
    const { POST } = await import("../../app/api/icons/upload/route");
    const res = await POST(uploadRequest(new File([PNG], "logo.png", { type: "image/png" })));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { path: string };
    expect(json.path).toMatch(/^\/api\/icons\/user\/[a-f0-9]{32}\.png$/);
  });

  it("sanitizes a malicious SVG so the served bytes have no executable content", async () => {
    authMock.mockResolvedValue(true);
    const { POST } = await import("../../app/api/icons/upload/route");
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="4" height="4"/></svg>';
    const uploadRes = await POST(
      uploadRequest(new File([malicious], "x.svg", { type: "image/svg+xml" }))
    );
    expect(uploadRes.status).toBe(200);
    const { path: served } = (await uploadRes.json()) as { path: string };
    const file = served.split("/").pop() as string;

    // Serve it back through the real route and assert the sanitized output.
    const { GET } = await import("../../app/api/icons/user/[file]/route");
    const getRes = await GET(new Request(`http://localhost${served}`), {
      params: Promise.resolve({ file }),
    });
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(getRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(getRes.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const text = (await getRes.text()).toLowerCase();
    expect(text).not.toContain("<script");
    expect(text).not.toContain("onload");
    expect(text).toContain("<rect");
  });

  it("rejects an oversized Content-Length up front, without parsing the body", async () => {
    authMock.mockResolvedValue(true);
    const { POST } = await import("../../app/api/icons/upload/route");
    const req = new Request("http://localhost/api/icons/upload", {
      method: "POST",
      headers: { "content-length": String(10 * 1024 * 1024) }, // well over the 2 MB cap
      body: "irrelevant",
    });
    const formDataSpy = vi.spyOn(req, "formData");
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect((await res.json()) as { error: string }).toEqual({
      error: "File exceeds the 2 MB limit",
    });
    expect(formDataSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/icons/user/[file]", () => {
  it("returns 401 when not authenticated", async () => {
    authMock.mockResolvedValue(false);
    const { GET } = await import("../../app/api/icons/user/[file]/route");
    const res = await GET(new Request("http://localhost/api/icons/user/abc.png"), {
      params: Promise.resolve({ file: "deadbeefdeadbeefdeadbeefdeadbeef.png" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a path-traversal filename", async () => {
    authMock.mockResolvedValue(true);
    const { GET } = await import("../../app/api/icons/user/[file]/route");
    const res = await GET(new Request("http://localhost/api/icons/user/x"), {
      params: Promise.resolve({ file: "../../etc/passwd" }),
    });
    expect(res.status).toBe(404);
  });
});
