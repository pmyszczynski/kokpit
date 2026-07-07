// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearApiVersionCache,
  DockerConfigSchema,
  fetchDockerData,
  resolveSocketPath,
} from "../../integrations/docker/api";

// Unix socket paths must stay under the ~104-char sockaddr limit, so the
// fixture socket lives in os.tmpdir() rather than any deeper directory.
const socketDir = mkdtempSync(path.join(tmpdir(), "kokpit-docker-"));
const SOCKET_PATH = path.join(socketDir, "docker.sock");

const FIXTURE_CONTAINERS = [
  {
    Id: "b1946ac92492d2347c6235b4d2611184f0e8a1c8d3f5b7a9c0e2d4f6a8b0c2d4",
    Names: ["/plex"],
    Image: "linuxserver/plex:latest",
    State: "running",
    Status: "Up 3 days",
    ExtraField: "ignored",
  },
  {
    Id: "a2857bd83583c3458d7346c5e3722295f1f9b2d9e4a6c8b0d1f3e5a7b9c1d3e5",
    Names: ["/kokpit", "/kokpit-alias"],
    Image: "ghcr.io/pmyszczynski/kokpit:latest",
    State: "running",
    Status: "Up 2 hours",
  },
  {
    Id: "c3968ce94694d4569e8457d6f4833306a2aac3eaf5b7d9c1e2a4f6b8d0e2f4a6",
    Names: ["/backup-job"],
    Image: "alpine:3",
    State: "exited",
    Status: "Exited (0) 5 hours ago",
  },
  {
    Id: "d4a79df05705e567af9568e7a5944417b3bbd4fba6c8ead2f3b5a7c9e1f3a5b7",
    Names: ["/adguard"],
    Image: "adguard/adguardhome",
    State: "paused",
    Status: "Up 1 day (Paused)",
  },
];

let server: http.Server;
let respondWith: (req: http.IncomingMessage, res: http.ServerResponse) => void;
let requestedPaths: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requestedPaths.push(req.url ?? "");
    respondWith(req, res);
  });
  await new Promise<void>((resolve) => server.listen(SOCKET_PATH, resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(socketDir, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.KOKPIT_DOCKER_SOCKET;
  clearApiVersionCache();
  requestedPaths = [];
});

/** Serves payload on every path; /_ping gets no Api-Version header. */
function serveJson(payload: unknown, status = 200) {
  respondWith = (_req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };
}

/** Emulates a real daemon: /_ping reports apiVersion, containers are versioned. */
function serveDocker(payload: unknown, apiVersion: string) {
  respondWith = (req, res) => {
    if (req.url === "/_ping") {
      res.writeHead(200, { "Api-Version": apiVersion });
      res.end("OK");
    } else if (req.url === `/v${apiVersion}/containers/json?all=1`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    } else {
      res.writeHead(404);
      res.end();
    }
  };
}

describe("DockerConfigSchema", () => {
  it("accepts an empty config and applies defaults", () => {
    const parsed = DockerConfigSchema.parse({});
    expect(parsed.max_items).toBe(10);
    expect(parsed.socket_path).toBeUndefined();
  });

  it("rejects out-of-range max_items", () => {
    expect(DockerConfigSchema.safeParse({ max_items: 0 }).success).toBe(false);
    expect(DockerConfigSchema.safeParse({ max_items: 51 }).success).toBe(false);
  });
});

describe("resolveSocketPath", () => {
  it("prefers explicit config over the env var and default", () => {
    process.env.KOKPIT_DOCKER_SOCKET = "/env/docker.sock";
    expect(resolveSocketPath({ socket_path: "/cfg/docker.sock" })).toBe(
      "/cfg/docker.sock"
    );
  });

  it("falls back to KOKPIT_DOCKER_SOCKET, then the default path", () => {
    process.env.KOKPIT_DOCKER_SOCKET = "/env/docker.sock";
    expect(resolveSocketPath({})).toBe("/env/docker.sock");
    delete process.env.KOKPIT_DOCKER_SOCKET;
    expect(resolveSocketPath({})).toBe("/var/run/docker.sock");
  });
});

describe("fetchDockerData", () => {
  it("maps, filters, and sorts containers", async () => {
    serveJson(FIXTURE_CONTAINERS);
    const data = await fetchDockerData({ socket_path: SOCKET_PATH });

    expect(data.total).toBe(4);
    expect(data.running).toBe(2); // exited and paused don't count as running
    // exited container is not listed; the rest are sorted by name
    expect(data.containers.map((c) => c.name)).toEqual([
      "adguard",
      "kokpit",
      "plex",
    ]);
    const plex = data.containers.find((c) => c.name === "plex");
    expect(plex).toMatchObject({
      id: "b1946ac92492",
      image: "linuxserver/plex:latest",
      state: "running",
      status: "Up 3 days",
    });
    // unknown fields from the Docker payload are stripped
    expect(Object.keys(plex!).sort()).toEqual([
      "id",
      "image",
      "name",
      "state",
      "status",
    ]);
  });

  it("caps the list at max_items but keeps full counts", async () => {
    serveJson(FIXTURE_CONTAINERS);
    const data = await fetchDockerData({
      socket_path: SOCKET_PATH,
      max_items: 1,
    });
    expect(data.containers).toHaveLength(1);
    expect(data.containers[0].name).toBe("adguard");
    expect(data.total).toBe(4);
    expect(data.running).toBe(2);
  });

  it("uses KOKPIT_DOCKER_SOCKET when config omits socket_path", async () => {
    serveJson(FIXTURE_CONTAINERS);
    process.env.KOKPIT_DOCKER_SOCKET = SOCKET_PATH;
    const data = await fetchDockerData({});
    expect(data.total).toBe(4);
  });

  it("reports a missing socket with an actionable message", async () => {
    await expect(
      fetchDockerData({ socket_path: path.join(socketDir, "nope.sock") })
    ).rejects.toThrow(/socket not found .* mounted/i);
  });

  it("rejects on a non-200 Docker API response", async () => {
    serveJson({ message: "server error" }, 500);
    await expect(
      fetchDockerData({ socket_path: SOCKET_PATH })
    ).rejects.toThrow(/responded with 500/);
  });

  it("rejects on invalid JSON", async () => {
    respondWith = (_req, res) => {
      res.writeHead(200);
      res.end("not json");
    };
    await expect(
      fetchDockerData({ socket_path: SOCKET_PATH })
    ).rejects.toThrow(/invalid JSON/i);
  });

  it("rejects on an unexpected payload shape", async () => {
    serveJson({ not: "an array" });
    await expect(
      fetchDockerData({ socket_path: SOCKET_PATH })
    ).rejects.toThrow(/unexpected .* shape/i);
  });

  it("negotiates the API version from /_ping and pins requests to it", async () => {
    serveDocker(FIXTURE_CONTAINERS, "1.51");
    const data = await fetchDockerData({ socket_path: SOCKET_PATH });
    expect(data.total).toBe(4);
    expect(requestedPaths).toEqual([
      "/_ping",
      "/v1.51/containers/json?all=1",
    ]);
  });

  it("caches the negotiated API version across fetches", async () => {
    serveDocker(FIXTURE_CONTAINERS, "1.51");
    await fetchDockerData({ socket_path: SOCKET_PATH });
    await fetchDockerData({ socket_path: SOCKET_PATH });
    const pings = requestedPaths.filter((p) => p === "/_ping");
    expect(pings).toHaveLength(1);
  });

  it("falls back to API version 1.44 when /_ping reports none", async () => {
    serveJson(FIXTURE_CONTAINERS);
    await fetchDockerData({ socket_path: SOCKET_PATH });
    expect(requestedPaths).toContain("/v1.44/containers/json?all=1");
  });

  it("rejects promptly when the abort signal fires", async () => {
    respondWith = () => {
      /* never respond */
    };
    const ac = new AbortController();
    const pending = fetchDockerData(
      { socket_path: SOCKET_PATH },
      ac.signal
    );
    ac.abort();
    await expect(pending).rejects.toThrow();
  });
});
