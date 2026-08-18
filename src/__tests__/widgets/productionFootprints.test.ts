import { describe, expect, it } from "vitest";
import { getAllWidgets } from "@/widgets";

import "@/integrations";

describe("production widget footprints", () => {
  it("declares at least one valid supported footprint for every production widget", () => {
    const widgets = getAllWidgets();
    expect(widgets).toHaveLength(28);

    for (const widget of widgets) {
      expect(widget.supportedFootprints, widget.id).toBeDefined();
      expect(widget.supportedFootprints, widget.id).not.toHaveLength(0);
      for (const footprint of widget.supportedFootprints ?? []) {
        expect(Number.isInteger(footprint.columnSpan), widget.id).toBe(true);
        expect(Number.isInteger(footprint.rowSpan), widget.id).toBe(true);
        expect(footprint.columnSpan).toBeGreaterThan(0);
        expect(footprint.rowSpan).toBeGreaterThan(0);
      }
    }
  });
});
