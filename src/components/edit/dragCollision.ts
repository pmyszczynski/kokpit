import { closestCenter, pointerWithin, type CollisionDetection } from "@dnd-kit/core";

/** Mixed-size tiles must target the pointer, not the dragged canvas's center. */
export const dashboardCollisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.type === "group") {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) =>
        container.data.current?.type === "group"
      ),
    });
  }

  // sortableKeyboardCoordinates places the dragged tile at the target's
  // top-left. Probe just inside that corner so a tall canvas does not skip
  // the short tile it was moved onto. Pointer/touch drags use the real pointer.
  const pointerCoordinates = args.pointerCoordinates ?? {
    x: args.collisionRect.left + 1,
    y: args.collisionRect.top + 1,
  };
  const hits = (type: "tile" | "container") => pointerWithin({
    ...args,
    pointerCoordinates,
    droppableContainers: args.droppableContainers.filter((container) =>
      container.data.current?.type === type
    ),
  });

  // Sections enclose their tiles, so only use a section for a background or
  // empty-section drop. Returning no collision outside a section cancels it.
  const tiles = hits("tile");
  return tiles.length > 0 ? tiles : hits("container");
};
