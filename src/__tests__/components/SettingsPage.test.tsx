// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => {
  const readFileSync = vi.fn();
  const existsSync = vi.fn().mockReturnValue(true);
  const writeFileSync = vi.fn();
  const renameSync = vi.fn();
  const statSync = vi.fn().mockReturnValue({ mode: 0o100644 });
  const chmodSync = vi.fn();
  return {
    default: { readFileSync, existsSync, writeFileSync, renameSync, statSync, chmodSync },
    readFileSync,
    existsSync,
    writeFileSync,
    renameSync,
    statSync,
    chmodSync,
  };
});
vi.mock("@/components/SettingsPanel", () => ({
  default: () => null,
}));

const SECRET_YAML = `
schema_version: 1
auth:
  enabled: false
  session_ttl_hours: 24
appearance:
  theme: dark
layout:
  columns: 4
  row_height: 120
services:
  - name: Tautulli
    widget:
      type: tautulli-activity
      config:
        url: http://tautulli.local:8181
        api_key: rsc-saved-secret
`.trim();

describe("protected settings server component", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(SECRET_YAML);
  });

  it("passes only a signed reference, never a raw saved credential", async () => {
    const { default: SettingsPage } = await import(
      "@/app/(protected)/settings/page"
    );
    const serialized = JSON.stringify(SettingsPage());

    expect(serialized).not.toContain("rsc-saved-secret");
    expect(serialized).toContain("__KOKPIT_WIDGET_SECRET_REF__:");
  });
});
