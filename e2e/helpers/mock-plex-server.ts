import http from "node:http";

export interface MockPlexState {
  sessions: { size: number; Metadata?: object[] };
  /** Maps section key (or "key:type=N") to totalSize. */
  sectionCounts: Record<string, number>;
  /** When set, all Plex API endpoints respond with this HTTP status code. */
  error?: number | null;
}

/** Sections list served by /library/sections. */
const SECTIONS = [{ key: "1", type: "movie" }];

/**
 * Default state: 2 streams, 1 transcode, 150 movies.
 * Matches the values asserted in the baseline E2E test.
 */
export const DEFAULT_MOCK_STATE: MockPlexState = {
  sessions: {
    size: 2,
    Metadata: [
      {
        TranscodeSession: {},
        Session: { location: "lan", bandwidth: 1000 },
        User: { title: "Alice" },
      },
      {
        Session: { location: "wan", bandwidth: 2000 },
        User: { title: "Bob" },
      },
    ],
  },
  sectionCounts: { "1": 150 },
  error: null,
};

export async function startMockPlexServer(port: number): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  let state: MockPlexState = structuredClone(DEFAULT_MOCK_STATE);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // ── Control endpoint ──────────────────────────────────────────────────────
    // Accepts POST /__control with a JSON body to replace the mock state.
    // Checked before the error guard so it stays reachable when state.error is set.
    if (req.method === "POST" && url.pathname === "/__control") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const update = JSON.parse(body) as MockPlexState;
          state = update;
          res.writeHead(204);
          res.end();
        } catch {
          res.writeHead(400);
          res.end("Bad JSON");
        }
      });
      return;
    }

    // ── Error simulation ──────────────────────────────────────────────────────
    if (state.error != null) {
      res.writeHead(state.error);
      res.end();
      return;
    }

    res.setHeader("Content-Type", "application/json");

    // ── /status/sessions ─────────────────────────────────────────────────────
    if (url.pathname === "/status/sessions") {
      res.writeHead(200);
      res.end(JSON.stringify({ MediaContainer: state.sessions }));
      return;
    }

    // ── /library/sections ────────────────────────────────────────────────────
    if (url.pathname === "/library/sections") {
      res.writeHead(200);
      res.end(JSON.stringify({ MediaContainer: { Directory: SECTIONS } }));
      return;
    }

    // ── /library/sections/{key}/all ──────────────────────────────────────────
    const sectionMatch = url.pathname.match(/^\/library\/sections\/(\w+)\/all$/);
    if (sectionMatch) {
      const key = sectionMatch[1];
      const typeParam = url.searchParams.get("type");
      const mapKey = typeParam ? `${key}:type=${typeParam}` : key;
      const totalSize = state.sectionCounts[mapKey] ?? 0;
      res.writeHead(200);
      res.end(JSON.stringify({ MediaContainer: { totalSize } }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, resolve);
    server.once("error", reject);
  });

  return {
    url: `http://localhost:${port}`,
    close(): Promise<void> {
      return new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}
