import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const releaseTag = "${{ github.event.release.tag_name || inputs.tag }}";

type Workflow = {
  on: Record<string, unknown>;
  jobs: Record<string, Record<string, unknown>>;
};

type WorkflowStep = {
  name?: string;
  uses?: string;
  with?: Record<string, string>;
  run?: string;
};

function readWorkflow(path: string): Workflow {
  return parseDocument(readFileSync(resolve(process.cwd(), path), "utf8")).toJS() as Workflow;
}

function publishSteps(workflow: Workflow): WorkflowStep[] {
  return workflow.jobs["build-and-push"].steps as WorkflowStep[];
}

function findStep(steps: WorkflowStep[], name: string): WorkflowStep {
  const step = steps.find((candidate) => candidate.name === name);

  if (!step) {
    throw new Error(`Missing workflow step: ${name}`);
  }

  return step;
}

function findMetadataStep(steps: WorkflowStep[]): WorkflowStep {
  const step = steps.find(
    (candidate) => candidate.uses === "docker/metadata-action@v6",
  );

  if (!step) {
    throw new Error("Missing Docker metadata step");
  }

  return step;
}

describe("Docker publish workflow", () => {
  it("derives version tags from the release tag for manual dispatches", () => {
    const publishWorkflow = readWorkflow(".github/workflows/publish.yml");
    const metadataStep = findMetadataStep(publishSteps(publishWorkflow));
    const tags = metadataStep.with?.tags;

    expect(tags).toContain(`type=semver,pattern={{version}},value=${releaseTag}`);
    expect(tags).toContain(`type=semver,pattern={{major}}.{{minor}},value=${releaseTag}`);
    expect(tags).toContain(`type=raw,value=${releaseTag}`);
  });

  it("verifies every expected image tag after publishing", () => {
    const publishWorkflow = readWorkflow(".github/workflows/publish.yml");
    const steps = publishSteps(publishWorkflow);
    const checkoutStep = findStep(steps, "Checkout code");
    const verificationStep = findStep(steps, "Verify published image tags");
    const workflowCall = publishWorkflow.on.workflow_call as {
      inputs?: Record<string, { required?: boolean; type?: string }>;
    };

    expect(workflowCall.inputs?.tag).toMatchObject({ required: true, type: "string" });
    expect(checkoutStep.with?.ref).toBe(releaseTag);
    expect(verificationStep.run).toContain("docker buildx imagetools inspect");
    expect(verificationStep.run).toContain('tags=("$TAG" "$VERSION")');
    expect(verificationStep.run).toContain('tags+=("${VERSION%.*}" latest)');
    expect(verificationStep.run).toContain("for attempt in 1 2 3 4 5 6");
  });
});

describe("Create Release workflow", () => {
  it("waits for Docker publication to complete", () => {
    const releaseWorkflow = readWorkflow(".github/workflows/release.yml");
    const publishJob = releaseWorkflow.jobs.publish;

    expect(publishJob.needs).toBe("release");
    expect(publishJob.uses).toBe("./.github/workflows/publish.yml");
    expect((publishJob.with as Record<string, string>).tag).toBe("v${{ inputs.version }}");
    expect(JSON.stringify(releaseWorkflow)).not.toContain("gh workflow run publish.yml");
  });

  it("marks suffixed versions as GitHub prereleases", () => {
    const releaseWorkflow = readWorkflow(".github/workflows/release.yml");
    const releaseSteps = releaseWorkflow.jobs.release.steps as WorkflowStep[];
    const tagAndReleaseStep = findStep(releaseSteps, "Tag and release");

    expect(tagAndReleaseStep.run).toContain('if [[ "$VERSION" == *-* ]]; then');
    expect(tagAndReleaseStep.run).toContain("RELEASE_FLAGS+=(--prerelease)");
    expect(tagAndReleaseStep.run).toContain('"${RELEASE_FLAGS[@]}"');
  });
});
