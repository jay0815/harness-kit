import { describe, it, expect } from "vitest";
import {
  VerificationGuidanceMiddleware,
  ToolCallGuardrailMiddleware,
  QualityGateMiddleware,
  IntentGateMiddleware,
} from "./middlewares.js";
import { CHANGE_TRACKER_KEY } from "./change-tracker.js";
import type { RuntimeState, AgentToolCall, AgentToolResult, LLMResponse } from "./types.js";

function makeState(tracker?: Record<string, unknown>): RuntimeState {
  return {
    context: { systemPrompt: "", messages: [] },
    iteration: 0,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextWindow: 200_000 },
    metadata: tracker ? { [CHANGE_TRACKER_KEY]: tracker } : {},
  };
}

function makeToolCall(name: string, input?: Record<string, unknown>): AgentToolCall {
  return { id: "tc_1", name, type: "toolCall", input } as any;
}

function makeResult(text = "ok"): AgentToolResult<any> {
  return { content: [{ type: "text", text }], details: null };
}

describe("VerificationGuidanceMiddleware", () => {
  const mw = new VerificationGuidanceMiddleware();

  it("has priority 60", () => {
    expect(mw.priority).toBe(60);
  });

  it("appends success guidance after passing verify", async () => {
    const state = makeState({
      codeGen: 1,
      verifiedGen: 1,
      lastVerifyOk: true,
      lastVerifyError: null,
    });
    const result = makeResult("PASS");

    const out = await mw.afterTool(state, makeToolCall("verify"), undefined, result);
    expect(out.content).toHaveLength(2);
    expect((out.content[1] as any).text).toContain("passed");
  });

  it("appends failure guidance after failing verify", async () => {
    const state = makeState({
      codeGen: 1,
      verifiedGen: 0,
      lastVerifyOk: false,
      lastVerifyError: "test broken",
    });
    const result = makeResult("FAIL");

    const out = await mw.afterTool(state, makeToolCall("verify"), undefined, result);
    expect(out.content).toHaveLength(2);
    expect((out.content[1] as any).text).toContain("failed");
    expect((out.content[1] as any).text).toContain("test broken");
  });

  it("ignores non-verify tools", async () => {
    const state = makeState();
    const result = makeResult();

    const out = await mw.afterTool(state, makeToolCall("read_file"), undefined, result);
    expect(out.content).toHaveLength(1);
  });

  it("includes changed files in failure feedback", async () => {
    const state = makeState({
      codeGen: 2,
      verifiedGen: 0,
      lastVerifyOk: false,
      lastVerifyError: "test broken",
      changedFiles: [
        { generation: 1, path: "src/auth.ts", toolName: "write_file" },
        { generation: 2, path: "src/middleware.ts", toolName: "edit_file" },
      ],
    });
    const result = makeResult("FAIL");

    const out = await mw.afterTool(state, makeToolCall("verify"), undefined, result);
    expect((out.content[1] as any).text).toContain("src/auth.ts");
    expect((out.content[1] as any).text).toContain("src/middleware.ts");
  });

  it("handles empty file list gracefully", async () => {
    const state = makeState({
      codeGen: 1,
      verifiedGen: 0,
      lastVerifyOk: false,
      lastVerifyError: "test broken",
      changedFiles: [],
    });
    const result = makeResult("FAIL");

    const out = await mw.afterTool(state, makeToolCall("verify"), undefined, result);
    expect(out.content).toHaveLength(2);
    expect((out.content[1] as any).text).toContain("failed");
    expect((out.content[1] as any).text).not.toContain("Changed files:");
  });

  it("detects verification commands from arguments.command", async () => {
    const state = makeState({
      codeGen: 1,
      verifiedGen: 0,
      lastVerifyOk: false,
      lastVerifyError: "test failed",
      changedFiles: [],
    });
    const result = makeResult("FAIL");

    const tc = {
      id: "tc_1",
      name: "Bash",
      type: "toolCall",
      arguments: { command: "pnpm run test" },
    } as any;
    const out = await mw.afterTool(state, tc, undefined, result);

    expect(out.content).toHaveLength(2);
    expect((out.content[1] as any).text).toContain("Verification failed");
  });
});

describe("ToolCallGuardrailMiddleware", () => {
  it("has priority 10", () => {
    const mw = new ToolCallGuardrailMiddleware();
    expect(mw.priority).toBe(10);
  });

  it("allows tool calls below threshold", async () => {
    const mw = new ToolCallGuardrailMiddleware();
    const state = makeState();

    const result = await mw.beforeTool(state, makeToolCall("bash"), undefined);
    expect(result).toBeNull();
  });

  it("blocks tool after blockThreshold failures", async () => {
    const mw = new ToolCallGuardrailMiddleware();
    const state = makeState();

    // Simulate 5 failures (isError: true)
    for (let i = 0; i < 5; i++) {
      const failResult = {
        content: [{ type: "text" as const, text: "error" }],
        details: null,
        isError: true,
      };
      await mw.afterTool(state, makeToolCall("bash"), undefined, failResult);
    }

    const result = await mw.beforeTool(state, makeToolCall("bash"), undefined);
    expect(result).not.toBeNull();
    expect(result!.isError).toBe(true);
    expect((result!.content[0] as any).text).toContain("Blocked");
  });

  it("resets failure count on success", async () => {
    const mw = new ToolCallGuardrailMiddleware();
    const state = makeState();

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      const failResult = {
        content: [{ type: "text" as const, text: "error" }],
        details: null,
        isError: true,
      };
      await mw.afterTool(state, makeToolCall("bash"), undefined, failResult);
    }

    // Succeed once
    const okResult = { content: [{ type: "text" as const, text: "ok" }], details: null };
    await mw.afterTool(state, makeToolCall("bash"), undefined, okResult);

    // Should be allowed again
    const result = await mw.beforeTool(state, makeToolCall("bash"), undefined);
    expect(result).toBeNull();
  });

  it("reset clears all state", async () => {
    const mw = new ToolCallGuardrailMiddleware();
    const state = makeState();

    for (let i = 0; i < 5; i++) {
      const failResult = {
        content: [{ type: "text" as const, text: "error" }],
        details: null,
        isError: true,
      };
      await mw.afterTool(state, makeToolCall("bash"), undefined, failResult);
    }

    mw.reset();
    const result = await mw.beforeTool(state, makeToolCall("bash"), undefined);
    expect(result).toBeNull();
  });
});

describe("QualityGateMiddleware", () => {
  it("has priority 95", () => {
    const mw = new QualityGateMiddleware();
    expect(mw.priority).toBe(95);
  });

  it("does nothing when no unverified changes", async () => {
    const mw = new QualityGateMiddleware();
    const state = makeState({ codeGen: 0, verifiedGen: 0 });
    const response: LLMResponse = { content: [], stopReason: "end_turn" };

    const out = await mw.afterModel(state, response);
    expect(out.content).toHaveLength(0);
  });

  it("injects synthetic tool call when unverified changes exist", async () => {
    const mw = new QualityGateMiddleware();
    const state = makeState({
      codeGen: 2,
      verifiedGen: 1,
      lastVerifyOk: false,
      lastVerifyError: null,
    });
    const response: LLMResponse = { content: [], stopReason: "end_turn" };

    const out = await mw.afterModel(state, response);
    expect(out.content).toHaveLength(1);
    expect((out.content[0] as any).type).toBe("toolCall");
    expect((out.content[0] as any).name).toBe("__quality_gate__");
  });

  it("intercepts __quality_gate__ with file list", async () => {
    const mw = new QualityGateMiddleware();
    const state = makeState({
      codeGen: 2,
      verifiedGen: 0,
      changedFiles: [
        { generation: 1, path: "src/auth.ts", toolName: "write_file" },
        { generation: 2, path: "src/utils.ts", toolName: "edit_file" },
      ],
    });

    const result = await mw.beforeTool(state, makeToolCall("__quality_gate__"), undefined);
    expect(result).not.toBeNull();
    expect((result!.content[0] as any).text).toContain("2 file(s)");
    expect((result!.content[0] as any).text).toContain("src/auth.ts");
    expect((result!.content[0] as any).text).toContain("src/utils.ts");
  });

  it("uses fallback text when file list is empty", async () => {
    const mw = new QualityGateMiddleware();
    const state = makeState({
      codeGen: 1,
      verifiedGen: 0,
      changedFiles: [],
    });

    const result = await mw.beforeTool(state, makeToolCall("__quality_gate__"), undefined);
    expect(result).not.toBeNull();
    expect((result!.content[0] as any).text).toContain("file paths were not captured");
  });

  it("does not inject twice (sentFeedback flag)", async () => {
    const mw = new QualityGateMiddleware();
    const state = makeState({
      codeGen: 2,
      verifiedGen: 1,
      lastVerifyOk: false,
      lastVerifyError: null,
    });
    const response: LLMResponse = { content: [], stopReason: "end_turn" };

    await mw.afterModel(state, response);
    // Reset response
    const response2: LLMResponse = { content: [], stopReason: "end_turn" };
    const out = await mw.afterModel(state, response2);
    expect(out.content).toHaveLength(0); // Should not inject again
  });
});

describe("IntentGateMiddleware", () => {
  it("has priority 50", () => {
    const mw = new IntentGateMiddleware();
    expect(mw.priority).toBe(50);
  });

  it("injects plan reminder on first call", async () => {
    const mw = new IntentGateMiddleware();
    const state = makeState();

    await mw.beforeModel(state);
    expect(state.context.messages).toHaveLength(1);
    expect((state.context.messages[0] as any).content).toContain("plan");
  });

  it("does not inject twice", async () => {
    const mw = new IntentGateMiddleware();
    const state = makeState();

    await mw.beforeModel(state);
    await mw.beforeModel(state);
    expect(state.context.messages).toHaveLength(1);
  });

  it("reset allows re-injection", async () => {
    const mw = new IntentGateMiddleware();
    const state = makeState();

    await mw.beforeModel(state);
    mw.reset();
    await mw.beforeModel(state);
    expect(state.context.messages).toHaveLength(2);
  });
});
