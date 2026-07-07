import { z } from "zod";
import type http from "node:http";

export interface DockerConfig {
  socket_path?: string;
  max_items?: number;
}

export const DockerConfigSchema = z.object({
  socket_path: z.string().min(1).optional(),
  max_items: z.number().int().min(1).max(50).default(10),
});

// Narrow view of the Docker Engine API container object — unknown fields are
// stripped so raw payloads never travel beyond this module.
const ContainerSchema = z.object({
  Id: z.string(),
  Names: z.array(z.string()).default([]),
  Image: z.string().default(""),
  State: z.string(),
  Status: z.string().default(""),
});

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export interface DockerData {
  running: number;
  total: number;
  containers: DockerContainer[];
}

const DEFAULT_SOCKET_PATH = "/var/run/docker.sock";
const REQUEST_TIMEOUT_MS = 3000;

/** States that appear in the widget list ("up" in some form). */
const LISTED_STATES = new Set(["running", "paused", "restarting"]);

export function resolveSocketPath(config: {
  socket_path?: string;
}): string {
  return (
    config.socket_path ??
    process.env.KOKPIT_DOCKER_SOCKET ??
    DEFAULT_SOCKET_PATH
  );
}

// node:http is looked up at call time instead of statically imported:
// integration modules are also bundled for the browser (WidgetRenderer
// registers them client-side), where fetchData is never invoked.
function getHttp(): typeof http {
  if (typeof process.getBuiltinModule !== "function") {
    throw new Error("Docker data can only be fetched server-side");
  }
  return process.getBuiltinModule("node:http");
}

function describeError(err: NodeJS.ErrnoException, socketPath: string): string {
  switch (err.code) {
    case "ENOENT":
      return `Docker socket not found at ${socketPath} — is it mounted into the container?`;
    case "EACCES":
      return `Permission denied reading Docker socket at ${socketPath} — see the README`;
    case "ECONNREFUSED":
      return `Docker socket at ${socketPath} refused the connection`;
    default:
      return err.message || "Docker API request failed";
  }
}

function requestJson(
  socketPath: string,
  path: string,
  signal?: AbortSignal
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = getHttp().request(
      { socketPath, path, method: "GET", signal },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          })
        );
        res.on("error", reject);
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("Docker API request timed out"));
    });
    req.on("error", (err) => {
      reject(new Error(describeError(err as NodeJS.ErrnoException, socketPath)));
    });
    req.end();
  });
}

export async function fetchDockerData(
  config: DockerConfig,
  signal?: AbortSignal
): Promise<DockerData> {
  const socketPath = resolveSocketPath(config);
  const maxItems = config.max_items ?? 10;

  const { status, body } = await requestJson(
    socketPath,
    "/v1.41/containers/json?all=1",
    signal
  );
  if (status !== 200) {
    throw new Error(`Docker API responded with ${status}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("Docker API returned invalid JSON");
  }
  const parsed = z.array(ContainerSchema).safeParse(payload);
  if (!parsed.success) {
    throw new Error("Unexpected Docker API response shape");
  }

  const all = parsed.data.map((c) => ({
    id: c.Id.slice(0, 12),
    name: c.Names[0]?.replace(/^\//, "") || c.Id.slice(0, 12),
    image: c.Image,
    state: c.State,
    status: c.Status,
  }));

  const listed = all
    .filter((c) => LISTED_STATES.has(c.state))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    running: all.filter((c) => c.state === "running").length,
    total: all.length,
    containers: listed.slice(0, maxItems),
  };
}
