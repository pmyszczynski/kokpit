import type { NextConfig } from "next";
import { createRequire } from "node:module";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

// Turbopack omits jsdom's form-data dependency tree from standalone output.
// Follow installed manifests so dependency updates do not leave a stale list.
function runtimePackageFiles(name: string): string[] {
  const packages = new Set<string>();
  function visit(packageName: string, resolveFrom: NodeRequire) {
    let manifest: string;
    try { manifest = resolveFrom.resolve(`${packageName}/package.json`); }
    catch {
      // Some packages export their entry point but keep package.json private.
      let directory = path.dirname(resolveFrom.resolve(packageName));
      for (;;) {
        const candidate = path.join(directory, "package.json");
        if (existsSync(candidate) && JSON.parse(readFileSync(candidate, "utf8")).name === packageName) { manifest = candidate; break; }
        const parent = path.dirname(directory);
        if (parent === directory) throw new Error(`Cannot locate runtime package ${packageName}`);
        directory = parent;
      }
    }
    if (packages.has(manifest)) return;
    packages.add(manifest);
    const { dependencies = {} } = resolveFrom(manifest) as {
      dependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys(dependencies)) {
      visit(dependency, createRequire(manifest));
    }
  }
  visit(name, createRequire(path.join(process.cwd(), "package.json")));
  return [...packages].map((manifest) =>
    `${path.relative(process.cwd(), path.dirname(manifest)).split(path.sep).join("/")}/**/*`
  );
}

const appVersion = (JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string }).version;

const nextConfig: NextConfig = {
  env: { KOKPIT_BUILD_VERSION: appVersion },
  output: "standalone",
  outputFileTracingIncludes: {
    // Keep aligned with the static Worker paths in Calendar and RSS. The RSS
    // worker requires its own full jsdom dependency tree at runtime.
    "/api/*": [...runtimePackageFiles("jsdom"), ...runtimePackageFiles("node-ical"), "./src/integrations/calendar/parser.cjs", "./src/integrations/rss/parser.cjs"],
    // Operational CLI entry points are not imported by app routes. Keep the
    // emergency reset command available in standalone and Docker deployments.
    "/api/auth/login": ["./scripts/reset-password.js", "./node_modules/bcryptjs/**/*"],
  },
  // Runtime state is mounted under /data in production. Never copy a
  // developer's local config, database, or session secret into the image.
  outputFileTracingExcludes: {
    "/*": ["./settings.yaml", "./data/**/*", "./data/.session_secret"],
  },
};

export default nextConfig;
