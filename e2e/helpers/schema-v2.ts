type LegacyServiceFixture = {
  name: string; url?: string; icon?: string; description?: string; group?: string;
  size?: string;
  widget?: { type: string; config?: Record<string, unknown>; fields?: string[] };
};

function fixtureUuid(kind: "service" | "tile", index: number): string {
  const prefix = kind === "service" ? "10000000" : "20000000";
  return `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function integrationType(widgetType: string): string | null {
  if (widgetType === "system-stats") return null;
  if (widgetType === "plex") return "plex";
  return widgetType.split("-")[0];
}

/** Convert concise E2E declarations into persisted schema-v2 entities. */
export function schemaV2Fixtures(legacy: LegacyServiceFixture[]) {
  const services = legacy.map((entry, index) => {
    const type = entry.widget ? integrationType(entry.widget.type) : null;
    const connection = { ...(entry.widget?.config ?? {}) };
    delete connection.fields;
    return {
      id: fixtureUuid("service", index), name: entry.name,
      launch_url: entry.url, icon: entry.icon, description: entry.description,
      category: entry.group,
      integration: type && entry.widget ? { type, config: connection } : undefined,
    };
  });
  const service_tiles = legacy.map((entry, index) => ({
    id: fixtureUuid("tile", index), service_id: services[index].id,
    group: entry.group,
    size: entry.size as "normal" | "wide" | "tall" | "large" | undefined,
    widget: entry.widget ? {
      type: entry.widget.type,
      config: Array.isArray(entry.widget.config?.fields)
        ? { fields: entry.widget.config.fields }
        : undefined,
      fields: entry.widget.fields,
    } : undefined,
  }));
  return { services, service_tiles };
}
