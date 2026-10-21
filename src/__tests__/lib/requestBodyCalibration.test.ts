// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import "@/integrations";
import { getAllWidgets, type WidgetConfigField } from "@/widgets";
import { KokpitConfigSchema } from "@/config/schema";
import { readJsonObject, SETTINGS_BODY_BYTES, WIDGET_TEST_BODY_BYTES } from "@/lib/requestBody";

function representative(field: WidgetConfigField): unknown {
  if (field.type === "password") return "p".repeat(4096);
  if (field.type === "url") return "http://integration.local/api/";
  if (field.type === "boolean") return field.defaultValue ?? false;
  if (field.type === "multiselect") return field.options?.map(option => option.value) ?? [];
  if (field.type === "number") return 1;
  const special: Record<string, string> = {
    currency: "USD", locale: "en-US", timezone: "Europe/Warsaw", calendar: "http://integration.local/calendar/",
    query_parameter: "q", query_param: "q", chart: "system.cpu", dimension: "user", socket_path: "/var/run/docker.sock",
  };
  return special[field.key] ?? (field.key === "username" ? "u".repeat(500) : "representative-value");
}

describe("request limit calibration", () => {
  it("accepts a large validated dashboard with 1,000 services/tiles and 256 KiB custom CSS", async () => {
    const services = Array.from({ length: 1000 }, (_, index) => ({
      id: randomUUID(), name: `Service ${index} ${"long label ".repeat(5)}`,
      launch_url: `http://service-${index}.local/application/`, description: "A detailed dashboard service description".repeat(3),
    }));
    const service_tiles = services.map(service => ({
      id: randomUUID(), service_id: service.id, footprint: { columnSpan: 3, rowSpan: 2 },
    }));
    const config = KokpitConfigSchema.parse({ schema_version: 2, services, service_tiles, appearance: { custom_css: " ".repeat(256 * 1024) } });
    const body = JSON.stringify({ services: config.services, service_tiles: config.service_tiles, appearance: config.appearance });
    expect(Buffer.byteLength(body)).toBeLessThan(SETTINGS_BODY_BYTES);
    const parsed = await readJsonObject(new Request("http://localhost/api/settings", { method: "PATCH", body }), SETTINGS_BODY_BYTES);
    expect(parsed.services).toHaveLength(1000);
    expect(parsed.service_tiles).toHaveLength(1000);
  });

  it("keeps representative configs for every registered widget below the connection-test limit", async () => {
    const widgets = getAllWidgets();
    expect(widgets.length).toBeGreaterThan(30);
    for (const widget of widgets) {
      const candidate = Object.fromEntries((widget.configFields ?? []).map(field => [field.key, representative(field)]));
      if (widget.id === "calendar") candidate.api_key = ""; // CalDAV credentials are exclusive of Google keys.
      const result = widget.configSchema.safeParse(candidate);
      expect(result.success, `${widget.id}: ${result.success ? "" : result.error.message}`).toBe(true);
      if (!result.success) continue;
      const body = JSON.stringify({ type: widget.id, config: result.data });
      expect(Buffer.byteLength(body), widget.id).toBeLessThan(WIDGET_TEST_BODY_BYTES);
      await expect(readJsonObject(new Request("http://localhost/api/widget/test", { method: "POST", body }), WIDGET_TEST_BODY_BYTES))
        .resolves.toMatchObject({ type: widget.id });
    }
  });
});
