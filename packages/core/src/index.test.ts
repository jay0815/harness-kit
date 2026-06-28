import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { HarnessExtensionAPI } from "@harness-kit/agent";
import { FACT_VERIFICATION_KEY } from "@harness-kit/agent";
import type { FactVerificationMetadata } from "@harness-kit/agent";

function createMockPI(): HarnessExtensionAPI & {
  handlers: Record<string, (...args: unknown[]) => unknown>;
  sentMessages: string[];
} {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const sentMessages: string[] = [];

  const on = (event: string, handler: (...args: unknown[]) => unknown) => {
    handlers[event] = handler;
  };

  return {
    handlers,
    sentMessages,
    on: on as HarnessExtensionAPI["on"],
    registerTool: vi.fn(),
    sendUserMessage(content: string) {
      sentMessages.push(content);
    },
  };
}

function makeTurnEndEvent(overrides?: { text?: string; metadata?: Record<string, unknown> }) {
  const text = overrides?.text ?? "some output";
  return {
    turnIndex: 0,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
    metadata: overrides?.metadata,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "core-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("core turn_end handler — metadata path", () => {
  let harnessKitExtension: (pi: HarnessExtensionAPI) => void;

  beforeEach(async () => {
    const mod = await import("./index.js");
    harnessKitExtension = mod.default;
  });

  it("registers complete_phase tool for scheduler-driven completion", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);

    expect(pi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "complete_phase" }),
    );
  });

  it("with agentMeta.status=pass, does not call verifyFacts, does not sendUserMessage", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);

    // Simulate session_start
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    const agentMeta: FactVerificationMetadata = {
      status: "pass",
      block: {
        currentWork: "implemented auth",
        facts: [{ file: "auth.ts", startLine: 1, endLine: 3, exactText: "const auth = () => {}" }],
      },
      report: null,
      timestamp: Date.now(),
    };

    const event = makeTurnEndEvent({
      text: '<HK_RESULT>{"currentWork":"implemented auth","facts":[{"file":"auth.ts","startLine":1,"endLine":3,"exactText":"const auth = () => {}"}]}</HK_RESULT>',
      metadata: { [FACT_VERIFICATION_KEY]: agentMeta },
    });

    pi.handlers["turn_end"]?.(event);
    expect(pi.sentMessages).toHaveLength(0);
  });

  it("with agentMeta.status=fail and report, does not sendUserMessage", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    const agentMeta: FactVerificationMetadata = {
      status: "fail",
      block: {
        currentWork: "test",
        facts: [{ file: "a.ts", startLine: 1, endLine: 1, exactText: "x" }],
      },
      report: {
        overall: "FAIL",
        checks: [
          {
            fact: { file: "a.ts", startLine: 1, endLine: 1, exactText: "x" },
            status: "FAIL",
            error: "text mismatch",
          },
        ],
      },
      timestamp: Date.now(),
    };

    const event = makeTurnEndEvent({ metadata: { [FACT_VERIFICATION_KEY]: agentMeta } });
    pi.handlers["turn_end"]?.(event);

    expect(pi.sentMessages).toHaveLength(0);
  });

  it("with agentMeta.status=fail and report=null, does not fallback verify", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    const agentMeta: FactVerificationMetadata = {
      status: "fail",
      block: { currentWork: "test", facts: [] },
      report: null,
      timestamp: Date.now(),
    };

    const event = makeTurnEndEvent({ metadata: { [FACT_VERIFICATION_KEY]: agentMeta } });
    pi.handlers["turn_end"]?.(event);

    expect(pi.sentMessages).toHaveLength(0);
  });

  it("with agentMeta.status=missing, does not fallback verify", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    const agentMeta: FactVerificationMetadata = {
      status: "missing",
      block: null,
      report: null,
      timestamp: Date.now(),
    };

    const event = makeTurnEndEvent({ metadata: { [FACT_VERIFICATION_KEY]: agentMeta } });
    pi.handlers["turn_end"]?.(event);

    expect(pi.sentMessages).toHaveLength(0);
  });

  it("with agentMeta.status=empty, does not fallback verify", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    const agentMeta: FactVerificationMetadata = {
      status: "empty",
      block: { currentWork: "test", facts: [] },
      report: null,
      timestamp: Date.now(),
    };

    const event = makeTurnEndEvent({ metadata: { [FACT_VERIFICATION_KEY]: agentMeta } });
    pi.handlers["turn_end"]?.(event);

    expect(pi.sentMessages).toHaveLength(0);
  });

  it("without metadata, falls back to old verify logic", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    const event = makeTurnEndEvent({ text: "just text, no HK_RESULT" });
    pi.handlers["turn_end"]?.(event);

    // No HK_RESULT → early return, no sendUserMessage
    expect(pi.sentMessages).toHaveLength(0);
  });

  it("pass metadata advances phase (artifact saved)", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    // Write a file that matches the claimed fact
    writeFileSync(join(tmpDir, "auth.ts"), "const auth = () => {}\n");

    const agentMeta: FactVerificationMetadata = {
      status: "pass",
      block: {
        currentWork: "implemented auth",
        facts: [{ file: "auth.ts", startLine: 1, endLine: 1, exactText: "const auth = () => {}" }],
      },
      report: null,
      timestamp: Date.now(),
    };

    const event = makeTurnEndEvent({
      text: '<HK_RESULT>{"currentWork":"implemented auth","facts":[{"file":"auth.ts","startLine":1,"endLine":1,"exactText":"const auth = () => {}"}]}</HK_RESULT>',
      metadata: { [FACT_VERIFICATION_KEY]: agentMeta },
    });

    pi.handlers["turn_end"]?.(event);

    // Phase should have advanced — artifact and state saved
    const statePath = join(tmpDir, ".harness-kit", "state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(state.currentPhase).toBe(1);
    expect(state.phases[0].status).toBe("completed");
  });

  it("fail metadata does not advance phase", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    const agentMeta: FactVerificationMetadata = {
      status: "fail",
      block: {
        currentWork: "test",
        facts: [{ file: "a.ts", startLine: 1, endLine: 1, exactText: "x" }],
      },
      report: {
        overall: "FAIL",
        checks: [
          { fact: { file: "a.ts", startLine: 1, endLine: 1, exactText: "x" }, status: "FAIL" },
        ],
      },
      timestamp: Date.now(),
    };

    const event = makeTurnEndEvent({ metadata: { [FACT_VERIFICATION_KEY]: agentMeta } });
    pi.handlers["turn_end"]?.(event);

    // Phase should NOT have advanced — state still at phase 0
    const statePath = join(tmpDir, ".harness-kit", "state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(state.currentPhase).toBe(0);
    expect(state.phases[0].status).toBe("pending");
  });

  it("missing metadata does not advance phase", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    const agentMeta: FactVerificationMetadata = {
      status: "missing",
      block: null,
      report: null,
      timestamp: Date.now(),
    };

    const event = makeTurnEndEvent({ metadata: { [FACT_VERIFICATION_KEY]: agentMeta } });
    pi.handlers["turn_end"]?.(event);

    const statePath = join(tmpDir, ".harness-kit", "state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(state.currentPhase).toBe(0);
    expect(state.phases[0].status).toBe("pending");
  });
});
