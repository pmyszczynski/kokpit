import { serviceStatusBatch } from "../helpers/service-status";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { CalendarData } from "../../src/integrations/calendar/api";
import { createServer } from "node:http";
import { withSettledConfigurationCheck } from "../helpers/configuration-check";

const FOOTPRINTS = [{ columnSpan: 3, rowSpan: 4 }, { columnSpan: 6, rowSpan: 4 }];
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const DATA: CalendarData = { timezone: "Europe/Warsaw", daysAhead: 7, events: [
  { title: "Weekly planning", location: "Home office", description: "A quick look at the week ahead: priorities, projects, and a little time for ourselves." },
  { title: "A day away from the screen", location: "Outdoors", description: "No meetings, no alerts. Take the long route home." },
  { title: "Homelab maintenance", location: "Server room", description: "Check backups, install updates, and test the restore we keep putting off." },
  { title: "Dinner with friends", location: "The neighbourhood kitchen", description: "Good food and a chance to catch up." },
  { title: "Project check-in", location: "Studio", description: "Share the latest work and decide what comes next." },
  { title: "Weekend workshop", location: "Community space", description: "Bring a small project and learn something new together." },
  { title: "Monthly budget review", location: "Home office", description: "Look over the month and make room for the next adventure." },
  { title: "A very long event title whose full text remains accessible through its native link and tooltip", location: "Somewhere with a long address", description: "This final event is reached by scrolling the same list. Every event stays in the DOM." },
].map((event, i) => ({ ...event, id: `event-${i}`, start: i === 1 ? "2026-10-21" : `2026-10-${20 + Math.min(i, 6)}T${i === 0 ? "07" : "14"}:00:00.000Z`, end: i === 1 ? "2026-10-22" : `2026-10-${20 + Math.min(i, 6)}T${i === 0 ? "08" : "15"}:00:00.000Z`, allDay: i === 1, url: `https://example.com/events/${i}`, tentative: i === 4, ongoing: false })) };
function fixtures(footprints = [FOOTPRINTS[0]]) {
  return { services: footprints.map((_, i) => ({ id: `10000000-0000-4000-8000-00000000000${i}`, name: `Calendar · ${i === 0 ? "Agenda" : "Detailed"}`, description: "The week ahead", icon: "/icons/calendar.svg", launch_url: "https://example.com/calendar", integration: { type: "calendar", config: { calendar: "https://cloud.example.com/calendars/me/personal/" } } })),
    service_tiles: footprints.map((footprint, i) => ({ id: `20000000-0000-4000-8000-00000000000${i}`, service_id: `10000000-0000-4000-8000-00000000000${i}`, footprint, widget: { type: "calendar", config: { timezone: "Europe/Warsaw", days_ahead: 7, max_items: 8 } } })) };
}
async function configure(request: APIRequestContext, footprints = [FOOTPRINTS[0]], theme: typeof THEMES[number] = "dark", custom_css?: string) {
  expect((await request.patch("/api/settings", { data: { ...fixtures(footprints), groups: [], bookmarks: [], appearance: { theme, custom_css } } })).ok()).toBe(true);
}
const tile = (page: Page) => page.locator(".service-tile").filter({ has: page.locator('[data-widget-type="calendar"]') });
async function mock(page: Page) {
  await page.route("**/api/widget?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: DATA }) }));
  await page.route("**/api/status?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(serviceStatusBatch(route.request().url(), { ok: true, status: 200 })) }));
}
test.use({ locale: "en-US", timezoneId: "Pacific/Kiritimati" });

test("Calendar fits both sizes in four themes with fixed summary and actual scrolling", async ({ page, request }) => {
  await mock(page);
  for (const footprint of FOOTPRINTS) for (const theme of THEMES) {
    await configure(request, [footprint], theme); await page.goto("/");
    const widget = tile(page); const list = widget.getByRole("list", { name: "Upcoming calendar events" });
    await expect(list.getByRole("listitem")).toHaveCount(8);
    await expect(widget.getByText("09:00–10:00", { exact: footprint.columnSpan === 3 })).toBeVisible();
    expect(await list.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const summary = await widget.locator(".widget-list__summary").boundingBox(); const notice = await widget.locator(".widget-body__notice").boundingBox();
    await list.focus(); await list.press("End");
    await expect.poll(() => list.evaluate(element => element.scrollTop > 0 && Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 2)).toBe(true);
    expect(await list.evaluate(element => { const last = element.lastElementChild!.getBoundingClientRect(); const bounds = element.getBoundingClientRect(); return last.bottom <= bounds.bottom + 1 && last.top >= bounds.top - 1; })).toBe(true);
    await list.press("Home"); await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0);
    expect(await widget.locator(".widget-list__summary").boundingBox()).toEqual(summary); expect(await widget.locator(".widget-body__notice").boundingBox()).toEqual(notice);
    expect(await widget.evaluate(element => { const tile = element.getBoundingClientRect(); const list = element.querySelector(".widget-list")!.getBoundingClientRect(); const notice = element.querySelector(".widget-body__notice")!.getBoundingClientRect(); return list.top >= tile.top && list.bottom <= notice.top + 1 && notice.bottom <= tile.bottom; })).toBe(true);
    const ratios = await widget.locator(".widget-list-item__title, .widget-list-item__secondary, .calendar-widget__description").evaluateAll(elements => {
      function luminance(color: string) { return color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0); }
      return elements.map(element => { let parent: Element | null = element; let bg = "rgba(0, 0, 0, 0)"; while (parent && bg === "rgba(0, 0, 0, 0)") { bg = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; } const values = [luminance(getComputedStyle(element).color), luminance(bg)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05); });
    });
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  }
});

test("Calendar preserves scroll, focused event and geometry through failed refresh and recovery", async ({ page, request }) => {
  let failed = false;
  await page.clock.install({ time: new Date("2026-10-20T06:00:00Z") });
  await page.route("**/api/widget?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(failed ? { ok: false, error: "Calendar temporarily unavailable" } : { ok: true, data: DATA }) }));
  await configure(request, [FOOTPRINTS[1]]); await withSettledConfigurationCheck(page, () => page.goto("/"));
  const widget = tile(page); const list = widget.getByRole("list"); await expect(list.getByRole("listitem")).toHaveCount(8);
  const last = list.getByRole("link").last(); await last.focus(); const top = await list.evaluate(element => element.scrollTop);
  const bounds = await list.boundingBox(); failed = true; await withSettledConfigurationCheck(page, () => page.clock.fastForward(300_000));
  await expect(widget.getByRole("alert")).toHaveAttribute("title", "Calendar temporarily unavailable"); await expect(last).toBeFocused();
  expect(await list.evaluate(element => element.scrollTop)).toBe(top); expect(await list.boundingBox()).toEqual(bounds);
  failed = false; await withSettledConfigurationCheck(page, () => page.clock.fastForward(300_000)); await expect(widget.getByRole("alert")).toHaveCount(0); await expect(last).toBeFocused();
  expect(await list.evaluate(element => element.scrollTop)).toBe(top); expect(await list.boundingBox()).toEqual(bounds);
});

test("Calendar preset saves connection and tile options in their proper scopes", async ({ page, request }) => {
  expect((await request.patch("/api/settings", { data: { services: [], service_tiles: [], groups: [{ name: "Planning" }], bookmarks: [] } })).ok()).toBe(true);
  await mock(page); await page.goto("/"); await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Add tile to Planning" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByLabel("Footprint", { exact: true })).toHaveValue("3x4");
  await page.getByLabel("Calendar *", { exact: true }).fill("https://cloud.example.com/calendars/me/personal/");
  await page.getByLabel("Time zone", { exact: true }).fill("Europe/Warsaw"); await page.getByLabel("Event limit", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = page.waitForResponse(r => r.url().endsWith("/api/settings") && r.request().method() === "PATCH"); await page.getByRole("button", { name: /Save & exit/ }).click(); expect((await saved).ok()).toBe(true);
  const persisted = await (await request.get("/api/settings")).json();
  expect(persisted.services[0]).toMatchObject({ icon: "/icons/calendar.svg", integration: { type: "calendar", config: { calendar: "https://cloud.example.com/calendars/me/personal/" } } });
  expect(persisted.service_tiles[0]).toMatchObject({ footprint: FOOTPRINTS[0], widget: { type: "calendar", config: { timezone: "Europe/Warsaw", max_items: 8 } } });
  await page.reload(); await expect(tile(page).getByRole("listitem")).toHaveCount(8);
});

test("Calendar uses shared loading/error/empty states and independent header/event links", async ({ page, request }) => {
  await configure(request); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let response: unknown = { ok: false, error: "Calendar unavailable" };
  await page.route("**/api/widget?*", async route => { await gate; await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) }); });
  await page.goto("/"); await expect(tile(page).getByRole("status", { name: "Loading widget" })).toBeVisible(); release();
  await expect(tile(page).getByRole("alert")).toHaveText("Calendar unavailable");
  response = { ok: true, data: { ...DATA, events: [] } }; await page.reload(); await expect(tile(page).getByText("No upcoming events")).toBeVisible();
  response = { ok: true, data: DATA }; await page.reload();
  expect(await tile(page).evaluate(element => element.tagName)).toBe("DIV");
  await expect(tile(page).getByRole("link", { name: "Calendar · Agenda", exact: true })).toHaveAttribute("href", "https://example.com/calendar");
  const event = tile(page).getByRole("link", { name: "Weekly planning", exact: true });
  expect(await event.evaluate(element => element.parentElement!.closest("a") === null)).toBe(true);
});

for (const google of [false, true]) test(`Calendar preserves saved ${google ? "Google" : "CalDAV"} credentials when editing tile options`, async ({ page, request }) => {
  const data = fixtures();
  const connection = google ? { calendar: "example@group.calendar.google.com", api_key: "saved-google-key" } : { calendar: data.services[0].integration.config.calendar, username: "me", password: "saved-app-password" };
  expect((await request.patch("/api/settings", { data: { ...data, services: [{ ...data.services[0], integration: { type: "calendar", config: connection } }], groups: [], bookmarks: [] } })).ok()).toBe(true);
  await mock(page); await page.goto("/"); await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Calendar · Agenda options", exact: true }).click(); await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByLabel("Time zone", { exact: true }).fill("America/New_York");
  const dialog = page.getByRole("dialog"); await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled(); await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const saved = page.waitForResponse(r => r.url().endsWith("/api/settings") && r.request().method() === "PATCH"); await page.getByRole("button", { name: /Save & exit/ }).click(); expect((await saved).ok()).toBe(true);
  const persisted = await (await request.get("/api/settings")).json();
  expect(persisted.service_tiles[0].widget.config.timezone).toBe("America/New_York");
  expect(persisted.services[0].integration.config.calendar).toBe(connection.calendar);
  expect(persisted.services[0].integration.config[google ? "api_key" : "password"]).toEqual({ __kokpit_widget_secret_reference__: expect.stringMatching(/^__KOKPIT_WIDGET_SECRET_REF__:/) });
  expect(JSON.stringify(persisted)).not.toContain(google ? "saved-google-key" : "saved-app-password");
});

test("ordinary custom CSS overrides Calendar description and links", async ({ page, request }) => {
  await mock(page); await configure(request, [FOOTPRINTS[1]], "dark", ".calendar-widget__description { color: rgb(1, 2, 3); } .calendar-widget__link { text-decoration: underline; }"); await page.goto("/");
  await expect(tile(page).locator(".calendar-widget__description").first()).toHaveCSS("color", "rgb(1, 2, 3)");
  await expect(tile(page).getByRole("link", { name: "Weekly planning", exact: true })).toHaveCSS("text-decoration-line", "underline");
});

test("Calendar API reads a real CalDAV REPORT through the isolated parser worker", async ({ request }) => {
  const start = new Date(Date.now() + 3_600_000); const end = new Date(start.getTime() + 3_600_000);
  const stamp = (value: Date) => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const officeStamp = (value: Date) => stamp(new Date(value.getTime() + 2 * 3_600_000)).slice(0, -1);
  let method = ""; let report = ""; let authorization = "";
  const server = createServer((req, res) => {
    method = req.method ?? ""; authorization = req.headers.authorization ?? "";
    req.setEncoding("utf8"); req.on("data", chunk => { report += chunk; });
    req.on("end", () => {
      res.writeHead(207, { "Content-Type": "application/xml" });
      res.end(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-data><![CDATA[BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:Custom/Office\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0200\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:transport-test\r\nDTSTART;TZID="Custom/Office":${officeStamp(start)}\r\nDTEND;TZID="Custom/Office":${officeStamp(end)}\r\nSUMMARY:Real calendar transport\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n]]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing mock calendar listener");
    const data = fixtures(); data.services[0].integration.config = { calendar: `http://127.0.0.1:${address.port}/calendar/`, username: "me", password: "app-password" } as typeof data.services[0]["integration"]["config"];
    expect((await request.patch("/api/settings", { data: { ...data, groups: [], bookmarks: [] } })).ok()).toBe(true);
    const response = await request.get(`/api/widget?tile_id=${data.service_tiles[0].id}&widget_type=calendar`);
    expect(response.status()).toBe(200); expect((await response.json()).data.events).toEqual([expect.objectContaining({ title: "Real calendar transport", start: start.toISOString().replace(/\.\d{3}Z$/, ".000Z") })]);
    expect(method).toBe("REPORT"); expect(report).toContain("calendar-query"); expect(authorization).toBe(`Basic ${Buffer.from("me:app-password").toString("base64")}`);
    const publicSettings = JSON.stringify(await (await request.get("/api/settings")).json()); expect(publicSettings).not.toContain("app-password");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("Calendar dark/light previews show Agenda and Detailed with the same events", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 570 }); await mock(page);
  for (const theme of ["dark", "light"] as const) {
    await configure(request, FOOTPRINTS, theme); await page.goto("/"); await expect(page.locator(".widget-list-item")).toHaveCount(16);
    for (let index = 0; index < FOOTPRINTS.length; index++) {
      await expect(tile(page).nth(index).locator(".widget-list-item__title")).toHaveText(DATA.events.map(event => event.title));
    }
    await testInfo.attach(`Calendar-${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/calendar-${theme}.png` : undefined }), contentType: "image/png" });
  }
});
