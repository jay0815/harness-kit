import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createCompletePhaseTool, createConfirmPhaseTool } from "./phase-tool.js";
import { snapshotWorkspace, type WorkspaceSnapshot } from "./guardrails.js";
import { initState } from "./state.js";
import type { HarnessState, ResultBlock, Workflow } from "./types.js";

const workflow: Workflow = {
  name: "tool-workflow",
  description: "complete phase tool workflow",
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

let workspaceDir: string;
let state: HarnessState;
let phaseSnapshot: WorkspaceSnapshot | null;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "hk-complete-phase-"));
  state = initState(workflow, workspaceDir);
  phaseSnapshot = snapshotWorkspace(workspaceDir);
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

function writeWorkspaceFile(path: string, content: string): void {
  const fullPath = join(workspaceDir, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

function makeResultBlock(overrides?: Partial<ResultBlock>): ResultBlock {
  return {
    currentWork: "completed design",
    facts: [
      {
        file: "src/a.ts",
        startLine: 1,
        endLine: 1,
        exactText: "export const a = 1;",
      },
    ],
    ...overrides,
  };
}

function makeTool() {
  return createCompletePhaseTool({
    workflow,
    getState: () => state,
    getWorkspaceDir: () => workspaceDir,
    getPhaseSnapshot: () => phaseSnapshot,
    setPhaseSnapshot: (next) => {
      phaseSnapshot = next;
    },
  });
}

describe("complete_phase tool", () => {
  it("verifies facts, saves artifact, and advances to the next phase", async () => {
    writeWorkspaceFile("src/a.ts", "export const a = 1;\n");
    const tool = makeTool();

    const result = await tool.execute(
      "tc-1",
      { phaseName: "design", result: makeResultBlock() },
      undefined,
      undefined,
      { cwd: workspaceDir, shutdown: () => {} },
    );

    expect(result.isError).toBeUndefined();
    expect(result.details).toMatchObject({
      status: "PHASE_COMPLETED",
      completedPhase: "design",
      nextPhase: "implement",
    });
    expect(state.currentPhase).toBe(1);

    const savedState = JSON.parse(
      readFileSync(join(workspaceDir, ".harness-kit", "state.json"), "utf-8"),
    );
    expect(savedState.currentPhase).toBe(1);
    expect(savedState.phases[0].artifactPath).toBe(".harness-kit/phases/0-design.json");
  });

  it("reports workflow completion after the final phase", async () => {
    const singlePhaseWorkflow: Workflow = {
      name: "single",
      description: "single phase",
      phases: [
        {
          name: "design",
          executor: "self",
          prompt: "design it",
          contextFiles: [],
          humanConfirm: false,
        },
      ],
    };
    state = initState(singlePhaseWorkflow, workspaceDir);
    phaseSnapshot = snapshotWorkspace(workspaceDir);
    writeWorkspaceFile("src/a.ts", "export const a = 1;\n");

    const tool = createCompletePhaseTool({
      workflow: singlePhaseWorkflow,
      getState: () => state,
      getWorkspaceDir: () => workspaceDir,
      getPhaseSnapshot: () => phaseSnapshot,
      setPhaseSnapshot: (next) => {
        phaseSnapshot = next;
      },
    });

    const result = await tool.execute(
      "tc-final",
      { phaseName: "design", result: makeResultBlock() },
      undefined,
      undefined,
      { cwd: workspaceDir, shutdown: () => {} },
    );

    expect(result.isError).toBeUndefined();
    expect(result.details).toMatchObject({
      status: "WORKFLOW_COMPLETED",
      completedPhase: "design",
    });
    expect(state.currentPhase).toBe(1);
  });

  it("returns awaiting human when completed phase requires confirmation", async () => {
    const humanWorkflow: Workflow = {
      ...workflow,
      phases: [{ ...workflow.phases[0], humanConfirm: true }, workflow.phases[1]],
    };
    state = initState(humanWorkflow, workspaceDir);
    phaseSnapshot = snapshotWorkspace(workspaceDir);
    writeWorkspaceFile("src/a.ts", "export const a = 1;\n");

    const tool = createCompletePhaseTool({
      workflow: humanWorkflow,
      getState: () => state,
      getWorkspaceDir: () => workspaceDir,
      getPhaseSnapshot: () => phaseSnapshot,
      setPhaseSnapshot: (next) => {
        phaseSnapshot = next;
      },
    });

    const result = await tool.execute(
      "tc-human",
      { phaseName: "design", result: makeResultBlock() },
      undefined,
      undefined,
      { cwd: workspaceDir, shutdown: () => {} },
    );

    expect(result.isError).toBeUndefined();
    expect(result.details).toMatchObject({
      status: "AWAITING_HUMAN",
      completedPhase: "design",
      nextPhase: "implement",
    });
    expect(state.currentPhase).toBe(1);
    expect(state.awaitingHuman).toMatchObject({
      phaseIndex: 0,
      phaseName: "design",
      nextPhaseIndex: 1,
      nextPhaseName: "implement",
    });

    const savedState = JSON.parse(
      readFileSync(join(workspaceDir, ".harness-kit", "state.json"), "utf-8"),
    );
    expect(savedState.awaitingHuman).toMatchObject({
      phaseIndex: 0,
      phaseName: "design",
      nextPhaseIndex: 1,
      nextPhaseName: "implement",
    });
  });

  it("clears awaiting human and returns the next phase after confirmation", async () => {
    const humanWorkflow: Workflow = {
      ...workflow,
      phases: [{ ...workflow.phases[0], humanConfirm: true }, workflow.phases[1]],
    };
    state = initState(humanWorkflow, workspaceDir);
    phaseSnapshot = snapshotWorkspace(workspaceDir);
    writeWorkspaceFile("src/a.ts", "export const a = 1;\n");

    const completeTool = createCompletePhaseTool({
      workflow: humanWorkflow,
      getState: () => state,
      getWorkspaceDir: () => workspaceDir,
      getPhaseSnapshot: () => phaseSnapshot,
      setPhaseSnapshot: (next) => {
        phaseSnapshot = next;
      },
    });
    await completeTool.execute(
      "tc-human",
      { phaseName: "design", result: makeResultBlock() },
      undefined,
      undefined,
      { cwd: workspaceDir, shutdown: () => {} },
    );

    const confirmTool = createConfirmPhaseTool({
      workflow: humanWorkflow,
      getState: () => state,
      getWorkspaceDir: () => workspaceDir,
    });
    const result = await confirmTool.execute(
      "tc-confirm",
      { phaseName: "design" },
      undefined,
      undefined,
      { cwd: workspaceDir, shutdown: () => {} },
    );

    expect(result.isError).toBeUndefined();
    expect(result.details).toMatchObject({
      status: "HUMAN_CONFIRMED",
      completedPhase: "design",
      nextPhase: "implement",
      nextPrompt: "implement it",
    });
    expect(state.awaitingHuman).toBeUndefined();

    const savedState = JSON.parse(
      readFileSync(join(workspaceDir, ".harness-kit", "state.json"), "utf-8"),
    );
    expect(savedState.awaitingHuman).toBeUndefined();
  });

  it("rejects out-of-order phase completion without advancing", async () => {
    writeWorkspaceFile("src/a.ts", "export const a = 1;\n");
    const tool = makeTool();

    const result = await tool.execute(
      "tc-2",
      { phaseName: "implement", result: makeResultBlock() },
      undefined,
      undefined,
      { cwd: workspaceDir, shutdown: () => {} },
    );

    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({
      status: "PHASE_REJECTED",
      expectedPhase: "design",
      actualPhase: "implement",
    });
    expect(state.currentPhase).toBe(0);
  });

  it("rejects failed fact verification without advancing", async () => {
    writeWorkspaceFile("src/a.ts", "export const a = 1;\n");
    const tool = makeTool();

    const result = await tool.execute(
      "tc-3",
      {
        phaseName: "design",
        result: makeResultBlock({
          facts: [{ file: "src/a.ts", startLine: 1, endLine: 1, exactText: "wrong" }],
        }),
      },
      undefined,
      undefined,
      { cwd: workspaceDir, shutdown: () => {} },
    );

    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ status: "VERIFY_FAILED" });
    expect(state.currentPhase).toBe(0);
  });

  it("blocks out-of-scope file changes without advancing", async () => {
    writeWorkspaceFile("src/a.ts", "export const a = 1;\n");
    writeWorkspaceFile("src/secret.ts", "export const secret = 1;\n");
    const tool = makeTool();

    const result = await tool.execute(
      "tc-4",
      { phaseName: "design", result: makeResultBlock() },
      undefined,
      undefined,
      { cwd: workspaceDir, shutdown: () => {} },
    );

    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({
      status: "OUT_OF_SCOPE",
      files: ["src/secret.ts"],
    });
    expect(state.currentPhase).toBe(0);
  });
});
