import { describe, it, expect, vi } from "vitest";
import { AgentA, createAgentA } from "./agent-a.js";
import type { Model } from "./types.js";

function makeModel(): Model<any> {
  return { provider: "test", id: "test-model" } as any;
}

function evaluationResponse(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    understood: true,
    taskOverview: "Implement auth",
    complexity: "medium",
    complexityReason: "Multi-file change",
    risk: "low",
    riskReason: "Adding new code",
    needsExecution: true,
    executor: "internal",
    reasoning: "Task requires implementation",
    ...overrides,
  });
}

function makeEvalStreamFn(evalText: string, agentBText = "ok") {
  let callCount = 0;
  return vi.fn().mockImplementation(async () => {
    callCount++;
    const text = callCount === 1 ? evalText : agentBText;
    return {
      result: async () => ({
        content: [{ type: "text", text }],
        stopReason: "end_turn",
        usage: { input: 100, output: 50 },
      }),
    };
  }) as any;
}

describe("AgentA", () => {
  it("createAgentA returns AgentA instance", () => {
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn: makeEvalStreamFn(evaluationResponse()),
    });
    expect(agent).toBeInstanceOf(AgentA);
  });

  it("initial state has empty task results", () => {
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn: makeEvalStreamFn(evaluationResponse()),
    });
    const state = agent.getState();
    expect(state.taskResults).toEqual([]);
    expect(state.currentAgentB).toBeNull();
  });

  it("uses LLM evaluator, not keyword matching", async () => {
    // "help" would be vague under keyword matching,
    // but LLM evaluator can understand it differently
    const evalJson = evaluationResponse({
      understood: true,
      taskOverview: "Help the user get started",
      needsExecution: false,
    });
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn: makeEvalStreamFn(evalJson),
    });

    const emit = vi.fn();
    const result = await agent.processHumanMessage("help", emit);

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_a_assessment" }));
    // needsExecution: false → compatibility return
    expect(result).toBe("Help the user get started");
  });

  it("clarification when LLM judges unclear", async () => {
    const evalJson = evaluationResponse({
      understood: false,
      clarificationNeeded: "What specific feature do you need?",
      needsExecution: false,
    });
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn: makeEvalStreamFn(evalJson),
    });

    const emit = vi.fn();
    const result = await agent.processHumanMessage("do something", emit);

    expect(result).toContain("What specific feature");
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_a_clarification" }));
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: "agent_b_start" }));
  });

  it("fallback does not delegate to AgentB", async () => {
    // streamFn throws → fallback
    const streamFn = vi.fn().mockRejectedValue(new Error("network error"));
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn: streamFn as any,
    });

    const emit = vi.fn();
    const result = await agent.processHumanMessage("Implement auth", emit);

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_a_clarification" }));
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: "agent_b_start" }));
    expect(result).toContain("couldn't");
  });

  it("needsExecution: true delegates to AgentB", async () => {
    const evalJson = evaluationResponse({ needsExecution: true });
    const streamFn = makeEvalStreamFn(evalJson, "done");
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn,
      maxIterations: 1,
    });

    const emit = vi.fn();
    const result = await agent.processHumanMessage("Implement auth", emit);

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_b_start" }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_b_complete" }));
    expect(result).toContain("done");
  });

  it("saves taskResults after AgentB completes", async () => {
    const evalJson = evaluationResponse({ needsExecution: true });
    const streamFn = makeEvalStreamFn(evalJson, "result text");
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn,
      maxIterations: 1,
    });

    const emit = vi.fn();
    await agent.processHumanMessage("Implement auth", emit);

    const state = agent.getState();
    expect(state.taskResults).toHaveLength(1);
    expect(state.taskResults[0].task).toBe("Implement auth");
    expect(state.taskResults[0].status).toBe("completed");
    expect(state.taskResults[0].output).toContain("result text");
  });

  it("streamFn called twice: once for evaluation, once for AgentB", async () => {
    const evalJson = evaluationResponse({ needsExecution: true });
    const streamFn = makeEvalStreamFn(evalJson, "ok");
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn,
      maxIterations: 1,
    });

    await agent.processHumanMessage("Implement auth", vi.fn());

    expect(streamFn).toHaveBeenCalledTimes(2);
  });
});
