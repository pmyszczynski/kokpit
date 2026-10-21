import { describe, expect, it } from "vitest";
import { sanitizeRecovery } from "@/components/unsaved/UnsavedChangesProvider";

describe("CSS draft recovery privacy", () => {
  it.each([
    '.tile { background-image: image-set("/proxy?api_key=fixture-only" 1x); }',
    ".tile { background-image: image-set('../proxy#fixture-only' 2x); }",
    '.tile { background-image: -webkit-image-set("./proxy?token=fixture-only" 1x); }',
    '.tile { background-image: image-set("data:image/svg+xml,%3Csvg%3Efixture-only%3C/svg%3E" 1x); }',
    '.tile { background-image: image-set(linear-gradient(red, blue) type("image/png") 1x); }',
    '.tile::before { content: "fixture-only"; }',
    ".tile { font-family: 'Example Font'; }",
    '.tile { background-image: url(/proxy?api_key=fixture-only); }',
    String.raw`.tile { background-image: image\2d set(/proxy?api_key=fixture-only 1x); }`,
  ])("omits string/URL/escape-bearing CSS without retaining its payload: %s", (customCss) => {
    expect(sanitizeRecovery({ customCss, name: "Keep this name" })).toEqual({ name: "Keep this name" });
  });

  it.each([
    ".tile { --asset: /proxy?api_key=fixture-only; }",
    ".tile { --asset: ../proxy?token=fixture-only; }",
    ".tile { --asset: proxy#fixture-only; }",
    ".tile { --asset: ?api_key=fixture-only; }",
    ".tile { --asset: user:fixture-only@proxy; }",
    ".tile { --asset: data:text/plain,fixture-only; }",
    ".tile { --asset: data:,fixture-only; }",
    ".tile { color: red;\n  --asset: fixture-only; }",
  ])("omits unquoted custom-property payloads from recovery: %s", (customCss) => {
    expect(sanitizeRecovery({ customCss, name: "Keep this name" })).toEqual({ name: "Keep this name" });
  });

  it.each([
    ".tile { color: #fff; }",
    "#tile { color: red; }",
    "@media (width > 600px) { .tile { color: red; } }",
    ".tile { width: calc(100% / 2); }",
    ".tile { color: red; /* fixture-only */ }",
  ])("omits syntax outside the limited recovery profile: %s", (customCss) => {
    expect(sanitizeRecovery({ customCss })).toEqual({});
  });

  it("keeps numeric, keyword, variable-reference and color-function CSS, plus separate hex color fields", () => {
    const styles = {
      customCss: ".tile { color: var(--accent); padding: 8px; display: grid; }",
      custom_css: ".tile { background-image: image-set(linear-gradient(red, blue) 1x); }",
      bgGradient: "linear-gradient(45deg, rgb(255, 255, 255), rgb(0, 0, 0))",
      gradient: "radial-gradient(circle, hsl(0, 100%, 50%), blue)",
      bgColor: "#fff",
    };
    expect(sanitizeRecovery(styles)).toEqual(styles);
  });

  it("applies the conservative policy to nested CSS aliases without changing ordinary prose", () => {
    const description = 'A font called "Example Font" is installed locally.';
    expect(sanitizeRecovery({
      description,
      appearance: {
        customCss: '.tile { background: image-set("/proxy?api_key=fixture-only" 1x); }',
        custom_css: ".tile { content: 'fixture-only'; }",
        bgGradient: 'image-set("data:image/svg+xml,fixture-only" 1x)',
        gradient: "image-set('/proxy#fixture-only' 1x)",
      },
    })).toEqual({ description, appearance: {} });
  });
});
