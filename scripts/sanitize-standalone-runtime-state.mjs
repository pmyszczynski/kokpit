import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const nextDir = path.join(projectRoot, ".next");
const settingsPath = path.join(projectRoot, "settings.yaml");
const dataDir = path.join(projectRoot, "data");

function isRuntimeState(target) {
  if (target === settingsPath) return true;
  const relativeToData = path.relative(dataDir, target);
  return relativeToData === "" || (!relativeToData.startsWith("..") && !path.isAbsolute(relativeToData));
}

function traceFiles(directory) {
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...traceFiles(target));
    else if (entry.name.endsWith(".nft.json")) results.push(target);
  }
  return results;
}

for (const tracePath of traceFiles(nextDir)) {
  const trace = JSON.parse(readFileSync(tracePath, "utf-8"));
  if (!Array.isArray(trace.files)) continue;
  const keptIndexes = trace.files.flatMap((file, index) =>
    isRuntimeState(path.resolve(path.dirname(tracePath), file)) ? [] : [index]
  );
  if (keptIndexes.length !== trace.files.length) {
    trace.files = keptIndexes.map((index) => trace.files[index]);
    // Next 16 emits a parallel hash for every traced file.
    if (Array.isArray(trace.fileHashes)) {
      trace.fileHashes = keptIndexes.map((index) => trace.fileHashes[index]);
    }
    writeFileSync(tracePath, JSON.stringify(trace));
  }
}

const standaloneRoot = path.join(nextDir, "standalone");
if (statSync(standaloneRoot, { throwIfNoEntry: false })?.isDirectory()) {
  rmSync(path.join(standaloneRoot, "settings.yaml"), { force: true });
  rmSync(path.join(standaloneRoot, "data"), { recursive: true, force: true });
}
