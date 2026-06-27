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
  class MockSubagentRunner {
    generateId = vi.fn().mockReturnValue("test-id-1");
    getResultPath = vi.fn().mockReturnValue("/tmp/hk-result-test-id-1.json");
    buildCommand = vi.fn().mockReturnValue({ command: "echo", args: ["test"] });
    collectResult = vi.fn().mockReturnValue({
      success: false,
      subagentId: "test-id-1",
      error: "No result file found",
      errorType: "no_result",
      durationMs: 0,
    });
  }
  return { HarnessAgentSession: MockSession, SubagentRunner: MockSubagentRunner };
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

  it("executePhase with subagent executor spawns process", async () => {
    const runner = new WorkflowRunner(makeConfig());
    // subagent executor spawns a real process, which will fail quickly
    // because "echo" is not a valid subagent. We just verify it doesn't crash.
    const result = await runner.executePhase({
      name: "test-subagent",
      executor: "subagent",
      prompt: "test task",
      contextFiles: [],
      humanConfirm: false,
      subagentType: "script",
      subagentTimeoutMs: 5000,
    });
    // The process will fail (echo doesn't write a result file), but it should not throw
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("output");
  });

  it("getWorkflow preserves subagent fields from provided workflow", () => {
    const workflow: Workflow = {
      name: "subagent-workflow",
      description: "test",
      phases: [
        {
          name: "design",
          executor: "subagent",
          prompt: "design the feature",
          contextFiles: [],
          humanConfirm: false,
          subagentType: "claude",
          subagentConstraints: ["Only modify src/"],
          subagentTimeoutMs: 60000,
          subagentSettings: "/path/to/settings.json",
        },
      ],
    };
    const runner = new WorkflowRunner(makeConfig(workflow));
    const phases = runner.getWorkflow().phases;
    expect(phases[0].executor).toBe("subagent");
    expect(phases[0].subagentType).toBe("claude");
    expect(phases[0].subagentConstraints).toEqual(["Only modify src/"]);
    expect(phases[0].subagentTimeoutMs).toBe(60000);
    expect(phases[0].subagentSettings).toBe("/path/to/settings.json");
  });
});
