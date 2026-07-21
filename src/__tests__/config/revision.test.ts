import { describe, it, expect } from "vitest";
import { KokpitConfigSchema, type KokpitConfig } from "@/config/schema";
import { configRevision } from "@/config/revision";
import { canonicalJSONString } from "@/config/canonicalJson";

function makeConfig(overrides: Record<string, unknown> = {}): KokpitConfig {
  return KokpitConfigSchema.parse({
    schema_version: 1,
    services: [{ name: "Plex", url: "https://plex.local", group: "Media" }],
    ...overrides,
  });
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
  it("is a stable 64-char hex sha256", () => {
    const rev = configRevision(makeConfig());
    expect(rev).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same revision for equal configs", () => {
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
});
