import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_MOCK_STATE } from "../helpers/mock-plex-server";

const ADMIN = { username: "testadmin", password: "Str0ngP@ssword1" };
const MOCK_PLEX = "http://localhost:32401";

// In production builds, React hydrates after HTML is served. Wait for network
// idle before interacting with forms so event handlers are attached.
async function goto(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

// Tests run serially so each builds on the DB state left by the previous one.
// The global setup wipes the DB before the run, so the sequence always starts
// from a clean slate: no users → setup → post-setup guards → login → auth state.
test.describe.serial("authentication flow", () => {

  // ── Before any admin is created ──────────────────────────────────────────────

  test("unauthenticated visit to / redirects to /setup", async ({ page }) => {
    await goto(page, "/");
    await expect(page).toHaveURL("/setup");
  });

  test("visiting /login redirects to /setup when no admin exists", async ({ page }) => {
    await goto(page, "/login");
    await expect(page).toHaveURL("/setup");
  });

  test("/setup shows the account creation form", async ({ page }) => {
    await goto(page, "/setup");
    await expect(page.getByRole("heading", { name: "Welcome to Kokpit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create admin account" })).toBeVisible();
  });

  // ── Setup form ────────────────────────────────────────────────────────────────

  test("setup form creates admin, shows the recovery code, and redirects to /login", async ({ page }) => {
    await goto(page, "/setup");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password (min 8 chars)").fill(ADMIN.password);
    await page.getByPlaceholder("Confirm password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Create admin account" }).click();

    await expect(page.getByRole("heading", { name: "Save your recovery code" })).toBeVisible();
    const continueButton = page.getByRole("button", { name: "Continue to login" });
    await expect(continueButton).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    await expect(page).toHaveURL("/login");
  });

  // ── Post-setup guards (these were broken before the force-dynamic fix) ────────

  test("/setup redirects to /login once an admin exists", async ({ page }) => {
    await goto(page, "/setup");
    await expect(page).toHaveURL("/login");
  });

  test("/login shows the sign-in form and does not loop back to /setup", async ({ page }) => {
    await goto(page, "/login");
    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  // ── Login form ────────────────────────────────────────────────────────────────

  test("login with wrong password shows an error and stays on /login", async ({ page }) => {
    await goto(page, "/login");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid credentials")).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("login with correct credentials redirects to the dashboard", async ({ page }) => {
    await goto(page, "/login");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("navigation")).toBeVisible();
  });

  test("authenticated editor loads settings from the production runtime", async ({ page }) => {
    await goto(page, "/login");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    const settings = await page.request.get("/api/settings");
    expect(settings.status()).toBe(200);
    expect(settings.headers()["x-config-revision"]).toBeTruthy();
    expect(await settings.json()).toHaveProperty("appearance");

    await page.getByRole("button", { name: "Edit dashboard" }).click();
    await expect(page.locator(".edit-bar")).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.locator(".edit-bar")).toBeHidden();
  });

  test("authenticated settings can test a Plex connection and report its result", async ({ page, request }) => {
    const reset = await request.post(`${MOCK_PLEX}/__control`, {
      data: DEFAULT_MOCK_STATE,
    });
    expect(reset.ok(), `Mock control endpoint failed: ${reset.status()}`).toBeTruthy();

    await goto(page, "/login");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await page.click("button.settings-tab:has-text('Services')");
    await page.click("button:has-text('+ Add Service')");
    await page.selectOption("#sf-tile-type", "plex");
    await page.fill("#sf-widget-url", MOCK_PLEX);
    await page.fill("#sf-widget-token", "test-token");

    const testButton = page.getByRole("button", { name: "Test connection" });
    await expect(testButton).toBeEnabled();

    await testButton.click();
    await expect(page.getByRole("status").filter({ hasText: "Connection OK" })).toBeVisible();

    const fail = await request.post(`${MOCK_PLEX}/__control`, {
      data: { ...DEFAULT_MOCK_STATE, error: 503 },
    });
    expect(fail.ok(), `Mock control endpoint failed: ${fail.status()}`).toBeTruthy();

    await testButton.click();
    await expect(page.getByRole("alert").filter({ hasText: "Connection test failed" })).toBeVisible();

    const restore = await request.post(`${MOCK_PLEX}/__control`, {
      data: DEFAULT_MOCK_STATE,
    });
    expect(restore.ok(), `Mock control endpoint failed: ${restore.status()}`).toBeTruthy();
  });

  // ── Authenticated-state guards ────────────────────────────────────────────────

  test("visiting /login while authenticated redirects to the dashboard", async ({ page }) => {
    await goto(page, "/login");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    // The redirect itself is the behavior under test. Waiting for the dashboard's
    // full load can depend on unrelated resources and made this assertion flaky in CI.
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL("/");
  });

  test("logout clears the session and redirects to /login", async ({ page }) => {
    await goto(page, "/login");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/login");
  });

  // ── API-level login tests ─────────────────────────────────────────────────────

  test("POST /api/auth/login returns user data on success", async ({ page }) => {
    const res = await page.request.post("/api/auth/login", {
      data: { username: ADMIN.username, password: ADMIN.password },
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.username).toBe(ADMIN.username);
    expect(typeof json.id).toBe("string");
  });

  test("POST /api/auth/login returns 401 on wrong password", async ({ page }) => {
    const res = await page.request.post("/api/auth/login", {
      data: { username: ADMIN.username, password: "wrong-password" },
    });
    expect(res.status()).toBe(401);
  });

  // ── Session persistence ───────────────────────────────────────────────────────

  test("session persists after a page reload", async ({ page }) => {
    await goto(page, "/login");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("navigation")).toBeVisible();
  });

  // ── /api/auth/me ──────────────────────────────────────────────────────────────

  test("GET /api/auth/me returns user data while authenticated", async ({ page }) => {
    await goto(page, "/login");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    const res = await page.request.get("/api/auth/me");
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.username).toBe(ADMIN.username);
    expect(typeof json.id).toBe("string");
  });

  test("GET /api/auth/me returns 401 when not authenticated", async ({ page }) => {
    const res = await page.request.get("/api/auth/me");
    expect(res.status()).toBe(401);
  });

  // ── Post-logout state ─────────────────────────────────────────────────────────

  test("visiting / after logout redirects to /login", async ({ page }) => {
    await goto(page, "/login");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    await page.request.post("/api/auth/logout");
    await goto(page, "/");
    await expect(page).toHaveURL("/login");
  });

  test("password recovery revokes the old session and consumes the recovery code", async ({ page, playwright, baseURL }) => {
    const login = await page.request.post("/api/auth/login", { data: ADMIN });
    expect(login.status()).toBe(200);
    const recovery = await page.request.post("/api/auth/recovery-code", {
      data: { password: ADMIN.password },
    });
    expect(recovery.status()).toBe(200);
    const { recoveryCode } = await recovery.json();
    const newPassword = "Recovered-Passw0rd2!";
    const anonymous = await playwright.request.newContext({ baseURL });
    let passwordWasReset = false;
    try {
      const reset = await anonymous.post("/api/auth/reset-password", {
        data: { username: ADMIN.username, recoveryCode, newPassword },
      });
      passwordWasReset = reset.status() === 200;
      expect(reset.status()).toBe(200);
      expect((await page.request.get("/api/auth/me")).status()).toBe(401);
      expect((await page.request.get("/api/settings")).status()).toBe(401);
      expect((await anonymous.post("/api/auth/login", { data: ADMIN })).status()).toBe(401);
      expect((await anonymous.post("/api/auth/reset-password", {
        data: { username: ADMIN.username, recoveryCode, newPassword: "Another-Passw0rd3!" },
      })).status()).toBe(401);
      expect((await anonymous.post("/api/auth/login", {
        data: { username: ADMIN.username, password: newPassword },
      })).status()).toBe(200);
      expect((await anonymous.get("/api/auth/me")).status()).toBe(200);
    } finally {
      try {
        if (passwordWasReset) {
          expect((await anonymous.post("/api/auth/login", {
            data: { username: ADMIN.username, password: newPassword },
          })).status()).toBe(200);
          const recovery = await anonymous.post("/api/auth/recovery-code", {
            data: { password: newPassword },
          });
          expect(recovery.status()).toBe(200);
          const { recoveryCode } = await recovery.json();
          expect((await anonymous.post("/api/auth/reset-password", {
            data: { username: ADMIN.username, recoveryCode, newPassword: ADMIN.password },
          })).status()).toBe(200);
          expect((await anonymous.post("/api/auth/login", { data: ADMIN })).status()).toBe(200);
        }
      } finally {
        await anonymous.dispose();
      }
    }
  });

});
