import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PhaseScheduler, resumePhaseScheduler } from "./phase-scheduler.js";
import { initState, saveArtifact } from "./state.js";
import type { ResultBlock, Workflow } from "./types.js";

const workflow: Workflow = {
  name: "test-workflow",
  description: "test scheduler workflow",
  phases: [
    {
      name: "design",
      executor: "self",
      prompt: "design it",
      contextFiles: [],
      humanConfirm: false,
    },
    {
      name: "implement",
      executor: "self",
      prompt: "implement it",
      contextFiles: [],
      humanConfirm: false,
    },
  ],
};

const humanWorkflow: Workflow = {
  ...workflow,
  phases: [{ ...workflow.phases[0], humanConfirm: true }, workflow.phases[1]],
};

const resultBlock: ResultBlock = {
  currentWork: "finished design",
  facts: [{ file: "src/a.ts", startLine: 1, endLine: 1, exactText: "export const a = 1;" }],
};

let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "hk-scheduler-"));
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("PhaseScheduler", () => {
  it("starts the current phase without mutating workflow progress", () => {
    const state = initState(workflow, workspaceDir);
    const scheduler = new PhaseScheduler({ workflow, state, workspaceDir });

    const result = scheduler.startCurrentPhase();

    expect(result.ok).toBe(true);
    expect(result.status).toBe("running_phase");
    if (result.ok) {
      expect(result.currentPhase?.name).toBe("design");
    }
    expect(state.currentPhase).toBe(0);
  });

  it("rejects out-of-order phase completion", () => {
    const state = initState(workflow, workspaceDir);
    const scheduler = new PhaseScheduler({ workflow, state, workspaceDir });

    const result = scheduler.submitPhaseResult({
      phaseName: "implement",
      result: resultBlock,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("phase_failed_retryable");
    if (!result.ok) {
      expect(result.expectedPhase).toBe("design");
      expect(result.actualPhase).toBe("implement");
    }
    expect(state.currentPhase).toBe(0);
    expect(state.phases[0].status).toBe("pending");
  });

  it("persists artifact and advances current phase on valid completion", () => {
    const state = initState(workflow, workspaceDir);
    const scheduler = new PhaseScheduler({ workflow, state, workspaceDir });

    const result = scheduler.submitPhaseResult({
      phaseName: "design",
      result: resultBlock,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("phase_completed");
    if (result.ok) {
      expect(result.completedPhase?.name).toBe("design");
      expect(result.nextPhase?.name).toBe("implement");
      expect(result.artifactPath).toBe(".harness-kit/phases/0-design.json");
    }

    const statePath = join(workspaceDir, ".harness-kit", "state.json");
    const persisted = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(persisted.currentPhase).toBe(1);
    expect(persisted.phases[0].status).toBe("completed");
    expect(persisted.phases[0].artifactPath).toBe(".harness-kit/phases/0-design.json");
    expect(existsSync(join(workspaceDir, ".harness-kit", "phases", "0-design.json"))).toBe(true);
  });

  it("persists awaiting human gate after completing a gated phase", () => {
    const state = initState(humanWorkflow, workspaceDir);
    const scheduler = new PhaseScheduler({ workflow: humanWorkflow, state, workspaceDir });

    const result = scheduler.submitPhaseResult({
      phaseName: "design",
      result: resultBlock,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("awaiting_human");
    if (result.ok) {
      expect(result.completedPhase?.name).toBe("design");
      expect(result.nextPhase?.name).toBe("implement");
    }
    expect(state.currentPhase).toBe(1);
    expect(state.awaitingHuman).toMatchObject({
      phaseIndex: 0,
      phaseName: "design",
      nextPhaseIndex: 1,
      nextPhaseName: "implement",
    });

    const persisted = JSON.parse(
      readFileSync(join(workspaceDir, ".harness-kit", "state.json"), "utf-8"),
    );
    expect(persisted.awaitingHuman).toMatchObject({
      phaseIndex: 0,
      phaseName: "design",
      nextPhaseIndex: 1,
      nextPhaseName: "implement",
    });

    const start = scheduler.startCurrentPhase();
    expect(start.ok).toBe(true);
    expect(start.status).toBe("awaiting_human");
  });

  it("clears awaiting human gate after confirmation", () => {
    const state = initState(humanWorkflow, workspaceDir);
    const scheduler = new PhaseScheduler({ workflow: humanWorkflow, state, workspaceDir });

    scheduler.submitPhaseResult({ phaseName: "design", result: resultBlock });
    const confirmed = scheduler.confirmAwaitingHuman({ phaseName: "design" });

    expect(confirmed.ok).toBe(true);
    expect(confirmed.status).toBe("running_phase");
    if (confirmed.ok) {
      expect(confirmed.currentPhase?.name).toBe("implement");
    }
    expect(state.awaitingHuman).toBeUndefined();

    const persisted = JSON.parse(
      readFileSync(join(workspaceDir, ".harness-kit", "state.json"), "utf-8"),
    );
    expect(persisted.awaitingHuman).toBeUndefined();
  });

  it("reports workflow_completed after the final phase", () => {
    const state = initState(workflow, workspaceDir);
    const scheduler = new PhaseScheduler({ workflow, state, workspaceDir });

    scheduler.submitPhaseResult({ phaseName: "design", result: resultBlock });
    const final = scheduler.submitPhaseResult({
      phaseName: "implement",
      result: { ...resultBlock, currentWork: "implemented" },
    });

    expect(final.ok).toBe(true);
    expect(final.status).toBe("workflow_completed");
    if (final.ok) {
      expect(final.nextPhase).toBeUndefined();
    }
    expect(state.currentPhase).toBe(2);
  });

  it("rejects completion after workflow is already complete", () => {
    const state = initState(workflow, workspaceDir);
    const scheduler = new PhaseScheduler({ workflow, state, workspaceDir });

    scheduler.submitPhaseResult({ phaseName: "design", result: resultBlock });
    scheduler.submitPhaseResult({
      phaseName: "implement",
      result: { ...resultBlock, currentWork: "implemented" },
    });

    const extra = scheduler.submitPhaseResult({
      phaseName: "implement",
      result: { ...resultBlock, currentWork: "extra" },
    });

    expect(extra.ok).toBe(false);
    expect(extra.status).toBe("failed");
    expect(scheduler.status).toBe("failed");
    expect(state.currentPhase).toBe(2);
  });

  it("rolls back in-memory state when saveState fails", () => {
    const state = initState(workflow, workspaceDir);
    const scheduler = new PhaseScheduler({
      workflow,
      state,
      workspaceDir,
      persistence: {
        saveState: () => {
          throw new Error("disk full");
        },
      },
    });

    expect(() =>
      scheduler.submitPhaseResult({
        phaseName: "design",
        result: resultBlock,
      }),
    ).toThrow("disk full");

    expect(state.currentPhase).toBe(0);
    expect(state.phases[0].status).toBe("pending");
    expect(state.phases[0].completedAt).toBeUndefined();
    expect(state.phases[0].artifactPath).toBeUndefined();
  });

  it("marks scheduler failed when artifact persistence fails", () => {
    const state = initState(workflow, workspaceDir);
    const scheduler = new PhaseScheduler({
      workflow,
      state,
      workspaceDir,
      persistence: {
        saveArtifact: () => {
          throw new Error("artifact write failed");
        },
      },
    });

    expect(() =>
      scheduler.submitPhaseResult({
        phaseName: "design",
        result: resultBlock,
      }),
    ).toThrow("artifact write failed");

    expect(scheduler.status).toBe("failed");
    expect(state.currentPhase).toBe(0);
    expect(state.phases[0].status).toBe("pending");
  });

  it("records retryable phase failure without advancing", () => {
    const state = initState(workflow, workspaceDir);
    const scheduler = new PhaseScheduler({ workflow, state, workspaceDir });

    const result = scheduler.failCurrentPhase("verification failed");

    expect(result.ok).toBe(false);
    expect(result.status).toBe("phase_failed_retryable");
    if (!result.ok) {
      expect(result.reason).toBe("verification failed");
      expect(result.expectedPhase).toBe("design");
    }
    expect(state.currentPhase).toBe(0);
  });

  it("records non-retryable failure when failing after workflow completion", () => {
    const state = initState(workflow, workspaceDir);
    const scheduler = new PhaseScheduler({ workflow, state, workspaceDir });

    scheduler.submitPhaseResult({ phaseName: "design", result: resultBlock });
    scheduler.submitPhaseResult({
      phaseName: "implement",
      result: { ...resultBlock, currentWork: "implemented" },
    });

    const result = scheduler.failCurrentPhase("late failure");

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(scheduler.status).toBe("failed");
    if (!result.ok) {
      expect(result.reason).toBe("late failure");
      expect(result.expectedPhase).toBeUndefined();
    }
    expect(state.currentPhase).toBe(2);
  });
});

describe("resumePhaseScheduler", () => {
  it("resumes from completed artifacts on disk", () => {
    saveArtifact(0, "design", resultBlock, workspaceDir);

    const scheduler = resumePhaseScheduler({ workflow, workspaceDir });
    const phase = scheduler.getCurrentPhase();

    expect(scheduler.state.currentPhase).toBe(1);
    expect(phase?.name).toBe("implement");
    expect(scheduler.state.phases[0].status).toBe("completed");
  });

  it("preserves awaiting human gate when reconciling from disk", () => {
    const state = initState(humanWorkflow, workspaceDir);
    const scheduler = new PhaseScheduler({ workflow: humanWorkflow, state, workspaceDir });

    scheduler.submitPhaseResult({ phaseName: "design", result: resultBlock });

    const resumed = resumePhaseScheduler({ workflow: humanWorkflow, workspaceDir });
    const start = resumed.startCurrentPhase();

    expect(resumed.state.currentPhase).toBe(1);
    expect(resumed.state.awaitingHuman).toMatchObject({
      phaseIndex: 0,
      phaseName: "design",
      nextPhaseIndex: 1,
      nextPhaseName: "implement",
    });
    expect(start.ok).toBe(true);
    expect(start.status).toBe("awaiting_human");
  });
});
