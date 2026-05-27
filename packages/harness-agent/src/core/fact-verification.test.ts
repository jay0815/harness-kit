import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FactVerificationMiddleware, FACT_VERIFICATION_KEY } from "./fact-verification.js";
import type { FactVerificationConfig } from "./fact-verification.js";
import type { RuntimeState, LLMResponse } from "./types.js";
import { cast, getProp } from "./test-utils.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "hk-fv-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeState(): RuntimeState {
  return {
    context: { systemPrompt: "", messages: [] },
    iteration: 0,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextWindow: 200_000 },
    metadata: {},
  };
}

function textResponse(text: string): LLMResponse {
  return {
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

function toolCallResponse(): LLMResponse {
  return {
    content: [
      cast<Extract<LLMResponse["content"][number], { type: "toolCall" }>>({
        type: "toolCall",
        id: "tc1",
        name: "read_file",
        input: { path: "/test" },
      }),
    ],
    stopReason: "end_turn",
  };
}

function makeConfig(mode: "strict" | "warn" | "off", maxRetries = 3): FactVerificationConfig {
  return { mode, maxRetries, workspaceDir: tmpDir };
}

function hkResult(
  facts: Array<{ file: string; startLine: number; endLine: number; exactText: string }>,
  currentWork = "test work",
): string {
  return `<HK_RESULT>\n${JSON.stringify({ currentWork, facts })}\n</HK_RESULT>`;
}

describe("FactVerificationMiddleware", () => {
  it("off mode accepts without verification", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("off"));
    const state = makeState();
    const response = textResponse("just text, no HK_RESULT");

    const result = await mw.afterModel(state, response);
    expect(result.action).toBe("accept");
    expect(state.metadata[FACT_VERIFICATION_KEY]).toBeUndefined();
  });

  it("tool-call turn accepts without verification", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("strict"));
    const state = makeState();
    const response = toolCallResponse();

    const result = await mw.afterModel(state, response);
    expect(result.action).toBe("accept");
    expect(state.metadata[FACT_VERIFICATION_KEY]).toBeUndefined();
  });

  it("strict mode retries on missing HK_RESULT", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("strict"));
    const state = makeState();
    const response = textResponse("just text");

    const result = await mw.afterModel(state, response);
    expect(result.action).toBe("retry");
    expect(getProp(result, "feedback")).toContain("No <HK_RESULT> block found");
  });

  it("strict mode retries on empty facts", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("strict"));
    const state = makeState();
    const response = textResponse(hkResult([]));

    const result = await mw.afterModel(state, response);
    expect(result.action).toBe("retry");
    expect(getProp(result, "feedback")).toContain("no facts");
  });

  it("strict mode accepts on valid facts", async () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "a.ts"), "line1\nline2\n");

    const mw = new FactVerificationMiddleware(makeConfig("strict"));
    const state = makeState();
    const response = textResponse(
      hkResult([{ file: "src/a.ts", startLine: 1, endLine: 2, exactText: "line1\nline2" }]),
    );

    const result = await mw.afterModel(state, response);
    expect(result.action).toBe("accept");
    expect(state.metadata[FACT_VERIFICATION_KEY]).toBeDefined();
    expect(getProp(state.metadata[FACT_VERIFICATION_KEY], "status")).toBe("pass");
  });

  it("strict mode retries on fact mismatch", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "actual content\n");

    const mw = new FactVerificationMiddleware(makeConfig("strict"));
    const state = makeState();
    const response = textResponse(
      hkResult([{ file: "a.ts", startLine: 1, endLine: 1, exactText: "wrong content" }]),
    );

    const result = await mw.afterModel(state, response);
    expect(result.action).toBe("retry");
    expect(getProp(result, "feedback")).toContain("FAIL");
    expect(getProp(state.metadata[FACT_VERIFICATION_KEY], "status")).toBe("fail");
  });

  it("strict mode fails after max retries", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("strict", 2));

    // First retry
    let result = await mw.afterModel(makeState(), textResponse("no block"));
    expect(result.action).toBe("retry");

    // Second retry
    result = await mw.afterModel(makeState(), textResponse("no block"));
    expect(result.action).toBe("retry");

    // Third attempt — exhausted
    result = await mw.afterModel(makeState(), textResponse("no block"));
    expect(result.action).toBe("fail");
    expect(getProp(result, "reason")).toContain("max retries");
  });

  it("maxRetries: 0 fails immediately", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("strict", 0));
    const result = await mw.afterModel(makeState(), textResponse("no block"));
    expect(result.action).toBe("fail");
  });

  it("maxRetries: 1 allows one retry then fails", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("strict", 1));

    let result = await mw.afterModel(makeState(), textResponse("no block"));
    expect(result.action).toBe("retry");

    result = await mw.afterModel(makeState(), textResponse("no block"));
    expect(result.action).toBe("fail");
  });

  it("warn mode writes metadata but does not block on missing HK_RESULT", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("warn"));
    const state = makeState();

    const result = await mw.afterModel(state, textResponse("just text"));
    expect(result.action).toBe("accept");
    expect(state.metadata[FACT_VERIFICATION_KEY]).toBeDefined();
    expect(getProp(state.metadata[FACT_VERIFICATION_KEY], "status")).toBe("missing");
  });

  it("warn mode writes metadata but does not block on empty facts", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("warn"));
    const state = makeState();

    const result = await mw.afterModel(state, textResponse(hkResult([])));
    expect(result.action).toBe("accept");
    expect(getProp(state.metadata[FACT_VERIFICATION_KEY], "status")).toBe("empty");
  });

  it("warn mode writes metadata on fact mismatch", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "actual\n");

    const mw = new FactVerificationMiddleware(makeConfig("warn"));
    const state = makeState();
    const response = textResponse(
      hkResult([{ file: "a.ts", startLine: 1, endLine: 1, exactText: "wrong" }]),
    );

    const result = await mw.afterModel(state, response);
    expect(result.action).toBe("accept");
    expect(getProp(state.metadata[FACT_VERIFICATION_KEY], "status")).toBe("fail");
  });

  it("warn mode writes metadata on pass", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "content\n");

    const mw = new FactVerificationMiddleware(makeConfig("warn"));
    const state = makeState();
    const response = textResponse(
      hkResult([{ file: "a.ts", startLine: 1, endLine: 1, exactText: "content" }]),
    );

    const result = await mw.afterModel(state, response);
    expect(result.action).toBe("accept");
    expect(getProp(state.metadata[FACT_VERIFICATION_KEY], "status")).toBe("pass");
  });

  it("metadata shape matches FactVerificationMetadata", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "content\n");

    const mw = new FactVerificationMiddleware(makeConfig("strict"));
    const state = makeState();
    const response = textResponse(
      hkResult([{ file: "a.ts", startLine: 1, endLine: 1, exactText: "content" }]),
    );

    await mw.afterModel(state, response);
    const meta = cast<Record<string, unknown>>(state.metadata[FACT_VERIFICATION_KEY]);
    expect(meta).toHaveProperty("status");
    expect(meta).toHaveProperty("block");
    expect(meta).toHaveProperty("report");
    expect(meta).toHaveProperty("timestamp");
    expect(typeof meta.timestamp).toBe("number");
  });

  it("strict retries when facts have warnings (invalid facts dropped)", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "content\n");

    // 1 valid fact + 1 invalid fact (file is number, will be dropped with warning)
    const blockWithInvalid = `<HK_RESULT>${JSON.stringify({
      currentWork: "test",
      facts: [
        { file: "a.ts", startLine: 1, endLine: 1, exactText: "content" },
        { file: 123, startLine: 1, endLine: 1, exactText: "bad" },
      ],
    })}</HK_RESULT>`;

    const mw = new FactVerificationMiddleware(makeConfig("strict"));
    const state = makeState();

    const result = await mw.afterModel(state, textResponse(blockWithInvalid));
    expect(result.action).toBe("retry");
    expect(getProp(result, "feedback")).toContain("Invalid facts");
  });

  it("warn mode writes metadata on warnings but does not block", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "content\n");

    const blockWithInvalid = `<HK_RESULT>${JSON.stringify({
      currentWork: "test",
      facts: [
        { file: "a.ts", startLine: 1, endLine: 1, exactText: "content" },
        { file: 123, startLine: 1, endLine: 1, exactText: "bad" },
      ],
    })}</HK_RESULT>`;

    const mw = new FactVerificationMiddleware(makeConfig("warn"));
    const state = makeState();

    const result = await mw.afterModel(state, textResponse(blockWithInvalid));
    expect(result.action).toBe("accept");
    expect(getProp(state.metadata[FACT_VERIFICATION_KEY], "status")).toBe("fail");
  });

  it("strict retries on all-invalid facts (warnings, not empty)", async () => {
    // All facts invalid — parser drops them all, resulting in empty facts + warnings
    const allInvalid = `<HK_RESULT>${JSON.stringify({
      currentWork: "test",
      facts: [
        { file: 123, startLine: 1, endLine: 1, exactText: "bad" },
        { file: null, startLine: -1, endLine: -1, exactText: "bad" },
      ],
    })}</HK_RESULT>`;

    const mw = new FactVerificationMiddleware(makeConfig("strict"));
    const state = makeState();

    const result = await mw.afterModel(state, textResponse(allInvalid));
    expect(result.action).toBe("retry");
    expect(getProp(result, "feedback")).toContain("Invalid facts");
    // Should NOT say "no facts" — it's invalid, not empty
    expect(getProp(result, "feedback")).not.toContain("no facts");
  });

  it("priority is finalizer (MAX_SAFE_INTEGER, runs after all other middleware)", () => {
    const mw = new FactVerificationMiddleware(makeConfig("strict"));
    expect(mw.priority).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("skips verification on tool-call response (stale metadata prevention)", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("strict"));
    const state = makeState();

    // Simulate QualityGate injecting a tool call into a text response
    const toolCallResponse: LLMResponse = {
      content: [
        cast<Extract<LLMResponse["content"][number], { type: "toolCall" }>>({
          type: "text",
          text: "done",
        }),
        cast<Extract<LLMResponse["content"][number], { type: "toolCall" }>>({
          type: "toolCall",
          id: "qg1",
          name: "__quality_gate__",
          input: {},
        }),
      ],
      stopReason: "end_turn",
    };

    const result = await mw.afterModel(state, toolCallResponse);
    expect(result.action).toBe("accept");
    // No metadata written — tool-call turn is skipped
    expect(state.metadata[FACT_VERIFICATION_KEY]).toBeUndefined();
  });

  it("clears stale metadata from previous turn before processing", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("off"));
    const state = makeState();

    // Simulate stale metadata from a previous turn
    state.metadata[FACT_VERIFICATION_KEY] = {
      status: "pass",
      block: { currentWork: "old", facts: [] },
      report: null,
      timestamp: 0,
    };

    // off mode — should clear stale metadata and accept
    const result = await mw.afterModel(state, textResponse("just text"));
    expect(result.action).toBe("accept");
    // Stale metadata cleared
    expect(state.metadata[FACT_VERIFICATION_KEY]).toBeUndefined();
  });

  it("clears stale metadata on tool-call turn", async () => {
    const mw = new FactVerificationMiddleware(makeConfig("strict"));
    const state = makeState();

    // Stale pass metadata from previous text turn
    state.metadata[FACT_VERIFICATION_KEY] = {
      status: "pass",
      block: { currentWork: "old", facts: [] },
      report: null,
      timestamp: 0,
    };

    const toolCallResponse = {
      content: [
        cast<Extract<LLMResponse["content"][number], { type: "toolCall" }>>({
          type: "toolCall",
          id: "tc1",
          name: "read_file",
          input: {},
        }),
      ],
      stopReason: "end_turn",
    };

    const result = await mw.afterModel(state, toolCallResponse);
    expect(result.action).toBe("accept");
    // Stale metadata cleared — tool-call turn doesn't carry old pass
    expect(state.metadata[FACT_VERIFICATION_KEY]).toBeUndefined();
  });
});
