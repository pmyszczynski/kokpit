import { SIZE_SPANS, type Size } from "@/config";

/** Canonical order of the four size presets, smallest span first. */
export const SIZE_ORDER: readonly Size[] = ["normal", "wide", "tall", "large"];

/** Human label with span, e.g. `Wide (2×1)`. */
export function sizeLabel(size: Size): string {
  const { columns, rows } = SIZE_SPANS[size];
  const name = size.charAt(0).toUpperCase() + size.slice(1);
  return `${name} (${columns}×${rows})`;
}
