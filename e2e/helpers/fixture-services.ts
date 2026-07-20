/**
 * Shared dashboard fixture used by spec files that reset state between tests
 * (visual.spec.ts, plex-widget.spec.ts). Mirrors e2e/fixtures/settings.yaml.
 *
 * Extended for the Phase A dashboard UX redesign so visual snapshots exercise
 * the new features: an ordered declared group, wide/tall/large tile sizes, and
 * bookmark groups (one placed inside a group, one in the implicit "Bookmarks"
 * section). Icons are inline `data:` URIs so tiles render deterministically
 * with no favicon network fetch (which would race the screenshot).
 */

/** Deterministic inline icons — no network, render immediately for stable shots. */
const ICON_INDIGO =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iIzYzNjZmMSIvPjwvc3ZnPg==";
const ICON_GREEN =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iIzIyYzU1ZSIvPjwvc3ZnPg==";
const ICON_AMBER =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iI2Y1OWUwYiIvPjwvc3ZnPg==";
const ICON_CYAN =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iIzA2YjZkNCIvPjwvc3ZnPg==";

/** Services fixture. Plex keeps its widget; Media group exercises the size presets. */
export const FIXTURE_SERVICES = [
  {
    name: "Plex",
    url: "http://localhost:32400",
    icon: ICON_INDIGO,
    group: "Media",
    size: "large",
    widget: {
      type: "plex",
      config: {
        url: "http://localhost:32400",
        token: "test-token",
        fields: ["streams", "transcodes", "library_movies"],
      },
    },
  },
  {
    name: "Sonarr",
    url: "http://localhost:8001",
    icon: ICON_GREEN,
    description: "TV series manager",
    group: "Media",
    size: "wide",
  },
  {
    name: "Radarr",
    url: "http://localhost:8002",
    icon: ICON_AMBER,
    description: "Movie manager",
    group: "Media",
    size: "tall",
  },
  {
    name: "Grafana",
    url: "http://localhost:3001",
    icon: ICON_CYAN,
    description: "Metrics dashboards",
  },
  {
    name: "Uptime Kuma",
    url: "http://localhost:3002",
    icon: ICON_GREEN,
  },
];

/** Declared, ordered groups. "Media" is declared so its order is explicit. */
export const FIXTURE_GROUPS = [{ name: "Media" }];

/**
 * Bookmark groups. "Guides" is a list-style group with an accent and a
 * description-bearing link, pinned into the Media group. "Quick Links" has no
 * placement so it lands in the implicit "Bookmarks" section rendered last.
 */
export const FIXTURE_BOOKMARKS = [
  {
    name: "Guides",
    accent: "#a855f7",
    style: "list",
    placement: { group: "Media" },
    links: [
      {
        name: "TRaSH Guides",
        url: "http://localhost:9101",
        icon: ICON_INDIGO,
        description: "Config best-practices for the *arr stack",
      },
      {
        name: "Servarr Wiki",
        url: "http://localhost:9102",
        icon: ICON_GREEN,
      },
    ],
  },
  {
    name: "Quick Links",
    accent: "#06b6d4",
    style: "list",
    links: [
      {
        name: "Source",
        url: "http://localhost:9201",
        icon: ICON_CYAN,
        description: "Project repository",
      },
      {
        name: "Status Page",
        url: "http://localhost:9202",
        icon: ICON_AMBER,
      },
    ],
  },
];
