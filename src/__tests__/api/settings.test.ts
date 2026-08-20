// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("proper-lockfile", () => ({ lockSync: vi.fn(() => () => undefined) }));
import { NextRequest } from "next/server";

vi.mock("node:fs", () => {
  const readFileSync = vi.fn();
  const writeFileSync = vi.fn();
  const linkSync = vi.fn();
  const unlinkSync = vi.fn();
  const existsSync = vi.fn((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
  const mkdirSync = vi.fn();
  const renameSync = vi.fn();
  const statSync = vi.fn().mockReturnValue({ mode: 0o100600 });
  const chmodSync = vi.fn();
  return {
    default: { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync, chmodSync },
    readFileSync,
    writeFileSync,
    linkSync,
    unlinkSync,
    existsSync,
    mkdirSync,
    renameSync,
    statSync,
    chmodSync,
  };
});
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}));

process.env.KOKPIT_AUTH_DISABLED = "true";

import { existsSync, linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import {
  WIDGET_SECRET_REFERENCE_KEY,
  WIDGET_SECRET_REFERENCE_PREFIX,
} from "@/widgets/secretReference";

const BASE_YAML = `
schema_version: 2
auth:
  enabled: false
  session_ttl_hours: 24
appearance:
  theme: dark
layout: {}
services: []
service_tiles: []
`.trim();

const VIEWPORT_YAML = `
schema_version: 2
auth:
  enabled: false
  session_ttl_hours: 24
appearance:
  theme: dark
layout:
  columns: 9
  row_height: 88
  tablet: { columns: 6, row_height: 72 }
  mobile: { columns: 3, row_height: 60 }
services: []
service_tiles: []
`.trim();

const SECRET_YAML = `
schema_version: 2
auth: { enabled: false, session_ttl_hours: 24 }
appearance: { theme: dark }
layout: {}
services:
  - id: 10000000-0000-4000-8000-000000000001
    name: Tautulli
    launch_url: http://tautulli.local:8181
    integration:
      type: tautulli
      config: { url: http://tautulli.local:8181, api_key: tautulli-secret-value }
  - id: 10000000-0000-4000-8000-000000000002
    name: Downloads
    launch_url: http://qbittorrent.local:8080
    integration:
      type: qbittorrent
      config: { url: http://qbittorrent.local:8080, username: admin, password: qbittorrent-secret-value }
service_tiles:
  - id: 20000000-0000-4000-8000-000000000001
    service_id: 10000000-0000-4000-8000-000000000001
    footprint: { columnSpan: 3, rowSpan: 4 }
    widget: { type: tautulli-activity, config: { sections: [summary] } }
  - id: 20000000-0000-4000-8000-000000000002
    service_id: 10000000-0000-4000-8000-000000000002
    footprint: { columnSpan: 6, rowSpan: 2 }
    widget: { type: qbittorrent-stats }
`.trim();

const TILE_SECRET_YAML = SECRET_YAML.replace(
  "config: { sections: [summary] }",
  "config: { client_secret: tile-secret-value, sections: [summary] }"
);

const UNKNOWN_WIDGET_SECRET_YAML = `
schema_version: 2
auth: { enabled: false, session_ttl_hours: 24 }
appearance: { theme: dark }
layout: {}
services:
  - id: 10000000-0000-4000-8000-000000000003
    name: Retired integration
    integration:
      type: removed-widget
      config: { endpoint: https://retired.local, api_key: unknown-widget-secret-value }
service_tiles:
  - id: 20000000-0000-4000-8000-000000000003
    service_id: 10000000-0000-4000-8000-000000000003
    footprint: { columnSpan: 3, rowSpan: 2 }
    widget: { type: removed-widget }
`.trim();

type MutableSecretTestService = {
  integration: { config: Record<string, unknown> };
};

function createSettingsFsSimulation(initialYaml: string) {
  let yaml = initialYaml;
  let activeConfig = true;
  const pendingWrites = new Map<string, string>();
  const displacedWrites = new Map<string, string>();

  const moveConfig = (source: unknown, destination: unknown) => {
    const from = String(source);
    const to = String(destination);
    if (from.endsWith("settings.yaml")) {
      displacedWrites.set(to, yaml);
      activeConfig = false;
    } else if (displacedWrites.has(from) && to.endsWith("settings.yaml")) {
      yaml = displacedWrites.get(from)!;
      displacedWrites.delete(from);
      activeConfig = true;
    }
  };

  vi.mocked(existsSync).mockImplementation((target) => {
    const key = String(target);
    if (key.endsWith("settings.yaml")) return activeConfig;
    if (key.includes("settings.yaml.displaced")) return displacedWrites.has(key);
    if (key.includes(".tmp-")) return pendingWrites.has(key);
    return true;
  });
  vi.mocked(readFileSync).mockImplementation((target) =>
    displacedWrites.get(String(target)) ?? yaml
  );
  vi.mocked(writeFileSync).mockImplementation((target, value) => {
    if (typeof target === "string" && target.includes(".tmp-")) {
      pendingWrites.set(target, String(value));
    }
  });
  vi.mocked(renameSync).mockImplementation(moveConfig);
  vi.mocked(linkSync).mockImplementation((source) => {
    if (activeConfig) throw Object.assign(new Error("exists"), { code: "EEXIST" });
    const key = String(source);
    yaml = displacedWrites.get(key) ?? pendingWrites.get(key)!;
    activeConfig = true;
  });
  vi.mocked(unlinkSync).mockImplementation((target) => {
    const key = String(target);
    pendingWrites.delete(key);
    displacedWrites.delete(key);
  });

  return {
    get yaml() {
      return yaml;
    },
    set yaml(value: string) {
      yaml = value;
    },
    moveConfig,
  };
}

function patch(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
});

describe("PATCH /api/settings – validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
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


  it("returns 400 for unknown theme value", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(patch({ appearance: { theme: "rainbow" } }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/settings – layout", () => {
  it("returns a bounded 500 when secret resolution fails unexpectedly", async () => {
    vi.doMock("@/widgets/configSecrets", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/widgets/configSecrets")>()),
      resolveServiceIntegrationSecrets: () => {
        throw new Error("leaked internal secret resolver detail");
      },
    }));
    try {
      const { PATCH } = await import("../../app/api/settings/route");
      const res = await PATCH(patch({ services: [] }));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Failed to save settings" });
    } finally {
      vi.doUnmock("@/widgets/configSecrets");
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML);
    vi.mocked(writeFileSync).mockImplementation(() => undefined);
  });

  it("drops deprecated desktop geometry and returns 200", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(patch({ layout: { columns: 6, row_height: 150 } }));
    expect(res.status).toBe(200);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("layout: {}");
    expect(written).not.toContain("row_height");
  });

  it("drops deprecated tablet geometry", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({ layout: { columns: 4, row_height: 120, tablet: { columns: 2 } } })
    );
    expect(res.status).toBe(200);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).not.toContain("tablet");
  });

  it("drops all deprecated viewport geometry", async () => {
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
    expect(written).not.toContain("tablet");
    expect(written).not.toContain("mobile");
  });
});

describe("PATCH /api/settings – appearance & services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
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
          { id: "10000000-0000-4000-8000-000000000004", name: "Jellyfin", launch_url: "http://jellyfin.local", category: "Media" },
        ],
      })
    );
    expect(res.status).toBe(200);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("Jellyfin");
  });
});

describe("PATCH /api/settings – opaque tile widget config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
    vi.mocked(readFileSync).mockReturnValue(TILE_SECRET_YAML);
    vi.mocked(writeFileSync).mockImplementation(() => undefined);
  });

  it("round-trips a signed opaque tile config without exposing or persisting its marker", async () => {
    const { GET, PATCH } = await import("../../app/api/settings/route");
    const getRes = await GET();
    const revision = getRes.headers.get("X-Config-Revision")!;
    const redacted = await getRes.json();

    expect(JSON.stringify(redacted)).not.toContain("tile-secret-value");
    expect(redacted.service_tiles[0].widget.config).toHaveProperty("__kokpit_widget_config_reference__");

    const res = await PATCH(patch({ service_tiles: redacted.service_tiles }, { "If-Match": revision }));
    const responseText = await res.text();

    expect(res.status).toBe(200);
    expect(vi.mocked(writeFileSync).mock.calls[0][1]).toContain("tile-secret-value");
    expect(vi.mocked(writeFileSync).mock.calls[0][1]).not.toContain("__kokpit_widget_config_reference__");
    expect(responseText).not.toContain("tile-secret-value");
  });
});

describe("PATCH /api/settings – groups, bookmarks & new layout/service fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
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

  it("normalizes a widgetless legacy size preset to the generic footprint", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({
        services: [{ id: "10000000-0000-4000-8000-000000000005", name: "Plex", launch_url: "http://plex.local" }],
        service_tiles: [{ id: "20000000-0000-4000-8000-000000000005", service_id: "10000000-0000-4000-8000-000000000005", size: "large" }],
      })
    );
    expect(res.status).toBe(200);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).not.toContain("size: large");
    expect(written).toContain("columnSpan: 3");
    expect(written).toContain("rowSpan: 1");
  });

  it("returns 400 for an invalid service size", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({ service_tiles: [{ id: "20000000-0000-4000-8000-000000000005", service_id: "10000000-0000-4000-8000-000000000005", size: "huge" }] })
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/settings – auth", () => {
  const AUTH_ENABLED_YAML = BASE_YAML.replace("enabled: false", "enabled: true");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
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
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML);
  });

  it("returns the current config with status 200", async () => {
    const { GET } = await import("../../app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.layout).toEqual({});
    expect(json.appearance.theme).toBe("dark");
  });

  it("does not return per-viewport layout overrides", async () => {
    vi.mocked(readFileSync).mockReturnValue(VIEWPORT_YAML);
    const { GET } = await import("../../app/api/settings/route");
    const res = await GET();
    const json = await res.json();
    expect(json.layout.tablet).toBeUndefined();
    expect(json.layout.mobile).toBeUndefined();
    expect(json.layout.columns).toBeUndefined();
  });

  it("returns a stable X-Config-Revision header (HMAC-SHA256 hex)", async () => {
    const { GET } = await import("../../app/api/settings/route");
    const res = await GET();
    const rev = res.headers.get("X-Config-Revision");
    expect(rev).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("/api/settings – widget password fields", () => {
  let fs: ReturnType<typeof createSettingsFsSimulation>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    fs = createSettingsFsSimulation(SECRET_YAML);
  });

  it("redacts every metadata-declared password from GET without changing non-secret config", async () => {
    const { GET } = await import("../../app/api/settings/route");

    const res = await GET();
    const json = await res.json();
    const serialized = JSON.stringify(json);

    expect(res.status).toBe(200);
    expect(serialized).not.toContain("tautulli-secret-value");
    expect(serialized).not.toContain("qbittorrent-secret-value");
    expect(json.services[0].integration.config.api_key).toMatchObject({
      [WIDGET_SECRET_REFERENCE_KEY]: expect.stringMatching(
        new RegExp(`^${WIDGET_SECRET_REFERENCE_PREFIX}`)
      ),
    });
    expect(json.services[1].integration.config.password).toMatchObject({
      [WIDGET_SECRET_REFERENCE_KEY]: expect.stringMatching(
        new RegExp(`^${WIDGET_SECRET_REFERENCE_PREFIX}`)
      ),
    });
    expect(json.services[0].integration.config.url).toBe(
      "http://tautulli.local:8181"
    );
    expect(json.services[1].integration.config.username).toBe("admin");
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("hides and preserves complete configs for unregistered widget types", async () => {
    fs.yaml = UNKNOWN_WIDGET_SECRET_YAML;
    const { GET, PATCH } = await import("../../app/api/settings/route");
    const getRes = await GET();
    const revision = getRes.headers.get("X-Config-Revision")!;
    const redacted = await getRes.json();
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("unknown-widget-secret-value");
    expect(serialized).not.toContain("retired.local");
    expect(redacted.services[0].integration.config).toEqual({
      __kokpit_widget_config_reference__: expect.stringMatching(
        /^__KOKPIT_WIDGET_CONFIG_REF__:/
      ),
    });

    redacted.services[0].name = "Retired integration renamed";
    const res = await PATCH(
      patch({ services: redacted.services }, { "If-Match": revision })
    );
    const responseText = await res.text();

    expect(res.status).toBe(200);
    expect(fs.yaml).toContain("name: Retired integration renamed");
    expect(fs.yaml).toContain("endpoint: https://retired.local");
    expect(fs.yaml).toContain("api_key: unknown-widget-secret-value");
    expect(fs.yaml).not.toContain("__KOKPIT_WIDGET_CONFIG_REF__:");
    expect(responseText).not.toContain("unknown-widget-secret-value");
    expect(responseText).not.toContain("retired.local");
  });

  it("preserves unchanged secrets through rename and reorder with an optimistic revision", async () => {
    const { GET, PATCH } = await import("../../app/api/settings/route");
    const getRes = await GET();
    const revision = getRes.headers.get("X-Config-Revision")!;
    const redacted = await getRes.json();
    const [tautulli, downloads] = redacted.services;

    const res = await PATCH(
      patch(
        {
          services: [
            { ...downloads, name: "Downloads Renamed" },
            { ...tautulli, name: "Tautulli Renamed" },
          ],
        },
        { "If-Match": revision }
      )
    );
    const responseText = await res.text();

    expect(res.status).toBe(200);
    expect(fs.yaml).toContain("name: Downloads Renamed");
    expect(fs.yaml).toContain("name: Tautulli Renamed");
    expect(fs.yaml).toContain("password: qbittorrent-secret-value");
    expect(fs.yaml).toContain("api_key: tautulli-secret-value");
    expect(fs.yaml).not.toContain("__KOKPIT_WIDGET_SECRET_REF__:");
    expect(responseText).not.toContain("qbittorrent-secret-value");
    expect(responseText).not.toContain("tautulli-secret-value");
    expect(responseText).toContain("__KOKPIT_WIDGET_SECRET_REF__:");
    expect(res.headers.get("X-Config-Revision")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writes an explicit replacement and redacts it from the PATCH response", async () => {
    const { GET, PATCH } = await import("../../app/api/settings/route");
    const getRes = await GET();
    const revision = getRes.headers.get("X-Config-Revision")!;
    const redacted = await getRes.json();
    redacted.services[0].integration.config.url =
      "http://new-tautulli.local:8181";
    redacted.services[0].integration.config.api_key = "replacement-secret-value";

    const res = await PATCH(
      patch({ services: redacted.services }, { "If-Match": revision })
    );
    const responseText = await res.text();

    expect(res.status).toBe(200);
    expect(fs.yaml).toContain("api_key: replacement-secret-value");
    expect(fs.yaml).toContain("url: http://new-tautulli.local:8181");
    expect(fs.yaml).not.toContain("api_key: tautulli-secret-value");
    expect(fs.yaml).toContain("password: qbittorrent-secret-value");
    expect(responseText).not.toContain("replacement-secret-value");
    expect(responseText).not.toContain("qbittorrent-secret-value");
    expect(responseText).toContain("__KOKPIT_WIDGET_SECRET_REF__:");
  });

  it("preserves a saved secret across display-only and canonical-equivalent URL edits", async () => {
    const { GET, PATCH } = await import("../../app/api/settings/route");
    const getRes = await GET();
    const revision = getRes.headers.get("X-Config-Revision")!;
    const redacted = await getRes.json();
    redacted.services[0].integration.config.url =
      " HTTP://TAUTULLI.LOCAL:8181/#dashboard ";
    redacted.service_tiles[0].widget.config.sections = ["sessions"];

    const res = await PATCH(
      patch({ services: redacted.services, service_tiles: redacted.service_tiles }, { "If-Match": revision })
    );
    expect(res.status).toBe(200);
    expect(fs.yaml).toContain("api_key: tautulli-secret-value");
    expect(fs.yaml).not.toContain("__KOKPIT_WIDGET_SECRET_REF__:");
  });

  it.each([
    ["endpoint", (services: MutableSecretTestService[]) => {
      services[0].integration.config.url = "http://attacker.invalid:8181";
    }],
    ["qBittorrent username", (services: MutableSecretTestService[]) => {
      services[1].integration.config.username = "other-admin";
    }],
  ])("rejects a saved secret when %s scope changes and writes nothing", async (_label, change) => {
    const { GET, PATCH } = await import("../../app/api/settings/route");
    const getRes = await GET();
    const revision = getRes.headers.get("X-Config-Revision")!;
    const redacted = await getRes.json();
    change(redacted.services);
    vi.mocked(writeFileSync).mockClear();

    const res = await PATCH(
      patch({ services: redacted.services }, { "If-Match": revision })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("widget_secret_scope_changed");
    expect(JSON.stringify(body)).not.toContain("attacker.invalid");
    expect(JSON.stringify(body)).not.toContain("tautulli-secret-value");
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("rejects malformed references with a stable safe code and no write", async () => {
    const { GET, PATCH } = await import("../../app/api/settings/route");
    const redacted = await (await GET()).json();
    redacted.services[0].integration.config.api_key = {
      [WIDGET_SECRET_REFERENCE_KEY]: `${WIDGET_SECRET_REFERENCE_PREFIX}malformed`,
    };
    vi.mocked(writeFileSync).mockClear();

    const res = await PATCH(patch({ services: redacted.services }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("widget_secret_reference_invalid");
    expect(JSON.stringify(body)).not.toContain("malformed");
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("keeps the revision-conflict check ahead of secret resolution", async () => {
    const { GET, PATCH } = await import("../../app/api/settings/route");
    const redacted = await (await GET()).json();
    redacted.services[0].integration.config.api_key = {
      [WIDGET_SECRET_REFERENCE_KEY]: `${WIDGET_SECRET_REFERENCE_PREFIX}malformed`,
    };

    const res = await PATCH(
      patch({ services: redacted.services }, { "If-Match": "stale-revision" })
    );

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("revision_mismatch");
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/settings – revision conflict (If-Match)", () => {
  let fs: ReturnType<typeof createSettingsFsSimulation>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    fs = createSettingsFsSimulation(BASE_YAML);
  });

  it("proceeds (200) when no If-Match header is sent (back-compat)", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(patch({ appearance: { theme: "light" } }));
    expect(res.status).toBe(200);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("proceeds (200) when If-Match matches the current revision", async () => {
    const { GET, PATCH } = await import("../../app/api/settings/route");
    const revision = (await GET()).headers.get("X-Config-Revision")!;
    const res = await PATCH(
      patch({ appearance: { theme: "light" } }, { "If-Match": revision })
    );
    expect(res.status).toBe(200);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("responds 409 and writes nothing when If-Match is stale", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const res = await PATCH(
      patch({ appearance: { theme: "light" } }, { "If-Match": "deadbeef" })
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("revision_mismatch");
    expect(writeFileSync).not.toHaveBeenCalled();
    // The 409 carries the true current revision for the client's Reload path.
    expect(res.headers.get("X-Config-Revision")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not overwrite an external edit made after validation", async () => {
    const externallyEdited = BASE_YAML.replace("theme: dark", "theme: oled");
    vi.mocked(renameSync).mockImplementation((source, destination) => {
      if (String(source).endsWith("settings.yaml")) fs.yaml = externallyEdited;
      fs.moveConfig(source, destination);
    });
    const { GET, PATCH } = await import("../../app/api/settings/route");
    const { KokpitConfigSchema } = await import("@/config/schema");
    const { configRevision } = await import("@/config/revision");
    const { parse } = await import("yaml");

    const res = await PATCH(patch({ appearance: { theme: "light" } }));

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("revision_mismatch");
    const externalRevision = configRevision(KokpitConfigSchema.parse(parse(externallyEdited)));
    expect(res.headers.get("X-Config-Revision")).toBe(externalRevision);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(linkSync).toHaveBeenCalledWith(expect.stringContaining("settings.yaml.displaced"), expect.stringMatching(/settings\.yaml$/));

    const reload = await GET();
    expect((await reload.json()).appearance.theme).toBe("oled");
    expect(reload.headers.get("X-Config-Revision")).toBe(externalRevision);
  });

  it("reports a conflict without a revision when the external edit is temporarily invalid", async () => {
    vi.mocked(renameSync).mockImplementation((source, destination) => {
      if (String(source).endsWith("settings.yaml")) fs.yaml = "appearance: [";
      fs.moveConfig(source, destination);
    });
    const { PATCH } = await import("../../app/api/settings/route");

    const res = await PATCH(patch({ appearance: { theme: "light" } }));

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("revision_mismatch");
    expect(res.headers.has("X-Config-Revision")).toBe(false);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(linkSync).toHaveBeenCalledWith(expect.stringContaining("settings.yaml.displaced"), expect.stringMatching(/settings\.yaml$/));
  });

  it("allows only one concurrent PATCH to commit for the same revision", async () => {
    const { GET, PATCH } = await import("../../app/api/settings/route");
    const revision = (await GET()).headers.get("X-Config-Revision")!;

    const responses = await Promise.all([
      PATCH(patch({ appearance: { theme: "light" } }, { "If-Match": revision })),
      PATCH(patch({ appearance: { theme: "oled" } }, { "If-Match": revision })),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
  });
});
