import { copyFile, lstat, mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("./fixtures/settings.yaml", import.meta.url));
const runtimeDirectory = resolve(fileURLToPath(new URL("./.runtime/", import.meta.url)));

export async function prepareRuntimeConfig({
  runtimeConfigPath,
  runtimeDirectoryPath = runtimeDirectory,
  sourcePath = source,
}) {
  if (!runtimeConfigPath) {
    throw new Error("KOKPIT_CONFIG_PATH must identify the E2E runtime settings file");
  }

  const isolatedRuntimeDirectory = resolve(runtimeDirectoryPath);
  const expectedRuntimeConfig = resolve(isolatedRuntimeDirectory, "settings.yaml");
  const runtimeConfig = resolve(runtimeConfigPath);

  if (runtimeConfig !== expectedRuntimeConfig) {
    throw new Error(`KOKPIT_CONFIG_PATH must point to ${expectedRuntimeConfig}`);
  }

  await mkdir(isolatedRuntimeDirectory, { recursive: true });
  const runtimeDirectoryStat = await lstat(isolatedRuntimeDirectory);
  if (!runtimeDirectoryStat.isDirectory() || runtimeDirectoryStat.isSymbolicLink()) {
    throw new Error(`E2E runtime directory must be a real directory: ${isolatedRuntimeDirectory}`);
  }

  try {
    const runtimeConfigStat = await lstat(runtimeConfig);
    if (runtimeConfigStat.isSymbolicLink()) {
      throw new Error(`E2E runtime config must not be a symbolic link: ${runtimeConfig}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await copyFile(sourcePath, runtimeConfig);
}

const modulePath = fileURLToPath(import.meta.url);
const canonicalModulePath = await realpath(modulePath);

async function isMainModule() {
  if (!process.argv[1]) return false;

  try {
    return (await realpath(resolve(process.argv[1]))) === canonicalModulePath;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

if (await isMainModule()) {
  await prepareRuntimeConfig({ runtimeConfigPath: process.env.KOKPIT_CONFIG_PATH });
}
