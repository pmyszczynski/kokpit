import { describe, expect, it } from "vitest";
import { packTiles } from "@/components/gridPacking";

describe("packTiles", () => {
  it("stacks normal tiles beside a tall tile", () => {
    expect(packTiles(["tall", "normal", "normal", "normal", "normal"], 3)).toEqual([
      { column: 1, row: 1 }, { column: 2, row: 1 }, { column: 2, row: 2 },
      { column: 3, row: 1 }, { column: 3, row: 2 },
    ]);
  });

  it("fills cells beside a large tile without overlap", () => {
    expect(packTiles(["large", "normal", "normal"], 4)).toEqual([
      { column: 1, row: 1 }, { column: 3, row: 1 }, { column: 3, row: 2 },
    ]);
  });

  it("packs mixed wide, tall, and normal tiles deterministically", () => {
    expect(packTiles(["wide", "tall", "normal", "normal"], 4)).toEqual([
      { column: 1, row: 1 }, { column: 3, row: 1 }, { column: 1, row: 2 },
      { column: 2, row: 2 },
    ]);
  });

  it("respects narrower responsive column counts", () => {
    expect(packTiles(["large", "normal"], 1)).toEqual([
      { column: 1, row: 1 }, { column: 1, row: 3 },
    ]);
  });
});
