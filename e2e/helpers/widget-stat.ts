import { expect, type Locator } from "@playwright/test";

/** Check actual text and inner scroll bounds, not just the tile's clipped exterior. */
export async function expectWidgetStatLayout(widget: Locator, expected: {
  width: number; height: number; columns: number; rows: number;
}) {
  const fit = await widget.evaluate((element) => {
    const body = element.querySelector(".widget-body");
    const grid = element.querySelector(".widget-stat-grid");
    const notice = element.querySelector(".widget-body__notice");
    if (!body || !grid || !notice) return null;
    const rect = (node: Element) => node.getBoundingClientRect();
    const contains = (outer: DOMRect, inner: DOMRect) =>
      inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
    const noScroll = (node: Element) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight;
    const cards = Array.from(grid.querySelectorAll(".widget-stat"));
    const texts = cards.flatMap((card) => Array.from(card.children));
    const contentBounds = texts.map((text) => {
      const range = document.createRange();
      range.selectNodeContents(text);
      return { parent: text.parentElement!, bounds: range.getBoundingClientRect() };
    });
    const scrollBounds = [element, body, grid, ...cards, ...texts].map((node) => ({
      className: node.className, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
    }));
    return {
      scrollBounds,
      width: rect(element).width, height: rect(element).height,
      columns: new Set(cards.map((card) => Math.round(rect(card).left))).size,
      rows: new Set(cards.map((card) => Math.round(rect(card).top))).size,
      bodyInsideTile: contains(rect(element), rect(body)),
      gridInsideBody: contains(rect(body), rect(grid)),
      noticeInsideBody: contains(rect(body), rect(notice)),
      noticeAfterGrid: rect(notice).top >= rect(grid).bottom - 0.5,
      cardsInsideGrid: cards.every((card) => contains(rect(grid), rect(card))),
      textInsideCards: contentBounds.every(({ parent, bounds }) => contains(rect(parent), bounds)),
      noScroll: [element, body, grid, ...cards].every(noScroll),
    };
  });
  expect(fit, "Shared widget body, grid and notice slot must exist").not.toBeNull();
  const { scrollBounds, ...measured } = fit!;
  expect(measured, JSON.stringify(scrollBounds)).toEqual({
    ...expected,
    bodyInsideTile: true, gridInsideBody: true, noticeInsideBody: true, noticeAfterGrid: true,
    cardsInsideGrid: true, textInsideCards: true, noScroll: true,
  });
}

export async function expectWidgetStatContrast(widget: Locator) {
  const contrast = await widget.locator(".widget-stat").evaluateAll((cards) => {
    const luminance = (color: string) => color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number)
      .map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return cards.flatMap((card) => Array.from(card.children).map((text) => {
      const values = [luminance(getComputedStyle(text).color), luminance(getComputedStyle(card).backgroundColor)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    }));
  });
  expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5);
}
