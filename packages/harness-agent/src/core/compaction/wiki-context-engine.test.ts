import { describe, it, expect, beforeEach } from "vitest";
import { WikiContextEngine } from "./wiki-context-engine.js";
import type { TokenUsage, AgentMessage } from "../types.js";

function makeTokenUsage(ratio: number): TokenUsage {
  return {
    inputTokens: Math.floor(200_000 * ratio),
    outputTokens: 0,
    totalTokens: Math.floor(200_000 * ratio),
    contextWindow: 200_000,
  };
}

function makeMessages(count: number): AgentMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: [{ type: "text", text: `Message ${i}` }],
    timestamp: Date.now() + i,
  })) as unknown as AgentMessage[];
}

describe("WikiContextEngine", () => {
  let engine: WikiContextEngine;

  beforeEach(() => {
    engine = new WikiContextEngine({ threshold: 0.75, keepRecentTurns: 2 });
  });

  describe("shouldCompact", () => {
    it("returns false when below threshold", () => {
      expect(engine.shouldCompact(makeTokenUsage(0.5))).toBe(false);
    });

    it("returns false at threshold boundary", () => {
      expect(engine.shouldCompact(makeTokenUsage(0.75))).toBe(true);
    });

    it("returns true when above threshold", () => {
      expect(engine.shouldCompact(makeTokenUsage(0.8))).toBe(true);
    });

    it("returns false when contextWindow is 0", () => {
      expect(
        engine.shouldCompact({
          inputTokens: 100,
          outputTokens: 0,
          totalTokens: 100,
          contextWindow: 0,
        }),
      ).toBe(false);
    });
  });

  describe("compact", () => {
    it("removes old messages and keeps recent", async () => {
      const messages = makeMessages(10);
      const result = await engine.compact(messages, makeTokenUsage(0.8));

      expect(result.removedCount).toBeGreaterThan(0);
      expect(result.trigger).toBe("threshold");
      // keepRecentTurns=2 means keep last 4 messages (2 turns * 2 messages each)
      expect(messages.length).toBeLessThan(10);
    });

    it("injects summary message at start", async () => {
      const messages = makeMessages(10);
      await engine.compact(messages, makeTokenUsage(0.8));

      const first = messages[0] as unknown as {
        role: string;
        content: Array<{ type: string; text: string }>;
      };
      expect(first.role).toBe("user");
      expect(first.content[0].text).toContain("Compaction Summary");
    });

    it("returns zero removed when messages are few", async () => {
      const messages = makeMessages(2);
      const result = await engine.compact(messages, makeTokenUsage(0.8));

      expect(result.removedCount).toBe(0);
    });
  });

  describe("wiki entries", () => {
    it("starts with empty wiki summary", () => {
      expect(engine.getWikiSummary()).toBe("");
    });

    it("adds wiki entry and updates summary", () => {
      engine.addWikiEntry({
        id: "test-1",
        timestamp: Date.now(),
        projectGoals: "Build a harness",
        completedWork: "Phase 1 done",
        keyDecisions: "Use middleware",
        fileChanges: "agent-loop.ts",
        problemsAndSolutions: "None",
        unfinishedTasks: "Phase 2",
        sourceMessageRange: [0, 10],
      });

      const summary = engine.getWikiSummary();
      expect(summary).toContain("Build a harness");
      expect(summary).toContain("Phase 1 done");
    });

    it("returns wiki entries", () => {
      engine.addWikiEntry({
        id: "test-1",
        timestamp: Date.now(),
        projectGoals: "Goal",
        completedWork: "",
        keyDecisions: "",
        fileChanges: "",
        problemsAndSolutions: "",
        unfinishedTasks: "",
        sourceMessageRange: [0, 5],
      });

      expect(engine.getWikiEntries()).toHaveLength(1);
    });
  });

  describe("searchMemory", () => {
    it("finds matching content", async () => {
      engine.addWikiEntry({
        id: "test-1",
        timestamp: Date.now(),
        projectGoals: "Build agent runtime",
        completedWork: "Middleware pipeline",
        keyDecisions: "Use priority sorting",
        fileChanges: "",
        problemsAndSolutions: "",
        unfinishedTasks: "",
        sourceMessageRange: [0, 5],
      });

      const results = await engine.searchMemory("middleware");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toContain("Middleware pipeline");
    });

    it("returns empty for no match", async () => {
      const results = await engine.searchMemory("nonexistent");
      expect(results).toHaveLength(0);
    });
  });
});
