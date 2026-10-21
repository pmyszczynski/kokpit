import { expect, type Page } from "@playwright/test";

/** Settle the real access check before another large fake-clock jump. */
export async function withSettledConfigurationCheck(page: Page, action: () => Promise<unknown>) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/config/revision"
      && response.request().method() === "GET"),
    action(),
  ]);
  expect(response.ok()).toBe(true);
  expect(await response.finished()).toBeNull();
  await expect(page.locator(".protected-surface")).toBeVisible();
}
