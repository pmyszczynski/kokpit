import { SIZE_SPANS } from "@/config/resolve";
import type { Size } from "@/config/schema";

export interface PackedTile {
  column: number;
  row: number;
}

/**
 * Packs tiles into two-row shelves, scanning down each column before moving
 * right. This keeps array order deterministic while allowing two normal tiles
 * to use the space beside a tall tile. A new shelf is opened only when the
 * current one cannot fit the next tile.
 */
export function packTiles(sizes: readonly Size[], columns: number): PackedTile[] {
  const width = Math.max(1, Math.floor(columns));
  const occupied: boolean[][] = [];

  const fits = (column: number, row: number, w: number, h: number) => {
    if (column + w > width) return false;
    for (let y = row; y < row + h; y++) {
      for (let x = column; x < column + w; x++) {
        if (occupied[y]?.[x]) return false;
      }
    }
    return true;
  };

  return sizes.map((size) => {
    const span = SIZE_SPANS[size];
    const w = Math.min(span.columns, width);
    const h = span.rows;
    for (let shelf = 0; ; shelf++) {
      const shelfRow = shelf * 2;
      for (let column = 0; column < width; column++) {
        for (let offset = 0; offset <= 2 - h; offset++) {
          const row = shelfRow + offset;
          if (!fits(column, row, w, h)) continue;
          for (let y = row; y < row + h; y++) {
            occupied[y] ??= [];
            for (let x = column; x < column + w; x++) occupied[y][x] = true;
          }
          return { column: column + 1, row: row + 1 };
        }
      }
    }
  });
}
