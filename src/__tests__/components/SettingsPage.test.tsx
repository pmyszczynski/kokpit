// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
schema_version: 2
auth:
  enabled: false
  session_ttl_hours: 24
appearance:
  theme: dark
layout: {}
services:
  - id: 10000000-0000-4000-8000-000000000001
    name: Tautulli
    integration:
      type: tautulli-activity
      config:
        url: http://tautulli.local:8181
        api_key: rsc-saved-secret
service_tiles: []
`.trim();

describe("protected settings server component", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !isDisplacedConfigPath(path));
    vi.mocked(readFileSync).mockReturnValue(SECRET_YAML);
  });

  afterEach(async () => {
    const { invalidateCache } = await import("@/config/loader");
    invalidateCache();
  });

  it("passes only a signed reference, never a raw saved credential", async () => {
    const revision = vi.fn(() => "revision-of-unredacted-snapshot");
    vi.doMock("@/config/revision", () => ({ configRevision: revision }));
    const { default: SettingsPage } = await import(
      "@/app/(protected)/settings/page"
    );
    const page = SettingsPage();
    const serialized = JSON.stringify(page);
    const panel = (page.props.children as unknown[])[1] as {
      props: { initialRevision: string };
    };

    expect(serialized).not.toContain("rsc-saved-secret");
    expect(serialized).toContain("__KOKPIT_WIDGET_CONFIG_REF__:");
    expect(revision).toHaveBeenCalledWith(SECRET_YAML);
    expect(panel.props.initialRevision).toBe("revision-of-unredacted-snapshot");
  });

  it("offers a full reload when the YAML source changes during rendering", async () => {
    const { getConfigSnapshot } = await import("@/config/server");
    expect(getConfigSnapshot().state).toBe("ready");
    vi.mocked(readFileSync).mockReturnValue(`${SECRET_YAML}\n# external edit`);
    const { default: SettingsPage } = await import("@/app/(protected)/settings/page");
    const page = SettingsPage();

    expect(JSON.stringify(page)).toContain("settings.yaml is being updated");
    const retry = (page.props.children as unknown[])[2] as { props: { href: string } };
    expect(retry.props.href).toBe("/settings");
  });
});
