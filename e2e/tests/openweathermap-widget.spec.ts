import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

test("OpenWeatherMap preset protects its key and preserves it when location options change", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  expect((await request.patch("/api/settings", { data: { services: [], service_tiles: [], groups: [{ name: "Weather" }], bookmarks: [], appearance: { theme: "dark" } } })).ok()).toBe(true);
  await page.route("**/api/widget?*", route => route.fulfill({ json: { ok: true, data: {
    provider: "openweathermap", temperature: 18, feelsLike: 17, humidity: 64, wind: 12, code: 0, isDay: true,
    observedAt: "2026-10-17T12:00", timezone: "UTC+01:00", imperial: false, forecast: [],
  } } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Add tile to Weather" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Weather (OpenWeatherMap)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Set up OpenWeatherMap" })).toBeVisible();
  await page.getByLabel("API base URL *", { exact: true }).fill("https://api.openweathermap.org");
  const key = "saved-openweather-e2e-key";
  await page.getByLabel("API key *", { exact: true }).fill(key);
  await page.getByLabel("Latitude *", { exact: true }).fill("51.5074");
  await page.getByLabel("Longitude *", { exact: true }).fill("-0.1278");
  await expect(page.getByRole("button", { name: "Use my location" })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  let saved = page.waitForResponse(r => r.url().endsWith("/api/settings") && r.request().method() === "PATCH");
  await page.getByRole("button", { name: /Save & exit/ }).click(); expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("link", { name: "Weather by OpenWeatherMap" })).toHaveAttribute("href", "https://openweathermap.org/");
  let settings = await (await request.get("/api/settings")).json();
  expect(JSON.stringify(settings)).not.toContain(key);
  expect(settings.services[0].integration.config.api_key).toEqual({ __kokpit_widget_secret_reference__: expect.any(String) });
  expect(settings.service_tiles[0].widget).toMatchObject({ type: "openweathermap", config: { latitude: 51.5074, longitude: -0.1278 } });
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Weather (OpenWeatherMap) options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("API key *", { exact: true })).toBeEmpty();
  await page.getByLabel("Latitude *", { exact: true }).fill("0");
  await page.getByLabel("Use imperial units").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  saved = page.waitForResponse(r => r.url().endsWith("/api/settings") && r.request().method() === "PATCH");
  await page.getByRole("button", { name: /Save & exit/ }).click(); expect((await saved).ok()).toBe(true);
  settings = await (await request.get("/api/settings")).json();
  expect(settings.service_tiles[0].widget.config).toMatchObject({ latitude: 0, imperial: true });
  expect(JSON.stringify(settings)).not.toContain(key);
  const yaml = await readFile(process.env.KOKPIT_E2E_RUNTIME_CONFIG_PATH!, "utf8");
  expect(yaml).toContain(key);
  expect(yaml).toContain("latitude: 0");
  expect(errors.filter(message => /same key|hydration/i.test(message))).toEqual([]);
});

test("OpenWeatherMap fetches both real endpoints server-side and exposes only normalized data", async ({ request }) => {
  const requests: URL[] = [];
  const dt = Date.parse("2026-10-17T10:00:00Z") / 1000;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost"); requests.push(url);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(url.pathname.endsWith("/weather")
      ? { dt, timezone: 7200, main: { temp: 14, feels_like: 12, humidity: 65 }, wind: { speed: 5 }, weather: [{ id: 800, icon: "01d" }], private: "never expose" }
      : { city: { timezone: 7200 }, list: [{ dt, main: { temp_min: 10, temp_max: 15 }, pop: 0.3, weather: [{ id: 500 }] }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing API listener");
    const serviceId = "10000000-0000-4000-8000-000000000001"; const tileId = "20000000-0000-4000-8000-000000000001";
    expect((await request.patch("/api/settings", { data: {
      services: [{ id: serviceId, name: "OWM transport", integration: { type: "openweathermap", config: { url: `http://127.0.0.1:${address.port}/proxy`, api_key: "server-only-key" } } }],
      service_tiles: [{ id: tileId, service_id: serviceId, widget: { type: "openweathermap", config: { latitude: 0, longitude: 0 } } }], groups: [], bookmarks: [],
    } })).ok()).toBe(true);
    const response = await request.get(`/api/widget?tile_id=${tileId}&widget_type=openweathermap`);
    expect(response.ok()).toBe(true);
    const json = await response.json();
    expect(json.data).toMatchObject({ provider: "openweathermap", temperature: 14, wind: 18, code: 0, timezone: "UTC+02:00",
      forecast: [{ date: "2026-10-17", high: 15, low: 10, precipitation: 30, code: 61 }] });
    expect(JSON.stringify(json)).not.toMatch(/server-only-key|never expose/);
    expect(requests.map(url => url.pathname)).toEqual(["/proxy/data/2.5/weather", "/proxy/data/2.5/forecast"]);
    expect(requests.every(url => url.searchParams.get("appid") === "server-only-key" && url.searchParams.get("units") === "metric")).toBe(true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
