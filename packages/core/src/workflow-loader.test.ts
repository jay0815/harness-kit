import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadWorkflow, substituteTemplate, WorkflowLoadError } from "./workflow-loader.js";

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "hk-workflow-"));
});

afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe("loadWorkflow", () => {
  it("loads valid workflow", () => {
    const yaml = `
workflow: test-workflow
description: A test workflow
phases:
  - name: design
    executor: self
    prompt: Design this
  - name: analyze
    executor: llm
    prompt: Analyze this
  - name: build
    executor: code
    command: pnpm run build
  - name: review
    executor: subagent
    prompt: Review this
    subagentType: claude
    subagentConstraints:
      - Only inspect src/
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    expect(config.workflow).toBe("test-workflow");
    expect(config.phases).toHaveLength(4);
    expect(config.phases[0].name).toBe("design");
    expect(config.phases[0].executor).toBe("self");
    expect(config.phases[1].name).toBe("analyze");
    expect(config.phases[1].executor).toBe("llm");
    expect(config.phases[2].name).toBe("build");
    expect(config.phases[2].executor).toBe("code");
    expect(config.phases[3].executor).toBe("subagent");
    expect(config.phases[3].subagentType).toBe("claude");
  });

  it("throws on missing file", () => {
    expect(() => loadWorkflow(join(ws, "nonexistent.yaml"))).toThrow(WorkflowLoadError);
  });

  it("throws on invalid YAML", () => {
    const filePath = join(ws, "bad.yaml");
    writeFileSync(filePath, "{{invalid yaml");

    expect(() => loadWorkflow(filePath)).toThrow(WorkflowLoadError);
  });

  it("throws on missing workflow name", () => {
    const yaml = `
phases:
  - name: test
    executor: llm
    prompt: test
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    expect(() => loadWorkflow(filePath)).toThrow(WorkflowLoadError);
  });

  it("throws on empty phases", () => {
    const yaml = `
workflow: test
phases: []
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    expect(() => loadWorkflow(filePath)).toThrow(WorkflowLoadError);
  });

  it("throws on duplicate phase names", () => {
    const yaml = `
workflow: test
phases:
  - name: dup
    executor: llm
    prompt: test
  - name: dup
    executor: code
    command: echo ok
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    expect(() => loadWorkflow(filePath)).toThrow(WorkflowLoadError);
  });

  it("throws on llm phase without prompt", () => {
    const yaml = `
workflow: test
phases:
  - name: test
    executor: llm
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    expect(() => loadWorkflow(filePath)).toThrow(WorkflowLoadError);
  });

  it("throws on self phase without prompt", () => {
    const yaml = `
workflow: test
phases:
  - name: test
    executor: self
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    expect(() => loadWorkflow(filePath)).toThrow(WorkflowLoadError);
  });

  it("throws on code phase without command or script", () => {
    const yaml = `
workflow: test
phases:
  - name: test
    executor: code
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    expect(() => loadWorkflow(filePath)).toThrow(WorkflowLoadError);
  });

  it("throws on code phase with both command and script", () => {
    const yaml = `
workflow: test
phases:
  - name: test
    executor: code
    command: echo ok
    script: ./test.ts
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    expect(() => loadWorkflow(filePath)).toThrow(WorkflowLoadError);
  });

  it("throws on subagent phase without prompt", () => {
    const yaml = `
workflow: test
phases:
  - name: test
    executor: subagent
    subagentType: claude
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    expect(() => loadWorkflow(filePath)).toThrow(WorkflowLoadError);
  });

  it("throws on invalid subagent type", () => {
    const yaml = `
workflow: test
phases:
  - name: test
    executor: subagent
    prompt: Review
    subagentType: unknown
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    expect(() => loadWorkflow(filePath)).toThrow(WorkflowLoadError);
  });

  it("throws on zero subagent timeout", () => {
    const yaml = `
workflow: test
phases:
  - name: test
    executor: subagent
    prompt: Review
    subagentTimeoutMs: 0
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    expect(() => loadWorkflow(filePath)).toThrow(WorkflowLoadError);
  });
});

describe("substituteTemplate", () => {
  it("replaces phase output references", () => {
    const results = new Map([
      ["lint", "3 warnings found"],
      ["test", "All tests passed"],
    ]);

    const template = "Lint: {{lint.output}}\nTest: {{test.output}}";
    const result = substituteTemplate(template, results);

    expect(result).toBe("Lint: 3 warnings found\nTest: All tests passed");
  });

  it("keeps unresolved references", () => {
    const results = new Map([["lint", "ok"]]);

    const template = "Lint: {{lint.output}}\nBuild: {{build.output}}";
    const result = substituteTemplate(template, results);

    expect(result).toBe("Lint: ok\nBuild: {{build.output}}");
  });

  it("handles empty results map", () => {
    const template = "{{phase.output}}";
    const result = substituteTemplate(template, new Map());

    expect(result).toBe("{{phase.output}}");
  });
});
