import { test, expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const FIXTURES = schemaV2Fixtures([
  { name: "Docker", description: "Containers on this host", size: "tall", widget: { type: "docker", config: { max_items: 50 } } },
  { name: "Seerr · Requests", description: "Recently requested media", size: "tall", widget: { type: "seerr-requests", config: { url: "http://localhost:5055", api_key: "dummy" } } },
  { name: "qBittorrent · Torrents", description: "Downloads and seeding", size: "tall", widget: { type: "qbittorrent-torrents", config: { url: "http://localhost:8080", username: "admin", password: "dummy" } } },
]);
const CONTAINERS = Array.from({ length: 15 }, (_, i) => ({
  id: `container-${i}`, name: i < 5 ? ["adguard", "immich", "kokpit", "plex", "traefik"][i] : `worker-${String(i).padStart(2, "0")}`,
  image: ["adguard/adguardhome:latest", "ghcr.io/immich-app/server:release", "ghcr.io/pmyszczynski/kokpit:latest", "lscr.io/linuxserver/plex:latest", "traefik:v3"][i % 5],
  state: ["running", "paused", "restarting", "running", "running"][i % 5],
  status: ["Up 2 days", "Up 1 day (Paused)", "Restarting (1) 4 seconds ago", "Up 3 hours", "Up 12 hours"][i % 5],
})).sort((a, b) => a.name.localeCompare(b.name));
const DATA = { running: 9, total: 18, containers: CONTAINERS };
const REQUESTS = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, requestStatus: i % 5 + 1, mediaStatus: i % 5 === 2 ? 5 : 3, mediaType: i % 2 ? "tv" : "movie", title: ["Dune: Part Two", "Severance", "Interstellar", "The Bear", "Arrival"][i % 5], seasons: i % 2 ? [1, 2] : null, requestedBy: ["Alex", "Sam", "Jordan"][i % 3], createdAt: new Date(Date.now() - (i + 1) * 3600000).toISOString(), tmdbId: 100 + i }));
const TORRENTS = Array.from({ length: 15 }, (_, i) => ({ hash: `torrent-${i}`, name: ["Ubuntu 26.04 Desktop", "Fedora Workstation", "Debian 13", "Linux Mint", "Arch Linux"][i % 5], progress: [0.73, 0.18, 0, 1, 0.45][i % 5], dlspeed: [12000000, 850000, 0, 0, 2400000][i % 5], upspeed: [240000, 0, 0, 1000000, 150000][i % 5] }));
const tile = (page: Page, type = "docker") => page.locator(".service-tile").filter({ has: page.locator(`[data-widget-type="${type}"]`) });
async function configure(request: APIRequestContext, theme = "dark", custom_css?: string, longText = false) {
  expect((await request.patch("/api/settings", { data: { ...FIXTURES, groups: [], bookmarks: [], appearance: { theme, custom_css },
    services: FIXTURES.services.map(s => ({ ...s, ...(longText ? { name: "Docker with a deliberately very long service name", description: "A long description of container activity on this host" } : {}) })),
  } })).ok()).toBe(true);
}
async function mock(page: Page, docker: unknown = DATA) {
  await page.route("**/api/widget*", async route => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    const data = id === FIXTURES.service_tiles[0].id ? docker : id === FIXTURES.service_tiles[1].id ? REQUESTS : TORRENTS;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
}

test("Docker shared list comparison previews", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 460 }); await mock(page);
  for (const theme of ["dark", "light"]) {
    await configure(request, theme); await page.goto("/");
    for (const type of ["docker", "seerr-requests", "qbittorrent-torrents"]) await expect(tile(page, type).locator(type === "docker" ? ".docker-widget__row" : ".widget-list-item")).toHaveCount(15);
    await testInfo.attach(`Docker lists ${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/comparison-${theme}.png` : undefined }), contentType: "image/png" });
  }
});

async function expectFit(widget: Locator) {
  const measured = await widget.evaluate(element => {
    const list = element.querySelector(".widget-list__scroll")!;
    const summary = element.querySelector(".widget-list__summary")!;
    const notice = element.querySelector(".widget-body__notice")!;
    const wr = element.getBoundingClientRect(), lr = list.getBoundingClientRect(), sr = summary.getBoundingClientRect(), nr = notice.getBoundingClientRect();
    const contents = Array.from(element.querySelectorAll(".widget-list-item__content"));
    return {
      width: wr.width, height: wr.height, noHorizontalScroll: list.scrollWidth <= list.clientWidth,
      contained: sr.left >= wr.left && sr.right <= wr.right && sr.top >= wr.top && lr.left >= wr.left && lr.right <= wr.right,
      summaryFixed: sr.bottom <= lr.top + 0.5, noticeAfterList: nr.top >= lr.bottom - 0.5 && nr.bottom <= wr.bottom,
      titlesAligned: contents.every(node => Math.abs(node.getBoundingClientRect().left - contents[0].getBoundingClientRect().left) < 0.5),
      readable: Array.from(element.querySelectorAll(".widget-list__summary-primary,.widget-list__summary-secondary,.widget-list-item__trailing")).every(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        const t = range.getBoundingClientRect(), r = node.getBoundingClientRect();
        return t.left >= r.left - 0.5 && t.right <= r.right + 0.5 && t.top >= r.top - 0.5 && t.bottom <= r.bottom + 0.5;
      }),
      dotsFit: Array.from(element.querySelectorAll(".widget-status-dot")).every(dot => {
        const r = dot.getBoundingClientRect(), parent = dot.parentElement!.getBoundingClientRect();
        return r.width === 8 && r.height === 8 && r.left >= parent.left && r.right <= parent.right && r.top >= parent.top && r.bottom <= parent.bottom;
      }),
    };
  });
  expect(measured).toEqual({ width: 340, height: 264, noHorizontalScroll: true, contained: true, summaryFixed: true, noticeAfterList: true, titlesAligned: true, readable: true, dotsFit: true });
}

test("Docker fits four themes with readable text, contrasting dots and all containers keyboard reachable", async ({ page, request }) => {
  await mock(page, { ...DATA, containers: CONTAINERS.map((c, i) => i === 14 ? { ...c, state: "future-state", status: "Unknown state" } : c) });
  for (const theme of THEMES) {
    await configure(request, theme); await page.goto("/");
    const widget = tile(page); await expect(widget.getByRole("listitem")).toHaveCount(15); await expectFit(widget);
    const ratios = await widget.evaluate(element => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; const ctx = canvas.getContext("2d")!;
      const luminance = (color: string) => {
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map(c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      };
      const background = luminance(getComputedStyle(element).backgroundColor);
      const ratio = (color: string) => { const [a, b] = [luminance(color), background].sort((a, b) => b - a); return (a + 0.05) / (b + 0.05); };
      return { text: Array.from(element.querySelectorAll(".widget-list-item__title,.widget-list-item__secondary,.widget-list-item__trailing,.widget-list__summary-primary,.widget-list__summary-secondary")).map(n => ratio(getComputedStyle(n).color)),
        dots: Array.from(element.querySelectorAll(".widget-status-dot")).map(n => ratio(getComputedStyle(n).backgroundColor)) };
    });
    expect(Math.min(...ratios.text)).toBeGreaterThanOrEqual(4.5); expect(Math.min(...ratios.dots)).toBeGreaterThanOrEqual(3);
    const list = widget.getByRole("list", { name: "Docker containers" }); await list.focus(); await list.press("End");
    await expect.poll(() => list.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1)).toBe(true);
    await expect(widget.getByRole("listitem").last()).toBeInViewport();
    await expect(widget.locator(".docker-widget__summary")).toBeInViewport();
    await list.press("Home"); await expect.poll(() => list.evaluate(node => node.scrollTop)).toBe(0);
  }
});

test("Docker preserves long names and images, full status text and large summary values", async ({ page, request }) => {
  const name = "A deliberately very long Docker container name describing this deployment";
  const image = "ghcr.io/a-very-long-organization/very-long-container-image-name:production-release-2026";
  const status = "Up 234 days (health: starting with a long diagnostic status)";
  await mock(page, { running: 123456789012, total: 987654321098, containers: CONTAINERS.map((c, i) => ({ ...c, name, image: i === 14 ? "" : image, status: i === 14 ? "" : status })) });
  await configure(request, "dark", undefined, true); await page.goto("/");
  const widget = tile(page); await expect(widget.getByRole("listitem")).toHaveCount(15); await expectFit(widget);
  await expect(widget.locator(".docker-widget__summary")).toHaveText("123456789012 running987654321098 total");
  await expect(widget.locator(".docker-widget__name").first()).toHaveAttribute("title", name);
  await expect(widget.locator(".docker-widget__image").first()).toHaveAttribute("title", image);
  await expect(widget.locator(".docker-widget__status").first()).toHaveAttribute("title", status);
  await expect(widget.locator(".docker-widget__status").first()).toHaveText(status);
  await expect(widget.getByRole("listitem").last().locator(".docker-widget__image,.docker-widget__status")).toHaveCount(0);
});

test("Docker preserves state meaning, source order and zero-summary colors", async ({ page, request }) => {
  const states = ["running", "paused", "restarting", "exited", "future-state"];
  await mock(page, { running: 0, total: 5, containers: states.map((state, i) => ({ ...CONTAINERS[i], state })) });
  await configure(request); await page.goto("/");
  const widget = tile(page); await expect(widget.getByRole("listitem")).toHaveCount(5);
  await expect(widget.locator(".docker-widget__name")).toHaveText(CONTAINERS.slice(0, 5).map(c => c.name));
  for (const [i, tone] of ["positive", "warning", "warning", "neutral", "neutral"].entries()) {
    const dot = widget.getByRole("img", { name: states[i], exact: true });
    await expect(dot).toHaveClass(new RegExp(`widget-status-dot--tone-${tone}`));
    await expect(dot).toHaveAttribute("title", states[i]);
  }
  await expect(widget.locator(".widget-list__summary-primary")).toHaveClass(/summary-tone-neutral/);
  await expect(widget.locator(".widget-list__summary-secondary")).toHaveClass(/summary-tone-info/);
  await expect(widget.getByRole("status")).toHaveCount(0);
});

test("Docker shared initial states and empty summary preserve scoped CSS hooks", async ({ page, request }) => {
  await configure(request, "dark", `.docker-widget__hint { padding-top:7px; } .docker-widget--empty .docker-widget__hint { padding-bottom:9px; } .docker-widget--empty .docker-widget__hint--error { color:#040506; }`);
  let release!: () => void; const initial = new Promise<void>(resolve => { release = resolve; });
  let response: unknown = { ok: false, error: "Docker socket unavailable" };
  await page.route("**/api/widget*", async route => { await initial; await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) }); });
  await page.goto("/");
  const widget = tile(page), loading = widget.getByRole("status", { name: "Loading widget" });
  await expect(loading).toHaveCSS("padding-top", "7px"); await expect(loading).toHaveCSS("padding-bottom", "9px");
  release(); await expect(widget.getByRole("alert")).toHaveText("Docker socket unavailable");
  await expect(widget.locator(".widget-state__label")).toHaveCSS("color", "rgb(4, 5, 6)");
  response = { ok: true, data: null }; await page.reload();
  await expect(widget.locator(".docker-widget--empty")).toBeVisible(); await expect(widget.getByRole("list")).toHaveCount(0);
  response = { ok: true, data: { running: 0, total: 3, containers: [] } }; await page.reload();
  await expect(widget.getByText("No running containers")).toHaveCSS("padding-bottom", "9px");
  await expect(widget.getByRole("list")).toHaveCount(0); await expect(widget.getByText("3 total")).toBeVisible();
});

for (const empty of [false, true]) test(`Docker saved ${empty ? "empty" : "populated"} data retain summary, bounds and scroll through refresh failure/recovery`, async ({ page, request }, testInfo) => {
  let fails = false;
  const docker = empty ? { running: 0, total: 3, containers: [] } : DATA;
  await page.route("**/api/widget*", async route => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    const data = id === FIXTURES.service_tiles[0].id ? docker : id === FIXTURES.service_tiles[1].id ? REQUESTS : TORRENTS;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(id === FIXTURES.service_tiles[0].id && fails ? { ok: false, error: "Socket unavailable" } : { ok: true, data }) });
  });
  await page.clock.install();
  for (const theme of THEMES) {
    fails = false; await configure(request, theme); await page.goto("/");
    const widget = tile(page);
    await expect(widget.locator(empty ? ".widget-state--empty" : ".widget-list-item")).toHaveCount(empty ? 1 : 15);
    if (!empty) await widget.getByRole("list").evaluate(node => { node.scrollTop = 45; });
    const bounds = () => widget.locator(".widget-list__summary,.widget-list,.widget-body__notice").evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    const scrolls = () => widget.locator(".widget-list__scroll").evaluateAll(nodes => nodes.map(node => node.scrollTop));
    const healthy = await bounds(), offsets = await scrolls();
    fails = true; await page.clock.fastForward(15000);
    await expect(widget.getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Socket unavailable");
    expect(await bounds()).toEqual(healthy); expect(await scrolls()).toEqual(offsets);
    await expect(widget.locator(".docker-widget__summary")).toHaveText(`${docker.running} running${docker.total} total`);
    if (empty) await expect(widget.getByRole("list")).toHaveCount(0);
    if (!empty && theme === "dark") await testInfo.attach("Docker stale", { body: await widget.screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/stale-dark.png` : undefined }), contentType: "image/png" });
    fails = false; await page.clock.fastForward(15000); await expect(widget.getByRole("alert")).toHaveCount(0);
    expect(await bounds()).toEqual(healthy); expect(await scrolls()).toEqual(offsets);
    if (empty) await expect(widget.getByRole("list")).toHaveCount(0);
  }
});

test("Docker summary, rows, wrapped status and status dots respect ordinary custom CSS", async ({ page, request }) => {
  await configure(request, "dark", `.docker-widget__summary { padding-top:9px; } .docker-widget__summary-total { color:#040506; } .docker-widget__row { padding-top:10px; --widget-list-item-trailing-max-width:80px; } .docker-widget__status { color:#040506; } .docker-widget__dot { --widget-status-dot-size:10px; background:#112233; }`);
  await mock(page); await page.goto("/");
  const widget = tile(page); await expect(widget.getByRole("listitem")).toHaveCount(15);
  await expect(widget.locator(".docker-widget__summary")).toHaveCSS("padding-top", "9px");
  await expect(widget.locator(".docker-widget__summary-total")).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(widget.getByRole("listitem").first()).toHaveCSS("padding-top", "10px");
  await expect(widget.locator(".widget-list-item__trailing").first()).toHaveCSS("max-width", "80px");
  await expect(widget.locator(".docker-widget__status").first()).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(widget.locator(".docker-widget__dot").first()).toHaveCSS("width", "10px");
  await expect(widget.locator(".docker-widget__dot").first()).toHaveCSS("height", "10px");
  await expect(widget.locator(".docker-widget__dot").first()).toHaveCSS("background-color", "rgb(17, 34, 51)");
});

test("Every advertised dot and summary tone resolves to the shared palette in four themes", async ({ page, request }) => {
  await mock(page);
  for (const theme of THEMES) {
    await configure(request, theme); await page.goto("/");
    const widget = tile(page); await expect(widget.getByRole("listitem")).toHaveCount(15);
    const measured = await widget.evaluate(element => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; const ctx = canvas.getContext("2d")!;
      const rgb = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data); };
      const dot = element.querySelector(".widget-status-dot")!, primary = element.querySelector(".widget-list__summary-primary")!, secondary = element.querySelector(".widget-list__summary-secondary")!;
      const original = [dot.className, primary.className, secondary.className];
      const results: { target: string; tone: string; actual: number[]; expected: number[] }[] = [];
      for (const tone of ["neutral", "positive", "warning"]) {
        dot.className = `widget-ui widget-status-dot widget-status-dot--tone-${tone}`;
        const style = getComputedStyle(dot);
        results.push({ target: "dot", tone, actual: rgb(style.backgroundColor), expected: rgb(style.getPropertyValue(tone === "neutral" ? "--color-text-muted" : `--widget-stat-tone-${tone}`).trim()) });
      }
      for (const [target, node] of [["primary", primary], ["secondary", secondary]] as const) {
        for (const tone of ["neutral", "positive", "info"]) {
          node.className = `widget-list__summary-${target} widget-list__summary-tone-${tone}`;
          const style = getComputedStyle(node);
          results.push({ target, tone, actual: rgb(style.color), expected: rgb(style.getPropertyValue(tone === "neutral" ? target === "primary" ? "--color-text" : "--color-text-muted" : `--widget-stat-tone-${tone}`).trim()) });
        }
      }
      [dot.className, primary.className, secondary.className] = original;
      return results;
    });
    expect(measured).toHaveLength(9);
    for (const color of measured) expect(color.actual, `${theme}: ${color.target} ${color.tone}`).toEqual(color.expected);
  }
});
