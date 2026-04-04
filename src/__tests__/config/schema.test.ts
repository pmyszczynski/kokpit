import { describe, it, expect } from "vitest";
import { KokpitConfigSchema } from "@/config/schema";

const minimalValid = {
  schema_version: 1 as const,
  services: [{ name: "A" }],
};

describe("KokpitConfigSchema", () => {
  it("accepts unique service names", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      services: [{ name: "Plex" }, { name: "Sonarr" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects duplicate service names (case-insensitive)", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      services: [{ name: "Plex" }, { name: "plex" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("name"))).toBe(true);
    }
  });

  it("rejects duplicate names after trim", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      services: [{ name: "Plex " }, { name: " Plex" }],
    });
    expect(r.success).toBe(false);
  });
});
