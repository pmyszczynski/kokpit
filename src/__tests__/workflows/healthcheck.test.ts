import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

// The container healthcheck probes the app over loopback. It must target
// 127.0.0.1 explicitly: the Next.js standalone server binds $HOSTNAME
// (0.0.0.0), which is IPv4-only, while Docker's /etc/hosts also maps
// "localhost" to ::1. BusyBox wget uses only the first address the resolver
// returns and never falls back, so a "localhost" probe can be refused on
// [::1]:3000 and mark a healthy container unhealthy.

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

type Compose = {
  services: Record<string, { healthcheck?: { test?: string[] } }>;
};

function readCompose(): Compose {
  return parseDocument(readRepoFile("docker-compose.yml")).toJS() as Compose;
}

function dockerfileHealthcheck(): string {
  const dockerfile = readRepoFile("Dockerfile");
  const line = dockerfile
    .split("\n")
    .find((candidate) => candidate.trimStart().startsWith("CMD wget"));

  if (!line) {
    throw new Error("Missing HEALTHCHECK CMD in Dockerfile");
  }

  return line;
}

describe("container healthcheck", () => {
  it("probes 127.0.0.1 in the Dockerfile, never localhost", () => {
    const command = dockerfileHealthcheck();

    expect(command).toContain("http://127.0.0.1:");
    expect(command).not.toContain("localhost");
  });

  it("honors an overridden PORT in the Dockerfile probe", () => {
    expect(dockerfileHealthcheck()).toContain("${PORT:-3000}");
  });

  it("probes 127.0.0.1 in docker-compose, never localhost", () => {
    const test = readCompose().services.kokpit.healthcheck?.test;

    expect(test).toBeDefined();
    const command = (test as string[]).join(" ");

    expect(command).toContain("http://127.0.0.1:");
    expect(command).not.toContain("localhost");
  });

  it("lets the container shell expand PORT in docker-compose", () => {
    const test = readCompose().services.kokpit.healthcheck?.test as string[];

    // CMD-SHELL is required for expansion, and $$ escapes the variable so
    // Compose passes it through instead of interpolating it at parse time.
    expect(test[0]).toBe("CMD-SHELL");
    expect(test.join(" ")).toContain("$${PORT:-3000}");
  });
});
