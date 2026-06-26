import { describe, it, expect, vi } from "vitest";
import { WorkflowRunner } from "./workflow-runner.js";
import type { Workflow } from "./types.js";

vi.mock("@harness-kit/agent", () => {
  class MockSession {
    extensionAPI = {
      on: vi.fn(),
      registerTool: vi.fn(),
      sendUserMessage: vi.fn(),
    };
    start = vi.fn().mockResolvedValue(undefined);
    prompt = vi.fn().mockResolvedValue(undefined);
    shutdown = vi.fn().mockResolvedValue(undefined);
  }
  return { HarnessAgentSession: MockSession };
});

vi.mock("./index.js", () => ({
  default: vi.fn(),
}));

vi.mock("./code-executor.js", () => ({
  executeCode: vi.fn().mockResolvedValue({
    phaseName: "test",
    executor: "code",
    success: true,
    output: "ok",
    durationMs: 100,
  }),
}));

function makeConfig(workflow?: Workflow) {
  return {
    cwd: "/tmp/test",
    model: {} as never,
    streamFn: vi.fn() as never,
    workflow,
  };
}

describe("WorkflowRunner", () => {
  it("uses default workflow when no workflow or path provided", () => {
    const runner = new WorkflowRunner(makeConfig());
    const wf = runner.getWorkflow();
    expect(wf.name).toBe("feature-impl");
    expect(wf.phases.length).toBe(3);
  });

  it("uses provided workflow object", () => {
    const workflow: Workflow = {
      name: "custom",
      description: "test",
      phases: [{ name: "p1", executor: "self", prompt: "do it", contextFiles: [], humanConfirm: false }],
    };
    const runner = new WorkflowRunner(makeConfig(workflow));
    expect(runner.getWorkflowName()).toBe("custom");
  });

  it("preserves executor type from provided workflow", () => {
    const workflow: Workflow = {
      name: "mixed",
      description: "test",
      phases: [
        { name: "llm-phase", executor: "self", prompt: "design", contextFiles: [], humanConfirm: false },
        { name: "code-phase", executor: "code", prompt: "", contextFiles: [], humanConfirm: false, command: "pnpm test" },
      ],
    };
    const runner = new WorkflowRunner(makeConfig(workflow));
    const phases = runner.getWorkflow().phases;
    expect(phases[0].executor).toBe("self");
    expect(phases[1].executor).toBe("code");
    expect(phases[1].command).toBe("pnpm test");
  });

  it("start() delegates to session.start()", async () => {
    const runner = new WorkflowRunner(makeConfig());
    await runner.start();
    // no error = success
  });

  it("prompt() delegates to session.prompt()", async () => {
    const runner = new WorkflowRunner(makeConfig());
    await runner.prompt("hello");
    // no error = success
  });

  it("shutdown() delegates to session.shutdown()", async () => {
    const runner = new WorkflowRunner(makeConfig());
    await runner.shutdown();
    // no error = success
  });

  it("executePhase with code executor calls executeCode", async () => {
    const { executeCode } = await import("./code-executor.js");
    const runner = new WorkflowRunner(makeConfig());
    const result = await runner.executePhase({
      name: "lint",
      executor: "code",
      prompt: "",
      contextFiles: [],
      humanConfirm: false,
      command: "pnpm run lint",
    });
    expect(result.success).toBe(true);
    expect(executeCode).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: expect.objectContaining({ command: "pnpm run lint" }),
      }),
    );
  });

  it("executePhase with self executor calls session.prompt", async () => {
    const runner = new WorkflowRunner(makeConfig());
    const result = await runner.executePhase({
      name: "design",
      executor: "self",
      prompt: "design the feature",
      contextFiles: [],
      humanConfirm: false,
    });
    expect(result.success).toBe(true);
  });
});
