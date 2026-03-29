// Importing each integration registers its widget as a side effect.
// Add new integrations here as they are implemented.
import "./plex/widget";

export type IntegrationStatus = "ok" | "error" | "unknown";
