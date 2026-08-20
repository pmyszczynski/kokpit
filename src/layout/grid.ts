/** Canonical, non-configurable dashboard geometry. */
export const GRID_UNIT_WIDTH = 108 as const;
export const GRID_UNIT_HEIGHT = 60 as const;
export const GRID_GAP = 8 as const;

export interface TileFootprint {
  columnSpan: number;
  rowSpan: number;
}

export interface TileDimensions {
  width: number;
  height: number;
}

export const GENERIC_SERVICE_FOOTPRINT: TileFootprint = {
  columnSpan: 3,
  rowSpan: 1,
};

/** Temporary boundary for widgets awaiting their individual fixed-canvas migration. */
export function legacyWidgetFootprint(size?: "normal" | "wide" | "tall" | "large"): TileFootprint {
  switch (size) {
    case "wide": return { columnSpan: 6, rowSpan: 2 };
    case "tall": return { columnSpan: 3, rowSpan: 4 };
    case "large": return { columnSpan: 6, rowSpan: 4 };
    default: return { columnSpan: 3, rowSpan: 2 };
  }
}

export function isTileFootprint(value: unknown): value is TileFootprint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TileFootprint>;
  return Number.isInteger(candidate.columnSpan) && candidate.columnSpan! > 0
    && Number.isInteger(candidate.rowSpan) && candidate.rowSpan! > 0;
}

export function dimensionsForFootprint(footprint: TileFootprint): TileDimensions {
  if (!isTileFootprint(footprint)) throw new TypeError("Tile spans must be positive integers");
  return {
    width: footprint.columnSpan * GRID_UNIT_WIDTH + (footprint.columnSpan - 1) * GRID_GAP,
    height: footprint.rowSpan * GRID_UNIT_HEIGHT + (footprint.rowSpan - 1) * GRID_GAP,
  };
}
