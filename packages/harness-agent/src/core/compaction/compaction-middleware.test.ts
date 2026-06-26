import { describe, it, expect, beforeEach } from "vitest";
import { CompactionMiddleware, COMPACTION_METADATA_KEY } from "./compaction-middleware.js";
import { WikiContextEngine } from "./wiki-context-engine.js";
import type { RuntimeState, AgentMessage } from "../types.js";

function makeState(tokenRatio: number, messageCount: number): RuntimeState {
  const messages: AgentMessage[] = Array.from({ length: messageCount }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: [{ type: "text", text: `Message ${i}` }],
    timestamp: Date.now() + i,
  })) as unknown as AgentMessage[];

  return {
    context: {
      systemPrompt: "test",
      messages,
    },
    iteration: 0,
    tokenUsage: {
      inputTokens: Math.floor(200_000 * tokenRatio),
      outputTokens: 0,
      totalTokens: Math.floor(200_000 * tokenRatio),
      contextWindow: 200_000,
    },
    metadata: {},
  };
}

describe("CompactionMiddleware", () => {
  let engine: WikiContextEngine;
  let middleware: CompactionMiddleware;

  beforeEach(() => {
    engine = new WikiContextEngine({ threshold: 0.75, keepRecentTurns: 2 });
    middleware = new CompactionMiddleware(engine);
  });

  it("has correct priority and name", () => {
    expect(middleware.priority).toBeLessThan(10); // PRIORITY_GUARD - 5
    expect(middleware.name).toBe("Compaction");
  });

  it("does nothing when below threshold", async () => {
    const state = makeState(0.5, 10);
    await middleware.beforeModel!(state);

    expect(state.context.messages).toHaveLength(10);
    expect(state.metadata[COMPACTION_METADATA_KEY]).toBeUndefined();
  });

  it("triggers compaction when above threshold", async () => {
    const state = makeState(0.8, 10);
    await middleware.beforeModel!(state);

    expect(state.context.messages.length).toBeLessThan(10);
    expect(state.metadata[COMPACTION_METADATA_KEY]).toBeDefined();
    const meta = state.metadata[COMPACTION_METADATA_KEY] as {
      compactionCount: number;
      totalRemoved: number;
    };
    expect(meta.compactionCount).toBe(1);
    expect(meta.totalRemoved).toBeGreaterThan(0);
  });

  it("accumulates compaction state across calls", async () => {
    const state1 = makeState(0.8, 10);
    await middleware.beforeModel!(state1);

    const state2 = makeState(0.8, state1.context.messages.length);
    state2.metadata = { ...state1.metadata };
    await middleware.beforeModel!(state2);

    const meta = state2.metadata[COMPACTION_METADATA_KEY] as { compactionCount: number };
    expect(meta.compactionCount).toBeGreaterThanOrEqual(1);
  });
});
