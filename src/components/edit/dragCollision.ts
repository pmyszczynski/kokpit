import {
  closestCenter,
  KeyboardCode,
  pointerWithin,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

/** Keep the keyboard target's top-left independent of the active tile's size. */
export const dashboardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { active, collisionRect, droppableContainers, droppableRects } = args.context;
  if (active?.data.current?.type === "group") {
    return sortableKeyboardCoordinates(event, args);
  }
  if (!active || !collisionRect) return;
  if (![KeyboardCode.Up, KeyboardCode.Down, KeyboardCode.Left, KeyboardCode.Right]
    .some((code) => code === event.code)) return;
  event.preventDefault();

  const candidates = droppableContainers.getEnabled().flatMap((container) => {
    const type = container.data.current?.type;
    const rect = droppableRects.get(container.id);
    if (!rect || (type !== "tile" && type !== "container")) return [];
    let inDirection = false;
    switch (event.code) {
      case KeyboardCode.Up: inDirection = rect.top < collisionRect.top; break;
      case KeyboardCode.Down: inDirection = rect.top > collisionRect.top; break;
      case KeyboardCode.Left: inDirection = rect.left < collisionRect.left; break;
      case KeyboardCode.Right: inDirection = rect.left > collisionRect.left; break;
    }
    return inDirection ? [{
      rect,
      isBackground: type === "container",
      distance: Math.hypot(rect.left - collisionRect.left, rect.top - collisionRect.top),
    }] : [];
  });
  // Rank corners rather than canvas centers/corners: a tall tile below the
  // adjacent short tile must not win just because its height matches ours.
  candidates.sort((a, b) =>
    a.distance - b.distance || Number(a.isBackground) - Number(b.isBackground)
  );
  const target = candidates[0]?.rect;
  // The default sortable getter offsets forward moves by the size difference.
  // Use the actual target corner so collision detection always probes it.
  return target ? { x: target.left, y: target.top } : undefined;
};

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

  // dashboardKeyboardCoordinates places the dragged tile at the target's
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
