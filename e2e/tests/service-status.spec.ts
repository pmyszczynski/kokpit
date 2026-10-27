import { serviceStatusBatch } from "../helpers/service-status";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const CHECKED_AT = Date.UTC(2026, 9, 20, 12);
const statuses = [200, 302, 401, 403, 404, 405, 500, 501, "timeout", "capacity"] as const;
const id = (prefix: string, index: number) => `${prefix}0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

async function configure(request: APIRequestContext, theme = "dark", custom_css = "") {
  expect((await request.patch("/api/settings", { data: {
    services: statuses.map((status, index) => ({ id: id("1", index), name: `Probe ${status}`, launch_url: `https://example.com/${status}`, icon: "/icons/search.svg" })),
    service_tiles: statuses.map((_, index) => ({ id: id("2", index), service_id: id("1", index), footprint: { columnSpan: 3, rowSpan: 1 } })),
    groups: [], bookmarks: [], appearance: { theme, custom_css },
  } })).ok()).toBe(true);
}

async function mock(page: Page) {
  await page.route("**/api/status?*", route => {
    return route.fulfill({ json: serviceStatusBatch(route.request().url(), serviceId => {
    const status = statuses[Number(serviceId.slice(-12)) - 1];
    const metadata = { checkedAt: CHECKED_AT - 5000, responseTimeMs: 42.5 };
    const result = status === "timeout" ? { ok: false, reachable: false, assessment: "unreachable", reason: "timeout", ...metadata }
      : status === "capacity" ? { ok: false, reachable: null, assessment: "unavailable", reason: "capacity", checkedAt: CHECKED_AT, responseTimeMs: null }
        : { ok: true, reachable: true, status, ...metadata };
    return result;
    }) });
  });
}

test("service indicators explain status and latency with keyboard tooltips in every theme", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 700 });
  await page.clock.install({ time: new Date(CHECKED_AT) });
  await page.clock.pauseAt(new Date(CHECKED_AT));
  await mock(page);
  for (const theme of ["dark", "light", "oled", "high-contrast"]) {
    await configure(request, theme);
    await page.goto("/");
    const indicator = (status: typeof statuses[number]) => page.locator(".service-tile").filter({ hasText: `Probe ${status}` }).locator(".status-dot");
    await expect(indicator(200)).toHaveAttribute("aria-label", /^Reachable; HTTP 200; 42.5 ms to headers/);
    await expect(indicator(401)).toHaveAttribute("aria-label", /^Reachable; authentication required; HTTP 401/);
    await expect(indicator(405)).toHaveAttribute("aria-label", /^Reachable; HEAD unsupported/);
    await expect(indicator(500)).toHaveClass(/status-dot--degraded/);
    await expect(indicator("timeout")).toHaveAttribute("aria-label", /^Unreachable from Kokpit; probe timed out/);
    await expect(indicator("capacity")).toHaveAttribute("aria-label", /^Status unavailable/);
    const tile = page.locator(".service-tile").filter({ hasText: "Probe 500" });
    await tile.focus();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toHaveText(/Reachable; degraded.*HTTP 500; 42.5 ms to headers.*5s ago/);
    await expect(tile).toHaveAccessibleDescription(/Reachable; degraded.*HTTP 500/);
    expect(await tooltip.evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })).toBe(true);
    await testInfo.attach(`Service-status-${theme}`, {
      body: await page.screenshot({ fullPage: true, path: process.env.KOKPIT_STATUS_PREVIEW_DIR ? `${process.env.KOKPIT_STATUS_PREVIEW_DIR}/service-status-${theme}.png` : undefined }),
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
  }
});

test("compact mobile launch links expose the status tooltip as their description", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await configure(request);
  await page.goto("/");
  const link = page.getByRole("link", { name: "Probe 401", exact: true });
  await link.focus();
  await expect(link).toHaveAccessibleDescription(/Reachable; authentication required; HTTP 401/);
  const tooltip = page.getByRole("tooltip");
  expect(await tooltip.evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })).toBe(true);
  await testInfo.attach("Service-status-mobile", {
    body: await page.screenshot({ fullPage: true, path: process.env.KOKPIT_STATUS_PREVIEW_DIR ? `${process.env.KOKPIT_STATUS_PREVIEW_DIR}/service-status-mobile.png` : undefined }),
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
  await expect(link).not.toHaveAttribute("aria-describedby");
});

test("custom CSS overrides indicator colors and tooltip text", async ({ page, request }) => {
  await mock(page);
  await configure(request, "dark", ".status-dot--degraded { background: rgb(1, 2, 3); } .service-status-tooltip { color: rgb(4, 5, 6); }");
  await page.goto("/");
  const tile = page.locator(".service-tile").filter({ hasText: "Probe 500" });
  await expect(tile.locator(".status-dot")).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await tile.focus();
  await expect(page.getByRole("tooltip")).toHaveCSS("color", "rgb(4, 5, 6)");
});

test("tiles in separate browser tabs share one guarded HEAD observation for a protected service", async ({ page, context, request }) => {
  let calls = 0;
  const methods: string[] = [];
  const authorization: (string | undefined)[] = [];
  let clientsReady = false;
  let release: (() => void) | undefined;
  const server = createServer((incoming, outgoing) => {
    calls++;
    methods.push(incoming.method ?? "");
    authorization.push(incoming.headers.authorization);
    const respond = () => {
      if (outgoing.writableEnded || outgoing.destroyed) return;
      outgoing.writeHead(401); outgoing.end();
    };
    if (clientsReady) respond(); else release = respond;
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const second = await context.newPage();
  const seen = [0, 0];
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing status fixture listener");
    expect((await request.patch("/api/settings", { data: {
      services: [{ id: id("1", 0), name: "Protected service", launch_url: `http://127.0.0.1:${address.port}/`, icon: "/icons/search.svg" }],
      service_tiles: [0, 1].map(index => ({ id: id("2", index), service_id: id("1", 0), footprint: { columnSpan: 3, rowSpan: 1 } })),
      groups: [], bookmarks: [],
    } })).ok()).toBe(true);
    // Warm the server-rendered route without mounting any client data pollers.
    expect((await request.get("/")).ok()).toBe(true);
    for (const [index, tab] of [page, second].entries()) tab.on("request", incoming => {
      if (!incoming.url().includes("/api/status?")) return;
      seen[index]++;
      if (seen.every(count => count >= 1)) { clientsReady = true; release?.(); }
    });
    await Promise.all([page.goto("/"), second.goto("/")]);
    for (const tab of [page, second]) {
      await expect(tab.locator(".status-dot")).toHaveCount(2);
      await expect(tab.locator(".status-dot").first()).toHaveAttribute("aria-label", /^Reachable; authentication required; HTTP 401/);
      await expect(tab.locator(".status-dot").last()).toHaveAttribute("aria-label", /^Reachable; authentication required; HTTP 401/);
    }
    expect(calls).toBe(1);
    expect(seen).toEqual([1, 1]);
    expect(methods).toEqual(["HEAD"]);
    expect(authorization).toEqual([undefined]);
    const timestamps = await Promise.all([page, second].map(tab => tab.locator(".status-dot").evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")?.match(/checked ([^ ]+) /)?.[1]))));
    expect(new Set(timestamps.flat()).size).toBe(1);
    // Staggered tabs must reuse the observation beyond the legacy 3s cooldown.
    await new Promise(resolve => setTimeout(resolve, 3200));
    const cached = await request.get(`/api/status?ids=${id("1", 0)}`);
    expect(cached.ok()).toBe(true);
    expect(calls).toBe(1);
  } finally {
    release?.();
    await second.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("status badge preference persists through the editor and YAML", async ({ page, request }) => {
  await mock(page); await configure(request); await page.goto("/");
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Probe 200 options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByLabel("Status indicator").selectOption("badge");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = page.waitForResponse(r => r.url().endsWith("/api/settings") && r.request().method() === "PATCH");
  await page.getByRole("button", { name: /Save & exit/ }).click(); expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.locator(".status-dot--badge")).toHaveText("Reachable");
  const settings = await (await request.get("/api/settings")).json();
  expect(settings.services[0].statusStyle).toBe("badge");
  expect(await readFile(process.env.KOKPIT_E2E_RUNTIME_CONFIG_PATH!, "utf8")).toContain("statusStyle: badge");
});

test("badges are readable and stay clear of long names in all themes and on mobile", async ({ page, request }, testInfo) => {
  await mock(page);
  for (const theme of ["dark", "light", "oled", "high-contrast"]) {
    await configure(request, theme);
    const settings = await (await request.get("/api/settings")).json();
    expect((await request.patch("/api/settings", { data: { services: settings.services.map((service: Record<string, unknown>) => ({ ...service, statusStyle: "badge" })) } })).ok()).toBe(true);
    for (const width of [1108, 390]) {
      await page.setViewportSize({ width, height: 800 }); await page.goto("/");
      const badges = page.locator(".status-dot--badge");
      await expect(badges).toHaveCount(statuses.length);
      await expect(badges.first()).toHaveText("Reachable");
      const contrasts = await badges.evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element);
        const luminance = (color: string) => {
          const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const foreground = luminance(style.color); const background = luminance(style.backgroundColor);
        const name = element.closest(".service-tile")!.querySelector(".service-tile__name")!.getBoundingClientRect();
        return { ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05), overlap: name.right > element.getBoundingClientRect().left };
      }));
      expect(contrasts.every(value => value.ratio >= 4.5 && !value.overlap)).toBe(true);
      if (width === 1108) await testInfo.attach(`Status-badges-${theme}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    }
  }
});
