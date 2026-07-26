"use client";

import { forwardRef, useCallback, useLayoutEffect, useRef } from "react";
import type { Size } from "@/config/schema";
import { packTiles } from "./gridPacking";

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function tileSize(element: Element): Size | null {
  for (const size of ["normal", "wide", "tall", "large"] as const) {
    if (element.classList.contains(`service-tile--${size}`) ||
        element.classList.contains(`bookmark-tile--${size}`)) return size;
  }
  return null;
}

/** Shared responsive spatial packing for view and edit mode grids. */
const DashboardTileGrid = forwardRef<HTMLDivElement, Props>(function DashboardTileGrid(
  { children, ...props }, forwardedRef
) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback((node: HTMLDivElement | null) => {
    localRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  useLayoutEffect(() => {
    const grid = localRef.current;
    if (!grid) return;
    const update = () => {
      const tiles = Array.from(grid.children).filter((child) => tileSize(child));
      // Phone presets intentionally collapse to ordinary single-row tiles.
      if (typeof matchMedia !== "undefined" && matchMedia("(max-width: 480px)").matches) {
        for (const tile of tiles) {
          (tile as HTMLElement).style.removeProperty("grid-column-start");
          (tile as HTMLElement).style.removeProperty("grid-row-start");
        }
        return;
      }
      const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
      const positions = packTiles(tiles.map((tile) => tileSize(tile)!), columns);
      tiles.forEach((tile, index) => {
        const element = tile as HTMLElement;
        element.style.gridColumnStart = String(positions[index].column);
        element.style.gridRowStart = String(positions[index].row);
      });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [children]);

  return <div {...props} ref={setRef}>{children}</div>;
});

export default DashboardTileGrid;
