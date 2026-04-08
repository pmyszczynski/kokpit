/** Returns download progress as an integer percentage (0–100). */
export function calcProgress(size: number, sizeleft: number): number {
  if (size === 0) return 0;
  return Math.min(100, Math.max(0, Math.round((1 - sizeleft / size) * 100)));
}
