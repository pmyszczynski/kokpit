import { createHash, createHmac } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import type { KokpitConfig } from "@/config/schema";
import { migrateV1Config } from "@/config/loader";
import { configRevision } from "@/config/revision";
import { canonicalJSONString } from "@/config/canonicalJson";

const { serverSecret } = vi.hoisted(() => ({
  serverSecret: {
    bytes: new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x41]),
  },
}));

vi.mock("@/auth/serverSecret", () => ({
  getServerSecret: () => serverSecret.bytes,
}));

function makeConfig(overrides: Record<string, unknown> = {}): KokpitConfig {
  const migrated = migrateV1Config({ schema_version: 1, services: [{ name: "Plex", url: "https://plex.local", group: "Media" }], ...overrides });
  return {
    ...migrated,
    services: migrated.services.map((service, index) => ({ ...service, id: `10000000-0000-4000-8000-00000000000${index + 1}` })),
    service_tiles: migrated.service_tiles.map((tile, index) => ({ ...tile, id: `20000000-0000-4000-8000-00000000000${index + 1}`, service_id: `10000000-0000-4000-8000-00000000000${index + 1}` })),
  };
}

describe("canonicalJSONString", () => {
  it("is independent of object key insertion order", () => {
    expect(canonicalJSONString({ a: 1, b: 2 })).toBe(
      canonicalJSONString({ b: 2, a: 1 })
    );
  });

  it("preserves array order (order is semantic for services/groups)", () => {
    expect(canonicalJSONString([1, 2, 3])).not.toBe(
      canonicalJSONString([3, 2, 1])
    );
  });

  it("treats an undefined value the same as an absent key", () => {
    expect(canonicalJSONString({ a: 1, b: undefined })).toBe(
      canonicalJSONString({ a: 1 })
    );
  });
});

describe("configRevision", () => {
  it("is a stable 64-char hex HMAC for the same key and config", () => {
    const rev = configRevision(makeConfig());
    expect(rev).toMatch(/^[0-9a-f]{64}$/);
    expect(configRevision(makeConfig())).toBe(configRevision(makeConfig()));
  });

  it("changes when a service is mutated", () => {
    const before = configRevision(makeConfig());
    const after = configRevision(
      makeConfig({
        services: [
          { name: "Plex", url: "https://plex.local", group: "Media", size: "large" },
        ],
      })
    );
    expect(after).not.toBe(before);
  });

  it("changes when groups change", () => {
    const before = configRevision(makeConfig());
    const after = configRevision(makeConfig({ groups: [{ name: "Media" }] }));
    expect(after).not.toBe(before);
  });

  it("changes when only a saved widget secret changes", () => {
    const before = configRevision(
      makeConfig({
        services: [
          {
            name: "Tautulli",
            widget: {
              type: "tautulli-activity",
              config: { url: "http://tautulli.local", api_key: "pin-1" },
            },
          },
        ],
      })
    );
    const after = configRevision(
      makeConfig({
        services: [
          {
            name: "Tautulli",
            widget: {
              type: "tautulli-activity",
              config: { url: "http://tautulli.local", api_key: "pin-2" },
            },
          },
        ],
      })
    );

    expect(after).not.toBe(before);
  });

  it("changes when the server secret changes", () => {
    const config = makeConfig();
    const before = configRevision(config);
    serverSecret.bytes = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x42]);

    expect(configRevision(config)).not.toBe(before);
  });

  it("is purpose-separated from an unkeyed config digest and preserves key bytes", () => {
    const config = makeConfig({
      services: [
        {
          name: "Tautulli",
          widget: {
            type: "tautulli-activity",
            config: { url: "http://tautulli.local", api_key: "1" },
          },
        },
      ],
    });
    const canonical = canonicalJSONString(config);
    const unkeyed = createHash("sha256").update(canonical).digest("hex");
    const purposeKey = createHmac("sha256", serverSecret.bytes)
      .update("kokpit/config-revision/v1")
      .digest();
    const expected = createHmac("sha256", purposeKey)
      .update(canonical)
      .digest("hex");

    expect(configRevision(config)).toBe(expected);
    expect(configRevision(config)).not.toBe(unkeyed);
  });

  it("does not expose a low-entropy saved secret through an unkeyed hash oracle", () => {
    const configForPin = (pin: string) =>
      makeConfig({
        services: [
          {
            name: "Tautulli",
            widget: {
              type: "tautulli-activity",
              config: { url: "http://tautulli.local", api_key: pin },
            },
          },
        ],
      });
    const observed = configRevision(configForPin("1"));
    const candidateDigests = ["1", "2"].map((pin) =>
      createHash("sha256")
        .update(canonicalJSONString(configForPin(pin)))
        .digest("hex")
    );

    expect(candidateDigests).not.toContain(observed);
  });
});
