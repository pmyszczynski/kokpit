import { describe, expect, it } from "vitest";
import type { CollisionDetection, KeyboardCoordinateGetter } from "@dnd-kit/core";
import { dashboardCollisionDetection, dashboardKeyboardCoordinates } from "@/components/edit/dragCollision";

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

describe("dashboard keyboard targets", () => {
  function keyboardArgs(bounds: Rect, containers: Container[]): Parameters<KeyboardCoordinateGetter>[1] {
    const input = args(bounds, containers, null);
    return {
      active: input.active.id, currentCoordinates: { x: bounds.left, y: bounds.top },
      context: {
        active: input.active, collisionRect: bounds, droppableRects: input.droppableRects,
        droppableContainers: {
          getEnabled: () => containers.filter((container) => !container.disabled),
        } as Parameters<KeyboardCoordinateGetter>[1]["context"]["droppableContainers"],
        activatorEvent: null, activeNode: null, collisions: null, draggableNodes: new Map(),
        draggingNode: null, draggingNodeRect: null, over: null,
        scrollableAncestors: [], scrollAdjustedTranslate: null,
      },
    };
  }

  it.each([
    ["ArrowUp", 348, 204],
    ["ArrowDown", 348, 544],
    ["ArrowLeft", 0, 272],
    ["ArrowRight", 696, 272],
  ] as const)("%s selects the short tile's corner without a size offset", (code, left, top) => {
    const active = droppable("active", "tile", rect(348, 272, 340, 264));
    const short = droppable("short", "tile", rect(left, top, 340, 60));
    const input = keyboardArgs(active.rect.current!, [active, short]);
    const coordinates = dashboardKeyboardCoordinates(new KeyboardEvent("keydown", { code }), input);
    expect(coordinates).toEqual({ x: left, y: top });
    // Feed the actual keyboard position into collision detection too.
    expect(dashboardCollisionDetection(args(
      rect(left, top, 340, 264), [active, short], null,
    ))[0]?.id).toBe("short");
  });

  it("does not skip a short neighbor in favor of a tall tile below it", () => {
    const active = droppable("active", "tile", rect(348, 272, 340, 264));
    const short = droppable("short", "tile", rect(696, 272, 340, 60));
    const tall = droppable("tall", "tile", rect(696, 340, 340, 264));
    expect(dashboardKeyboardCoordinates(
      new KeyboardEvent("keydown", { code: "ArrowRight" }),
      keyboardArgs(active.rect.current!, [active, tall, short]),
    )).toEqual({ x: 696, y: 272 });
  });

  it("can move into an empty section while ignoring group drag handles", () => {
    const active = droppable("active", "tile", rect(0, 0, 340, 264));
    const group = droppable("group", "group", rect(348, 0, 340, 264));
    const empty = droppable("empty", "container", rect(696, 0, 340, 128));
    expect(dashboardKeyboardCoordinates(
      new KeyboardEvent("keydown", { code: "ArrowRight" }),
      keyboardArgs(active.rect.current!, [active, group, empty]),
    )).toEqual({ x: 696, y: 0 });
  });

  it("does not move when there is no target in the requested direction", () => {
    const active = droppable("active", "tile", rect(0, 0, 340, 264));
    expect(dashboardKeyboardCoordinates(
      new KeyboardEvent("keydown", { code: "ArrowLeft" }),
      keyboardArgs(active.rect.current!, [active]),
    )).toBeUndefined();
  });
});
