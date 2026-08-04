// @vitest-environment node
import React from "react";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import "@/integrations";
import {
  getAllWidgets,
  registerWidget,
  type WidgetDefinition,
} from "@/widgets";
import {
  normalizeCredentialScope,
  widgetCredentialScopesMatch,
} from "@/widgets/credentialScope";
import {
  toClientSafeSettings,
  resolveServiceIntegrationSecrets,
  resolveIntegrationConfigSecrets,
  resolveServiceTileWidgetConfigs,
  UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY,
  WidgetSecretResolutionError,
} from "@/widgets/configSecrets";
import {
  WIDGET_SECRET_REFERENCE_KEY,
  WIDGET_SECRET_REFERENCE_PREFIX,
} from "@/widgets/secretReference";
import {
  createWidgetConfigReference,
  createWidgetSecretReference,
} from "@/widgets/secretReference.server";
import type { KokpitConfig } from "@/config/schema";

const component = () => React.createElement("div");
const baseDefinition = {
  name: "Invalid test widget",
  configSchema: z.record(z.string(), z.unknown()),
  fetchData: async () => ({}),
  component,
  configFields: [
    { key: "url", label: "URL", type: "url" as const },
    { key: "token", label: "Token", type: "password" as const },
    { key: "number", label: "Number", type: "number" as const },
  ],
};

describe("widget credential scope registry invariant", () => {
  it("requires every password-bearing widget to declare valid non-secret scope", () => {
    const credentialed = getAllWidgets().filter((widget) =>
      widget.configFields?.some((field) => field.type === "password")
    );

    expect(
      Object.fromEntries(
        credentialed
          .map(
            (widget) =>
              [widget.id, widget.credentialScopeFields] as const
          )
          .sort((left, right) => left[0].localeCompare(right[0]))
      )
    ).toEqual({
      "actualbudget-accounts": ["url", "budget_sync_id"],
      "actualbudget-categories": ["url", "budget_sync_id"],
      "actualbudget-schedules": ["url", "budget_sync_id"],
      "actualbudget-summary": ["url", "budget_sync_id"],
      "immich-stats": ["url"],
      "netdata-cpu": ["url"],
      "netdata-disk-io": ["url"],
      "netdata-disk-space": ["url"],
      "netdata-load": ["url"],
      "netdata-net": ["url"],
      "netdata-ram": ["url"],
      "netdata-sensor": ["url"],
      plex: ["url"],
      "prowlarr-stats": ["url"],
      "qbittorrent-stats": ["url", "username"],
      "qbittorrent-torrents": ["url", "username"],
      "radarr-queue": ["url"],
      "radarr-stats": ["url"],
      sabnzbd: ["url"],
      "seerr-requests": ["url"],
      "seerr-stats": ["url"],
      "sonarr-calendar": ["url"],
      "sonarr-queue": ["url"],
      "tautulli-activity": ["url"],
      "tdarr-stats": ["url"],
      "unraid-stats": ["url"],
    });
    for (const widget of credentialed) {
      expect(widget.credentialScopeFields?.length).toBeGreaterThan(0);
      for (const key of widget.credentialScopeFields ?? []) {
        expect(
          widget.configFields?.find((field) => field.key === key)?.type
        ).not.toBe("password");
      }
    }
  });

  it.each([
    { id: "missing-scope" },
    { id: "empty-scope", credentialScopeFields: [] },
    { id: "unknown-scope", credentialScopeFields: ["missing"] },
    { id: "secret-scope", credentialScopeFields: ["token"] },
    { id: "number-scope", credentialScopeFields: ["number"] },
  ])("rejects invalid definition $id", (extra) => {
    expect(() =>
      registerWidget({
        ...baseDefinition,
        ...extra,
      } as WidgetDefinition)
    ).toThrow(/credential scope/i);
  });
});

describe("credential scope normalization", () => {
  it("canonicalizes equivalent HTTP URLs and drops fragments", () => {
    expect(
      normalizeCredentialScope("tautulli-activity", {
        url: " HTTP://Example.COM:80/#ignored ",
      })
    ).toEqual(["http://example.com/"]);
    expect(
      widgetCredentialScopesMatch(
        "tautulli-activity",
        { url: "http://example.com" },
        { url: "HTTP://EXAMPLE.COM:80/#fragment" }
      )
    ).toBe(true);
  });

  it.each([
    ["host", "https://other/api?a=1"],
    ["scheme", "http://host/api?a=1"],
    ["port", "https://host:8443/api?a=1"],
    ["path", "https://host/other?a=1"],
    ["query", "https://host/api?a=2"],
  ])("keeps URL %s destination-bound", (_part, destination) => {
    expect(
      widgetCredentialScopesMatch(
        "tautulli-activity",
        { url: "https://host/api?a=1" },
        { url: destination }
      )
    ).toBe(false);
  });

  it("rejects non-http URLs", () => {
    expect(
      normalizeCredentialScope("tautulli-activity", {
        url: "ftp://host/api",
      })
    ).toBeNull();
  });

  it("compares qBittorrent usernames exactly", () => {
    expect(
      normalizeCredentialScope("qbittorrent-stats", {
        url: "http://host:8080",
        username: " Admin ",
      })
    ).toEqual(["http://host:8080/", " Admin "]);
    expect(
      widgetCredentialScopesMatch(
        "qbittorrent-stats",
        { url: "http://host:8080", username: "admin" },
        { url: "http://host:8080", username: "Admin" }
      )
    ).toBe(false);
  });

  it("keeps Actual Budget credentials bound to the selected budget", () => {
    const source = {
      url: "http://actual.local:5006",
      budget_sync_id: "budget-a",
    };
    expect(
      normalizeCredentialScope("actualbudget-accounts", source)
    ).toEqual(["http://actual.local:5006/", "budget-a"]);
    expect(
      widgetCredentialScopesMatch("actualbudget-accounts", source, {
        ...source,
        budget_sync_id: "budget-b",
      })
    ).toBe(false);
  });
});

describe("destination-bound secret resolution", () => {
  const serviceId = "10000000-0000-4000-8000-000000000001";
  const tileId = "20000000-0000-4000-8000-000000000001";
  const savedServices: KokpitConfig["services"] = [
    {
      id: serviceId,
      name: "Tautulli",
      integration: {
        type: "tautulli",
        config: {
          url: "http://tautulli.local:8181/",
          api_key: "unit-saved-secret",
        },
      },
    },
  ];

  it("rejects a copied reference at a different destination", () => {
    const reference = createWidgetSecretReference(
      serviceId,
      "tautulli",
      "api_key"
    );
    expect(() =>
      resolveIntegrationConfigSecrets(
        "tautulli",
        { url: "http://other.local:8181", api_key: reference },
        savedServices
      )
    ).toThrowError(
      expect.objectContaining({
        code: "widget_secret_scope_changed",
      }) as WidgetSecretResolutionError
    );
  });

  it("rejects wrong source, field, and misplaced reserved references", () => {
    const cases = [
      {
        url: "http://tautulli.local:8181",
        api_key: createWidgetSecretReference(
          "20000000-0000-4000-8000-000000000002",
          "tautulli",
          "api_key"
        ),
      },
      {
        url: "http://tautulli.local:8181",
        api_key: createWidgetSecretReference(
          serviceId,
          "tautulli",
          "other"
        ),
      },
      {
        url: createWidgetSecretReference(
          serviceId,
          "tautulli",
          "api_key"
        ),
        api_key: "replacement",
      },
      {
        url: {
          nested: {
            [WIDGET_SECRET_REFERENCE_KEY]: "malformed",
          },
        },
        api_key: "replacement",
      },
    ];

    for (const config of cases) {
      try {
        resolveIntegrationConfigSecrets(
          "tautulli",
          config,
          savedServices
        );
        throw new Error("Expected secret resolution to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(WidgetSecretResolutionError);
        expect((error as WidgetSecretResolutionError).code).toBe(
          "widget_secret_reference_invalid"
        );
      }
    }
  });

  it("preserves literal credentials that use the old marker prefix", () => {
    const literal = `${WIDGET_SECRET_REFERENCE_PREFIX}a-real-password`;
    const config = {
      ...savedServices[0],
      integration: {
        type: "tautulli",
        config: {
          url: "http://tautulli.local:8181/",
          api_key: literal,
        },
      },
    } satisfies KokpitConfig["services"][number];
    const redacted = toClientSafeSettings({
      schema_version: 2,
      auth: { enabled: false, session_ttl_hours: 24 },
      appearance: { theme: "dark" },
      layout: { columns: 4, row_height: 120 },
      services: [config],
      service_tiles: [{
        id: tileId,
        service_id: serviceId,
        widget: { type: "tautulli-activity" },
      }],
    });

    expect(redacted.services[0].integration?.config.api_key).not.toBe(literal);
    expect(
      resolveIntegrationConfigSecrets(
        "tautulli",
        redacted.services[0].integration!.config,
        [config]
      )
    ).toEqual(config.integration.config);
  });
});

describe("registered widget config redaction", () => {
  function kokpitConfig(
    service: KokpitConfig["services"][number],
    widgetType: string
  ): KokpitConfig {
    return {
      schema_version: 2,
      auth: { enabled: false, session_ttl_hours: 24 },
      appearance: { theme: "dark" as const },
      layout: { columns: 4, row_height: 120 },
      services: [service],
      service_tiles: [{
        id: `20000000-0000-4000-8000-${service.id.slice(-12)}`,
        service_id: service.id,
        widget: { type: widgetType },
      }],
    };
  }

  it("preserves empty saved credentials so invalid configs stay editable", () => {
    const service = {
      id: "10000000-0000-4000-8000-000000000002",
      name: "Plex",
      integration: {
        type: "plex",
        config: { url: "http://plex.local:32400/", token: "" },
      },
    } satisfies KokpitConfig["services"][number];
    const redacted = toClientSafeSettings(kokpitConfig(service, "plex"));
    const browserConfig = redacted.services[0].integration!.config;

    expect(browserConfig).toEqual(service.integration.config);
    expect(
      resolveIntegrationConfigSecrets("plex", browserConfig, [service])
    ).toEqual(service.integration.config);
  });

  it("preserves known fields when a required credential is missing", () => {
    const service = {
      id: "10000000-0000-4000-8000-000000000003",
      name: "Sonarr",
      integration: {
        type: "sonarr",
        config: { url: "http://sonarr.local:8989" },
      },
    } satisfies KokpitConfig["services"][number];

    const redacted = toClientSafeSettings(kokpitConfig(service, "sonarr-queue"));

    expect(redacted.services[0].integration?.config).toEqual(
      service.integration.config
    );
  });

  it("preserves schema-supported non-editor fields", () => {
    const service = {
      id: "10000000-0000-4000-8000-000000000004",
      name: "Actual Budget",
      integration: {
        type: "actualbudget",
        config: {
          url: "http://actual.local:5006/",
          api_key: "actual-secret",
          budget_sync_id: "budget-id",
          timezone: "Europe/Warsaw",
        },
      },
    } satisfies KokpitConfig["services"][number];
    const redacted = toClientSafeSettings(
      kokpitConfig(service, "actualbudget-accounts")
    );
    const browserConfig = redacted.services[0].integration!.config;

    expect(browserConfig).toMatchObject({
      url: "http://actual.local:5006/",
      budget_sync_id: "budget-id",
      timezone: "Europe/Warsaw",
    });
    expect(JSON.stringify(browserConfig)).not.toContain("actual-secret");
    expect(
      resolveIntegrationConfigSecrets(
        "actualbudget",
        browserConfig,
        [service]
      )
    ).toEqual(service.integration.config);
  });

  it("hides malformed declared values with the complete config", () => {
    const service = {
      id: "10000000-0000-4000-8000-000000000005",
      name: "Plex",
      integration: {
        type: "plex",
        config: {
          url: { api_key: "nested-secret" },
          token: "saved-secret",
        },
      },
    } satisfies KokpitConfig["services"][number];
    const redacted = toClientSafeSettings(kokpitConfig(service, "plex"));
    const browserConfig = redacted.services[0].integration!.config;

    expect(JSON.stringify(browserConfig)).not.toContain("nested-secret");
    expect(JSON.stringify(browserConfig)).not.toContain("saved-secret");
    expect(browserConfig).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: expect.any(String),
    });
  });

  it("allows a verified opaque config to be replaced", () => {
    const service = {
      id: "10000000-0000-4000-8000-000000000006",
      name: "Plex",
      integration: {
        type: "plex",
        config: {
          url: { api_key: "nested-secret" },
          token: "saved-secret",
        },
      },
    } satisfies KokpitConfig["services"][number];
    const opaqueConfig = toClientSafeSettings(
      kokpitConfig(service, "plex")
    ).services[0].integration!.config;
    const replacement = {
      ...opaqueConfig,
      url: "http://plex.local:32400/",
      token: "replacement-token",
    };
    const resolved = resolveServiceIntegrationSecrets(
      [
        {
          ...service,
          integration: { ...service.integration, config: replacement },
        },
      ],
      [service]
    );

    expect(resolved[0].integration?.config).toEqual({
      url: "http://plex.local:32400/",
      token: "replacement-token",
    });
  });

  it("keeps configs with unregistered fields opaque", () => {
    const service = {
      id: "10000000-0000-4000-8000-000000000007",
      name: "Plex",
      integration: {
        type: "plex",
        config: {
          url: "http://plex.local:32400",
          token: "saved-secret",
          legacy_token: "must-not-reach-browser",
        },
      },
    } satisfies KokpitConfig["services"][number];
    const redacted = toClientSafeSettings(kokpitConfig(service, "plex"));
    const browserConfig = redacted.services[0].integration!.config;

    expect(JSON.stringify(browserConfig)).not.toContain("saved-secret");
    expect(JSON.stringify(browserConfig)).not.toContain(
      "must-not-reach-browser"
    );
    expect(browserConfig).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: expect.any(String),
    });
    expect(
      resolveServiceIntegrationSecrets([
        { ...service, integration: { ...service.integration, config: browserConfig } },
      ], [service])[0].integration?.config
    ).toEqual(service.integration.config);
  });
});

describe("client-safe settings allowlist", () => {
  it("does not serialize undeclared server-only properties", () => {
    const config = {
      schema_version: 2,
      auth: {
        enabled: false,
        session_ttl_hours: 24,
        future_server_secret: "auth-secret",
      },
      appearance: { theme: "dark" },
      layout: { columns: 4, row_height: 120 },
      services: [
        {
          id: "10000000-0000-4000-8000-000000000008",
          name: "Plex",
          future_server_secret: "service-secret",
          integration: {
            type: "plex",
            config: {
              url: "http://plex.local:32400",
              token: "credential-secret",
            },
          },
        },
      ],
      service_tiles: [{
        id: "20000000-0000-4000-8000-000000000008",
        service_id: "10000000-0000-4000-8000-000000000008",
        future_server_secret: "widget-secret",
      }],
      future_server_secret: "top-level-secret",
    } as unknown as import("@/config/schema").KokpitConfig;

    const serialized = JSON.stringify(toClientSafeSettings(config));

    expect(serialized).not.toContain("top-level-secret");
    expect(serialized).not.toContain("auth-secret");
    expect(serialized).not.toContain("service-secret");
    expect(serialized).not.toContain("widget-secret");
    expect(serialized).not.toContain("credential-secret");
  });
});

describe("unregistered widget config redaction", () => {
  const serviceId = "10000000-0000-4000-8000-000000000009";
  const config = {
    schema_version: 2 as const,
    auth: { enabled: false, session_ttl_hours: 24 },
    appearance: { theme: "dark" as const },
    layout: { columns: 4, row_height: 120 },
    services: [
      {
        id: serviceId,
        name: "Retired integration",
        integration: {
          type: "removed-integration",
          config: {
            endpoint: "https://retired.local",
            api_key: "unknown-widget-secret",
          },
        },
      },
    ],
    service_tiles: [],
  } satisfies KokpitConfig;

  it("hides the complete config and restores it from the signed placeholder", () => {
    const redacted = toClientSafeSettings(config);
    const browserConfig = redacted.services[0].integration!.config;

    expect(JSON.stringify(redacted)).not.toContain("unknown-widget-secret");
    expect(JSON.stringify(redacted)).not.toContain("retired.local");
    expect(browserConfig).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: expect.stringMatching(
        /^__KOKPIT_WIDGET_CONFIG_REF__:/
      ),
    });

    const restored = resolveServiceIntegrationSecrets(
      redacted.services,
      config.services
    );
    expect(restored[0].integration?.config).toEqual(
      config.services[0].integration?.config
    );
  });

  it("rejects a malformed opaque config placeholder", () => {
    expect(() =>
      resolveServiceIntegrationSecrets([{
        ...config.services[0],
        integration: {
          ...config.services[0].integration,
          config: { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: "not-a-reference" },
        },
      }], config.services)
    ).toThrowError(
      expect.objectContaining({ code: "widget_secret_reference_invalid" })
    );
  });

  it("rejects an opaque whole-config reference mixed with regular config", () => {
    expect(() =>
      resolveServiceIntegrationSecrets([{
        ...config.services[0],
        integration: {
          ...config.services[0].integration,
          config: {
            url: "http://tautulli.local:8181",
            [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: createWidgetConfigReference(
              serviceId,
              "removed-widget"
            ),
          },
        },
      }], config.services)
    ).toThrowError(
      expect.objectContaining({ code: "widget_secret_reference_invalid" })
    );
  });
});

describe("opaque integration config redaction", () => {
  const serviceId = "10000000-0000-4000-8000-000000000001";
  const savedServices: KokpitConfig["services"] = [{
    id: serviceId,
    name: "Tautulli",
    integration: {
      type: "tautulli",
      config: { url: { malformed: true }, api_key: "saved-secret" },
    },
  }];
  const savedConfig = {
    schema_version: 2 as const,
    auth: { enabled: false, session_ttl_hours: 24 },
    appearance: { theme: "dark" as const },
    layout: { columns: 4, row_height: 120 },
    services: savedServices,
    service_tiles: [],
  } satisfies KokpitConfig;

  it("restores a sole opaque marker and permits replacement fields without persisting it", () => {
    const browserService = toClientSafeSettings(savedConfig).services[0];
    const opaque = browserService.integration!.config;
    expect(opaque).toEqual({ [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: expect.any(String) });

    expect(resolveServiceIntegrationSecrets([browserService], savedServices)[0].integration?.config)
      .toEqual(savedServices[0].integration?.config);

    const replaced = resolveServiceIntegrationSecrets([{
      ...browserService,
      integration: {
        ...browserService.integration!,
        config: {
          ...opaque,
          url: " HTTP://tautulli.local:8181/ ",
          api_key: "replacement-secret",
        },
      },
    }], savedServices);
    expect(replaced[0].integration?.config).toEqual({
      url: "http://tautulli.local:8181/",
      api_key: "replacement-secret",
    });
  });

  it("resolves an exact opaque marker for connection testing without exposing its config", () => {
    const marker = createWidgetConfigReference(serviceId, "tautulli");
    expect(resolveIntegrationConfigSecrets("tautulli", {
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: marker,
    }, savedServices)).toEqual(savedServices[0].integration!.config);
    expect(() => resolveIntegrationConfigSecrets("plex", {
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: marker,
    }, savedServices)).toThrowError(
      expect.objectContaining({ code: "widget_secret_reference_invalid" })
    );
    expect(() => resolveIntegrationConfigSecrets("tautulli", {
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: "malformed",
    }, savedServices)).toThrowError(
      expect.objectContaining({ code: "widget_secret_reference_invalid" })
    );
    expect(() => resolveIntegrationConfigSecrets("tautulli", {
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: marker,
      url: "http://replacement.local",
    }, savedServices)).toThrowError(
      expect.objectContaining({ code: "widget_secret_reference_invalid" })
    );
  });

  it.each([
    { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: "malformed" },
    {
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: createWidgetConfigReference(
        "20000000-0000-4000-8000-000000000002",
        "tautulli"
      ),
      url: "http://replacement.local",
    },
  ])("rejects malformed or wrong-bound opaque integration references", (config) => {
    expect(() => resolveServiceIntegrationSecrets([{
      ...savedServices[0],
      integration: { ...savedServices[0].integration!, config },
    }], savedServices)).toThrowError(
      expect.objectContaining({ code: "widget_secret_reference_invalid" })
    );
  });

  it("resolves a signed credential after removing a valid mixed opaque marker", () => {
    const source: KokpitConfig["services"] = [{
      id: serviceId,
      name: "Tautulli",
      integration: { type: "tautulli", config: { url: "http://tautulli.local:8181", api_key: "saved-secret" } },
    }];
    const resolved = resolveServiceIntegrationSecrets([{
      ...source[0],
      integration: { ...source[0].integration!, config: {
        [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: createWidgetConfigReference(serviceId, "tautulli"),
        url: "http://tautulli.local:8181",
        api_key: createWidgetSecretReference(serviceId, "tautulli", "api_key"),
      } },
    }], source);
    expect(resolved[0].integration?.config).toEqual({ url: "http://tautulli.local:8181/", api_key: "saved-secret" });
  });

  it("rejects a same-service opaque marker bound to another integration type", () => {
    expect(() => resolveServiceIntegrationSecrets([{
      ...savedServices[0],
      integration: { ...savedServices[0].integration!, config: {
        [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: createWidgetConfigReference(serviceId, "plex"),
      } },
    }], savedServices)).toThrowError(expect.objectContaining({ code: "widget_secret_reference_invalid" }));
  });
});

describe("opaque tile widget config redaction", () => {
  const serviceId = "10000000-0000-4000-8000-000000000001";
  const tileId = "20000000-0000-4000-8000-000000000001";
  const saved = [{
    id: tileId,
    service_id: serviceId,
    widget: { type: "tautulli-activity", config: { api_key: "tile-secret", sections: ["summary"] } },
  }] satisfies KokpitConfig["service_tiles"];
  const config = {
    schema_version: 2 as const,
    auth: { enabled: false, session_ttl_hours: 24 },
    appearance: { theme: "dark" as const },
    layout: { columns: 4, row_height: 120 },
    services: [{ id: serviceId, name: "Tautulli" }],
    service_tiles: saved,
  } satisfies KokpitConfig;

  it("hides secret-like tile options and restores a signed opaque reference", () => {
    const safe = toClientSafeSettings(config);
    const opaque = safe.service_tiles[0].widget!.config!;

    expect(JSON.stringify(safe)).not.toContain("tile-secret");
    expect(opaque).toEqual({ [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: expect.any(String) });
    expect(resolveServiceTileWidgetConfigs(safe.service_tiles, saved)).toEqual(saved);
  });

  it("makes unknown and malformed registered tile configs wholly opaque", () => {
    const unknown = toClientSafeSettings({ ...config, service_tiles: [{ ...saved[0], widget: { type: "removed", config: { access_key: "secret" } } }] });
    const malformed = toClientSafeSettings({ ...config, service_tiles: [{ ...saved[0], widget: { ...saved[0].widget!, config: { sections: [{ nested: "value" }] } } }] });
    expect(unknown.service_tiles[0].widget?.config).toHaveProperty(UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY);
    expect(malformed.service_tiles[0].widget?.config).toHaveProperty(UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY);
  });

  it("merges a verified mixed marker with opaque saved tile config", () => {
    const safe = toClientSafeSettings(config);
    const replacement = [{
      ...safe.service_tiles[0],
      widget: {
        ...safe.service_tiles[0].widget!,
        config: { ...safe.service_tiles[0].widget!.config!, sections: ["sessions"] },
      },
    }];

    expect(resolveServiceTileWidgetConfigs(replacement, saved)[0].widget?.config)
      .toEqual({ api_key: "tile-secret", sections: ["sessions"] });
  });

  it("rejects malformed or wrong-bound tile references", () => {
    for (const marker of ["invalid", createWidgetConfigReference(tileId, "plex")]) {
      expect(() => resolveServiceTileWidgetConfigs([{
        ...saved[0],
        widget: { ...saved[0].widget!, config: { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: marker } },
      }], saved)).toThrowError(expect.objectContaining({ code: "widget_secret_reference_invalid" }));
    }
  });
});
