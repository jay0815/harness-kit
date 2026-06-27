import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { WorkflowConfig, PhaseConfig, ExecutorType } from "./workflow-schema.js";

describe("WorkflowConfig schema", () => {
  it("accepts valid workflow", () => {
    const config = {
      workflow: "test-workflow",
      description: "A test workflow",
      phases: [
        { name: "design", executor: "self", prompt: "Design this" },
        { name: "analyze", executor: "llm", prompt: "Analyze this" },
        { name: "build", executor: "code", command: "pnpm run build" },
        { name: "review", executor: "subagent", prompt: "Review this", subagentType: "claude" },
      ],
    };
    expect(Value.Check(WorkflowConfig, config)).toBe(true);
  });

  it("rejects empty workflow name", () => {
    const config = {
      workflow: "",
      phases: [{ name: "test", executor: "llm", prompt: "test" }],
    };
    expect(Value.Check(WorkflowConfig, config)).toBe(false);
  });

  it("rejects empty phases array", () => {
    const config = {
      workflow: "test",
      phases: [],
    };
    expect(Value.Check(WorkflowConfig, config)).toBe(false);
  });

  it("rejects duplicate phase names", () => {
    // Schema allows it, but loader should catch it
    const config = {
      workflow: "test",
      phases: [
        { name: "dup", executor: "llm", prompt: "test" },
        { name: "dup", executor: "code", command: "echo ok" },
      ],
    };
    // Schema validation passes (duplicates are caught at load time)
    expect(Value.Check(WorkflowConfig, config)).toBe(true);
  });
});

describe("PhaseConfig schema", () => {
  it("accepts self executor with prompt", () => {
    const phase = {
      name: "test",
      executor: "self",
      prompt: "Do something",
    };
    expect(Value.Check(PhaseConfig, phase)).toBe(true);
  });

  it("accepts llm executor with prompt", () => {
    const phase = {
      name: "test",
      executor: "llm",
      prompt: "Do something",
    };
    expect(Value.Check(PhaseConfig, phase)).toBe(true);
  });

  it("accepts code executor with command", () => {
    const phase = {
      name: "test",
      executor: "code",
      command: "echo hello",
    };
    expect(Value.Check(PhaseConfig, phase)).toBe(true);
  });

  it("accepts code executor with script", () => {
    const phase = {
      name: "test",
      executor: "code",
      script: "./scripts/check.ts",
    };
    expect(Value.Check(PhaseConfig, phase)).toBe(true);
  });

  it("accepts subagent executor with subagent settings", () => {
    const phase = {
      name: "review",
      executor: "subagent",
      prompt: "Review the changes",
      subagentType: "codex",
      subagentConstraints: ["Only inspect src/"],
      subagentTimeoutMs: 120000,
      subagentSettings: "/tmp/settings.json",
    };
    expect(Value.Check(PhaseConfig, phase)).toBe(true);
  });

  it("rejects invalid subagent executor type", () => {
    const phase = {
      name: "review",
      executor: "subagent",
      prompt: "Review the changes",
      subagentType: "unknown",
    };
    expect(Value.Check(PhaseConfig, phase)).toBe(false);
  });

  it("rejects invalid executor type", () => {
    const phase = {
      name: "test",
      executor: "invalid",
    };
    expect(Value.Check(PhaseConfig, phase)).toBe(false);
  });

  it("rejects empty phase name", () => {
    const phase = {
      name: "",
      executor: "llm",
      prompt: "test",
    };
    expect(Value.Check(PhaseConfig, phase)).toBe(false);
  });
});

describe("ExecutorType", () => {
  it("accepts self", () => {
    expect(Value.Check(ExecutorType, "self")).toBe(true);
  });

  it("accepts llm", () => {
    expect(Value.Check(ExecutorType, "llm")).toBe(true);
  });

  it("accepts code", () => {
    expect(Value.Check(ExecutorType, "code")).toBe(true);
  });

  it("accepts subagent", () => {
    expect(Value.Check(ExecutorType, "subagent")).toBe(true);
  });

  it("rejects other values", () => {
    expect(Value.Check(ExecutorType, "other")).toBe(false);
  });
});
