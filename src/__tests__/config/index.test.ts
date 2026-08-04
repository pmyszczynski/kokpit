import { afterEach, describe, expect, it, vi } from "vitest";
import * as config from "@/config";

describe("shared config exports", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not expose server-only configuration I/O", () => {
    for (const name of [
      "ConfigRevisionMismatchError",
      "getConfig",
      "getConfigPath",
      "invalidateCache",
      "legacyIntegrationType",
      "loadConfig",
      "splitLegacyWidgetConfig",
      "writeConfig",
    ]) {
      expect(config).not.toHaveProperty(name);
    }
  });

  it("can load in a browser environment without SharedArrayBuffer", async () => {
    vi.stubGlobal("SharedArrayBuffer", undefined);
    vi.resetModules();

    await expect(import("@/config")).resolves.toBeDefined();
  });
});
