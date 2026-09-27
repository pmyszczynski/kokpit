// @vitest-environment node
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { prepareRuntimeConfig } from "../../e2e/prepare-runtime-config.mjs";

const prepareRuntimeConfigModule = new URL("../../e2e/prepare-runtime-config.mjs", import.meta.url).href;
const execFile = promisify(execFileCallback);

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "kokpit-runtime-config-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("copies the source into the isolated runtime config", async () => {
  await withTemporaryDirectory(async (directory) => {
    const sourcePath = join(directory, "source.yaml");
    const runtimeDirectoryPath = join(directory, "runtime");
    const runtimeConfigPath = join(runtimeDirectoryPath, "settings.yaml");
    await writeFile(sourcePath, "copied content");

    await prepareRuntimeConfig({ runtimeConfigPath, runtimeDirectoryPath, sourcePath });

    assert.equal(await readFile(runtimeConfigPath, "utf8"), "copied content");
  });
});

test("does not run when imported by a runner with a stale argv path", async () => {
  await withTemporaryDirectory(async (directory) => {
    const missingArgvPath = join(directory, "stale-runner-entry.mjs");
    await execFile(process.execPath, [
      "--input-type=module",
      "--eval",
      `process.argv[1] = ${JSON.stringify(missingArgvPath)}; await import(${JSON.stringify(prepareRuntimeConfigModule)});`,
    ], { env: { ...process.env, KOKPIT_CONFIG_PATH: "" } });
  });
});

test("refuses a symlinked runtime directory without overwriting its target", async () => {
  await withTemporaryDirectory(async (directory) => {
    const sourcePath = join(directory, "source.yaml");
    const victimDirectory = join(directory, "victim");
    const runtimeDirectoryPath = join(directory, "runtime");
    const victimConfigPath = join(victimDirectory, "settings.yaml");
    await writeFile(sourcePath, "replacement");
    await mkdir(victimDirectory);
    await writeFile(victimConfigPath, "preserve me");
    await symlink(victimDirectory, runtimeDirectoryPath);

    await assert.rejects(
      prepareRuntimeConfig({
        runtimeConfigPath: join(runtimeDirectoryPath, "settings.yaml"),
        runtimeDirectoryPath,
        sourcePath,
      }),
      /runtime directory must be a real directory/
    );

    assert.equal(await readFile(victimConfigPath, "utf8"), "preserve me");
  });
});

test("refuses an existing config-file symlink without overwriting its target", async () => {
  await withTemporaryDirectory(async (directory) => {
    const sourcePath = join(directory, "source.yaml");
    const runtimeDirectoryPath = join(directory, "runtime");
    const victimConfigPath = join(directory, "victim.yaml");
    const runtimeConfigPath = join(runtimeDirectoryPath, "settings.yaml");
    await writeFile(sourcePath, "replacement");
    await mkdir(runtimeDirectoryPath);
    await writeFile(victimConfigPath, "preserve me");
    await symlink(victimConfigPath, runtimeConfigPath);

    await assert.rejects(
      prepareRuntimeConfig({ runtimeConfigPath, runtimeDirectoryPath, sourcePath }),
      /runtime config must not be a symbolic link/
    );

    assert.equal(await readFile(victimConfigPath, "utf8"), "preserve me");
  });
});

test("refuses a config path outside the runtime directory without writing to it", async () => {
  await withTemporaryDirectory(async (directory) => {
    const sourcePath = join(directory, "source.yaml");
    const runtimeDirectoryPath = join(directory, "runtime");
    const unsafeConfigPath = join(directory, "settings.yaml");
    await writeFile(sourcePath, "replacement");
    await writeFile(unsafeConfigPath, "preserve me");

    await assert.rejects(
      prepareRuntimeConfig({
        runtimeConfigPath: unsafeConfigPath,
        runtimeDirectoryPath,
        sourcePath,
      }),
      /KOKPIT_CONFIG_PATH must point to/
    );

    assert.equal(await readFile(unsafeConfigPath, "utf8"), "preserve me");
  });
});
