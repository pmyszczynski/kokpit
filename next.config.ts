import type { NextConfig } from "next";
import { createRequire } from "node:module";
import path from "node:path";

// Turbopack omits jsdom's form-data dependency tree from standalone output.
// Follow installed manifests so dependency updates do not leave a stale list.
function runtimePackageFiles(name: string): string[] {
  const packages = new Set<string>();
  function visit(packageName: string, resolveFrom: NodeRequire) {
    const manifest = resolveFrom.resolve(`${packageName}/package.json`);
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

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/*": runtimePackageFiles("form-data"),
  },
  // Runtime state is mounted under /data in production. Never copy a
  // developer's local config, database, or session secret into the image.
  outputFileTracingExcludes: {
    "/*": ["./settings.yaml", "./data/**/*", "./data/.session_secret"],
  },
};

export default nextConfig;
