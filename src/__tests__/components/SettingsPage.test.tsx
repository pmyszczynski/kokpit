// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("proper-lockfile", () => ({ lockSync: vi.fn(() => () => undefined) }));

vi.mock("node:fs", () => {
  const readFileSync = vi.fn();
  const existsSync = vi.fn((path?: unknown) => !isDisplacedConfigPath(path));
  const writeFileSync = vi.fn();
  const linkSync = vi.fn();
  const unlinkSync = vi.fn();
  const renameSync = vi.fn();
  const statSync = vi.fn().mockReturnValue({ mode: 0o100644 });
  const chmodSync = vi.fn();
  const mkdirSync = vi.fn();
  return {
    default: { readFileSync, existsSync, writeFileSync, renameSync, statSync, chmodSync, mkdirSync },
    readFileSync,
    existsSync,
    writeFileSync,
    linkSync,
    unlinkSync,
    renameSync,
    statSync,
    chmodSync,
    mkdirSync,
  };
});
vi.mock("@/components/SettingsPanel", () => ({
  default: () => null,
}));

function isDisplacedConfigPath(path: unknown) {
  return String(path ?? "").includes("settings.yaml.displaced");
}

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
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !isDisplacedConfigPath(path));
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
