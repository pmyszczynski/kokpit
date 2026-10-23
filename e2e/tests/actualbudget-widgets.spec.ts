import { test, expect, type APIRequestContext, type Page, type Locator } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";
import { expectWidgetStatLayout, expectWidgetStatContrast } from "../helpers/widget-stat";
import { withSettledConfigurationCheck } from "../helpers/configuration-check";

const TYPES = ["actualbudget-summary", "actualbudget-categories", "actualbudget-accounts", "actualbudget-schedules"] as const;
type Type = typeof TYPES[number];
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const FOOTPRINTS = [{ columnSpan: 3, rowSpan: 2 }, { columnSpan: 6, rowSpan: 2 }, { columnSpan: 3, rowSpan: 4 }];
const CONNECTION = { url: "http://actual-http-api.local:5007", api_key: "dummy", budget_sync_id: "dummy-budget" };
const DISPLAY = { currency: "USD", locale: "en-US", privacyMode: false };
const CATEGORIES = [
  { id: "dining", name: "Dining out", groupName: "Everyday", budgeted: 20000, spent: -22400, balance: -2400 },
  { id: "groceries", name: "Groceries", groupName: "Everyday", budgeted: 45000, spent: -39600, balance: 5400 },
  { id: "transport", name: "Transport", groupName: "Everyday", budgeted: 18000, spent: -12000, balance: 6000 },
  { id: "travel", name: "Travel fund", groupName: "Savings", budgeted: 0, spent: -5000, balance: 15000 },
  ...Array.from({ length: 8 }, (_, i) => ({ id: `cat-${i}`, name: `Category ${i + 5}`, groupName: "Monthly", budgeted: 10000, spent: -1000, balance: 9000 })),
].map(category => ({ ...category, isIncome: false, hidden: false, carryover: category.id === "travel" }));
const MONTH = { month: "2026-10", toBudget: 41200, totalBudgeted: 245000, totalSpent: -183400, totalBalance: 61600, totalIncome: 500000, categories: CATEGORIES };
const ACCOUNTS = [
  { id: "current", name: "Current account", balance: 321450, offbudget: false },
  { id: "savings", name: "Savings", balance: 1850000, offbudget: false },
  { id: "credit", name: "Credit card", balance: -48250, offbudget: false },
  { id: "investment", name: "Investments", balance: 4500000, offbudget: true },
  ...Array.from({ length: 8 }, (_, i) => ({ id: `account-${i}`, name: `Account ${i + 5}`, balance: 10000, offbudget: i % 2 === 0 })),
].map(account => ({ ...account, closed: false }));
const SCHEDULES = [
  { id: "electricity", payeeName: "Electricity", amount: -8500, amountMin: -7000, amountMax: -10000, daysUntil: -2 },
  { id: "internet", payeeName: "Internet", amount: -4500, amountMin: null, amountMax: null, daysUntil: 0 },
  { id: "rent", payeeName: "Rent", amount: -125000, amountMin: null, amountMax: null, daysUntil: 3 },
  { id: "salary", payeeName: "Salary", amount: 500000, amountMin: null, amountMax: null, daysUntil: 5 },
  { id: "insurance", payeeName: "Insurance", amount: -18000, amountMin: null, amountMax: null, daysUntil: 6 },
  { id: "phone", payeeName: "Phone", amount: -1900, amountMin: null, amountMax: null, daysUntil: 10 },
].map(schedule => ({ ...schedule, nextDate: "2026-10-20", completed: false }));
const DATA = {
  "actualbudget-summary": { ...DISPLAY, month: MONTH, accounts: ACCOUNTS, netWorth: 6703200, sizeDefaults: true },
  "actualbudget-categories": { ...DISPLAY, ...MONTH, hideIncome: true, hideEmpty: true, limit: 8 },
  "actualbudget-accounts": { ...DISPLAY, accounts: ACCOUNTS },
  "actualbudget-schedules": { ...DISPLAY, schedules: SCHEDULES, dueSoonCount: 9, dueSoonWindowDays: 7 },
};
const FIXTURE = schemaV2Fixtures(TYPES.map(type => ({ name: `Actual Budget · ${type.split("-")[1].replace(/^./, letter => letter.toUpperCase())}`, widget: { type, config: CONNECTION } })));
function tile(page: Page, type: Type) {
  return page.locator(".service-tile").filter({ has: page.locator(`[data-widget-type="${type}"]`) });
}
async function configure(request: APIRequestContext, options: {
  theme?: typeof THEMES[number]; footprint?: typeof FOOTPRINTS[number]; private?: boolean; custom_css?: string;
} = {}) {
  expect((await request.patch("/api/settings", { data: { ...FIXTURE,
    service_tiles: FIXTURE.service_tiles.map((entry, i) => ({ ...entry, footprint: i === 0 ? options.footprint ?? FOOTPRINTS[2] : FOOTPRINTS[2],
      widget: { ...entry.widget, config: { currency: "USD", locale: "en-US", privacy_mode: options.private ?? false, ...(i === 0 ? { size_defaults: true } : {}) } },
    })), groups: [], bookmarks: [], appearance: { theme: options.theme ?? "dark", custom_css: options.custom_css },
  } })).ok()).toBe(true);
}
async function mockWidgets(page: Page, response: (type: Type) => unknown = type => ({ ok: true, data: DATA[type] })) {
  await page.route("**/api/widget*", route => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    const i = FIXTURE.service_tiles.findIndex(entry => entry.id === id);
    return i < 0 ? route.continue() : route.fulfill({ contentType: "application/json", body: JSON.stringify(response(TYPES[i])) });
  });
}
async function fitsList(widget: Locator) {
  expect(await widget.evaluate(node => {
    const body = node.querySelector(".widget-body")!;
    const list = node.querySelector(".widget-list__scroll")!;
    const notice = node.querySelector(".widget-body__notice")!;
    const outer = node.getBoundingClientRect();
    return [body, list, notice].every(item => {
      const r = item.getBoundingClientRect();
      return r.left >= outer.left && r.right <= outer.right && r.top >= outer.top && r.bottom <= outer.bottom;
    }) && list.scrollWidth <= list.clientWidth && body.scrollWidth <= body.clientWidth;
  })).toBe(true);
}

test("Actual Budget Summary follows 2/3/6 sizing and shared colors in four themes", async ({ page, request }) => {
  await mockWidgets(page);
  for (const footprint of FOOTPRINTS) for (const theme of THEMES) {
    await configure(request, { footprint, theme }); await page.goto("/");
    const summary = tile(page, TYPES[0]);
    const fields = footprint.rowSpan === 4 ? ["toAssign", "budgeted", "spent", "remaining", "overspent", "netWorth"]
      : footprint.columnSpan === 6 ? ["toAssign", "remaining", "spent"] : ["toAssign", "remaining"];
    await expect(summary.locator(".widget-stat")).toHaveCount(fields.length);
    expect(await summary.locator(".widget-stat").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-field")))).toEqual(fields);
    await expect(summary.locator('[data-field="toAssign"]')).toHaveClass(/widget-stat--tone-positive/);
    await expect(summary.locator('[data-field="remaining"]')).toHaveClass(/widget-stat--tone-positive/);
    await expectWidgetStatLayout(summary, { width: footprint.columnSpan === 6 ? 688 : 340, height: footprint.rowSpan === 4 ? 264 : 128,
      columns: footprint.columnSpan === 6 ? 3 : 2, rows: footprint.rowSpan === 4 ? 3 : 1 });
    await expectWidgetStatContrast(summary);
  }
});

test("saved six-figure Summary retains Compact geometry and keyboard access to every figure", async ({ page, request }) => {
  await configure(request, { footprint: FOOTPRINTS[0] });
  await mockWidgets(page, type => ({ ok: true, data: type === TYPES[0] ? { ...DATA[type], sizeDefaults: false } : DATA[type] }));
  await page.goto("/");
  const summary = tile(page, TYPES[0]);
  await expect(summary.locator(".widget-stat")).toHaveCount(6);
  expect((await summary.boundingBox())?.height).toBe(128);
  const region = summary.getByRole("region", { name: "Budget measurements" });
  await region.focus(); await page.keyboard.press("End");
  await expect.poll(() => region.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expect(summary.getByText("Net Worth", { exact: true })).toBeInViewport();
  expect(await region.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test("Actual Budget lists preserve amounts, groups, semantic bars, badges and fixed footers in four themes", async ({ page, request }) => {
  await mockWidgets(page);
  for (const theme of THEMES) {
    await configure(request, { theme }); await page.goto("/");
    const categories = tile(page, TYPES[1]);
    await expect(categories.getByRole("listitem")).toHaveCount(8);
    await expect(categories.getByRole("meter", { name: "Budget spent for Dining out" })).toHaveAttribute("aria-valuenow", "100");
    await expect(categories.getByRole("meter", { name: "Budget spent for Travel fund" })).toHaveAttribute("aria-valuenow", "25");
    await expect(categories.locator(".actualbudget-categories-widget__row").filter({ hasText: "Travel fund" })).toContainText("$50.00 / $200.00");
    await expect(categories.getByText("100% · Overspent")).toBeVisible();
    await expect(categories.getByText("88% · Almost spent")).toBeVisible();
    const accounts = tile(page, TYPES[2]);
    await expect(accounts.getByRole("listitem")).toHaveCount(12);
    await expect(accounts.locator(".actualbudget-accounts-widget__row").filter({ hasText: "Investments" }).getByText("Off-budget")).toBeVisible();
    await expect(accounts.locator(".actualbudget-amount--negative")).toHaveText("-$482.50");
    await expect(accounts.locator(".actualbudget-accounts-widget__footer")).toContainText("$67,032.00");
    const schedules = tile(page, TYPES[3]);
    await expect(schedules.getByRole("listitem")).toHaveCount(6);
    await expect(schedules.getByText("overdue", { exact: true })).toHaveClass(/widget-badge--tone-alert/);
    await expect(schedules.locator(".actualbudget-schedules-widget__amount").first()).toHaveText("-$70.00–-$100.00");
    await expect(schedules.locator(".actualbudget-schedules-widget__footer-value")).toHaveText("9");
    for (const type of TYPES.slice(1)) await fitsList(tile(page, type));
  }
});

test("Actual Budget privacy stays blurred until whole-tile hover or keyboard focus", async ({ page, request }) => {
  await configure(request, { private: true });
  await mockWidgets(page, type => ({ ok: true, data: { ...DATA[type], privacyMode: true } }));
  await page.goto("/"); await page.mouse.move(0, 0);
  for (const type of TYPES) {
    const widget = tile(page, type), amount = widget.locator(".actualbudget-amount").first();
    await expect(amount).toHaveCSS("filter", "blur(5.6px)");
    await widget.hover(); await expect(amount).toHaveCSS("filter", "none");
    await page.mouse.move(0, 0); await expect(amount).toHaveCSS("filter", "blur(5.6px)");
    const scroll = widget.locator('.widget-list__scroll, .widget-body__content[tabindex="0"]');
    await scroll.focus(); await expect(amount).toHaveCSS("filter", "none");
    await expect(amount).not.toHaveAttribute("aria-hidden", "true");
    await scroll.blur(); await expect(amount).toHaveCSS("filter", "blur(5.6px)");
  }
});

test("long names, monetary ranges and the actual last list rows remain reachable with keyboard scrolling", async ({ page, request }) => {
  const longName = "A deliberately long full financial account or payee name that must remain available";
  await configure(request);
  await mockWidgets(page, type => ({ ok: true, data: type === TYPES[2] ? { ...DATA[type], accounts: ACCOUNTS.map(a => ({ ...a, name: longName, balance: -123456789012345 })) }
    : type === TYPES[3] ? { ...DATA[type], schedules: SCHEDULES.map(s => ({ ...s, payeeName: longName, amountMin: -123456789012345, amountMax: -987654321012345 })) }
    : DATA[type] }));
  await page.goto("/");
  for (const type of TYPES.slice(1)) {
    const widget = tile(page, type), list = widget.getByRole("list"), last = list.getByRole("listitem").last();
    await expect(last).toBeAttached();
    const before = await list.evaluate(node => node.scrollTop);
    expect(await last.evaluate(node => node.getBoundingClientRect().top >= node.parentElement!.getBoundingClientRect().bottom)).toBe(true);
    const footer = widget.locator(".widget-list__summary--footer");
    const bounds = await footer.count() ? await footer.boundingBox() : null;
    await list.focus(); await page.keyboard.press("End");
    await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(before);
    await expect(last).toBeInViewport();
    await expect.poll(() => last.evaluate(node => node.getBoundingClientRect().bottom <= node.parentElement!.getBoundingClientRect().bottom + 1)).toBe(true);
    if (bounds) expect(await footer.boundingBox()).toEqual(bounds);
    await fitsList(widget);
  }
  await expect(tile(page, TYPES[2]).locator(".widget-list-item__title").first()).toHaveAttribute("title", longName);
  await expect(tile(page, TYPES[3]).locator(".actualbudget-schedules-widget__amount").first()).toContainText("-$9,876,543,210,123.45");
});

test("shared initial, domain-empty and partial-summary states keep Actual Budget hooks", async ({ page, request }) => {
  await configure(request, { custom_css: '.actualbudget-summary-widget__hint--error { color: #123456; }' });
  let release!: () => void;
  const initial = new Promise<void>(resolve => { release = resolve; });
  let response = (type: Type): unknown => ({ ok: true, data: DATA[type] });
  await page.route("**/api/widget*", async route => {
    await initial;
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    const i = FIXTURE.service_tiles.findIndex(entry => entry.id === id);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response(TYPES[i])) });
  });
  await page.goto("/"); await expect(page.getByRole("status", { name: "Loading widget" })).toHaveCount(4);
  for (const type of TYPES) await expect(tile(page, type).locator(`.${type}-widget--empty`)).toBeVisible();
  release(); await expect(page.locator(".widget-stat")).toHaveCount(6);
  response = () => ({ ok: false, error: "Budget unavailable" }); await page.reload();
  await expect(page.locator(".service-tile").getByRole("alert")).toHaveCount(4);
  await expect(tile(page, TYPES[0]).locator(".actualbudget-summary-widget__hint--error")).toHaveCSS("color", "rgb(18, 52, 86)");
  response = type => ({ ok: true, data: type === TYPES[0] ? { ...DATA[type], accounts: null, netWorth: null }
    : type === TYPES[1] ? { ...DATA[type], categories: [] } : type === TYPES[2] ? { ...DATA[type], accounts: [] } : { ...DATA[type], schedules: [] } });
  await page.reload(); await expect(page.getByText("No categories to show")).toBeVisible();
  await expect(page.getByText("No accounts to show")).toBeVisible(); await expect(page.getByText("No upcoming schedules")).toBeVisible();
  await expect(tile(page, TYPES[0]).locator('[data-field="netWorth"]')).toHaveClass(/widget-stat--tone-neutral/);
  await expect(tile(page, TYPES[0]).locator('[data-field="netWorth"] .widget-stat__value')).toHaveText("—");
  await expect(page.locator(".widget-list__summary--footer")).toHaveCount(0);
});

test("five-minute refresh failures retain Actual Budget data and layout, then recover", async ({ page, request }) => {
  await configure(request); await page.clock.install();
  let fails = false;
  await mockWidgets(page, type => fails ? { ok: false, error: "Sidecar unavailable" } : { ok: true, data: DATA[type] });
  await withSettledConfigurationCheck(page, () => page.goto("/")); await expect(page.locator(".widget-stat")).toHaveCount(6);
  await expect(page.locator(".widget-list__summary--footer")).toHaveCount(2);
  const bounds = () => page.locator(".widget-stat, .widget-list__scroll, .widget-list__summary--footer").evaluateAll(nodes => nodes.map(node => {
    const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height };
  }));
  const before = await bounds(); fails = true; await withSettledConfigurationCheck(page, () => page.clock.fastForward(300000));
  await expect(page.locator(".service-tile").getByRole("alert")).toHaveCount(4);
  for (const type of TYPES) await expect(tile(page, type).getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Sidecar unavailable");
  expect(await bounds()).toEqual(before);
  fails = false; await withSettledConfigurationCheck(page, () => page.clock.fastForward(300000)); await expect(page.locator(".service-tile").getByRole("alert")).toHaveCount(0);
  expect(await bounds()).toEqual(before);
});

test("ordinary custom CSS overrides shared Actual Budget presentation through retained hooks", async ({ page, request }) => {
  await configure(request, { custom_css: '.actualbudget-summary-widget__stat { border-radius: 12px; background: #010203; } .actualbudget-categories-widget__progress-fill { background: #123456; } .actualbudget-accounts-widget__badge { color: #234567; } .actualbudget-schedules-widget__due--overdue { color: #345678; } .actualbudget-accounts-widget__footer-value { color: #456789; }' });
  await mockWidgets(page); await page.goto("/");
  await expect(tile(page, TYPES[0]).locator(".widget-stat").first()).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(tile(page, TYPES[0]).locator(".widget-stat").first()).toHaveCSS("border-radius", "12px");
  await expect(tile(page, TYPES[1]).locator(".widget-bar__fill").first()).toHaveCSS("background-color", "rgb(18, 52, 86)");
  await expect(tile(page, TYPES[2]).locator(".widget-badge").first()).toHaveCSS("color", "rgb(35, 69, 103)");
  await expect(tile(page, TYPES[2]).locator(".actualbudget-accounts-widget__footer-value")).toHaveCSS("color", "rgb(69, 103, 137)");
  await expect(tile(page, TYPES[3]).locator(".actualbudget-schedules-widget__due--overdue")).toHaveCSS("color", "rgb(52, 86, 120)");
});

test("Actual Budget preset persists Compact size defaults as a per-tile option through the real editor", async ({ page, request }) => {
  expect((await request.patch("/api/settings", { data: { services: [], service_tiles: [], groups: [{ name: "Budget" }], bookmarks: [], appearance: { theme: "dark" } } })).ok()).toBe(true);
  await page.route("**/api/widget*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: DATA[TYPES[0]] }) }));
  await page.goto("/"); await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Add tile to Budget" }).click();
  await page.getByRole("button", { name: "Actual Budget Summary", exact: true }).click();
  await expect(page.getByLabel("Footprint", { exact: true })).toHaveValue("3x2");
  await expect(page.getByLabel("Choose stats by tile size")).toBeChecked();
  await page.getByLabel("URL *", { exact: true }).fill(CONNECTION.url);
  await page.getByLabel("API Key *", { exact: true }).fill(CONNECTION.api_key);
  await page.getByLabel("Budget Sync ID *", { exact: true }).fill(CONNECTION.budget_sync_id);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = page.waitForResponse(response => response.url().endsWith("/api/settings") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: /Save & exit/ }).click(); expect((await saved).ok()).toBe(true);
  await expect(page.locator(".edit-bar")).toBeHidden();
  const persisted = await (await request.get("/api/settings")).json();
  expect(persisted.service_tiles[0].footprint).toEqual(FOOTPRINTS[0]);
  expect(persisted.service_tiles[0].widget.config.size_defaults).toBe(true);
  expect(persisted.services[0].integration.config.size_defaults).toBeUndefined();
  await page.reload(); await expect(tile(page, TYPES[0]).locator(".widget-stat")).toHaveCount(2);
});

test("Actual Budget dark and light screenshots show all four widgets and Summary sizes", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1456, height: 780 }); await mockWidgets(page);
  for (const theme of ["dark", "light"] as const) {
    await configure(request, { theme }); await page.goto("/");
    await expect(page.locator(".widget-stat")).toHaveCount(6);
    await expect(page.locator(".widget-list-item")).toHaveCount(26);
    await page.mouse.move(0, 0);
    await testInfo.attach(`Actual-Budget-${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({
      path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/actualbudget-${theme}.png` : undefined,
    }), contentType: "image/png" });
    const presets = schemaV2Fixtures(FOOTPRINTS.map((footprint, i) => ({ name: `Budget · ${["Compact", "Wide", "Detailed"][i]}`, widget: { type: TYPES[0], config: CONNECTION } })));
    await page.unroute("**/api/widget*");
    await page.route("**/api/widget*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: DATA[TYPES[0]] }) }));
    expect((await request.patch("/api/settings", { data: { ...presets,
      service_tiles: presets.service_tiles.map((entry, i) => ({ ...entry, footprint: FOOTPRINTS[i], widget: { ...entry.widget, config: { size_defaults: true } } })),
      groups: [], bookmarks: [], appearance: { theme },
    } })).ok()).toBe(true);
    await page.goto("/"); await expect(page.locator(".widget-stat")).toHaveCount(11);
    await testInfo.attach(`Actual-Budget-sizes-${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({
      path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/actualbudget-sizes-${theme}.png` : undefined,
    }), contentType: "image/png" });
    await page.unroute("**/api/widget*"); await mockWidgets(page);
  }
});
