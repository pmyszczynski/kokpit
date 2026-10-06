import { describe, expect, it } from "vitest";
import type { CollisionDetection } from "@dnd-kit/core";
import { dashboardCollisionDetection } from "@/components/edit/dragCollision";

type CollisionArgs = Parameters<CollisionDetection>[0];
type Rect = CollisionArgs["collisionRect"];
type Container = CollisionArgs["droppableContainers"][number];

function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function droppable(id: string, type: "tile" | "container" | "group", bounds: Rect): Container {
  return {
    id, key: id, disabled: false,
    data: { current: { type } },
    node: { current: null },
    rect: { current: bounds },
  };
}

function args(
  collisionRect: Rect,
  containers: Container[],
  pointerCoordinates: CollisionArgs["pointerCoordinates"],
  type = "tile",
): CollisionArgs {
  return {
    active: {
      id: "active", data: { current: { type } },
      rect: { current: { initial: collisionRect, translated: collisionRect } },
    },
    collisionRect, droppableContainers: containers, pointerCoordinates,
    droppableRects: new Map(containers.map((container) => [container.id, container.rect.current!])),
  };
}

describe("dashboard drop targets", () => {
  it.each([60, 128])("targets a %ipx short tile under the pointer when dragging a tall widget", (height) => {
    const short = droppable("short", "tile", rect(696, 272, 340, height));
    const tall = droppable("active", "tile", rect(696, 272 + height + 8, 340, 264));
    const group = droppable("media", "container", rect(0, 0, 1732, 680));
    const result = dashboardCollisionDetection(args(
      rect(696, 272, 340, 264), [group, short, tall], { x: 866, y: 287 },
    ));
    expect(result[0]?.id).toBe("short");
  });

  it("targets a tall tile's header when dragging the short tile above it", () => {
    const short = droppable("active", "tile", rect(696, 272, 340, 60));
    const tall = droppable("tall", "tile", rect(696, 340, 340, 264));
    expect(dashboardCollisionDetection(args(
      rect(696, 340, 340, 60), [short, tall], { x: 866, y: 355 },
    ))[0]?.id).toBe("tall");
  });

  it("lets a tile win over the containing section even when the section center is closer", () => {
    const group = droppable("media", "container", rect(0, 0, 688, 400));
    const tile = droppable("wide", "tile", rect(0, 0, 688, 128));
    expect(dashboardCollisionDetection(args(
      rect(174, 68, 340, 264), [group, tile], { x: 344, y: 80 },
    ))[0]?.id).toBe("wide");
  });

  it("uses the keyboard's tile position to move a tall widget ahead of a short one", () => {
    const short = droppable("short", "tile", rect(696, 272, 340, 60));
    const tall = droppable("active", "tile", rect(696, 340, 340, 264));
    expect(dashboardCollisionDetection(args(
      rect(696, 272, 340, 264), [short, tall], null,
    ))[0]?.id).toBe("short");
  });

  it("accepts drops on empty sections and section backgrounds", () => {
    const tile = droppable("active", "tile", rect(0, 0, 340, 264));
    const empty = droppable("empty", "container", rect(348, 0, 340, 128));
    expect(dashboardCollisionDetection(args(
      rect(348, 0, 340, 264), [tile, empty], { x: 360, y: 15 },
    ))[0]?.id).toBe("empty");
  });

  it("does not move a tile when it is dropped outside the dashboard", () => {
    const tile = droppable("active", "tile", rect(0, 0, 340, 264));
    const group = droppable("media", "container", rect(0, 0, 688, 400));
    expect(dashboardCollisionDetection(args(
      rect(700, 500, 340, 264), [tile, group], { x: 800, y: 600 },
    ))).toEqual([]);
  });

  it("keeps group dragging scoped to other groups", () => {
    const group = droppable("group", "group", rect(0, 0, 688, 400));
    const tile = droppable("tile", "tile", rect(0, 0, 340, 60));
    const section = droppable("section", "container", rect(0, 0, 688, 400));
    expect(dashboardCollisionDetection(args(
      rect(0, 0, 340, 60), [tile, section, group], { x: 10, y: 10 }, "group",
    )).map((collision) => collision.id)).toEqual(["group"]);
  });
});
