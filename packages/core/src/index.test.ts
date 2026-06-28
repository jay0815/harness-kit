import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { HarnessExtensionAPI, ToolDefinition } from "@harness-kit/agent";
import { FACT_VERIFICATION_KEY } from "@harness-kit/agent";
import type { FactVerificationMetadata } from "@harness-kit/agent";

function createMockPI(): HarnessExtensionAPI & {
  handlers: Record<string, (...args: unknown[]) => unknown>;
  sentMessages: string[];
  tools: Record<string, ToolDefinition>;
} {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const sentMessages: string[] = [];
  const tools: Record<string, ToolDefinition> = {};

  const on = (event: string, handler: (...args: unknown[]) => unknown) => {
    handlers[event] = handler;
  };
  const registerTool = vi.fn((tool: ToolDefinition) => {
    tools[tool.name] = tool;
  });

  return {
    handlers,
    sentMessages,
    tools,
    on: on as HarnessExtensionAPI["on"],
    registerTool,
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

  it("registers scheduler tools for gated phase control", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);

    expect(pi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "complete_phase" }),
    );
    expect(pi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "confirm_phase" }),
    );
  });

  it("injects only the current phase and complete_phase contract", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    const result = pi.handlers["before_agent_start"]?.(
      { systemPrompt: "base" },
      { cwd: tmpDir },
    ) as { systemPrompt?: string } | undefined;

    expect(result?.systemPrompt).toContain("Current phase: **design**");
    expect(result?.systemPrompt).toContain("complete_phase");
    expect(result?.systemPrompt).toContain('phaseName: "design"');
    expect(result?.systemPrompt).not.toContain("2. **implement**");
  });

  it("injects awaiting-human prompt after a gated phase completes", () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    writeFileSync(join(tmpDir, "auth.ts"), "const auth = () => {}\n");
    const agentMeta: FactVerificationMetadata = {
      status: "pass",
      block: {
        currentWork: "completed design",
        facts: [{ file: "auth.ts", startLine: 1, endLine: 1, exactText: "const auth = () => {}" }],
      },
      report: null,
      timestamp: Date.now(),
    };
    pi.handlers["turn_end"]?.(
      makeTurnEndEvent({ metadata: { [FACT_VERIFICATION_KEY]: agentMeta } }),
    );

    const result = pi.handlers["before_agent_start"]?.(
      { systemPrompt: "base" },
      { cwd: tmpDir },
    ) as { systemPrompt?: string } | undefined;

    expect(result?.systemPrompt).toContain("Workflow is paused for human confirmation.");
    expect(result?.systemPrompt).toContain("- design (completed)");
    expect(result?.systemPrompt).toContain("Completed gated phase: **design**");
    expect(result?.systemPrompt).toContain("Next phase after approval: **implement**");
    expect(result?.systemPrompt).toContain("confirm_phase");
    expect(result?.systemPrompt).not.toContain("Current phase: **implement**");
    expect(result?.systemPrompt).not.toContain('phaseName: "implement"');
    expect(result?.systemPrompt).not.toContain("Current phase: **design**");
  });

  it("injects next phase after human confirmation clears the gate", async () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    writeFileSync(join(tmpDir, "auth.ts"), "const auth = () => {}\n");
    const block = {
      currentWork: "completed design",
      facts: [{ file: "auth.ts", startLine: 1, endLine: 1, exactText: "const auth = () => {}" }],
    };

    const completeResult = await pi.tools["complete_phase"].execute(
      "tc-complete",
      { phaseName: "design", result: block },
      undefined,
      undefined,
      { cwd: tmpDir, shutdown: () => {} },
    );
    expect(completeResult.details).toMatchObject({ status: "AWAITING_HUMAN" });

    const blockedPrompt = pi.handlers["before_agent_start"]?.(
      { systemPrompt: "base" },
      { cwd: tmpDir },
    ) as { systemPrompt?: string } | undefined;
    expect(blockedPrompt?.systemPrompt).toContain("Workflow is paused for human confirmation.");
    expect(blockedPrompt?.systemPrompt).not.toContain("Current phase: **implement**");

    const confirmResult = await pi.tools["confirm_phase"].execute(
      "tc-confirm",
      { phaseName: "design" },
      undefined,
      undefined,
      { cwd: tmpDir, shutdown: () => {} },
    );
    expect(confirmResult.details).toMatchObject({ status: "HUMAN_CONFIRMED" });

    const result = pi.handlers["before_agent_start"]?.(
      { systemPrompt: "base" },
      { cwd: tmpDir },
    ) as { systemPrompt?: string } | undefined;
    expect(result?.systemPrompt).toContain("Current phase: **implement**");
    expect(result?.systemPrompt).toContain('phaseName: "implement"');
    expect(result?.systemPrompt).not.toContain("Workflow is paused for human confirmation.");
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

  it("does not advance again from turn_end after complete_phase succeeds in the same turn", async () => {
    const pi = createMockPI();
    harnessKitExtension(pi);
    pi.handlers["session_start"]?.({}, { cwd: tmpDir });

    writeFileSync(join(tmpDir, "auth.ts"), "const auth = () => {}\n");
    const block = {
      currentWork: "completed design",
      facts: [{ file: "auth.ts", startLine: 1, endLine: 1, exactText: "const auth = () => {}" }],
    };

    const completeResult = await pi.tools["complete_phase"].execute(
      "tc-complete",
      { phaseName: "design", result: block },
      undefined,
      undefined,
      { cwd: tmpDir, shutdown: () => {} },
    );
    expect(completeResult.isError).toBeUndefined();

    const agentMeta: FactVerificationMetadata = {
      status: "pass",
      block,
      report: null,
      timestamp: Date.now(),
    };
    pi.handlers["turn_end"]?.(
      makeTurnEndEvent({ metadata: { [FACT_VERIFICATION_KEY]: agentMeta } }),
    );

    const statePath = join(tmpDir, ".harness-kit", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(state.currentPhase).toBe(1);
    expect(state.phases[0].status).toBe("completed");
    expect(state.phases[1].status).toBe("pending");
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
