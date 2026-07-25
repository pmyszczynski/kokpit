import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const releaseTag = "${{ github.event.release.tag_name || inputs.tag }}";

function publishMetadataTags() {
  const workflow = parseDocument(
    readFileSync(resolve(process.cwd(), ".github/workflows/publish.yml"), "utf8"),
  ).toJS();
  const steps = workflow.jobs["build-and-push"].steps;
  const metadataStep = steps.find(
    (step: { uses?: string }) => step.uses === "docker/metadata-action@v6",
  );

  return metadataStep.with.tags as string;
}

describe("Docker publish workflow", () => {
  it("derives version tags from the release tag for manual dispatches", () => {
    const tags = publishMetadataTags();

    expect(tags).toContain(`type=semver,pattern={{version}},value=${releaseTag}`);
    expect(tags).toContain(`type=semver,pattern={{major}}.{{minor}},value=${releaseTag}`);
    expect(tags).toContain(`type=raw,value=${releaseTag}`);
  });
});
