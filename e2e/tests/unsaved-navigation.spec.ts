import { expect, test } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const fixture = schemaV2Fixtures([{ name: "Existing service", url: "http://localhost:9876" }]);

test.beforeEach(async ({ request }) => {
  expect((await request.patch("/api/settings", { data: {
    ...fixture, groups: [], bookmarks: [], appearance: { theme: "dark" },
  } })).status()).toBe(200);
});

test("internal navigation offers Stay and one deliberate discard while retaining the theme preview", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "light", exact: true }).click();
  await page.getByLabel("Custom CSS").fill(".unsaved-test { color: red; }");
  await page.getByRole("link", { name: "kokpit", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Stay", exact: true })).toBeFocused();
  await confirmation.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByLabel("Custom CSS")).toHaveValue(".unsaved-test { color: red; }");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "kokpit", exact: true }).click();
  await confirmation.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("native dialog Escape cannot discard an unsubmitted service silently", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Services", exact: true }).click();
  await page.getByRole("button", { name: "+ Add Service", exact: true }).click();
  await page.getByLabel("Name *", { exact: true }).fill("Keep this name");
  await page.keyboard.press("Escape");
  const confirmation = page.getByRole("dialog", { name: "Unsaved changes" });
  await confirmation.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(page.getByLabel("Name *", { exact: true })).toHaveValue("Keep this name");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await confirmation.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("a real browser reload can be cancelled after editing", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Custom CSS").fill(".keep-on-reload {} ");
  const nativePrompt = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
  });
  // Dismissing beforeunload can leave Playwright reload pending until its navigation timeout.
  await Promise.all([nativePrompt, page.reload({ timeout: 5_000 }).catch(() => null)]);
  await expect(page.getByLabel("Custom CSS")).toHaveValue(".keep-on-reload {} ");
});

test("same-document Back and Forward recover non-secret settings with a visible notice", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Custom CSS").fill(".history-recovery { color: red; }");
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page.getByLabel("Custom CSS")).toHaveValue(".history-recovery { color: red; }");
  await expect(page.getByText("Unsaved settings changes.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});

test("history recovery rechecks a changed server revision without rebasing the draft", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Custom CSS").fill(".old-baseline-draft {} ");
  await page.goBack();
  expect((await request.patch("/api/settings", { data: { appearance: { theme: "oled" } } })).status()).toBe(200);
  await page.goForward();
  await expect(page.getByLabel("Custom CSS")).toHaveValue(".old-baseline-draft {} ");
  await expect(page.getByRole("alert").filter({ hasText: "settings.yaml changed on disk" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
});

test("open service recovery retains its name while credentials require re-entry", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Services", exact: true }).click();
  await page.getByRole("button", { name: "+ Add Service", exact: true }).click();
  await page.getByLabel("Name *", { exact: true }).fill("Recovered service");
  await page.getByLabel("Integration", { exact: true }).selectOption("qbittorrent");
  await page.getByLabel("Password *", { exact: true }).fill("synthetic-not-retained");
  await page.goBack();
  await page.goForward();
  await expect(page.getByLabel("Name *", { exact: true })).toHaveValue("Recovered service");
  await expect(page.getByLabel("Password *", { exact: true })).toHaveValue("");
  await expect(page.getByText(/Recovered basic service fields/)).toBeVisible();
});
