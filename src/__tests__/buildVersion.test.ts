// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("build version metadata", () => {
  it("inlines only the package version and ignores runtime overrides in a direct Node artifact", () => {
    const packageVersion = (JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string }).version;
    const configuredVersion = nextConfig.env?.KOKPIT_BUILD_VERSION;
    expect(configuredVersion).toBe(packageVersion);
    const result = buildSync({
      entryPoints: [path.resolve("src/lib/buildVersion.server.ts")], bundle: true,
      platform: "node", format: "cjs", write: false, metafile: true,
      define: { "process.env.KOKPIT_BUILD_VERSION": JSON.stringify(configuredVersion) },
    });
    expect(Object.keys(result.metafile!.inputs)).toEqual(["src/lib/buildVersion.server.ts"]);
    const code = result.outputFiles[0].text;
    expect(code).not.toContain("npm_package_version");
    expect(code).not.toMatch(/devDependencies|dependencies|scripts/);
    const output = execFileSync(process.execPath, ["-e", `${code}\nconsole.log(module.exports.BUILD_VERSION);`], {
      encoding: "utf8", env: { ...process.env, npm_package_version: "999.0.0-runtime", KOKPIT_BUILD_VERSION: "999.0.0-runtime" },
    });
    expect(output.trim()).toBe(packageVersion);
  });
});
