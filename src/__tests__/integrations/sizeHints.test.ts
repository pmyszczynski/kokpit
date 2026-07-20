// Every shipped integration widget must declare a preferredSize hint so
// resolveServiceSize can pick a sensible default tile size for it.
import { describe, it, expect } from "vitest";
import "@/integrations";
import { getAllWidgets, getWidgetSizeHints } from "@/widgets";
import { sizeSatisfies } from "@/config/resolve";

describe("integration widget size hints", () => {
  it("every registered widget declares a preferredSize", () => {
    const widgets = getAllWidgets();
    expect(widgets.length).toBeGreaterThanOrEqual(21);
    for (const w of widgets) {
      expect(w.preferredSize, `widget "${w.id}" is missing preferredSize`).toBeDefined();
    }
  });

  it("preferredSize always satisfies minSize when both are set", () => {
    for (const w of getAllWidgets()) {
      if (w.preferredSize && w.minSize) {
        expect(
          sizeSatisfies(w.preferredSize, w.minSize),
          `widget "${w.id}" prefers ${w.preferredSize} below its minSize ${w.minSize}`
        ).toBe(true);
      }
    }
  });

  it("list/queue widgets prefer tall tiles", () => {
    for (const id of [
      "qbittorrent-torrents",
      "sonarr-queue",
      "sonarr-calendar",
      "radarr-queue",
      "seerr-requests",
      "docker",
    ]) {
      expect(getWidgetSizeHints(id)).toEqual({
        preferredSize: "tall",
        minSize: "tall",
      });
    }
  });

  it("single-stat netdata widgets prefer normal tiles", () => {
    for (const id of [
      "netdata-cpu",
      "netdata-ram",
      "netdata-net",
      "netdata-disk-io",
      "netdata-disk-space",
      "netdata-load",
      "netdata-sensor",
    ]) {
      expect(getWidgetSizeHints(id)?.preferredSize).toBe("normal");
    }
  });
});
