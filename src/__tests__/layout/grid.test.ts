import { describe, expect, it } from "vitest";
import {
  dimensionsForFootprint,
  GRID_GAP, GRID_UNIT_HEIGHT, GRID_UNIT_WIDTH,
} from "@/layout/grid";

describe("fixed dashboard geometry", () => {
  it("derives exact dimensions from integer spans", () => {
    expect([GRID_UNIT_WIDTH, GRID_UNIT_HEIGHT, GRID_GAP]).toEqual([108, 60, 8]);
    expect(dimensionsForFootprint({ columnSpan: 1, rowSpan: 1 })).toEqual({ width: 108, height: 60 });
    expect(dimensionsForFootprint({ columnSpan: 3, rowSpan: 1 })).toEqual({ width: 340, height: 60 });
    expect(dimensionsForFootprint({ columnSpan: 6, rowSpan: 3 })).toEqual({ width: 688, height: 196 });
  });

  it("rejects fractional, zero, and negative spans", () => {
    for (const footprint of [{ columnSpan: 0, rowSpan: 1 }, { columnSpan: 1.5, rowSpan: 1 }, { columnSpan: 1, rowSpan: -1 }]) {
      expect(() => dimensionsForFootprint(footprint)).toThrow(/positive integers/);
    }
  });

});
