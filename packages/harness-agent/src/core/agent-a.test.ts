import { describe, it, expect, vi } from "vitest";
import { AgentA, createAgentA } from "./agent-a.js";
import type { Model, StreamFn } from "./types.js";

function makeModel(): Model<any> {
  return { provider: "test", id: "test-model" } as any;
}

function makeStreamFn(): StreamFn {
  return vi.fn().mockImplementation(async () => ({
    result: async () => ({
      content: [{ type: "text", text: "ok" }],
      stopReason: "end_turn",
      usage: { input: 100, output: 50 },
    }),
  })) as any;
}

describe("AgentA", () => {
  it("createAgentA returns AgentA instance", () => {
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn: makeStreamFn(),
    });
    expect(agent).toBeInstanceOf(AgentA);
  });

  it("initial state has empty task results", () => {
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn: makeStreamFn(),
    });
    const state = agent.getState();
    expect(state.taskResults).toEqual([]);
    expect(state.currentAgentB).toBeNull();
  });

  it("assesses vague input as unclear", async () => {
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn: makeStreamFn(),
    });

    const emit = vi.fn();
    const result = await agent.processHumanMessage("help", emit);

    expect(result).toContain("details");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_a_clarification" }),
    );
  });

  it("assesses question as not needing Agent B", async () => {
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn: makeStreamFn(),
    });

    const emit = vi.fn();
    const result = await agent.processHumanMessage("What is the purpose of this project?", emit);

    // Questions return the assessment overview, not delegated to Agent B
    expect(result).toBeTruthy();
    expect(emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_b_start" }),
    );
  });

  it("assesses task as needing Agent B", async () => {
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn: makeStreamFn(),
      maxIterations: 1,
    });

    const emit = vi.fn();
    await agent.processHumanMessage("Implement a new feature for user auth", emit);

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_a_assessment" }),
    );
  });

  it("delegates to Agent B with injected streamFn", async () => {
    const streamFn = makeStreamFn();
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      streamFn,
      maxIterations: 1,
    });

    const emit = vi.fn();
    const result = await agent.processHumanMessage("Implement a new feature for user auth", emit);

    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(result).toContain("ok");

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_b_start" }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_b_complete" }),
    );

    const state = agent.getState();
    expect(state.taskResults).toHaveLength(1);
    expect(state.taskResults[0].status).toBe("completed");
    expect(state.taskResults[0].output).toContain("ok");
  });
});
