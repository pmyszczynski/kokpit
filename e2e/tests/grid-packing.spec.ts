import { test, expect, type Page } from "@playwright/test";

/**
 * Grid packing (KOK-75): mixed `normal`/`wide`/`tall`/`large` tiles must pack
 * into free span cells without leaving avoidable vertical gaps, while ordinary
 * same-size tiles keep plain row-major reading order.
 *
 * Packing is `grid-auto-flow: dense` on `.dashboard-tile-grid` (globals.css) —
 * CSS, not JS, so placement stays overridable by user custom CSS without
 * `!important` (AGENTS.md non-negotiable #5). These tests pin the resulting
 * cells so a future change to the flow, the size-preset spans, or the
 * responsive column counts can't silently regress the layout.
 *
 * Services carry no widgets: there is no async data to race the measurement.
 */

const GROUPS = [
  { name: "Mixed" },
  { name: "Plain" },
  { name: "BesideTall", columns: 3 },
];

const SERVICES = [
  // Mixed: 4 + 2 + 2 + 1 + 1 = 10 span cells over 4 columns → 3 rows minimum.
  { name: "Alpha", url: "http://localhost:8101", group: "Mixed", size: "large" },
  { name: "Bravo", url: "http://localhost:8102", group: "Mixed", size: "wide" },
  { name: "Charlie", url: "http://localhost:8103", group: "Mixed", size: "tall" },
  { name: "Delta", url: "http://localhost:8104", group: "Mixed", size: "normal" },
  { name: "Echo", url: "http://localhost:8105", group: "Mixed", size: "normal" },

  // Plain: four ordinary tiles must stay side by side on one row.
  { name: "Foxtrot", url: "http://localhost:8201", group: "Plain" },
  { name: "Golf", url: "http://localhost:8202", group: "Plain" },
  { name: "Hotel", url: "http://localhost:8203", group: "Plain" },
  { name: "India", url: "http://localhost:8204", group: "Plain" },

  // BesideTall (3 columns): the two-row slot beside the tall tile fills up.
  { name: "Juliett", url: "http://localhost:8301", group: "BesideTall", size: "tall" },
  { name: "Kilo", url: "http://localhost:8302", group: "BesideTall" },
  { name: "Lima", url: "http://localhost:8303", group: "BesideTall" },
  { name: "Mike", url: "http://localhost:8304", group: "BesideTall" },
  { name: "November", url: "http://localhost:8305", group: "BesideTall" },
];

interface Cell {
  name: string;
  column: number;
  row: number;
}

/**
 * Resolves every tile in `group`'s grid to its 1-based grid cell by measuring
 * bounding boxes against the grid's own track sizes. Reading placement back
 * from geometry (rather than from a style attribute) is what makes this a real
 * check of the CSS flow.
 */
async function cells(page: Page, group: string): Promise<Cell[]> {
  return page.evaluate((groupName) => {
    const section = [...document.querySelectorAll(".service-group")].find(
      (el) =>
        el.querySelector(".service-group__toggle span")?.textContent?.trim() ===
        groupName
    );
    if (!section) throw new Error(`group "${groupName}" not found`);
    const grid = section.querySelector(".dashboard-tile-grid");
    if (!grid) throw new Error(`group "${groupName}" has no tile grid`);

    const gridBox = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const track = parseFloat(style.gridTemplateColumns.split(" ")[0]);
    const columnGap = parseFloat(style.columnGap) || 0;
    const rowGap = parseFloat(style.rowGap) || 0;
    const rowHeight = parseFloat(style.gridAutoRows);

    return [...grid.children].map((tile) => {
      const box = tile.getBoundingClientRect();
      return {
        name: tile.querySelector(".service-tile__name")?.textContent?.trim() ?? "",
        column: Math.round((box.left - gridBox.left) / (track + columnGap)) + 1,
        row: Math.round((box.top - gridBox.top) / (rowHeight + rowGap)) + 1,
      };
    });
  }, group);
}

test.describe("dashboard grid packing", () => {
  test.beforeAll(async ({ request }) => {
    // Warm up dev-mode route compilation before the first real test.
    await request.get("/").catch(() => null);
  });

  test.beforeEach(async ({ page, request }) => {
    const res = await request.patch("/api/settings", {
      data: {
        services: SERVICES,
        groups: GROUPS,
        bookmarks: [],
        layout: { columns: 4, row_height: 120 },
        appearance: { theme: "dark", custom_css: undefined },
      },
    });
    expect(res.ok(), `Settings patch failed: ${res.status()}`).toBeTruthy();

    // Desktop width: above the 768px breakpoint where wide/large collapse to
    // full-width, so the 4-column spans under test actually apply.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.locator(".service-tile").first()).toBeVisible();
    // Measure only once client effects have run. A visible tile proves the
    // server HTML painted, not that hydration finished — so without this the
    // assertions can read the pre-hydration layout and would silently pass
    // even if a client-side placement pass later moved every tile.
    await expect(page.locator("html")).toHaveAttribute(
      "data-edit-hotkey-ready",
      "true"
    );
  });

  test("mixed large/wide/tall/normal tiles pack without avoidable gaps", async ({
    page,
  }) => {
    // large(1,1) + wide(3,1) fill row 1; the tall tile then takes the two-row
    // slot at column 3 instead of opening a fresh row band, so 10 span cells
    // fit in the minimum 3 rows for a 4-column grid.
    expect(await cells(page, "Mixed")).toEqual([
      { name: "Alpha", column: 1, row: 1 },
      { name: "Bravo", column: 3, row: 1 },
      { name: "Charlie", column: 3, row: 2 },
      { name: "Delta", column: 4, row: 2 },
      { name: "Echo", column: 1, row: 3 },
    ]);
  });

  test("ordinary same-size tiles keep row-major order", async ({ page }) => {
    // Regression guard: packing must never turn four plain tiles into a
    // column-major block that leaves half the configured columns unused.
    expect(await cells(page, "Plain")).toEqual([
      { name: "Foxtrot", column: 1, row: 1 },
      { name: "Golf", column: 2, row: 1 },
      { name: "Hotel", column: 3, row: 1 },
      { name: "India", column: 4, row: 1 },
    ]);
  });

  test("normal tiles fill the vertical slot beside a tall tile", async ({ page }) => {
    // Three columns, one tall tile: the four normal tiles backfill both rows of
    // the remaining two columns rather than leaving row 2 empty.
    expect(await cells(page, "BesideTall")).toEqual([
      { name: "Juliett", column: 1, row: 1 },
      { name: "Kilo", column: 2, row: 1 },
      { name: "Lima", column: 3, row: 1 },
      { name: "Mike", column: 2, row: 2 },
      { name: "November", column: 3, row: 2 },
    ]);
  });

  test("tile spans collapse to full width on phones", async ({ page }) => {
    // The mobile collapse is deliberate: every preset becomes a single
    // full-width cell, so packing must not reintroduce multi-column spans.
    await page.setViewportSize({ width: 390, height: 844 });
    const mixed = await cells(page, "Mixed");
    expect(mixed.map((c) => c.column)).toEqual([1, 1, 1, 1, 1]);
  });
});
