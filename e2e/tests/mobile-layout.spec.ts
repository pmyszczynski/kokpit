import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_MOCK_STATE } from "../helpers/mock-plex-server";

const MOCK = "http://localhost:32400";

/**
 * Mobile horizontal-overflow regression tests.
 *
 * Reproduces the bug documented in docs/plans/mobile-experience-plan.md: on
 * narrow viewports the dashboard (and, at 375px, the settings tab bar)
 * scrolls horizontally. The overflow is contained inside `.shell-main`
 * (which becomes an implicit `overflow-x: auto` scroll container per the
 * CSS overflow spec once `overflow-y: auto` is set) rather than the
 * document, so `document.documentElement.scrollWidth` alone does NOT catch
 * it — these tests measure `.shell-main` directly and sweep every element
 * under `.shell` for a bounding box that extends past the viewport.
 *
 * We deliberately use manual `{ width, height }` viewports via
 * `test.use({ viewport })` rather than Playwright's `devices[...]` presets
 * (e.g. `devices['iPhone SE']` / `devices['iPhone 12']`) — we only need the
 * CSS width to trigger the relevant media queries, not touch/UA emulation,
 * and manual sizes keep the measurements deterministic.
 */

const VIEWPORTS = [
  { name: "375x667 (iPhone SE)", width: 375, height: 667 },
  { name: "390x844 (iPhone 12/13/14)", width: 390, height: 844 },
];

// Plain link tiles (no widgets) so the test needs no mock widget data and is
// deterministic. No mobile column override is configured, so the dashboard
// grid inherits the desktop column count (RC2) -- and the last service has a
// long unbreakable name/description token to exercise the grid-shrinking fix
// (RC3). This mirrors a representative real-world config, not a contrived one.
const MOBILE_FIXTURE_SERVICES = [
  { name: "Sonarr", url: "http://localhost:8001" },
  { name: "Radarr", url: "http://localhost:8002" },
  { name: "Prowlarr", url: "http://localhost:8003" },
  { name: "qBittorrent", url: "http://localhost:8004" },
  { name: "SABnzbd", url: "http://localhost:8005" },
  { name: "Immich", url: "http://localhost:8006" },
  {
    name: "A-Very-Long-Unbreakable-Service-Name-That-Cannot-Wrap",
    url: "http://localhost:8007",
    description: "contains superlongunbreakablewordthatwillnotwrapatalleverokay token",
  },
];

/**
 * Measures real horizontal overflow even when an inner scroll container
 * (`.shell-main`) hides it from `document.documentElement.scrollWidth`.
 * See the file-level comment / docs/plans/mobile-experience-plan.md Section 1
 * ("The measurement trap") for why the document-level check alone is
 * insufficient.
 */
async function assertNoHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => {
    const iw = window.innerWidth;
    const sm = document.querySelector(".shell-main");
    // Per-element sweep under .shell: nothing may extend past the right edge.
    let worstRight = 0;
    let worstSel = "";
    document.querySelectorAll(".shell *").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return; // skip hidden
      if (rect.right > worstRight) {
        worstRight = rect.right;
        worstSel =
          el.tagName.toLowerCase() +
          "." +
          (typeof el.className === "string" ? el.className.split(" ")[0] : "");
      }
    });
    return {
      innerWidth: iw,
      docScrollWidth: document.documentElement.scrollWidth,
      shellMain: sm ? { c: sm.clientWidth, s: sm.scrollWidth } : null,
      worstRight: Math.round(worstRight),
      worstSel,
    };
  });

  // (a) document-level (cheap; necessary but NOT sufficient on its own --
  // `.shell-main`'s implicit horizontal scroll container hides overflow from
  // the document, so this alone would false-negative on the real bug).
  expect(r.docScrollWidth, `document.documentElement.scrollWidth (${r.docScrollWidth}) exceeds innerWidth (${r.innerWidth})`)
    .toBeLessThanOrEqual(r.innerWidth + 1);
  // (b) PRIMARY: the scroll container must not scroll horizontally.
  expect(r.shellMain, ".shell-main not found on page").not.toBeNull();
  expect(
    r.shellMain!.s,
    `.shell-main scrollWidth (${r.shellMain!.s}) exceeds clientWidth (${r.shellMain!.c})`
  ).toBeLessThanOrEqual(r.shellMain!.c + 1);
  // (c) THOROUGH: no element inside .shell extends past the viewport.
  expect(
    r.worstRight,
    `element ${r.worstSel} extends to right=${r.worstRight}, past innerWidth=${r.innerWidth}`
  ).toBeLessThanOrEqual(r.innerWidth + 1);
}

for (const viewport of VIEWPORTS) {
  test.describe(`mobile layout @ ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ request }) => {
      const mockRes = await request.post(`${MOCK}/__control`, { data: DEFAULT_MOCK_STATE });
      expect(mockRes.ok(), `Mock control endpoint failed: ${mockRes.status()}`).toBeTruthy();

      const settingsRes = await request.patch("/api/settings", {
        data: {
          layout: { columns: 4, row_height: 120 }, // no mobile override -> reproduces default RC2
          appearance: { theme: "dark", custom_css: undefined },
          services: MOBILE_FIXTURE_SERVICES,
        },
      });
      expect(settingsRes.ok(), `Settings patch failed: ${settingsRes.status()}`).toBeTruthy();
    });

    test("dashboard has no horizontal overflow", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".service-tile").first()).toBeVisible();

      await assertNoHorizontalOverflow(page);
    });

    test("settings page has no horizontal overflow", async ({ page }) => {
      await page.goto("/settings");
      await expect(page.locator(".settings-tabs")).toBeVisible();

      await assertNoHorizontalOverflow(page);
    });

    test("settings tabs are all reachable", async ({ page }) => {
      await page.goto("/settings");
      await expect(page.locator(".settings-tabs")).toBeVisible();

      const innerWidth = viewport.width;
      const tabs = page.locator(".settings-tab");
      const count = await tabs.count();
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        const tab = tabs.nth(i);
        const box = await tab.boundingBox();
        expect(box, `tab ${i} has no bounding box`).not.toBeNull();
        expect(
          box!.x + box!.width,
          `settings-tab[${i}] right edge (${box!.x + box!.width}) exceeds innerWidth (${innerWidth})`
        ).toBeLessThanOrEqual(innerWidth + 1);
      }

      // Clicking a non-default tab still switches the visible section.
      await page.click("button.settings-tab:has-text('Layout')");
      await expect(page.locator(".settings-section__title")).toHaveText("Layout");
    });

    test("auth form is usable on mobile", async ({ page }) => {
      // /login redirects to /setup when no admin exists in the e2e server;
      // /setup renders the same .auth-card styling, so it's a valid stand-in
      // for exercising the auth-card layout on mobile. (See docs/plans/
      // mobile-experience-plan.md Section 5 for why /login itself is out of
      // scope for this default, auth-disabled harness.)
      await page.goto("/setup");

      const authCard = page.locator(".auth-card");
      await expect(authCard).toBeVisible();

      const innerWidth = viewport.width;
      const cardBox = await authCard.boundingBox();
      expect(cardBox).not.toBeNull();
      expect(
        cardBox!.x + cardBox!.width,
        `.auth-card right edge (${cardBox!.x + cardBox!.width}) exceeds innerWidth (${innerWidth})`
      ).toBeLessThanOrEqual(innerWidth + 1);

      const firstInput = page.locator("input").first();
      await expect(firstInput).toBeVisible();
      const inputBox = await firstInput.boundingBox();
      expect(inputBox).not.toBeNull();
      expect(
        inputBox!.width,
        `first input width (${inputBox!.width}) exceeds innerWidth (${innerWidth})`
      ).toBeLessThanOrEqual(innerWidth);
    });

    test("dashboard tiles are visible and tappable", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".service-tile").first()).toBeVisible();

      const tiles = page.locator(".service-tile");
      const count = await tiles.count();
      expect(count).toBeGreaterThan(0);

      const sampleSize = Math.min(count, 3);
      for (let i = 0; i < sampleSize; i++) {
        const tile = tiles.nth(i);
        await expect(tile).toBeVisible();
        await expect(tile).toHaveAttribute("href", /.+/);

        const box = await tile.boundingBox();
        expect(box, `tile ${i} has no bounding box`).not.toBeNull();
        expect(
          box!.height,
          `tile ${i} height (${box!.height}) is below the 40px tap-target minimum`
        ).toBeGreaterThanOrEqual(40);
      }
    });

    test("main content scrolls vertically only", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".service-tile").first()).toBeVisible();

      const r = await page.evaluate(() => {
        const sm = document.querySelector(".shell-main");
        if (!sm) return null;
        return {
          scrollWidth: sm.scrollWidth,
          clientWidth: sm.clientWidth,
          scrollHeight: sm.scrollHeight,
          clientHeight: sm.clientHeight,
        };
      });

      expect(r, ".shell-main not found on page").not.toBeNull();
      // Vertical overflow/scrolling is expected and fine.
      expect(r!.scrollHeight).toBeGreaterThanOrEqual(0);
      // Horizontal overflow/scrolling is NOT fine -- this is the same
      // primary check as assertNoHorizontalOverflow's (b), kept explicit
      // here as documentation of intent for this specific scenario.
      expect(
        r!.scrollWidth,
        `.shell-main scrollWidth (${r!.scrollWidth}) exceeds clientWidth (${r!.clientWidth}) -- horizontal scroll detected`
      ).toBeLessThanOrEqual(r!.clientWidth + 1);
    });
  });
}
