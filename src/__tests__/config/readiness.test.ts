// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let directory: string;
let configPath: string;

function source(theme = "dark"): string {
  return `schema_version: 2\nauth:\n  enabled: false\nappearance:\n  theme: ${theme}\nservices: []\nservice_tiles: []\n`;
}

beforeEach(() => {
  vi.resetModules();
  directory = mkdtempSync(path.join(os.tmpdir(), "kokpit-config-readiness-"));
  configPath = path.join(directory, "settings.yaml");
  vi.stubEnv("KOKPIT_CONFIG_PATH", configPath);
  vi.stubEnv("KOKPIT_DB_PATH", path.join(directory, "data", "users.db"));
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  const loader = await import("@/config/loader"); loader.invalidateCache();
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("read-only configuration readiness", () => {
  it.each([
    ["missing", undefined],
    ["valid but not initialized", source()],
    ["legacy", "schema_version: 1\nauth:\n  enabled: false\nservices: []\n"],
    ["invalid", "auth: [ sensitive-config-content\n"],
  ])("does not initialize or migrate a cold %s configuration", async (_name, contents) => {
    if (contents !== undefined) writeFileSync(configPath, contents);
    const { observeConfigReadiness } = await import("@/config/loader");
    const { subscribeConfigPublication } = await import("@/config/publication");
    const published = vi.fn(); const unsubscribe = subscribeConfigPublication(published);
    try {
      for (let i = 0; i < 3; i++) expect(observeConfigReadiness()).toEqual({ state: "cold", config: null });
      expect(readdirSync(directory)).toEqual(contents === undefined ? [] : ["settings.yaml"]);
      if (contents !== undefined) expect(readFileSync(configPath, "utf8")).toBe(contents);
      expect(vi.getTimerCount()).toBe(0);
      expect(published).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it("observes already-published config without creating timers or publications", async () => {
    const contents = source(); writeFileSync(configPath, contents);
    const loader = await import("@/config/loader"); const config = loader.loadConfig();
    const { subscribeConfigPublication } = await import("@/config/publication");
    const published = vi.fn(); const unsubscribe = subscribeConfigPublication(published);
    try {
      expect(loader.observeConfigReadiness()).toEqual({ state: "ready", config });
      expect(loader.observeConfigReadiness()).toEqual({ state: "ready", config });
      expect(readFileSync(configPath, "utf8")).toBe(contents);
      expect(readdirSync(directory)).toEqual(["settings.yaml"]);
      expect(published).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    } finally { unsubscribe(); }
  });

  it("publishes completed initial loads and committed writes while rejected writes stay silent", async () => {
    writeFileSync(configPath, source());
    const loader = await import("@/config/loader");
    const { ZodError } = await import("zod");
    const { configRevision } = await import("@/config/revision");
    const { subscribeConfigPublication } = await import("@/config/publication");
    const published = vi.fn(); const unsubscribe = subscribeConfigPublication(published);
    try {
      const initial = loader.loadConfig();
      expect(published).toHaveBeenCalledExactlyOnceWith(initial);
      const committed = loader.writeConfigSnapshot({ appearance: { ...initial.appearance, theme: "light" } }, configRevision(source()), source());
      expect(published).toHaveBeenCalledTimes(2);
      expect(published).toHaveBeenLastCalledWith(committed.config);
      expect(() => loader.writeConfigSnapshot({ appearance: { ...initial.appearance, theme: "oled" } }, configRevision(source()), source())).toThrow(loader.ConfigRevisionMismatchError);
      let validationError: unknown;
      try {
        loader.writeConfigSnapshot({ appearance: { ...initial.appearance, card_blur: -1 } });
      } catch (error) { validationError = error; }
      expect(validationError).toBeInstanceOf(ZodError);
      expect(validationError).toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "too_small", path: ["appearance", "card_blur"], minimum: 0 }),
        ]),
      });
      expect(published).toHaveBeenCalledTimes(2);
      expect(readFileSync(configPath, "utf8")).toBe(committed.source);
    } finally { unsubscribe(); }
  });

  it("requires the exact published bytes and does not promote a valid external edit", async () => {
    writeFileSync(configPath, source());
    const loader = await import("@/config/loader"); loader.loadConfig();
    const { subscribeConfigPublication } = await import("@/config/publication");
    const published = vi.fn(); const unsubscribe = subscribeConfigPublication(published);
    const replacement = `${source()}# External comment only\n`; writeFileSync(configPath, replacement);
    try {
      expect(loader.observeConfigReadiness().state).toBe("dirty");
      expect(loader.observeConfigReadiness().state).toBe("dirty");
      expect(published).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
      expect(readFileSync(configPath, "utf8")).toBe(replacement);
      expect(loader.refreshConfigCache()).toBe("dirty");
      expect(loader.refreshConfigCache()).toBe("ready");
      expect(published).toHaveBeenCalledTimes(1);
      expect(loader.observeConfigReadiness().state).toBe("ready");
      expect(published).toHaveBeenCalledTimes(1);
      expect(readdirSync(directory)).toEqual(["settings.yaml"]);
    } finally { unsubscribe(); }
  });

  it("keeps loads and committed saves successful when an observer fails, with one safe diagnostic", async () => {
    writeFileSync(configPath, source());
    const loader = await import("@/config/loader");
    const { subscribeConfigPublication } = await import("@/config/publication");
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(() => { throw new Error(`sensitive-config-content api_key=private ${configPath}`); });
    const observed = vi.fn();
    const unsubscribeFailure = subscribeConfigPublication(failing);
    const unsubscribeObserver = subscribeConfigPublication(observed);
    try {
      const initial = loader.loadConfig();
      const committed = loader.writeConfigSnapshot({ appearance: { ...initial.appearance, theme: "light" } });
      expect(committed.config.appearance.theme).toBe("light");
      expect(readFileSync(configPath, "utf8")).toBe(committed.source);
      expect(failing).toHaveBeenCalledTimes(2);
      expect(observed).toHaveBeenCalledTimes(2);
      expect(observed).toHaveBeenLastCalledWith(committed.config);
      expect(diagnostic.mock.calls).toEqual([["[kokpit] Configuration publication callback failed."]]);
    } finally { unsubscribeFailure(); unsubscribeObserver(); }
  });

  it("bounds diagnostics per failing observer and permits a new incident after recovery", async () => {
    writeFileSync(configPath, source());
    const loader = await import("@/config/loader");
    const config = loader.loadConfig();
    const { subscribeConfigPublication, notifyConfigPublished } = await import("@/config/publication");
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    let firstFailed = true;
    const first = vi.fn(() => { if (firstFailed) throw new Error("sensitive first observer"); });
    const second = vi.fn(() => { throw new Error("sensitive second observer"); });
    const unsubscribeFirst = subscribeConfigPublication(first);
    const unsubscribeSecond = subscribeConfigPublication(second);
    try {
      for (let i = 0; i < 20; i++) notifyConfigPublished(config);
      expect(diagnostic).toHaveBeenCalledTimes(2);
      expect(first).toHaveBeenCalledTimes(20);
      expect(second).toHaveBeenCalledTimes(20);
      firstFailed = false;
      notifyConfigPublished(config);
      expect(diagnostic).toHaveBeenCalledTimes(2);
      firstFailed = true;
      notifyConfigPublished(config);
      notifyConfigPublished(config);
      expect(diagnostic.mock.calls).toEqual(Array.from({ length: 3 }, () => ["[kokpit] Configuration publication callback failed."]));
    } finally { unsubscribeFirst(); unsubscribeSecond(); }
  });

  it("starts a fresh failure incident when an observer is unsubscribed and registered again", async () => {
    writeFileSync(configPath, source());
    const loader = await import("@/config/loader");
    const config = loader.loadConfig();
    const { subscribeConfigPublication, notifyConfigPublished } = await import("@/config/publication");
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(() => { throw new Error("sensitive observer details"); });
    let unsubscribe = subscribeConfigPublication(failing);
    try {
      notifyConfigPublished(config);
      expect(diagnostic).toHaveBeenCalledTimes(1);
      unsubscribe();
      notifyConfigPublished(config);
      expect(failing).toHaveBeenCalledTimes(1);
      unsubscribe = subscribeConfigPublication(failing);
      notifyConfigPublished(config);
      expect(diagnostic).toHaveBeenCalledTimes(2);
      expect(failing).toHaveBeenCalledTimes(2);
    } finally { unsubscribe(); }
  });

  it("keeps other observers running even if diagnostic output itself fails", async () => {
    writeFileSync(configPath, source());
    const loader = await import("@/config/loader");
    const config = loader.loadConfig();
    const { subscribeConfigPublication, notifyConfigPublished } = await import("@/config/publication");
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => { throw new Error("diagnostic output unavailable"); });
    const failing = () => { throw new Error("sensitive callback failure"); };
    const observed = vi.fn();
    const unsubscribeFailure = subscribeConfigPublication(failing);
    const unsubscribeObserver = subscribeConfigPublication(observed);
    try {
      expect(() => notifyConfigPublished(config)).not.toThrow();
      expect(observed).toHaveBeenCalledExactlyOnceWith(config);
      expect(diagnostic).toHaveBeenCalledTimes(1);
    } finally { unsubscribeFailure(); unsubscribeObserver(); }
  });

  it.each(["", "auth: [ sensitive-config-content\n", "schema_version: 2\nappearance:\n  theme: invalid\n"])("fails closed for an invalid external replacement without rewriting it: %j", async replacement => {
    writeFileSync(configPath, source());
    const loader = await import("@/config/loader"); loader.loadConfig();
    writeFileSync(configPath, replacement);
    expect(loader.observeConfigReadiness().state).toBe("dirty");
    expect(loader.observeConfigReadiness().state).toBe("dirty");
    expect(vi.getTimerCount()).toBe(0);
    expect(readFileSync(configPath, "utf8")).toBe(replacement);
    expect(readdirSync(directory)).toEqual(["settings.yaml"]);
  });

  it("reports a missing warmed config as unavailable without recreating it", async () => {
    writeFileSync(configPath, source());
    const loader = await import("@/config/loader"); loader.loadConfig();
    rmSync(configPath);
    expect(loader.observeConfigReadiness().state).toBe("dirty");
    expect(readdirSync(directory)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps an externally supplied legacy document restart-required without migration side effects", async () => {
    writeFileSync(configPath, source());
    const loader = await import("@/config/loader"); loader.loadConfig();
    const { subscribeConfigPublication } = await import("@/config/publication");
    const published = vi.fn(); const unsubscribe = subscribeConfigPublication(published);
    const legacy = "schema_version: 1\nauth:\n  enabled: false\nservices: []\n";
    writeFileSync(configPath, legacy);
    try {
      expect(loader.observeConfigReadiness().state).toBe("dirty");
      expect(loader.refreshConfigCache()).toBe("dirty");
      expect(loader.refreshConfigCache()).toBe("migration-required");
      for (let i = 0; i < 3; i++) expect(loader.observeConfigReadiness().state).toBe("migration-required");
      expect(readFileSync(configPath, "utf8")).toBe(legacy);
      expect(readdirSync(directory)).toEqual(["settings.yaml"]);
      expect(vi.getTimerCount()).toBe(0);
      expect(published).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });
});
