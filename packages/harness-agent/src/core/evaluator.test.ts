import { describe, it, expect, vi } from "vitest";
import { evaluateTask, evaluateTaskWithSource } from "./evaluator.js";
import type { EvaluateTaskConfig } from "./evaluator.js";
import { cast, getProp, mockModel } from "./test-utils.js";

function makeConfig(overrides?: Partial<EvaluateTaskConfig>): EvaluateTaskConfig {
  return {
    model: mockModel(),
    streamFn: cast<import("./types.js").StreamFn>(
      vi.fn().mockImplementation(async () => ({
        result: async () => ({
          content: [{ type: "text", text: "{}" }],
          stopReason: "end_turn",
        }),
      })),
    ),
    workspaceDir: "/tmp/test",
    ...overrides,
  };
}

function mockStreamFn(text: string) {
  return vi.fn().mockImplementation(async () => ({
    result: async () => ({
      content: [{ type: "text", text }],
      stopReason: "end_turn",
    }),
  }));
}

function validEvaluation(overrides?: Record<string, unknown>) {
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

describe("evaluateTaskWithSource", () => {
  it("returns source: model on successful parse", async () => {
    const config = makeConfig({ streamFn: mockStreamFn(validEvaluation()) });
    const result = await evaluateTaskWithSource(config, "Implement auth");

    expect(result.source).toBe("model");
    expect(result.evaluation.understood).toBe(true);
    expect(result.evaluation.taskOverview).toBe("Implement auth");
  });

  it("normalizes executor to internal", async () => {
    const config = makeConfig({
      streamFn: mockStreamFn(validEvaluation({ executor: "claude" })),
    });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.evaluation.executor).toBe("internal");
  });

  it("returns fallback on streamFn error", async () => {
    const config = makeConfig({
      streamFn: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("fallback");
    expect(result.evaluation.understood).toBe(false);
    expect(result.evaluation.needsExecution).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns fallback on non-JSON output", async () => {
    const config = makeConfig({ streamFn: mockStreamFn("I'm not sure what you mean.") });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("fallback");
    expect(result.evaluation.understood).toBe(false);
  });

  it("parses fenced JSON code block", async () => {
    const fenced = "```json\n" + validEvaluation() + "\n```";
    const config = makeConfig({ streamFn: mockStreamFn(fenced) });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("model");
    expect(result.evaluation.understood).toBe(true);
  });

  it("uses balanced-brace extraction", async () => {
    const wrapped = "Here is the evaluation:\n" + validEvaluation() + "\nDone.";
    const config = makeConfig({ streamFn: mockStreamFn(wrapped) });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("model");
    expect(result.evaluation.understood).toBe(true);
  });

  it("falls back on missing core fields", async () => {
    const incomplete = JSON.stringify({ understood: true }); // missing taskOverview, needsExecution
    const config = makeConfig({ streamFn: mockStreamFn(incomplete) });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("fallback");
    expect(result.evaluation.understood).toBe(false);
  });

  it("defaults complexityReason/riskReason/reasoning to empty string", async () => {
    const minimal = validEvaluation({
      complexityReason: undefined,
      riskReason: undefined,
      reasoning: undefined,
    });
    const config = makeConfig({ streamFn: mockStreamFn(minimal) });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("model");
    expect(result.evaluation.complexityReason).toBe("");
    expect(result.evaluation.riskReason).toBe("");
    expect(result.evaluation.reasoning).toBe("");
  });

  it("falls back on missing complexity", async () => {
    const json = validEvaluation({ complexity: undefined });
    const config = makeConfig({ streamFn: mockStreamFn(json) });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("fallback");
    expect(result.evaluation.understood).toBe(false);
  });

  it("falls back on invalid complexity", async () => {
    const json = validEvaluation({ complexity: "extreme" });
    const config = makeConfig({ streamFn: mockStreamFn(json) });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("fallback");
  });

  it("falls back on missing risk", async () => {
    const json = validEvaluation({ risk: undefined });
    const config = makeConfig({ streamFn: mockStreamFn(json) });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("fallback");
  });

  it("falls back on invalid risk", async () => {
    const json = validEvaluation({ risk: "extreme" });
    const config = makeConfig({ streamFn: mockStreamFn(json) });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("fallback");
  });

  it("falls back on stopReason: error", async () => {
    const streamFn = vi.fn().mockImplementation(async () => ({
      result: async () => ({
        content: [{ type: "text", text: "partial" }],
        stopReason: "error",
        errorMessage: "rate limited",
      }),
    }));
    const config = makeConfig({ streamFn });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("fallback");
    expect(result.evaluation.understood).toBe(false);
  });

  it("falls back on stopReason: aborted", async () => {
    const streamFn = vi.fn().mockImplementation(async () => ({
      result: async () => ({
        content: [],
        stopReason: "aborted",
      }),
    }));
    const config = makeConfig({ streamFn });
    const result = await evaluateTaskWithSource(config, "test");

    expect(result.source).toBe("fallback");
  });
});

describe("evaluateTask", () => {
  it("returns TaskEvaluation directly (thin wrapper)", async () => {
    const config = makeConfig({ streamFn: mockStreamFn(validEvaluation()) });
    const result = await evaluateTask(config, "Implement auth");

    expect(result.understood).toBe(true);
    expect(result.taskOverview).toBe("Implement auth");
    // No source field — evaluateTask doesn't expose it
    expect(getProp(result, "source")).toBeUndefined();
  });

  it("returns fallback evaluation on error", async () => {
    const config = makeConfig({
      streamFn: vi.fn().mockRejectedValue(new Error("fail")),
    });
    const result = await evaluateTask(config, "test");

    expect(result.understood).toBe(false);
    expect(result.needsExecution).toBe(false);
  });
});
