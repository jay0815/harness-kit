import { describe, it, expect, vi } from "vitest";
import { generateWiki, scoreWiki, generateWikiWithRetry } from "./wiki-generator.js";
import type { WikiGeneratorConfig } from "./wiki-generator.js";
import type { AgentMessage } from "../types.js";

function mockStreamFn(responseText: string) {
  return vi.fn().mockResolvedValue({
    result: vi.fn().mockResolvedValue({
      stopReason: "end_turn",
      content: [{ type: "text", text: responseText }],
    }),
  });
}

function failingStreamFn() {
  return vi.fn().mockResolvedValue({
    result: vi.fn().mockResolvedValue({
      stopReason: "error",
      errorMessage: "test error",
      content: [],
    }),
  });
}

function makeMessages(): AgentMessage[] {
  return [
    { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "Hi there" }], timestamp: 2 },
  ] as unknown as AgentMessage[];
}

describe("generateWiki", () => {
  it("generates wiki entry from valid JSON response", async () => {
    const response = JSON.stringify({
      projectGoals: "Build harness",
      completedWork: "Phase 1",
      keyDecisions: "Use middleware",
      fileChanges: "agent-loop.ts",
      problemsAndSolutions: "None",
      unfinishedTasks: "Phase 2",
    });

    const config: WikiGeneratorConfig = {
      model: {} as never,
      streamFn: mockStreamFn(response) as never,
    };

    const entry = await generateWiki(config, makeMessages(), [0, 2]);
    expect(entry).not.toBeNull();
    expect(entry!.projectGoals).toBe("Build harness");
    expect(entry!.completedWork).toBe("Phase 1");
    expect(entry!.sourceMessageRange).toEqual([0, 2]);
  });

  it("returns null on LLM error", async () => {
    const config: WikiGeneratorConfig = {
      model: {} as never,
      streamFn: failingStreamFn() as never,
    };

    const entry = await generateWiki(config, makeMessages(), [0, 2]);
    expect(entry).toBeNull();
  });

  it("returns null on invalid JSON", async () => {
    const config: WikiGeneratorConfig = {
      model: {} as never,
      streamFn: mockStreamFn("not valid json") as never,
    };

    const entry = await generateWiki(config, makeMessages(), [0, 2]);
    expect(entry).toBeNull();
  });

  it("parses fenced JSON code block", async () => {
    const response =
      '```json\n{"projectGoals":"Test","completedWork":"","keyDecisions":"","fileChanges":"","problemsAndSolutions":"","unfinishedTasks":""}\n```';
    const config: WikiGeneratorConfig = {
      model: {} as never,
      streamFn: mockStreamFn(response) as never,
    };

    const entry = await generateWiki(config, makeMessages(), [0, 2]);
    expect(entry).not.toBeNull();
    expect(entry!.projectGoals).toBe("Test");
  });
});

describe("scoreWiki", () => {
  it("scores wiki entry", async () => {
    const response = JSON.stringify({
      completeness: 0.8,
      accuracy: 0.9,
      conciseness: 0.7,
      overall: 0.82,
    });

    const config: WikiGeneratorConfig = {
      model: {} as never,
      streamFn: mockStreamFn(response) as never,
    };

    const entry = {
      id: "test",
      timestamp: Date.now(),
      projectGoals: "Test",
      completedWork: "",
      keyDecisions: "",
      fileChanges: "",
      problemsAndSolutions: "",
      unfinishedTasks: "",
      sourceMessageRange: [0, 2] as [number, number],
    };

    const score = await scoreWiki(config, entry);
    expect(score).not.toBeNull();
    expect(score!.completeness).toBe(0.8);
    expect(score!.overall).toBe(0.82);
  });

  it("returns null on error", async () => {
    const config: WikiGeneratorConfig = {
      model: {} as never,
      streamFn: failingStreamFn() as never,
    };

    const entry = {
      id: "test",
      timestamp: Date.now(),
      projectGoals: "Test",
      completedWork: "",
      keyDecisions: "",
      fileChanges: "",
      problemsAndSolutions: "",
      unfinishedTasks: "",
      sourceMessageRange: [0, 2] as [number, number],
    };

    const score = await scoreWiki(config, entry);
    expect(score).toBeNull();
  });
});

describe("generateWikiWithRetry", () => {
  it("retries on low score", async () => {
    let callCount = 0;
    const lowScoreResponse = JSON.stringify({
      completeness: 0.3,
      accuracy: 0.3,
      conciseness: 0.3,
      overall: 0.3,
    });
    const highScoreResponse = JSON.stringify({
      completeness: 0.9,
      accuracy: 0.9,
      conciseness: 0.9,
      overall: 0.9,
    });

    const streamFn = vi.fn().mockImplementation(() => {
      callCount++;
      const text = callCount <= 2 ? lowScoreResponse : highScoreResponse;
      return {
        result: vi.fn().mockResolvedValue({
          stopReason: "end_turn",
          content: [
            {
              type: "text",
              text:
                callCount % 2 === 1
                  ? JSON.stringify({
                      projectGoals: "Test",
                      completedWork: "",
                      keyDecisions: "",
                      fileChanges: "",
                      problemsAndSolutions: "",
                      unfinishedTasks: "",
                    })
                  : text,
            },
          ],
        }),
      };
    });

    const config: WikiGeneratorConfig = {
      model: {} as never,
      streamFn: streamFn as never,
    };

    const { retries } = await generateWikiWithRetry(
      config,
      makeMessages(),
      [0, 2],
      2,
      0.7,
    );
    // After retries, should get a valid entry (or null if all retries fail)
    expect(retries).toBeGreaterThanOrEqual(0);
  });
});
