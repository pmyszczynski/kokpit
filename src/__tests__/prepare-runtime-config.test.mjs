// @vitest-environment node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { prepareRuntimeConfig } from "../../e2e/prepare-runtime-config.mjs";

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "kokpit-runtime-config-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

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
