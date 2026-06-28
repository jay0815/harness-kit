import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkflowRunner } from "./workflow-runner.js";
import type { Workflow } from "./types.js";

const agentMocks = vi.hoisted(() => ({
  sessionPrompt: vi.fn(),
  subagentGenerateId: vi.fn(),
  subagentGetResultPath: vi.fn(),
  subagentBuildCommand: vi.fn(),
  subagentCollectResult: vi.fn(),
  subagentClearActive: vi.fn(),
}));

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("@harness-kit/agent", () => {
  class MockSession {
    extensionAPI = {
      on: vi.fn(),
      registerTool: vi.fn(),
      sendUserMessage: vi.fn(),
    };
    start = vi.fn().mockResolvedValue(undefined);
    prompt = agentMocks.sessionPrompt;
    shutdown = vi.fn().mockResolvedValue(undefined);
  }
  class MockSubagentRunner {
    generateId = agentMocks.subagentGenerateId;
    getResultPath = agentMocks.subagentGetResultPath;
    buildCommand = agentMocks.subagentBuildCommand;
    collectResult = agentMocks.subagentCollectResult;
    clearActive = agentMocks.subagentClearActive;
  }
  return {
    DEFAULT_TIMEOUT_MS: 300_000,
    HarnessAgentSession: MockSession,
    SubagentRunner: MockSubagentRunner,
  };
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

vi.mock("node:child_process", () => ({
  spawn: childProcessMocks.spawn,
}));

function makeConfig(workflow?: Workflow) {
  return {
    cwd: "/tmp/test",
    model: {} as never,
    streamFn: vi.fn() as never,
    workflow,
  };
}

function makeMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe("WorkflowRunner", () => {
  beforeEach(() => {
    agentMocks.sessionPrompt.mockReset().mockResolvedValue(undefined);
    agentMocks.subagentGenerateId.mockReset().mockReturnValue("test-id-1");
    agentMocks.subagentGetResultPath
      .mockReset()
      .mockReturnValue("/tmp/hk-result-test-id-1.json");
    agentMocks.subagentBuildCommand.mockReset().mockReturnValue({ command: "echo", args: ["test"] });
    agentMocks.subagentCollectResult.mockReset().mockReturnValue({
      success: false,
      subagentId: "test-id-1",
      error: "No result file found",
      errorType: "no_result",
      durationMs: 0,
    });
    agentMocks.subagentClearActive.mockReset();
    childProcessMocks.spawn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
      phases: [
        { name: "p1", executor: "self", prompt: "do it", contextFiles: [], humanConfirm: false },
      ],
    };
    const runner = new WorkflowRunner(makeConfig(workflow));
    expect(runner.getWorkflowName()).toBe("custom");
  });

  it("preserves executor type from provided workflow", () => {
    const workflow: Workflow = {
      name: "mixed",
      description: "test",
      phases: [
        {
          name: "llm-phase",
          executor: "self",
          prompt: "design",
          contextFiles: [],
          humanConfirm: false,
        },
        {
          name: "code-phase",
          executor: "code",
          prompt: "",
          contextFiles: [],
          humanConfirm: false,
          command: "pnpm test",
        },
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

  it("executePhase with llm executor calls session.prompt", async () => {
    const runner = new WorkflowRunner(makeConfig());
    const result = await runner.executePhase({
      name: "design",
      executor: "llm",
      prompt: "design the feature",
      contextFiles: [],
      humanConfirm: false,
    });
    expect(result.success).toBe(true);
  });

  it("executePhase with llm executor returns failure when prompt throws", async () => {
    agentMocks.sessionPrompt.mockRejectedValueOnce(new Error("network error"));
    const runner = new WorkflowRunner(makeConfig());
    const result = await runner.executePhase({
      name: "design",
      executor: "llm",
      prompt: "design the feature",
      contextFiles: [],
      humanConfirm: false,
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("network error");
  });

  it("executePhase rejects unknown executor", async () => {
    const runner = new WorkflowRunner(makeConfig());
    const result = await runner.executePhase({
      name: "unknown",
      executor: "mystery",
      prompt: "do something",
      contextFiles: [],
      humanConfirm: false,
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown phase executor");
  });

  it("executePhase with subagent executor spawns process", async () => {
    const proc = makeMockProcess();
    childProcessMocks.spawn.mockReturnValue(proc);
    const runner = new WorkflowRunner(makeConfig());
    const promise = runner.executePhase({
      name: "test-subagent",
      executor: "subagent",
      prompt: "test task",
      contextFiles: [],
      humanConfirm: false,
      subagentType: "script",
      subagentTimeoutMs: 5000,
    });
    await vi.waitFor(() => expect(childProcessMocks.spawn).toHaveBeenCalled());
    proc.emit("close", 0);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.output).toContain("No result file found");
  });

  it("executePhase rejects unknown subagent executor", async () => {
    const runner = new WorkflowRunner(makeConfig());
    const result = await runner.executePhase({
      name: "test-subagent",
      executor: "subagent",
      prompt: "test task",
      contextFiles: [],
      humanConfirm: false,
      subagentType: "unknown",
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown subagent executor");
  });

  it("executePhase rejects invalid subagent timeout", async () => {
    const runner = new WorkflowRunner(makeConfig());
    const result = await runner.executePhase({
      name: "test-subagent",
      executor: "subagent",
      prompt: "test task",
      contextFiles: [],
      humanConfirm: false,
      subagentType: "script",
      subagentTimeoutMs: 0,
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid subagent timeout");
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
  });

  it("does not collect and delete results after subagent timeout", async () => {
    vi.useFakeTimers();
    const proc = makeMockProcess();
    childProcessMocks.spawn.mockReturnValue(proc);
    const runner = new WorkflowRunner(makeConfig());

    const promise = runner.executePhase({
      name: "test-subagent",
      executor: "subagent",
      prompt: "test task",
      contextFiles: [],
      humanConfirm: false,
      subagentType: "script",
      subagentTimeoutMs: 10,
    });

    await vi.waitFor(() => expect(childProcessMocks.spawn).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(10);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.output).toContain("Result file preserved");
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(agentMocks.subagentClearActive).toHaveBeenCalledWith("test-id-1");

    proc.emit("close", 0);
    expect(agentMocks.subagentCollectResult).not.toHaveBeenCalled();
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
