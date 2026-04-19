import { test, expect, type Page } from "@playwright/test";

const ADMIN = { username: "testadmin", password: "Str0ngP@ssword1" };

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

  test("setup form creates admin and redirects to /login", async ({ page }) => {
    await goto(page, "/setup");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password (min 8 chars)").fill(ADMIN.password);
    await page.getByPlaceholder("Confirm password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Create admin account" }).click();
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

  // ── Authenticated-state guards ────────────────────────────────────────────────

  test("visiting /login while authenticated redirects to the dashboard", async ({ page }) => {
    await goto(page, "/login");
    await page.getByPlaceholder("Username").fill(ADMIN.username);
    await page.getByPlaceholder("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    await goto(page, "/login");
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
});
