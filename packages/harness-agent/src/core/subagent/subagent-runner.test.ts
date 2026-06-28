import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildSubagentPrompt,
  parseResultFile,
  validateResultFile,
  SubagentRunner,
} from "./subagent-runner.js";
import type { SubagentResultFile } from "./types.js";

describe("buildSubagentPrompt", () => {
  it("includes task description", () => {
    const prompt = buildSubagentPrompt({
      id: "test-1",
      task: "Fix the login bug",
      executor: "claude",
    });
    expect(prompt).toContain("Fix the login bug");
  });

  it("includes constraints", () => {
    const prompt = buildSubagentPrompt({
      id: "test-1",
      task: "Fix bug",
      executor: "claude",
      constraints: ["Only modify src/auth.ts", "Do not change tests"],
    });
    expect(prompt).toContain("Only modify src/auth.ts");
    expect(prompt).toContain("Do not change tests");
  });

  it("includes result file path", () => {
    const prompt = buildSubagentPrompt({
      id: "test-1",
      task: "Fix bug",
      executor: "claude",
    });
    expect(prompt).toContain(join(tmpdir(), "hk-result-test-1.json"));
  });

  it("uses explicit result path when provided", () => {
    const resultPath = join(tmpdir(), "custom-results", "hk-result-test-1.json");
    const prompt = buildSubagentPrompt(
      {
        id: "test-1",
        task: "Fix bug",
        executor: "claude",
      },
      resultPath,
    );
    expect(prompt).toContain(resultPath);
  });

  it("includes JSON format example", () => {
    const prompt = buildSubagentPrompt({
      id: "test-1",
      task: "Fix bug",
      executor: "claude",
    });
    expect(prompt).toContain("summary");
    expect(prompt).toContain("facts");
    expect(prompt).toContain("exactText");
  });
});

describe("parseResultFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "hk-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses valid JSON file", () => {
    const result: SubagentResultFile = {
      summary: "Fixed login bug",
      currentWork: "Modified auth.ts",
      facts: [
        { file: "src/auth.ts", startLine: 10, endLine: 20, exactText: "export function login()" },
      ],
    };
    const filePath = join(tmpDir, "result.json");
    writeFileSync(filePath, JSON.stringify(result), "utf-8");

    const parsed = parseResultFile(filePath);
    expect(parsed).not.toBeNull();
    expect(parsed!.summary).toBe("Fixed login bug");
    expect(parsed!.facts).toHaveLength(1);
  });

  it("returns null for missing file", () => {
    const parsed = parseResultFile(join(tmpDir, "nonexistent.json"));
    expect(parsed).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const filePath = join(tmpDir, "bad.json");
    writeFileSync(filePath, "not json", "utf-8");

    const parsed = parseResultFile(filePath);
    expect(parsed).toBeNull();
  });
});

describe("validateResultFile", () => {
  it("validates correct result", () => {
    const result: SubagentResultFile = {
      summary: "Done",
      currentWork: "Modified file",
      facts: [{ file: "src/a.ts", startLine: 1, endLine: 5, exactText: "const a = 1" }],
    };
    expect(validateResultFile(result)).toBe(true);
  });

  it("rejects missing summary", () => {
    const result = { currentWork: "x", facts: [] } as unknown as SubagentResultFile;
    expect(validateResultFile(result)).toBe(false);
  });

  it("rejects missing facts", () => {
    const result = { summary: "x", currentWork: "x" } as unknown as SubagentResultFile;
    expect(validateResultFile(result)).toBe(false);
  });

  it("rejects non-array facts", () => {
    const result = {
      summary: "x",
      currentWork: "x",
      facts: "not array",
    } as unknown as SubagentResultFile;
    expect(validateResultFile(result)).toBe(false);
  });

  it("rejects fact with missing fields", () => {
    const result = {
      summary: "x",
      currentWork: "x",
      facts: [{ file: "a.ts", startLine: 1 }], // missing endLine, exactText
    } as unknown as SubagentResultFile;
    expect(validateResultFile(result)).toBe(false);
  });

  it("accepts empty facts array", () => {
    const result: SubagentResultFile = {
      summary: "No changes needed",
      currentWork: "Verified",
      facts: [],
    };
    expect(validateResultFile(result)).toBe(true);
  });
});

describe("SubagentRunner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "hk-runner-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates unique subagent IDs", () => {
    const runner = new SubagentRunner({ resultDir: tmpDir });
    const id1 = runner.generateId();
    const id2 = runner.generateId();
    expect(id1).not.toBe(id2);
  });

  it("tracks active subagents", () => {
    const runner = new SubagentRunner({ resultDir: tmpDir });
    expect(runner.getActive()).toHaveLength(0);
    const id = runner.generateId();
    expect(runner.getActive()).toEqual([id]);
  });

  it("getResultPath returns correct path", () => {
    const runner = new SubagentRunner({ resultDir: tmpDir });
    const path = runner.getResultPath("test-123");
    expect(path).toBe(join(tmpDir, "hk-result-test-123.json"));
  });

  it("buildCommand writes the runner result path into the prompt", () => {
    const runner = new SubagentRunner({ resultDir: tmpDir });
    const built = runner.buildCommand({
      id: "test-123",
      task: "Fix bug",
      executor: "claude",
    });
    expect(built.args.join("\n")).toContain(join(tmpDir, "hk-result-test-123.json"));
  });

  it("collectResult reads and validates result file", () => {
    const runner = new SubagentRunner({ resultDir: tmpDir });
    const id = runner.generateId();
    const resultPath = runner.getResultPath(id);

    const result: SubagentResultFile = {
      summary: "Task done",
      currentWork: "Modified files",
      facts: [{ file: "src/a.ts", startLine: 1, endLine: 3, exactText: "hello" }],
    };
    writeFileSync(resultPath, JSON.stringify(result), "utf-8");

    const collected = runner.collectResult(id);
    expect(collected.success).toBe(true);
    expect(collected.block).toBeDefined();
    expect(collected.block!.currentWork).toBe("Modified files");
    expect(collected.block!.facts).toHaveLength(1);
    expect(runner.getActive()).not.toContain(id);
  });

  it("collectResult returns error for missing file", () => {
    const runner = new SubagentRunner({ resultDir: tmpDir });
    const id = runner.generateId();
    const collected = runner.collectResult(id);
    expect(collected.success).toBe(false);
    expect(collected.errorType).toBe("no_result");
    expect(runner.getActive()).not.toContain(id);
  });

  it("collectResult returns error for invalid JSON", () => {
    const runner = new SubagentRunner({ resultDir: tmpDir });
    const id = runner.generateId();
    writeFileSync(runner.getResultPath(id), "not json", "utf-8");

    const collected = runner.collectResult(id);
    expect(collected.success).toBe(false);
    expect(collected.errorType).toBe("invalid_json");
    expect(runner.getActive()).not.toContain(id);
  });

  it("collectResult returns error for invalid schema", () => {
    const runner = new SubagentRunner({ resultDir: tmpDir });
    const id = runner.generateId();
    writeFileSync(runner.getResultPath(id), JSON.stringify({ foo: "bar" }), "utf-8");

    const collected = runner.collectResult(id);
    expect(collected.success).toBe(false);
    expect(collected.errorType).toBe("invalid_schema");
    expect(runner.getActive()).not.toContain(id);
  });

  it("clearActive removes active subagent without collecting result", () => {
    const runner = new SubagentRunner({ resultDir: tmpDir });
    const id = runner.generateId();

    runner.clearActive(id);

    expect(runner.getActive()).not.toContain(id);
  });
});
