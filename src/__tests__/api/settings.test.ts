// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("node:fs", () => {
  const readFileSync = vi.fn();
  const writeFileSync = vi.fn();
  const existsSync = vi.fn().mockReturnValue(true);
  const mkdirSync = vi.fn();
  return {
    default: { readFileSync, writeFileSync, existsSync, mkdirSync },
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
  };
});
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}));

process.env.KOKPIT_AUTH_DISABLED = "true";

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASE_YAML = `
schema_version: 1
auth:
  enabled: false
  session_ttl_hours: 24
appearance:
  theme: dark
layout:
  columns: 4
  row_height: 120
services: []
`.trim();

const VIEWPORT_YAML = `
schema_version: 1
auth:
  enabled: false
  session_ttl_hours: 24
appearance:
  theme: dark
layout:
  columns: 4
  row_height: 120
  tablet:
    columns: 2
  mobile:
    columns: 1
    row_height: 80
services: []
`.trim();

function patch(body: unknown) {
  return new NextRequest("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(existsSync).mockReturnValue(true);
});

describe("PATCH /api/settings – validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML);
    vi.mocked(writeFileSync).mockImplementation(() => undefined);
  });

  it("returns 400 for malformed JSON", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const req = new NextRequest("http://localhost/api/settings", {
      method: "PATCH",
      body: "not json",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid json/i);
  });

  it("returns 400 when layout.columns is zero", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(patch({ layout: { columns: 0, row_height: 120 } }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when tablet.columns is zero", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({ layout: { columns: 4, row_height: 120, tablet: { columns: 0 } } })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown theme value", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(patch({ appearance: { theme: "rainbow" } }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/settings – layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML);
    vi.mocked(writeFileSync).mockImplementation(() => undefined);
  });

  it("saves desktop-only layout and returns 200", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(patch({ layout: { columns: 6, row_height: 150 } }));
    expect(res.status).toBe(200);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("6");
  });

  it("saves layout with tablet override", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({ layout: { columns: 4, row_height: 120, tablet: { columns: 2 } } })
    );
    expect(res.status).toBe(200);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("tablet");
  });

  it("saves layout with both tablet and mobile overrides", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({
        layout: {
          columns: 4,
          row_height: 120,
          tablet: { columns: 2, row_height: 100 },
          mobile: { columns: 1, row_height: 80 },
        },
      })
    );
    expect(res.status).toBe(200);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("tablet");
    expect(written).toContain("mobile");
  });
});

describe("PATCH /api/settings – appearance & services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML);
    vi.mocked(writeFileSync).mockImplementation(() => undefined);
  });

  it("saves appearance theme", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(patch({ appearance: { theme: "light" } }));
    expect(res.status).toBe(200);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("light");
  });

  it("saves services list", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({
        services: [
          { name: "Jellyfin", url: "http://jellyfin.local", group: "Media" },
        ],
      })
    );
    expect(res.status).toBe(200);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("Jellyfin");
  });
});

describe("PATCH /api/settings – groups, bookmarks & new layout/service fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML);
    vi.mocked(writeFileSync).mockImplementation(() => undefined);
  });

  it("saves a groups array", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({
        groups: [
          { name: "Media", collapsed: false, columns: 4 },
          { name: "Downloads" },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("groups:");
    expect(written).toContain("Media");
    expect(written).toContain("Downloads");
  });

  it("returns 400 for duplicate group names and writes nothing", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({ groups: [{ name: "Media" }, { name: "media" }] })
    );
    expect(res.status).toBe(400);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("saves a bookmarks array", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({
        bookmarks: [
          {
            name: "Dev",
            accent: "#7aa2f7",
            style: "list",
            placement: { group: "Infrastructure", size: "tall" },
            links: [
              { name: "GitHub", url: "https://github.com", icon: "sh-github" },
            ],
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("bookmarks:");
    expect(written).toContain("GitHub");
    expect(written).toContain("https://github.com");
  });

  it("returns 400 for a bookmark link with an invalid URL", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({
        bookmarks: [{ name: "Dev", links: [{ name: "Bad", url: "nope" }] }],
      })
    );
    expect(res.status).toBe(400);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("saves layout.ungrouped", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({ layout: { columns: 4, row_height: 120, ungrouped: "first" } })
    );
    expect(res.status).toBe(200);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("ungrouped: first");
  });

  it("returns 400 for an invalid layout.ungrouped value", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({ layout: { columns: 4, row_height: 120, ungrouped: "middle" } })
    );
    expect(res.status).toBe(400);
  });

  it("saves services with a size preset", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({
        services: [
          { name: "Plex", url: "http://plex.local", size: "large" },
        ],
      })
    );
    expect(res.status).toBe(200);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("size: large");
  });

  it("returns 400 for an invalid service size", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({ services: [{ name: "Plex", size: "huge" }] })
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/settings – auth", () => {
  const AUTH_ENABLED_YAML = BASE_YAML.replace("enabled: false", "enabled: true");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(AUTH_ENABLED_YAML);
    vi.mocked(writeFileSync).mockImplementation(() => undefined);
    process.env.KOKPIT_AUTH_DISABLED = "false";
  });

  afterEach(() => {
    process.env.KOKPIT_AUTH_DISABLED = "true";
  });

  it("GET returns 401 without a session when auth is enabled", async () => {
    const { GET } = await import("../../app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("PATCH returns 401 and writes nothing without a session when auth is enabled", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(patch({ appearance: { theme: "light" } }));
    expect(res.status).toBe(401);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("succeeds without a session when KOKPIT_AUTH_DISABLED is set", async () => {
    process.env.KOKPIT_AUTH_DISABLED = "true";
    const { GET } = await import("../../app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
  });
});

describe("GET /api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML);
  });

  it("returns the current config with status 200", async () => {
    const { GET } = await import("../../app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.layout.columns).toBe(4);
    expect(json.appearance.theme).toBe("dark");
  });

  it("returns viewport layout overrides when configured", async () => {
    vi.mocked(readFileSync).mockReturnValue(VIEWPORT_YAML);
    const { GET } = await import("../../app/api/settings/route");
    const res = await GET();
    const json = await res.json();
    expect(json.layout.tablet?.columns).toBe(2);
    expect(json.layout.mobile?.columns).toBe(1);
    expect(json.layout.mobile?.row_height).toBe(80);
  });
});
