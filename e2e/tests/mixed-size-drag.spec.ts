import { test, expect, type Page } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

function mediaGrid(page: Page) {
  return page.locator(".service-group")
    .filter({ has: page.locator(".service-group__toggle", { hasText: "Media" }) })
    .locator(".dashboard-tile-grid");
}

async function dragToHeader(page: Page, source: string, target: string) {
  const handle = page.getByRole("button", { name: `Reorder ${source}`, exact: true });
  const destination = mediaGrid(page).locator(".service-tile")
    .filter({ has: page.locator(".service-tile__name", { hasText: new RegExp(`^${target}$`) }) });
  const start = await handle.boundingBox();
  const end = await destination.boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(start!.x + start!.width / 2 + 12, start!.y + start!.height / 2, { steps: 4 });
  await expect(page.locator(".service-tile--dragging")).toBeVisible();
  await page.mouse.move(end!.x + end!.width / 2, end!.y + 15, { steps: 20 });
  await page.mouse.up();
  await page.mouse.move(1780, 950);
  await expect(page.locator(".tile-drag-overlay")).toHaveCount(0);
}

for (const shortRows of [1, 2]) {
  test.describe(`mixed-size tile ordering with 3x${shortRows} tiles`, () => {
    test.use({ viewport: { width: 1800, height: 1000 } });

    test.beforeEach(async ({ request, page }) => {
      const tall = (name: string) => ({
        name, group: "Media",
        widget: { type: "seerr-requests", config: { url: "http://localhost:5055", api_key: "test" } },
      });
      const small = (name: string) => ({
        name, group: "Media",
        widget: shortRows === 2 ? {
          type: "seerr-stats", config: { url: "http://localhost:5055", api_key: "test" },
        } : undefined,
      });
      const fixtures = schemaV2Fixtures([
        ...Array.from({ length: 5 }, (_, i) => tall(`Top ${i + 1}`)),
        tall("Prowlarr"), tall("Seerr"),
        small("Tautulli"), small("Small 1"), small("Small 2"),
        tall("Seerr Req"),
        small("Small 3"), small("Small 4"),
      ]);
      const response = await request.patch("/api/settings", {
        data: {
          ...fixtures,
          service_tiles: fixtures.service_tiles.map((tile) => ({
            ...tile,
            footprint: { columnSpan: 3, rowSpan: tile.widget?.type === "seerr-requests" ? 4 : shortRows },
          })),
          groups: [{ name: "Media" }], bookmarks: [],
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      await page.route("**/api/widget*", (route) => {
        const tileId = new URL(route.request().url()).searchParams.get("tile_id");
        const data = fixtures.service_tiles.find((tile) => tile.id === tileId)?.widget?.type === "seerr-stats"
          ? { pending: 0, approved: 0, available: 0, total: 0 }
          : [];
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
      });
    });

    test("keyboard moving forward from a tall tile targets the adjacent short tile", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Edit dashboard" }).click();
      const handle = page.getByRole("button", { name: "Reorder Seerr", exact: true });
      await handle.focus();
      await page.keyboard.press("Space");
      await expect(page.locator(".service-tile--dragging")).toBeVisible();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(150);
      await page.keyboard.press("Space");

      const expected = [
        "Top 1", "Top 2", "Top 3", "Top 4", "Top 5",
        "Prowlarr", "Tautulli", "Seerr", "Small 1", "Small 2",
        "Seerr Req", "Small 3", "Small 4",
      ];
      await expect(mediaGrid(page).locator(".service-tile__name")).toHaveText(expected, { timeout: 5000 });
      await page.getByRole("button", { name: /Save & exit/ }).click();
      await expect(page.locator(".edit-bar")).toBeHidden();
      await page.reload();
      await expect(mediaGrid(page).locator(".service-tile__name")).toHaveText(expected);
    });

    for (const gesture of ["tall onto short", "short onto tall", "keyboard"] as const) {
      test(`${gesture} aligns the tall widgets and persists after save + reload`, async ({ page, request }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Edit dashboard" }).click();
        await expect(page.getByRole("button", { name: "Reorder Seerr Req", exact: true })).toBeVisible();

        // The tall requests tile starts below Tautulli, matching the reported
        // production layout rather than an already-aligned row.
        const initial = await mediaGrid(page).locator(".service-tile").evaluateAll((tiles) =>
          [tiles[7], tiles[10]].map((tile) => {
            const bounds = tile.getBoundingClientRect();
            return { x: bounds.x, y: bounds.y };
          })
        );
        expect(initial[1].x).toBe(initial[0].x);
        expect(initial[1].y).toBeGreaterThan(initial[0].y);

        if (gesture === "keyboard") {
          const handle = page.getByRole("button", { name: "Reorder Seerr Req", exact: true });
          await handle.focus();
          await page.keyboard.press("Space");
          await expect(page.locator(".service-tile--dragging")).toBeVisible();
          await page.keyboard.press("ArrowUp");
          // Let the keyboard sensor's scheduled movement commit before dropping.
          await page.waitForTimeout(150);
          await page.keyboard.press("Space");
        } else if (gesture === "tall onto short") {
          await dragToHeader(page, "Seerr Req", "Tautulli");
        } else {
          // Move each short tile past the requests widget, starting with its
          // immediate predecessor, to keep the same requested final ordering.
          for (const name of ["Small 2", "Small 1", "Tautulli"]) {
            await dragToHeader(page, name, "Seerr Req");
          }
        }

        const expected = [
          "Top 1", "Top 2", "Top 3", "Top 4", "Top 5",
          "Prowlarr", "Seerr", "Seerr Req", "Tautulli",
          "Small 1", "Small 2", "Small 3", "Small 4",
        ];
        await expect(mediaGrid(page).locator(".service-tile__name")).toHaveText(expected, { timeout: 5000 });
        const aligned = async () => {
          const tops = await mediaGrid(page).locator(".service-tile").evaluateAll((tiles) =>
            tiles.slice(5, 8).map((tile) => Math.round(tile.getBoundingClientRect().top))
          );
          expect(new Set(tops).size).toBe(1);
        };
        await expect(aligned).toPass();

        await page.getByRole("button", { name: /Save & exit/ }).click();
        await expect(page.locator(".edit-bar")).toBeHidden();
        const saved = await (await request.get("/api/settings")).json();
        const savedNames = saved.service_tiles.map((tile: { service_id: string }) =>
          saved.services.find((service: { id: string }) => service.id === tile.service_id).name
        );
        expect(savedNames).toEqual(expected);

        await page.reload();
        await expect(mediaGrid(page).locator(".service-tile__name")).toHaveText(expected);
        await expect(aligned).toPass();
      });
    }
  });
}
