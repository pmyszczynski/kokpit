# Kokpit brand assets

The simplified frontal cockpit is Kokpit's single mark. It has a transparent background and is used consistently in the navbar, browser favicon, installed-app icons, and larger product contexts.

## Visual direction

The artwork is a literal front-facing cockpit: a graphite shell, three blue HUD panes, and a centered gauge. Do not treat it as a generic K, status ring, or dashboard grid.

The palette is deliberately independent of Kokpit's configurable `--color-accent`:

- Ink `#0B1020`
- Graphite shell
- Electric-blue HUD
- White gauge needle

## Inventory

- `png/kokpit-mark-512.png` — master transparent mark for larger use.
- `png/kokpit-mark-navbar-64.png` — navbar source; rendered at 28 px in the app.
- `png/kokpit-favicon-{16,32,48,64}.png` and `favicon.ico` — browser variants.
- `png/kokpit-icon-192.png` and `png/kokpit-icon-512.png` — web manifest icons.
- `png/kokpit-apple-touch-icon-180.png` — Apple touch icon.

Use the supplied PNG size nearest to the rendered size. Do not add a card, fill, or different background behind the mark: the artwork already has transparent alpha and must remain visually identical on light and dark surfaces.
