// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import "@/integrations";
import { getAllWidgets } from "@/widgets";
import { MAX_WIDGET_RESULT_PAYLOAD_BYTES, WidgetResultCache, WIDGET_RESULT_TTL_MS } from "@/widgets/resultCache";

describe("widget cache calibration", () => {
  it("bounds freshness below existing active polling schedules and preserves Search interval zero", () => {
    const widgets = getAllWidgets();
    expect(widgets.length).toBeGreaterThan(30);
    for (const widget of widgets) {
      if (widget.refreshInterval && widget.refreshInterval > 0) {
        expect(WIDGET_RESULT_TTL_MS, widget.id).toBeLessThanOrEqual(widget.refreshInterval);
      }
    }
    expect(widgets.find(widget => widget.id === "search")?.refreshInterval).toBe(0);
  });

  it.each([
    ["RSS", {
      title: "Homelab news", articles: Array.from({ length: 50 }, (_, index) => ({
        id: `article-${index}`, title: "Headline ".repeat(25), summary: "é".repeat(500),
        url: `https://news.example/articles/${index}?${"param=value&".repeat(150)}`, publishedAt: "2026-10-20T12:00:00.000Z",
      })),
    }],
    ["Plex", {
      streams: 500, transcodes: 250, sessions: Array.from({ length: 500 }, (_, index) => ({
        username: `User ${index}`, title: "Long media title ".repeat(30), state: "playing", mediaType: "episode",
        transcodeDecision: "transcode", progressPercent: 42,
      })),
    }],
    ["Actual Budget", {
      currency: "USD", locale: "en-US", privacyMode: true,
      accounts: Array.from({ length: 1000 }, (_, index) => ({
        id: `account-${index}`, name: "A descriptive account name ".repeat(5), balance: 123456789, offbudget: false,
      })),
    }],
  ] as const)("retains representative large %s payloads within the proposed per-entry bound", async (_name, data) => {
    expect(Buffer.byteLength(JSON.stringify(data), "utf8")).toBeLessThan(MAX_WIDGET_RESULT_PAYLOAD_BYTES);
    const cache = new WidgetResultCache();
    cache.observeGeneration("calibration");
    const load = vi.fn(async () => data);
    expect(await cache.get("sample", 30_000, load)).toEqual(data);
    expect(await cache.get("sample", 30_000, load)).toEqual(data);
    expect(load).toHaveBeenCalledOnce();
  });
});
