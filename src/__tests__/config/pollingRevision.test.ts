import { beforeEach, describe, expect, it, vi } from "vitest";
import { pollingRevision } from "@/config/pollingRevision";
import type { KokpitConfig } from "@/config/schema";
vi.mock("@/auth/serverSecret", () => ({ getServerSecret: () => "test-config-revision-secret" }));
const config: KokpitConfig = {
  schema_version: 2, auth: { enabled: false }, appearance: { theme: "dark" }, layout: {},
  services: [{ id: "service", name: "Server", launch_url: "https://example.com", integration: { type: "plex", config: { token: "secret" } } }],
  service_tiles: [{ id: "tile", service_id: "service", widget: { type: "plex", config: { fields: ["sessions"] } } }],
};
beforeEach(() => vi.clearAllMocks());
describe("effective polling input identity", () => {
  it("ignores presentation-only source changes", () => {
    expect(pollingRevision({ ...config, appearance: { theme: "oled" }, groups: [{ name: "Media" }],
      services: config.services.map((service) => ({ ...service, name: "Renamed", icon: "new", description: "text" })),
      service_tiles: config.service_tiles!.map((tile) => ({ ...tile, group: "Media" })),
    })).toBe(pollingRevision(config));
  });
  it("changes for widget/connection/status inputs without exposing their secret values", () => {
    const original = pollingRevision(config);
    const changed = pollingRevision({ ...config, services: config.services.map((service) => ({ ...service,
      integration: { type: "plex", config: { token: "new-secret" } } })) });
    expect(changed).not.toBe(original); expect(changed).toMatch(/^[a-f0-9]{64}$/);
    expect(pollingRevision({ ...config, services: config.services.map((service) => ({ ...service, launch_url: "https://changed.example" })) })).not.toBe(original);
    expect(pollingRevision({ ...config, service_tiles: config.service_tiles!.map((tile) => ({ ...tile, widget: { type: "plex", config: { fields: ["library"] } } })) })).not.toBe(original);
  });

  it("ignores nested connection and widget-option key order while preserving ordered arrays", () => {
    const first: KokpitConfig = { ...config,
      services: [{ ...config.services[0], integration: { type: "plex", config: {
        token: "secret", endpoint: { host: "example.com", port: 443 },
      } } }],
      service_tiles: [{ ...config.service_tiles![0], widget: { type: "plex", config: {
        fields: ["sessions", "library"], range: { from: 1, to: 2 },
      } } }],
    };
    const reordered: KokpitConfig = { ...first,
      services: [{ ...first.services[0], integration: { type: "plex", config: {
        endpoint: { port: 443, host: "example.com" }, token: "secret",
      } } }],
      service_tiles: [{ ...first.service_tiles![0], widget: { type: "plex", config: {
        range: { to: 2, from: 1 }, fields: ["sessions", "library"],
      } } }],
    };
    expect(pollingRevision(reordered)).toBe(pollingRevision(first));
    expect(pollingRevision({ ...first, service_tiles: [{ ...first.service_tiles![0],
      widget: { type: "plex", config: { fields: ["library", "sessions"], range: { from: 1, to: 2 } } },
    }] })).not.toBe(pollingRevision(first));
  });

  it("retains own __proto__ keys when canonicalizing effective inputs", () => {
    const withValue = (value: string): KokpitConfig => ({ ...config,
      services: [{ ...config.services[0], integration: { type: "plex", config: {
        token: "secret", ["__proto__"]: { value },
      } } }],
    });
    expect(pollingRevision(withValue("one"))).not.toBe(pollingRevision(withValue("two")));
  });
});
