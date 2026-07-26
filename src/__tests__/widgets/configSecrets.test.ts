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
  resolveWidgetConfigSecrets,
  WidgetSecretResolutionError,
} from "@/widgets/configSecrets";
import { createWidgetSecretReference } from "@/widgets/secretReference.server";
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
  ],
};

describe("widget credential scope registry invariant", () => {
  it("requires every password-bearing widget to declare valid non-secret scope", () => {
    const credentialed = getAllWidgets().filter((widget) =>
      widget.configFields?.some((field) => field.type === "password")
    );

    expect(credentialed).toHaveLength(22);
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
});
