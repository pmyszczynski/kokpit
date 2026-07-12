// Populate the widget registry server-side so widget configs can be
// validated before deciding whether a tile renders its widget.
import "@/integrations";
import { getConfig } from "@/config";
import { Service, ServiceWidget } from "@/config/schema";
import { getWidget } from "@/widgets";
import ServiceTile, { TileWidget } from "./ServiceTile";

// Decide what the client tile gets to see of a service's widget:
// - no widget → nothing
// - unknown type → sanitized pass-through, so the renderer surfaces the typo
// - known type with valid config → sanitized widget
// - known type with missing/invalid config → nothing (plain link tile)
// Config (credentials) never leaves the server either way.
function resolveTileWidget(widget?: ServiceWidget): TileWidget | undefined {
  if (!widget) return undefined;
  const def = getWidget(widget.type);
  if (def && !def.configSchema.safeParse(widget.config ?? {}).success) {
    return undefined;
  }
  return {
    type: widget.type,
    refresh_interval_ms: widget.refresh_interval_ms,
  };
}

function groupServices(services: Service[]): {
  ungrouped: Service[];
  groups: Map<string, Service[]>;
} {
  const ungrouped: Service[] = [];
  const groups = new Map<string, Service[]>();

  for (const service of services) {
    if (!service.group) {
      ungrouped.push(service);
    } else {
      const existing = groups.get(service.group) ?? [];
      existing.push(service);
      groups.set(service.group, existing);
    }
  }

  // Sort groups alphabetically
  const sorted = new Map(
    [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  );

  return { ungrouped, groups: sorted };
}

export default function ServiceGrid() {
  const { services } = getConfig();

  if (services.length === 0) {
    return null;
  }

  const { ungrouped, groups } = groupServices(services);

  return (
    <>
      {[...groups.entries()].map(([groupName, groupServices]) => (
        <div key={groupName} className="service-group">
          <h2 className="service-group__header">{groupName}</h2>
          <div className="dashboard-tile-grid">
            {groupServices.map((service) => (
              <ServiceTile
                key={service.name}
                name={service.name}
                url={service.url}
                icon={service.icon}
                description={service.description}
                widget={resolveTileWidget(service.widget)}
                position={service.position}
              />
            ))}
          </div>
        </div>
      ))}
      {ungrouped.length > 0 && (
        <div className="dashboard-tile-grid">
          {ungrouped.map((service) => (
            <ServiceTile
              key={service.name}
              name={service.name}
              url={service.url}
              icon={service.icon}
              description={service.description}
              widget={resolveTileWidget(service.widget)}
              position={service.position}
            />
          ))}
        </div>
      )}
    </>
  );
}
