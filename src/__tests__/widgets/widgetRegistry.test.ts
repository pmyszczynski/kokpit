import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { registerWidget, getWidget, getAllWidgets, clearRegistry } from "@/widgets";
import type { WidgetDefinition } from "@/widgets";

function makeWidget(id: string): WidgetDefinition {
  return {
    id,
    name: `Widget ${id}`,
    configSchema: z.object({}),
    fetchData: async () => ({ value: 42 }),
    component: () => null,
  };
}

describe("widgetRegistry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("registers and retrieves a widget by id", () => {
    const def = makeWidget("test-widget");
    registerWidget(def);
    expect(getWidget("test-widget")).toBe(def);
  });

  it("returns undefined for unknown widget id", () => {
    expect(getWidget("does-not-exist")).toBeUndefined();
  });

  it("throws when registering a duplicate widget id", () => {
    registerWidget(makeWidget("duplicate"));
    expect(() => registerWidget(makeWidget("duplicate"))).toThrow(
      'Widget "duplicate" is already registered'
    );
  });

  it("getAllWidgets returns all registered widgets", () => {
    registerWidget(makeWidget("a"));
    registerWidget(makeWidget("b"));
    const all = getAllWidgets();
    expect(all).toHaveLength(2);
    expect(all.map((w) => w.id)).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("supports optional refreshInterval", () => {
    const def: WidgetDefinition = { ...makeWidget("with-interval"), refreshInterval: 10_000 };
    registerWidget(def);
    expect(getWidget("with-interval")?.refreshInterval).toBe(10_000);
  });
});
