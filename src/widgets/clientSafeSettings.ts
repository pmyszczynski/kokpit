import type {
  KokpitConfig,
  Service,
  ServiceWidget,
} from "@/config/schema";

/** A widget configuration after server-side credential redaction. */
export type ClientSafeWidget = Omit<ServiceWidget, "config"> & {
  /** Contains only editable non-secret values and opaque credential references. */
  config?: Record<string, unknown>;
};

/** A service that is safe to serialize to an authenticated browser client. */
export type ClientSafeService = Omit<Service, "widget"> & {
  widget?: ClientSafeWidget;
};

/**
 * Settings that have passed through the server-side credential-redaction
 * boundary. This lives in a type-only module so Client Components do not need
 * to import the server-only redaction implementation.
 */
export type ClientSafeSettings = Omit<KokpitConfig, "services"> & {
  services: ClientSafeService[];
};
