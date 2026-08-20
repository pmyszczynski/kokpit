import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("./fixtures/settings.yaml", import.meta.url));
const runtimeConfig = fileURLToPath(new URL("./.runtime/settings.yaml", import.meta.url));

await mkdir(dirname(runtimeConfig), { recursive: true });
await copyFile(source, runtimeConfig);
