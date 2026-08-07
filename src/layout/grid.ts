/** Canonical, non-configurable dashboard geometry. */
export const GRID_UNIT_WIDTH = 108 as const;
export const GRID_UNIT_HEIGHT = 60 as const;
export const GRID_GAP = 8 as const;

export const GRID_PRESET_COLUMNS = {
  mobile: 3,
  tablet: 6,
  desktop: 9,
  large: 12,
  wide: 15,
} as const;

export type GridPreset = keyof typeof GRID_PRESET_COLUMNS;

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

export function gridWidth(columns: number): number {
  if (!Number.isInteger(columns) || columns < 1) throw new TypeError("Grid columns must be a positive integer");
  return dimensionsForFootprint({ columnSpan: columns, rowSpan: 1 }).width;
}

/** Select the largest canonical grid that fits; narrow screens retain 3 columns. */
export function presetForAvailableWidth(width: number): GridPreset {
  if (width >= gridWidth(15)) return "wide";
  if (width >= gridWidth(12)) return "large";
  if (width >= gridWidth(9)) return "desktop";
  if (width >= gridWidth(6)) return "tablet";
  return "mobile";
}
