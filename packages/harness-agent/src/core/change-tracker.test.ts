import { describe, it, expect } from "vitest";
import {
  ChangeTracker,
  hasUnverifiedChanges,
  isLastVerifyOk,
  getLastVerifyError,
  CHANGE_TRACKER_KEY,
} from "./change-tracker.js";
import type { RuntimeState, AgentToolCall, AgentToolResult } from "./types.js";

function makeState(): RuntimeState {
  return {
    context: { systemPrompt: "", messages: [] },
    iteration: 0,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextWindow: 200_000 },
    metadata: {},
  };
}

function makeToolCall(name: string, input?: Record<string, unknown>): AgentToolCall {
  return { id: "tc_1", name, type: "toolCall", input } as any;
}

function makeResult(text = "ok", isError = false): AgentToolResult<any> {
  return {
    content: [{ type: "text", text }],
    details: null,
    isError,
  };
}

describe("ChangeTracker", () => {
  const tracker = new ChangeTracker();

  it("has correct priority and name", () => {
    expect(tracker.priority).toBe(10);
    expect(tracker.name).toBe("ChangeTracker");
  });

  it("increments codeGen on code-modifying tool", async () => {
    const state = makeState();
    await tracker.afterTool(state, makeToolCall("write_file"), undefined, makeResult());
    expect((state.metadata[CHANGE_TRACKER_KEY] as any).codeGen).toBe(1);
  });

  it("does not increment codeGen on non-code tool", async () => {
    const state = makeState();
    await tracker.afterTool(state, makeToolCall("read_file"), undefined, makeResult());
    expect(state.metadata[CHANGE_TRACKER_KEY]).toBeUndefined();
  });

  it("skips errored results", async () => {
    const state = makeState();
    await tracker.afterTool(
      state,
      makeToolCall("write_file"),
      undefined,
      makeResult("error", true),
    );
    expect(state.metadata[CHANGE_TRACKER_KEY]).toBeUndefined();
  });

  it("sets verifiedGen on successful verify", async () => {
    const state = makeState();
    // First, make a code change
    await tracker.afterTool(state, makeToolCall("write_file"), undefined, makeResult());
    expect((state.metadata[CHANGE_TRACKER_KEY] as any).codeGen).toBe(1);
    expect((state.metadata[CHANGE_TRACKER_KEY] as any).verifiedGen).toBe(0);

    // Then verify
    await tracker.afterTool(state, makeToolCall("verify"), undefined, makeResult());
    expect((state.metadata[CHANGE_TRACKER_KEY] as any).verifiedGen).toBe(1);
    expect(isLastVerifyOk(state)).toBe(true);
  });

  it("tracks verify failure via isError flag", async () => {
    const state = makeState();
    await tracker.afterTool(
      state,
      makeToolCall("verify"),
      undefined,
      makeResult("FAIL: test broken", true),
    );
    // Verify failure updates lastVerifyOk/lastVerifyError but NOT verifiedGen
    expect(isLastVerifyOk(state)).toBe(false);
    expect(getLastVerifyError(state)).toContain("FAIL: test broken");
    expect((state.metadata[CHANGE_TRACKER_KEY] as any).verifiedGen).toBe(0);
  });

  it("detects bash verify commands", async () => {
    const state = makeState();
    await tracker.afterTool(state, makeToolCall("write_file"), undefined, makeResult());

    await tracker.afterTool(
      state,
      makeToolCall("Bash", { command: "pnpm run test" }),
      undefined,
      makeResult(),
    );
    expect(isLastVerifyOk(state)).toBe(true);
    expect(hasUnverifiedChanges(state)).toBe(false);
  });

  it("detects tsc --noEmit as verify", async () => {
    const state = makeState();
    await tracker.afterTool(state, makeToolCall("write_file"), undefined, makeResult());

    await tracker.afterTool(
      state,
      makeToolCall("Bash", { command: "tsc --noEmit" }),
      undefined,
      makeResult(),
    );
    expect(isLastVerifyOk(state)).toBe(true);
  });
});

describe("helper functions", () => {
  it("hasUnverifiedChanges returns false when no changes", () => {
    const state = makeState();
    expect(hasUnverifiedChanges(state)).toBe(false);
  });

  it("hasUnverifiedChanges returns true when codeGen > verifiedGen", () => {
    const state = makeState();
    state.metadata[CHANGE_TRACKER_KEY] = {
      codeGen: 2,
      verifiedGen: 1,
      lastVerifyOk: true,
      lastVerifyError: null,
    };
    expect(hasUnverifiedChanges(state)).toBe(true);
  });

  it("hasUnverifiedChanges returns false when codeGen === verifiedGen", () => {
    const state = makeState();
    state.metadata[CHANGE_TRACKER_KEY] = {
      codeGen: 2,
      verifiedGen: 2,
      lastVerifyOk: true,
      lastVerifyError: null,
    };
    expect(hasUnverifiedChanges(state)).toBe(false);
  });

  it("isLastVerifyOk returns false by default", () => {
    expect(isLastVerifyOk(makeState())).toBe(false);
  });

  it("getLastVerifyError returns null by default", () => {
    expect(getLastVerifyError(makeState())).toBeNull();
  });
});
