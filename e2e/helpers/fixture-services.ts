/** Services list that matches e2e/fixtures/settings.yaml, shared across spec files that reset state between tests. */
export const FIXTURE_SERVICES = [
  {
    name: "Plex",
    url: "http://localhost:32400",
    widget: {
      type: "plex",
      config: {
        url: "http://localhost:32400",
        token: "test-token",
        fields: ["streams", "transcodes", "library_movies"],
      },
    },
  },
];
