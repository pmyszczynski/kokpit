import type { KokpitConfig } from "./schema";
import { configRevision } from "./revision";
import { canonicalJSONString } from "./canonicalJson";

/** Opaque browser invalidation identity; names/order/theme do not fetch data. */
export function pollingRevision(config: KokpitConfig): string {
  const services = config.services.map((service) => ({
    id: service.id, launch_url: service.launch_url, integration: service.integration,
  })).sort((left, right) => (left.id ?? "").localeCompare(right.id ?? ""));
  const tiles = (config.service_tiles ?? []).map((tile) => ({
    id: tile.id, service_id: tile.service_id, widget: tile.widget, footprint: tile.footprint,
  })).sort((left, right) => left.id.localeCompare(right.id));
  return configRevision(canonicalJSONString({ services, tiles }));
}
