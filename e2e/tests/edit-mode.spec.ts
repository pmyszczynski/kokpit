import { test, expect, type Page } from "@playwright/test";

/**
 * Edit mode (Phase B, work packages B1-B3): enter/exit/discard/save with
 * conflict detection, drag reorder, per-tile + group kebabs, and the add-tile
 * flow. Mutates shared state via PATCH /api/settings like the other spec
 * files — `playwright.config.ts` pins `workers: 1` so these writes never race.
 *
 * Fixture: two services grouped under "Media" (for reorder/group-kebab
 * coverage) plus one ungrouped service (for kebab edit/duplicate/remove).
 * Kept separate from e2e/helpers/fixture-services.ts because the drag test
 * needs a *predictable* 2-tile group with no widgets (no async data to race
 * the keyboard-driven drag).
 */

const EDIT_SERVICES = [
  { name: "Sonarr", url: "http://localhost:8001", group: "Media" },
  { name: "Radarr", url: "http://localhost:8002", group: "Media" },
  { name: "Grafana", url: "http://localhost:3001" },
];
const EDIT_GROUPS = [{ name: "Media" }];

test.describe("edit mode", () => {
  test.beforeAll(async ({ request }) => {
    // Warm up dev-mode route compilation before the first real test.
    await request.get("/").catch(() => null);
  });

  test.beforeEach(async ({ request }) => {
    const res = await request.patch("/api/settings", {
      data: {
        services: EDIT_SERVICES,
        groups: EDIT_GROUPS,
        bookmarks: [],
        appearance: { theme: "dark", custom_css: undefined },
      },
    });
    expect(res.ok(), `Settings patch failed: ${res.status()}`).toBeTruthy();
  });

  async function enterEditMode(page: Page) {
    await page.goto("/");
    await expect(page.locator(".service-tile").first()).toBeVisible();
    await page.getByRole("button", { name: "Edit dashboard" }).click();
    await expect(page.locator(".edit-bar")).toBeVisible();
    // Wait for the editable grid (drag handles are additive-only markers).
    await expect(page.locator(".tile-drag-handle").first()).toBeVisible();
  }

  function mediaSection(page: Page) {
    return page
      .locator(".service-group")
      .filter({ has: page.locator(".service-group__toggle", { hasText: "Media" }) });
  }

  // ── Enter / exit / discard ──────────────────────────────────────────────

  test("enter edit mode via the navbar toggle; discard returns to view unchanged", async ({
    page,
  }) => {
    await page.goto("/");
    const namesBefore = await page.locator(".service-tile__name").allTextContents();

    await page.getByRole("button", { name: "Edit dashboard" }).click();
    await expect(page.locator(".edit-bar")).toBeVisible();
    await expect(page.locator(".edit-bar__status")).toHaveText("No changes");
    // Editable-mode-only affordances are present.
    await expect(page.locator(".tile-drag-handle").first()).toBeVisible();
    await expect(page.locator(".tile-kebab--service").first()).toBeVisible();
    await expect(page.locator(".dashboard-add-tile").first()).toBeVisible();

    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.locator(".edit-bar")).toBeHidden();
    await expect(page.locator(".tile-drag-handle")).toHaveCount(0);

    const namesAfter = await page.locator(".service-tile__name").allTextContents();
    expect(namesAfter).toEqual(namesBefore);
  });

  test("enter edit mode via Mod+E", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".service-tile").first()).toBeVisible();

    await page.keyboard.press("Control+e");
    await expect(page.locator(".edit-bar")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Exit edit mode" })
    ).toBeVisible();

    // Mod+E again while active also works via the toggle (discard path).
    await page.keyboard.press("Control+e");
    await expect(page.locator(".edit-bar")).toBeHidden();
  });

  // ── Drag reorder ─────────────────────────────────────────────────────────

  test("drag-reorder two tiles within a group persists after save + reload", async ({
    page,
  }) => {
    await enterEditMode(page);

    const before = await mediaSection(page)
      .locator(".service-tile__name")
      .allTextContents();
    expect(before).toEqual(["Sonarr", "Radarr"]);

    // Keyboard-sensor drag (dnd-kit): focus the source tile's drag handle,
    // Space to pick up, Arrow to move one slot, Space to drop. Chosen over a
    // simulated pointer drag, which is flaky for dnd-kit's 8px-activation
    // PointerSensor in headless Chromium without many intermediate
    // mousemove steps.
    const handle = page.getByRole("button", { name: "Reorder Sonarr" });
    await handle.focus();
    await page.keyboard.press("Space");
    // dnd-kit needs a frame to commit the pickup (activeId/DragOverlay state)
    // before the next key is processed reliably.
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    await page.keyboard.press("Space");

    await expect(async () => {
      const after = await mediaSection(page)
        .locator(".service-tile__name")
        .allTextContents();
      expect(after).toEqual(["Radarr", "Sonarr"]);
    }).toPass({ timeout: 5000 });

    await page.getByRole("button", { name: /Save & exit/ }).click();
    await expect(page.locator(".edit-bar")).toBeHidden();

    await page.reload();
    const persisted = await mediaSection(page)
      .locator(".service-tile__name")
      .allTextContents();
    expect(persisted).toEqual(["Radarr", "Sonarr"]);
  });

  // ── Per-tile kebab: edit / duplicate / remove ───────────────────────────

  test("tile kebab: Edit changes the URL, stages it, and Save persists it", async ({
    page,
  }) => {
    await enterEditMode(page);

    await page.getByRole("button", { name: "Grafana options" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.locator("dialog.service-form-dialog")).toBeVisible();

    await page.fill("#sf-url", "http://localhost:4001");
    await page.locator("dialog.service-form-dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.locator("dialog.service-form-dialog")).toBeHidden();

    // Staged change shows immediately in the editable grid.
    const grafanaTile = page.locator("a.service-tile", { hasText: "Grafana" });
    await expect(grafanaTile).toHaveAttribute("href", "http://localhost:4001");

    await page.getByRole("button", { name: /Save & exit/ }).click();
    await expect(page.locator(".edit-bar")).toBeHidden();

    await page.reload();
    const persistedTile = page.locator("a.service-tile", { hasText: "Grafana" });
    await expect(persistedTile).toHaveAttribute("href", "http://localhost:4001");
  });

  test("tile kebab: Duplicate adds a copy; Remove deletes the original", async ({
    page,
  }) => {
    await enterEditMode(page);

    await page.getByRole("button", { name: "Grafana options" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.locator(".service-tile__name", { hasText: "Grafana copy" })).toBeVisible();

    // Remove the ORIGINAL "Grafana" (requires a confirm step).
    await page.getByRole("button", { name: "Grafana options" }).click();
    await page.getByRole("menuitem", { name: "Remove" }).click();
    await page.getByRole("menuitem", { name: "Confirm remove" }).click();

    await expect(page.locator(".service-tile__name", { hasText: /^Grafana$/ })).toHaveCount(0);
    await expect(page.locator(".service-tile__name", { hasText: "Grafana copy" })).toBeVisible();

    await page.getByRole("button", { name: /Save & exit/ }).click();
    await page.reload();

    await expect(page.locator(".service-tile__name", { hasText: /^Grafana$/ })).toHaveCount(0);
    await expect(page.locator(".service-tile__name", { hasText: "Grafana copy" })).toBeVisible();
  });

  // ── Add-flow ─────────────────────────────────────────────────────────────

  test("add-flow: adding a blank service into a group persists after Save", async ({
    page,
  }) => {
    await enterEditMode(page);

    await mediaSection(page)
      .getByRole("button", { name: "Add tile to Media" })
      .click();
    await expect(page.locator("dialog.add-tile-picker")).toBeVisible();
    await page.locator(".add-tile-picker__option", { hasText: "Blank service" }).click();

    await expect(page.locator("dialog.service-form-dialog")).toBeVisible();
    await page.fill("#sf-name", "Overseerr");
    await page.fill("#sf-url", "http://localhost:5055");
    await page.locator("dialog.service-form-dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.locator("dialog.service-form-dialog")).toBeHidden();

    await expect(
      mediaSection(page).locator(".service-tile__name", { hasText: "Overseerr" })
    ).toBeVisible();

    await page.getByRole("button", { name: /Save & exit/ }).click();
    await page.reload();

    await expect(
      mediaSection(page).locator(".service-tile__name", { hasText: "Overseerr" })
    ).toBeVisible();
  });

  // ── Group kebab: rename cascades to member tiles ────────────────────────

  test("group kebab: rename cascades to member tiles and persists", async ({
    page,
  }) => {
    await enterEditMode(page);

    await page.getByRole("button", { name: "Media group options" }).click();
    const renameInput = page.getByLabel("Rename group Media");
    await renameInput.fill("Streaming");
    await renameInput.press("Enter");

    // Old header gone, new header present, members followed the rename.
    await expect(page.locator(".service-group__toggle", { hasText: "Media" })).toHaveCount(0);
    const streaming = page
      .locator(".service-group")
      .filter({ has: page.locator(".service-group__toggle", { hasText: "Streaming" }) });
    await expect(streaming).toBeVisible();
    await expect(streaming.locator(".service-tile__name", { hasText: "Sonarr" })).toBeVisible();
    await expect(streaming.locator(".service-tile__name", { hasText: "Radarr" })).toBeVisible();

    await page.getByRole("button", { name: /Save & exit/ }).click();
    await page.reload();

    await expect(page.locator(".service-group__toggle", { hasText: "Media" })).toHaveCount(0);
    const streamingAfterReload = page
      .locator(".service-group")
      .filter({ has: page.locator(".service-group__toggle", { hasText: "Streaming" }) });
    await expect(streamingAfterReload).toBeVisible();
    await expect(
      streamingAfterReload.locator(".service-tile__name", { hasText: "Sonarr" })
    ).toBeVisible();
    await expect(
      streamingAfterReload.locator(".service-tile__name", { hasText: "Radarr" })
    ).toBeVisible();
  });

  // ── Conflict (409 revision mismatch) ────────────────────────────────────

  test("Save after an out-of-band change shows the conflict notice; Reload recovers", async ({
    page,
    request,
  }) => {
    await enterEditMode(page);

    // Stage a local change (via the Size kebab control — a single click, no
    // dialog) so Save actually performs a network write.
    await page.getByRole("button", { name: "Grafana options" }).click();
    await page.getByRole("button", { name: "Wide" }).click();
    await expect(page.locator(".edit-bar__status--dirty")).toBeVisible();

    // Out-of-band write: no If-Match, so it succeeds unconditionally and
    // advances the on-disk revision under the open edit session — mirrors a
    // second admin (or the file watcher) picking up a hand-edit.
    const outOfBand = await request.patch("/api/settings", {
      data: {
        services: [
          ...EDIT_SERVICES.filter((s) => s.name !== "Grafana"),
          { name: "Grafana Renamed", url: "http://localhost:3001" },
        ],
        groups: EDIT_GROUPS,
      },
    });
    expect(outOfBand.ok()).toBeTruthy();

    await page.getByRole("button", { name: /Save & exit/ }).click();

    const notice = page.locator(".edit-bar__notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("settings.yaml changed on disk");
    // Still in edit mode — the draft is kept so Reload is a deliberate choice.
    await expect(page.locator(".edit-bar")).toBeVisible();

    await notice.getByRole("button", { name: "Reload" }).click();
    await expect(page.locator(".edit-bar__notice")).toBeHidden();
    await expect(page.locator(".edit-bar__status")).toHaveText("No changes");
    // The reload pulled the out-of-band state, discarding the stale "Wide"
    // staged edit and picking up the renamed service.
    await expect(
      page.locator(".service-tile__name", { hasText: "Grafana Renamed" })
    ).toBeVisible();
    await expect(page.locator(".service-tile__name", { hasText: /^Grafana$/ })).toHaveCount(0);
  });

  // ── Visual snapshots (edit-mode chrome) ──────────────────────────────────

  test("visual: edit bar", async ({ page }) => {
    await enterEditMode(page);
    await expect(page.locator(".edit-bar")).toHaveScreenshot("edit-bar.png");
  });

  test("visual: tile kebab menu open", async ({ page }) => {
    await enterEditMode(page);
    await page.getByRole("button", { name: "Grafana options" }).click();
    const menu = page.locator(".kebab-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveScreenshot("tile-kebab-menu.png");
  });

  test("visual: group kebab menu open", async ({ page }) => {
    await enterEditMode(page);
    await page.getByRole("button", { name: "Media group options" }).click();
    const menu = page.locator(".kebab-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveScreenshot("group-kebab-menu.png");
  });
});
