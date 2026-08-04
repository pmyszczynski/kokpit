import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { registerWidget, clearRegistry } from "@/widgets";
import type { AnyWidgetDefinition, WidgetConfigField } from "@/widgets";
import { widgetConfigIssues, resolveTileWidget } from "@/widgets/tileWidget";
import {
  WIDGET_CONFIG_REFERENCE_PREFIX,
  WIDGET_SECRET_REFERENCE_KEY,
  WIDGET_SECRET_REFERENCE_PREFIX,
} from "@/widgets/secretReference";

function makeWidget(
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configSchema: z.ZodType<any> = z.object({}),
  configFields?: WidgetConfigField[],
  credentialScopeFields?: string[]
): AnyWidgetDefinition {
  return {
    id,
    name: `Widget ${id}`,
    configSchema,
    configFields,
    credentialScopeFields,
    fetchData: async () => ({}),
    component: () => null,
  };
}

describe("widgetConfigIssues", () => {
  it("returns no issues when the config satisfies the schema", () => {
    const def = makeWidget("ok", z.object({ url: z.string().url() }));
    expect(
      widgetConfigIssues(def, { url: "http://example.com" })
    ).toEqual([]);
  });

  it("returns one issue per failed field, with path + message only", () => {
    const def = makeWidget(
      "strict",
      z.object({ url: z.string().url(), api_key: z.string().min(1) })
    );
    const issues = widgetConfigIssues(def, {});
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.path).sort()).toEqual(["api_key", "url"]);
    for (const issue of issues) {
      expect(Object.keys(issue).sort()).toEqual(["message", "path"]);
      expect(typeof issue.message).toBe("string");
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  it("treats a missing/undefined config the same as an empty object", () => {
    const def = makeWidget(
      "requires-field",
      z.object({ url: z.string().url() })
    );
    expect(widgetConfigIssues(def, undefined)).toEqual(
      widgetConfigIssues(def, {})
    );
    expect(widgetConfigIssues(def, undefined)).toHaveLength(1);
  });

  it("labels a whole-object (root-level) failure with the 'config' path", () => {
    const def = makeWidget("root-fail", z.string());
    const issues = widgetConfigIssues(def, { not: "a string" });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("config");
  });

  it("joins nested paths with dots", () => {
    const def = makeWidget(
      "nested",
      z.object({ auth: z.object({ token: z.string().min(1) }) })
    );
    const issues = widgetConfigIssues(def, { auth: {} });
    expect(issues.map((i) => i.path)).toContain("auth.token");
  });

  // SECURITY: config carries credentials (API keys, tokens, passwords). The
  // whole reason TileWidget only exposes {path, message} instead of the raw
  // Zod issue is so those values never cross the server/client boundary, even
  // when they're also the thing that failed validation.
  it("never leaks a credential value from the config into the returned issues", () => {
    const SECRET = "sk-live-super-secret-should-never-leave-the-server-12345";
    const def = makeWidget(
      "credentialed",
      z.object({
        url: z.string().url(),
        api_key: z.string().min(1),
        // A type mismatch is the case most likely to carry the raw input in
        // some Zod issue shapes (invalid_type issues), so exercise it too.
        port: z.number(),
      })
    );
    const result = widgetConfigIssues(def, {
      url: "not-a-url",
      api_key: SECRET,
      port: SECRET,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe("resolveTileWidget", () => {
  beforeEach(() => {
    clearRegistry();
  });
  afterEach(() => {
    clearRegistry();
  });

  it("returns undefined when the service has no widget", () => {
    expect(resolveTileWidget(undefined)).toBeUndefined();
  });

  it("passes through an unknown widget type with no `invalid`", () => {
    // No widget registered under this id at all.
    const result = resolveTileWidget({ type: "not-a-real-widget" });
    expect(result).toEqual({ type: "not-a-real-widget" });
    expect(result).not.toHaveProperty("invalid");
  });

  it("known type + valid config: sanitized widget, no `invalid`", () => {
    registerWidget(makeWidget("plexish", z.object({ url: z.string().url() })));
    const result = resolveTileWidget({
      type: "plexish",
      config: { url: "http://plex.local:32400" },
      refresh_interval_ms: 5000,
    });
    expect(result).toEqual({
      type: "plexish",
      refresh_interval_ms: 5000,
    });
    expect(result).not.toHaveProperty("invalid");
  });

  it("validates raw credential references by default and normalizes them only for edit previews", () => {
    registerWidget(
      makeWidget(
        "credentialed",
        z.object({ url: z.string().url(), api_key: z.string().min(1) }),
        [
          { key: "url", label: "URL", type: "url", required: true },
          { key: "api_key", label: "API key", type: "password", required: true },
        ],
        ["url"]
      )
    );
    const reference = `${WIDGET_SECRET_REFERENCE_PREFIX}signed-reference`;
    const widget = {
      type: "credentialed",
      config: {
        url: "http://service.local",
        api_key: { [WIDGET_SECRET_REFERENCE_KEY]: reference },
      },
    };

    const serverResult = resolveTileWidget(widget);
    expect(serverResult?.invalid).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "api_key" })])
    );

    const editPreview = resolveTileWidget(widget, undefined, {
      normalizeSecretReferences: true,
    });

    expect(editPreview).toEqual({ type: "credentialed" });
    expect(JSON.stringify(editPreview)).not.toContain(reference);
  });

  it("accepts opaque integration references only for client-safe edit previews", () => {
    registerWidget(
      makeWidget(
        "opaque-credentialed",
        z.object({
          url: z.string().url(),
          api_key: z.string().min(1),
          days: z.number().max(30).optional(),
        }),
        [
          { key: "url", label: "URL", type: "url", required: true },
          { key: "api_key", label: "API key", type: "password", required: true },
        ],
        ["url"]
      )
    );
    const reference = `${WIDGET_CONFIG_REFERENCE_PREFIX}signed-reference`;
    const connection = { __kokpit_widget_config_reference__: reference };
    const widget = { type: "opaque-credentialed", config: { days: 7 } };

    expect(resolveTileWidget(widget, connection)?.invalid).toBeDefined();

    const editPreview = resolveTileWidget(widget, connection, {
      normalizeOpaqueConfigReference: true,
    });
    expect(editPreview).toEqual({ type: "opaque-credentialed" });
    expect(JSON.stringify(editPreview)).not.toContain(reference);

    const invalidPreview = resolveTileWidget(
      { type: "opaque-credentialed", config: { days: 31 } },
      connection,
      { normalizeOpaqueConfigReference: true }
    );
    expect(invalidPreview?.invalid).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "days" })])
    );
  });

  it("does not invent invalid values for optional hidden connection fields", () => {
    registerWidget(
      makeWidget(
        "actualbudget-accounts",
        z.object({
          url: z.string().url(),
          api_key: z.string().min(1),
          budget_sync_id: z.string().min(1),
          currency: z.string().length(3).default("USD"),
          exclude_closed: z.boolean().default(true),
        }),
        [
          { key: "url", label: "URL", type: "url", required: true },
          { key: "api_key", label: "API key", type: "password", required: true },
          { key: "budget_sync_id", label: "Budget", type: "text", required: true },
          { key: "currency", label: "Currency", type: "text", required: false },
          { key: "exclude_closed", label: "Hide closed", type: "boolean", required: false },
        ],
        ["url", "budget_sync_id"]
      )
    );
    const connection = {
      __kokpit_widget_config_reference__:
        `${WIDGET_CONFIG_REFERENCE_PREFIX}signed-reference`,
    };

    expect(resolveTileWidget(
      { type: "actualbudget-accounts", config: { exclude_closed: false } },
      connection,
      { normalizeOpaqueConfigReference: true }
    )).toEqual({ type: "actualbudget-accounts" });

    expect(resolveTileWidget(
      { type: "actualbudget-accounts", config: { exclude_closed: "yes" } },
      connection,
      { normalizeOpaqueConfigReference: true }
    )?.invalid).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "exclude_closed" })])
    );
  });

  it("known type + invalid config: sanitized widget with populated `invalid`", () => {
    registerWidget(
      makeWidget(
        "sonarrish",
        z.object({ url: z.string().url(), api_key: z.string().min(1) })
      )
    );
    const result = resolveTileWidget({
      type: "sonarrish",
      config: { url: "http://sonarr.local" }, // api_key missing
    });
    expect(result?.type).toBe("sonarrish");
    expect(result?.invalid).toBeDefined();
    expect(result?.invalid?.length).toBeGreaterThan(0);
    expect(result?.invalid?.[0]).toEqual(
      expect.objectContaining({ path: "api_key" })
    );
  });

  it("never leaks the raw service.widget.config on the resolved tile widget", () => {
    registerWidget(
      makeWidget("secretive", z.object({ token: z.string().min(50) }))
    );
    const result = resolveTileWidget({
      type: "secretive",
      config: { token: "short-secret-value" },
    });
    expect(result).not.toHaveProperty("config");
    expect(JSON.stringify(result)).not.toContain("short-secret-value");
  });
});
