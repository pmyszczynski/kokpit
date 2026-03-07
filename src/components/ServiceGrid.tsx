import { getConfig } from "@/config";
import { Service } from "@/config/schema";
import ServiceTile from "./ServiceTile";

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

function tileKey(service: Service): string {
  return service.url ? `${service.name}:${service.url}` : service.name;
}

export default function ServiceGrid() {
  const { services } = getConfig();

  if (services.length === 0) {
    return null;
  }

  const { ungrouped, groups } = groupServices(services);

  return (
    <>
      {ungrouped.map((service) => (
        <ServiceTile
          key={tileKey(service)}
          name={service.name}
          url={service.url}
          icon={service.icon}
          description={service.description}
          widget={service.widget}
          position={service.position}
        />
      ))}
      {[...groups.entries()].map(([groupName, groupServices]) => (
        <div key={groupName} className="service-group">
          <h2 className="service-group__header">{groupName}</h2>
          {groupServices.map((service) => (
            <ServiceTile
              key={tileKey(service)}
              name={service.name}
              url={service.url}
              icon={service.icon}
              description={service.description}
              widget={service.widget}
              position={service.position}
            />
          ))}
        </div>
      ))}
    </>
  );
}
