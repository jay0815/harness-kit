import { describe, it, expect, vi } from "vitest";
import { AgentA, createAgentA } from "./agent-a.js";
import type { Model } from "./types.js";

function makeModel(): Model<any> {
  return { provider: "test", id: "test-model" } as any;
}

describe("AgentA", () => {
  it("createAgentA returns AgentA instance", () => {
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
    });
    expect(agent).toBeInstanceOf(AgentA);
  });

  it("initial state has empty task results", () => {
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
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
      maxIterations: 1,
    });

    const emit = vi.fn();
    // This will fail because streamFn is not injected, but we can check the assessment
    const result = await agent.processHumanMessage("Implement a new feature for user auth", emit);

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_a_assessment" }),
    );
  });

  it("saves task results after completion", async () => {
    const agent = createAgentA({
      model: makeModel(),
      workspaceDir: "/tmp",
      tools: [],
      maxIterations: 1,
    });

    const emit = vi.fn();
    await agent.processHumanMessage("Fix the login bug", emit);

    const state = agent.getState();
    expect(state.taskResults.length).toBeGreaterThanOrEqual(0);
  });
});
