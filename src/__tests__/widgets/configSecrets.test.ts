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
  redactWidgetSecrets,
  resolveServiceWidgetSecrets,
  resolveWidgetConfigSecrets,
  UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY,
  WidgetSecretResolutionError,
} from "@/widgets/configSecrets";
import { WIDGET_SECRET_REFERENCE_PREFIX } from "@/widgets/secretReference";
import {
  createWidgetConfigReference,
  createWidgetSecretReference,
} from "@/widgets/secretReference.server";
import type { Service } from "@/config/schema";

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
  const savedServices: Service[] = [
    {
      name: "Tautulli",
      widget: {
        type: "tautulli-activity",
        config: {
          url: "http://tautulli.local:8181",
          api_key: "unit-saved-secret",
        },
      },
    },
  ];

  it("rejects a copied reference at a different destination", () => {
    const reference = createWidgetSecretReference(
      "Tautulli",
      "tautulli-activity",
      "api_key"
    );
    expect(() =>
      resolveWidgetConfigSecrets(
        "tautulli-activity",
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
          "Missing",
          "tautulli-activity",
          "api_key"
        ),
      },
      {
        url: "http://tautulli.local:8181",
        api_key: createWidgetSecretReference(
          "Tautulli",
          "tautulli-activity",
          "other"
        ),
      },
      {
        url: createWidgetSecretReference(
          "Tautulli",
          "tautulli-activity",
          "api_key"
        ),
        api_key: "replacement",
      },
    ];

    for (const config of cases) {
      try {
        resolveWidgetConfigSecrets(
          "tautulli-activity",
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
      widget: {
        type: "tautulli-activity",
        config: {
          url: "http://tautulli.local:8181",
          api_key: literal,
        },
      },
    } satisfies Service;
    const redacted = redactWidgetSecrets({
      schema_version: 1,
      auth: { enabled: false, session_ttl_hours: 24 },
      appearance: { theme: "dark" },
      layout: { columns: 4, row_height: 120 },
      services: [config],
    });

    expect(redacted.services[0].widget?.config?.api_key).not.toBe(literal);
    expect(
      resolveWidgetConfigSecrets(
        "tautulli-activity",
        redacted.services[0].widget!.config,
        [config]
      )
    ).toEqual(config.widget?.config);
  });
});

describe("registered widget config redaction", () => {
  function kokpitConfig(service: Service) {
    return {
      schema_version: 1 as const,
      auth: { enabled: false, session_ttl_hours: 24 },
      appearance: { theme: "dark" as const },
      layout: { columns: 4, row_height: 120 },
      services: [service],
    };
  }

  it("preserves empty saved credentials so invalid configs stay editable", () => {
    const service = {
      name: "Plex",
      widget: {
        type: "plex",
        config: { url: "http://plex.local:32400", token: "" },
      },
    } satisfies Service;
    const redacted = redactWidgetSecrets(kokpitConfig(service));
    const browserConfig = redacted.services[0].widget!.config!;

    expect(browserConfig).toEqual(service.widget?.config);
    expect(
      resolveWidgetConfigSecrets("plex", browserConfig, [service])
    ).toEqual(service.widget?.config);
  });

  it("preserves known fields when a required credential is missing", () => {
    const service = {
      name: "Sonarr",
      widget: {
        type: "sonarr-queue",
        config: { url: "http://sonarr.local:8989" },
      },
    } satisfies Service;

    const redacted = redactWidgetSecrets(kokpitConfig(service));

    expect(redacted.services[0].widget?.config).toEqual(
      service.widget?.config
    );
  });

  it("preserves schema-supported non-editor fields", () => {
    const service = {
      name: "Actual Budget",
      widget: {
        type: "actualbudget-accounts",
        config: {
          url: "http://actual.local:5006",
          api_key: "actual-secret",
          budget_sync_id: "budget-id",
          timezone: "Europe/Warsaw",
        },
      },
    } satisfies Service;
    const redacted = redactWidgetSecrets(kokpitConfig(service));
    const browserConfig = redacted.services[0].widget!.config!;

    expect(browserConfig).toMatchObject({
      url: "http://actual.local:5006",
      budget_sync_id: "budget-id",
      timezone: "Europe/Warsaw",
    });
    expect(JSON.stringify(browserConfig)).not.toContain("actual-secret");
    expect(
      resolveWidgetConfigSecrets(
        "actualbudget-accounts",
        browserConfig,
        [service]
      )
    ).toEqual(service.widget?.config);
  });

  it("hides malformed declared values with the complete config", () => {
    const service = {
      name: "Plex",
      widget: {
        type: "plex",
        config: {
          url: { api_key: "nested-secret" },
          token: "saved-secret",
        },
      },
    } satisfies Service;
    const redacted = redactWidgetSecrets(kokpitConfig(service));
    const browserConfig = redacted.services[0].widget!.config!;

    expect(JSON.stringify(browserConfig)).not.toContain("nested-secret");
    expect(JSON.stringify(browserConfig)).not.toContain("saved-secret");
    expect(browserConfig).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: expect.any(String),
    });
  });

  it("allows a verified opaque config to be replaced", () => {
    const service = {
      name: "Plex",
      widget: {
        type: "plex",
        config: {
          url: { api_key: "nested-secret" },
          token: "saved-secret",
        },
      },
    } satisfies Service;
    const opaqueConfig = redactWidgetSecrets(kokpitConfig(service)).services[0]
      .widget!.config!;
    const replacement = {
      ...opaqueConfig,
      url: "http://plex.local:32400",
      token: "replacement-token",
    };
    const resolved = resolveServiceWidgetSecrets(
      [
        {
          ...service,
          widget: { ...service.widget!, config: replacement },
        },
      ],
      [service]
    );

    expect(resolved[0].widget?.config).toEqual({
      url: "http://plex.local:32400",
      token: "replacement-token",
    });
  });

  it("keeps configs with unregistered fields opaque", () => {
    const service = {
      name: "Plex",
      widget: {
        type: "plex",
        config: {
          url: "http://plex.local:32400",
          token: "saved-secret",
          legacy_token: "must-not-reach-browser",
        },
      },
    } satisfies Service;
    const redacted = redactWidgetSecrets(kokpitConfig(service));
    const browserConfig = redacted.services[0].widget!.config!;

    expect(JSON.stringify(browserConfig)).not.toContain("saved-secret");
    expect(JSON.stringify(browserConfig)).not.toContain(
      "must-not-reach-browser"
    );
    expect(browserConfig).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: expect.any(String),
    });
    expect(
      resolveWidgetConfigSecrets("plex", browserConfig, [service])
    ).toEqual(service.widget?.config);
  });
});

describe("unregistered widget config redaction", () => {
  const config = {
    schema_version: 1 as const,
    auth: { enabled: false, session_ttl_hours: 24 },
    appearance: { theme: "dark" as const },
    layout: { columns: 4, row_height: 120 },
    services: [
      {
        name: "Retired integration",
        widget: {
          type: "removed-widget",
          config: {
            endpoint: "https://retired.local",
            api_key: "unknown-widget-secret",
          },
        },
      },
    ],
  } satisfies import("@/config/schema").KokpitConfig;

  it("hides the complete config and restores it from the signed placeholder", () => {
    const redacted = redactWidgetSecrets(config);
    const browserConfig = redacted.services[0].widget!.config!;

    expect(JSON.stringify(redacted)).not.toContain("unknown-widget-secret");
    expect(JSON.stringify(redacted)).not.toContain("retired.local");
    expect(browserConfig).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: expect.stringMatching(
        /^__KOKPIT_WIDGET_CONFIG_REF__:/
      ),
    });

    const restored = resolveServiceWidgetSecrets(
      redacted.services,
      config.services
    );
    expect(restored[0].widget?.config).toEqual(config.services[0].widget?.config);
  });

  it("rejects a malformed opaque config placeholder", () => {
    expect(() =>
      resolveWidgetConfigSecrets(
        "removed-widget",
        { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: "not-a-reference" },
        config.services
      )
    ).toThrowError(
      expect.objectContaining({ code: "widget_secret_reference_invalid" })
    );
  });

  it("rejects an opaque whole-config reference mixed with regular config", () => {
    expect(() =>
      resolveWidgetConfigSecrets(
        "tautulli-activity",
        {
          url: "http://tautulli.local:8181",
          [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: createWidgetConfigReference(
            "Retired integration",
            "removed-widget"
          ),
        },
        config.services
      )
    ).toThrowError(
      expect.objectContaining({ code: "widget_secret_reference_invalid" })
    );
  });
});
