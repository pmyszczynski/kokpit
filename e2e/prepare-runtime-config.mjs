import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("./fixtures/settings.yaml", import.meta.url));
const runtimeConfigPath = process.env.KOKPIT_CONFIG_PATH;

if (!runtimeConfigPath) {
  throw new Error("KOKPIT_CONFIG_PATH must identify the E2E runtime settings file");
}

const runtimeConfig = resolve(runtimeConfigPath);

await mkdir(dirname(runtimeConfig), { recursive: true });
await copyFile(source, runtimeConfig);
