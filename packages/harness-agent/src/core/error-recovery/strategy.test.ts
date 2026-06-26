import { describe, it, expect } from "vitest";
import { decideRecovery } from "./strategy.js";
import { ErrorType, RecoveryAction, type ErrorRecoveryState } from "./types.js";

function makeState(overrides?: Partial<ErrorRecoveryState>): ErrorRecoveryState {
  return {
    errors: [],
    toolFailureCounts: new Map(),
    blacklistedTools: new Set(),
    consecutiveUnknown: 0,
    ...overrides,
  };
}

describe("decideRecovery", () => {
  it("aborts on PERMISSION_DENIED", () => {
    const decision = decideRecovery("bash", ErrorType.PERMISSION_DENIED, makeState());
    expect(decision.action).toBe(RecoveryAction.ABORT);
  });

  it("retries on TIMEOUT", () => {
    const decision = decideRecovery("bash", ErrorType.TIMEOUT, makeState());
    expect(decision.action).toBe(RecoveryAction.WAIT_AND_RETRY);
    expect(decision.backoffMs).toBeGreaterThan(0);
  });

  it("retries with longer backoff on RESOURCE_EXHAUSTED", () => {
    const decision = decideRecovery("llm", ErrorType.RESOURCE_EXHAUSTED, makeState());
    expect(decision.action).toBe(RecoveryAction.WAIT_AND_RETRY);
    expect(decision.backoffMs).toBeGreaterThanOrEqual(2000);
  });

  it("reduces scope on PARSE_ERROR", () => {
    const decision = decideRecovery("bash", ErrorType.PARSE_ERROR, makeState());
    expect(decision.action).toBe(RecoveryAction.REDUCE_SCOPE);
  });

  it("retries same tool on first TOOL_ERROR", () => {
    const state = makeState();
    state.toolFailureCounts.set("write_file", 1);
    const decision = decideRecovery("write_file", ErrorType.TOOL_ERROR, state);
    expect(decision.action).toBe(RecoveryAction.RETRY_SAME);
  });

  it("switches tool after max retries", () => {
    const state = makeState();
    state.toolFailureCounts.set("write_file", 3);
    const decision = decideRecovery("write_file", ErrorType.TOOL_ERROR, state, { maxRetriesPerTool: 3 });
    expect(decision.action).toBe(RecoveryAction.SWITCH_TOOL);
  });

  it("blacklists tool after threshold", () => {
    const state = makeState();
    state.toolFailureCounts.set("write_file", 3);
    const decision = decideRecovery("write_file", ErrorType.TOOL_ERROR, state, { blacklistThreshold: 3 });
    expect(decision.action).toBe(RecoveryAction.SWITCH_TOOL);
    expect(decision.blacklisted).toBe(true);
  });

  it("switches tool if already blacklisted", () => {
    const state = makeState();
    state.blacklistedTools.add("write_file");
    const decision = decideRecovery("write_file", ErrorType.TOOL_ERROR, state);
    expect(decision.action).toBe(RecoveryAction.SWITCH_TOOL);
    expect(decision.blacklisted).toBe(true);
  });

  it("aborts after too many consecutive unknown errors", () => {
    const state = makeState({ consecutiveUnknown: 5 });
    const decision = decideRecovery("bash", ErrorType.UNKNOWN, state, { maxConsecutiveUnknown: 5 });
    expect(decision.action).toBe(RecoveryAction.ABORT);
  });

  it("retries on first unknown error", () => {
    const state = makeState({ consecutiveUnknown: 1 });
    const decision = decideRecovery("bash", ErrorType.UNKNOWN, state);
    expect(decision.action).toBe(RecoveryAction.RETRY_SAME);
  });

  it("upgrades model on MODEL_ERROR", () => {
    const decision = decideRecovery("llm", ErrorType.MODEL_ERROR, makeState());
    expect(decision.action).toBe(RecoveryAction.UPGRADE_MODEL);
  });

  it("includes feedback string in all decisions", () => {
    const types = Object.values(ErrorType);
    for (const errorType of types) {
      const decision = decideRecovery("test", errorType, makeState());
      expect(decision.feedback).toBeTruthy();
      expect(decision.feedback.length).toBeGreaterThan(0);
    }
  });
});
