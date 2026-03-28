import { startMockPlexServer } from "./helpers/mock-plex-server";

export default async function globalSetup() {
  const server = await startMockPlexServer(32400);
  // Playwright calls the returned function as global teardown.
  return () => server.close();
}
