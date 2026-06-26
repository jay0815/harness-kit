import { describe, it, expect, beforeEach } from "vitest";
import { ErrorRecoveryMiddleware } from "./error-recovery-middleware.js";
import { ERROR_RECOVERY_KEY, ErrorType } from "./types.js";
import type { RuntimeState, AgentToolResult } from "../types.js";
import { mockToolCall } from "../test-utils.js";

function makeState(): RuntimeState {
  return {
    context: { systemPrompt: "", messages: [] },
    iteration: 0,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextWindow: 200_000 },
    metadata: {},
  };
}

function makeResult(text = "ok", isError = false): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text }],
    details: null,
    isError,
  };
}

describe("ErrorRecoveryMiddleware", () => {
  let middleware: ErrorRecoveryMiddleware;

  beforeEach(() => {
    middleware = new ErrorRecoveryMiddleware();
  });

  it("has correct priority and name", () => {
    expect(middleware.priority).toBe(15); // PRIORITY_GUARD + 5
    expect(middleware.name).toBe("ErrorRecovery");
  });

  it("passes through successful results", async () => {
    const state = makeState();
    const result = await middleware.afterTool(state, mockToolCall("write_file"), undefined, makeResult());
    expect(result.isError).toBeFalsy();
  });

  it("resets consecutiveUnknown on success", async () => {
    const state = makeState();
    state.metadata[ERROR_RECOVERY_KEY] = {
      errors: [],
      toolFailureCounts: new Map(),
      blacklistedTools: new Set(),
      consecutiveUnknown: 3,
    };
    await middleware.afterTool(state, mockToolCall("write_file"), undefined, makeResult());
    const es = state.metadata[ERROR_RECOVERY_KEY] as { consecutiveUnknown: number };
    expect(es.consecutiveUnknown).toBe(0);
  });

  it("classifies and records tool errors", async () => {
    const state = makeState();
    const result = await middleware.afterTool(
      state,
      mockToolCall("bash"),
      undefined,
      makeResult("ECONNRESET", true),
    );
    expect(result.isError).toBe(true);
    const es = state.metadata[ERROR_RECOVERY_KEY] as { errors: Array<{ errorType: string }> };
    expect(es.errors).toHaveLength(1);
    expect(es.errors[0].errorType).toBe(ErrorType.TIMEOUT);
  });

  it("appends recovery feedback to error result", async () => {
    const state = makeState();
    const result = await middleware.afterTool(
      state,
      mockToolCall("bash"),
      undefined,
      makeResult("EACCES: permission denied", true),
    );
    const text = result.content.map((c) => (c as { text: string }).text).join("");
    expect(text).toContain("[ErrorRecovery]");
    expect(text).toContain("Permission denied");
  });

  it("sets terminate flag on ABORT", async () => {
    const state = makeState();
    const result = await middleware.afterTool(
      state,
      mockToolCall("bash"),
      undefined,
      makeResult("EACCES: permission denied", true),
    );
    expect(result.terminate).toBe(true);
  });

  it("does not append feedback on RETRY_SAME", async () => {
    const state = makeState();
    const result = await middleware.afterTool(
      state,
      mockToolCall("write_file"),
      undefined,
      makeResult("ENOENT: no such file", true),
    );
    // First TOOL_ERROR → RETRY_SAME, no extra feedback
    const text = result.content.map((c) => (c as { text: string }).text).join("");
    expect(text).not.toContain("[ErrorRecovery]");
  });

  it("blacklists tool after threshold failures", async () => {
    const state = makeState();
    const toolCall = mockToolCall("write_file");

    // Fail 3 times (blacklistThreshold = 3)
    for (let i = 0; i < 3; i++) {
      await middleware.afterTool(state, toolCall, undefined, makeResult("ENOENT", true));
    }

    const es = state.metadata[ERROR_RECOVERY_KEY] as { blacklistedTools: Set<string> };
    expect(es.blacklistedTools.has("write_file")).toBe(true);

    // 4th call should get SWITCH_TOOL
    const result = await middleware.afterTool(state, toolCall, undefined, makeResult("ENOENT", true));
    const text = result.content.map((c) => (c as { text: string }).text).join("");
    expect(text).toContain("disabled");
  });

  it("increments tool failure count", async () => {
    const state = makeState();
    await middleware.afterTool(state, mockToolCall("bash"), undefined, makeResult("error1", true));
    await middleware.afterTool(state, mockToolCall("bash"), undefined, makeResult("error2", true));

    const es = state.metadata[ERROR_RECOVERY_KEY] as { toolFailureCounts: Map<string, number> };
    expect(es.toolFailureCounts.get("bash")).toBe(2);
  });

  it("resets tool failure count on success", async () => {
    const state = makeState();
    await middleware.afterTool(state, mockToolCall("bash"), undefined, makeResult("error", true));
    await middleware.afterTool(state, mockToolCall("bash"), undefined, makeResult("ok", false));

    const es = state.metadata[ERROR_RECOVERY_KEY] as { toolFailureCounts: Map<string, number> };
    expect(es.toolFailureCounts.has("bash")).toBe(false);
  });
});
