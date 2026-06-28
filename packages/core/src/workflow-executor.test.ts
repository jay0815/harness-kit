import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeWorkflow, type LlmExecutor } from "./workflow-executor.js";
import { loadWorkflow } from "./workflow-loader.js";
import type { WorkflowConfig } from "./workflow-schema.js";

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "hk-wf-"));
});

afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe("executeWorkflow", () => {
  it("executes dry-run for llm and code phases", async () => {
    const yaml = `
workflow: test
phases:
  - name: analyze
    executor: llm
    prompt: Analyze the code
  - name: build
    executor: code
    command: pnpm run build
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const run = await executeWorkflow({
      config,
      workflowDir: ws,
      dryRun: true,
    });

    expect(run.overallSuccess).toBe(true);
    expect(run.phases).toHaveLength(2);
    expect(run.phases[0].phaseName).toBe("analyze");
    expect(run.phases[0].output).toContain("[DRY RUN]");
    expect(run.phases[0].output).toContain("Analyze the code");
    expect(run.phases[1].phaseName).toBe("build");
    expect(run.phases[1].output).toContain("[DRY RUN]");
    expect(run.phases[1].output).toContain("pnpm run build");
  });

  it("substitutes template in dry-run", async () => {
    const yaml = `
workflow: test
phases:
  - name: lint
    executor: code
    command: pnpm run lint
  - name: review
    executor: llm
    prompt: "Review lint results: {{lint.output}}"
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const run = await executeWorkflow({
      config,
      workflowDir: ws,
      dryRun: true,
    });

    expect(run.overallSuccess).toBe(true);
    expect(run.phases[1].output).toContain("Review lint results:");
    expect(run.phases[1].output).toContain("[DRY RUN]");
  });

  it("stops on failure (fail-stop)", async () => {
    const yaml = `
workflow: test
phases:
  - name: fail
    executor: code
    command: exit 1
  - name: never
    executor: code
    command: echo should not run
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const run = await executeWorkflow({
      config,
      workflowDir: ws,
    });

    expect(run.overallSuccess).toBe(false);
    expect(run.phases).toHaveLength(1);
    expect(run.phases[0].phaseName).toBe("fail");
    expect(run.phases[0].success).toBe(false);
  });

  it("passes outputs between phases", async () => {
    const yaml = `
workflow: test
phases:
  - name: step1
    executor: code
    command: echo "step1 output"
  - name: step2
    executor: code
    command: echo "got from step1"
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const run = await executeWorkflow({
      config,
      workflowDir: ws,
    });

    expect(run.overallSuccess).toBe(true);
    expect(run.phases[0].output).toBe("step1 output");
    expect(run.phases[1].success).toBe(true);
  });

  it("uses LLM executor when provided", async () => {
    const yaml = `
workflow: test
phases:
  - name: llm-phase
    executor: llm
    prompt: Do something
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const llmExecutor: LlmExecutor = {
      execute: async (phase, _ctx) => ({
        success: true,
        output: `LLM executed: ${phase.name}`,
      }),
    };

    const run = await executeWorkflow({
      config,
      workflowDir: ws,
      llmExecutor,
    });

    expect(run.overallSuccess).toBe(true);
    expect(run.phases[0].output).toBe("LLM executed: llm-phase");
  });

  it("uses LLM executor for self phases", async () => {
    const yaml = `
workflow: test
phases:
  - name: self-phase
    executor: self
    prompt: Do something
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const llmExecutor: LlmExecutor = {
      execute: async (phase, _ctx) => ({
        success: true,
        output: `Self executed: ${phase.name}`,
      }),
    };

    const run = await executeWorkflow({
      config,
      workflowDir: ws,
      llmExecutor,
    });

    expect(run.overallSuccess).toBe(true);
    expect(run.phases[0].executor).toBe("self");
    expect(run.phases[0].output).toBe("Self executed: self-phase");
  });

  it("dry-runs subagent phases explicitly", async () => {
    const yaml = `
workflow: test
phases:
  - name: review
    executor: subagent
    prompt: Review changes
    subagentType: codex
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const run = await executeWorkflow({
      config,
      workflowDir: ws,
      dryRun: true,
    });

    expect(run.overallSuccess).toBe(true);
    expect(run.phases[0].executor).toBe("subagent");
    expect(run.phases[0].output).toContain("subagent codex");
  });

  it("reports unsupported subagent phases in executeWorkflow", async () => {
    const yaml = `
workflow: test
phases:
  - name: review
    executor: subagent
    prompt: Review changes
    subagentType: codex
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const run = await executeWorkflow({
      config,
      workflowDir: ws,
    });

    expect(run.overallSuccess).toBe(false);
    expect(run.phases[0].success).toBe(false);
    expect(run.phases[0].output).toContain("only supported by WorkflowRunner");
  });

  it("does not execute unknown executor as LLM", async () => {
    let llmCalled = false;
    const config = {
      workflow: "test",
      phases: [{ name: "bad", executor: "lml", prompt: "Do something" }],
    } as unknown as WorkflowConfig;

    const run = await executeWorkflow({
      config,
      workflowDir: ws,
      llmExecutor: {
        execute: async () => {
          llmCalled = true;
          return { success: true, output: "should not run" };
        },
      },
    });

    expect(run.overallSuccess).toBe(false);
    expect(run.phases[0].output).toContain('unknown executor "lml"');
    expect(llmCalled).toBe(false);
  });

  it("does not dry-run unknown executor as code", async () => {
    const config = {
      workflow: "test",
      phases: [{ name: "bad", executor: "lml", command: "echo wrong" }],
    } as unknown as WorkflowConfig;

    const run = await executeWorkflow({
      config,
      workflowDir: ws,
      dryRun: true,
    });

    expect(run.overallSuccess).toBe(false);
    expect(run.phases[0].output).toContain('unknown executor "lml"');
    expect(run.phases[0].output).not.toContain("echo wrong");
  });

  it("reports error when LLM executor missing", async () => {
    const yaml = `
workflow: test
phases:
  - name: llm-phase
    executor: llm
    prompt: Do something
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const run = await executeWorkflow({
      config,
      workflowDir: ws,
    });

    expect(run.overallSuccess).toBe(false);
    expect(run.phases[0].output).toContain("no LLM executor");
  });

  it("generates timestamps", async () => {
    const yaml = `
workflow: test
phases:
  - name: quick
    executor: code
    command: echo ok
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const run = await executeWorkflow({
      config,
      workflowDir: ws,
    });

    expect(run.startedAt).toBeDefined();
    expect(run.completedAt).toBeDefined();
    expect(new Date(run.startedAt).getTime()).toBeLessThanOrEqual(
      new Date(run.completedAt!).getTime(),
    );
  });

  it("aborts LLM phase on timeout", async () => {
    const yaml = `
workflow: test
phases:
  - name: slow-llm
    executor: llm
    prompt: Think hard
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const llmExecutor: LlmExecutor = {
      execute: async (_phase, ctx) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          ctx.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        return { success: true, output: "done" };
      },
    };

    const run = await executeWorkflow({
      config,
      workflowDir: ws,
      llmExecutor,
      timeoutMs: 100,
    });

    expect(run.overallSuccess).toBe(false);
    expect(run.phases[0].success).toBe(false);
    expect(run.phases[0].output).toContain("timed out");
  });

  it("completes LLM phase before timeout", async () => {
    const yaml = `
workflow: test
phases:
  - name: fast-llm
    executor: llm
    prompt: Quick task
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    const llmExecutor: LlmExecutor = {
      execute: async () => {
        return { success: true, output: "done fast" };
      },
    };

    const run = await executeWorkflow({
      config,
      workflowDir: ws,
      llmExecutor,
      timeoutMs: 5000,
    });

    expect(run.overallSuccess).toBe(true);
    expect(run.phases[0].output).toBe("done fast");
  });

  it("passes abort signal to LLM executor", async () => {
    const yaml = `
workflow: test
phases:
  - name: tracked
    executor: llm
    prompt: Track signal
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    let receivedSignal: AbortSignal | undefined;
    const llmExecutor: LlmExecutor = {
      execute: async (_phase, ctx) => {
        receivedSignal = ctx.signal;
        return { success: true, output: "ok" };
      },
    };

    await executeWorkflow({
      config,
      workflowDir: ws,
      llmExecutor,
      timeoutMs: 5000,
    });

    expect(receivedSignal).toBeDefined();
    expect(receivedSignal!.aborted).toBe(false);
  });

  it("aborts signal when LLM times out", async () => {
    const yaml = `
workflow: test
phases:
  - name: slow
    executor: llm
    prompt: Slow task
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    let receivedSignal: AbortSignal | undefined;
    const llmExecutor: LlmExecutor = {
      execute: async (_phase, ctx) => {
        receivedSignal = ctx.signal;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          ctx.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        return { success: true, output: "done" };
      },
    };

    const run = await executeWorkflow({
      config,
      workflowDir: ws,
      llmExecutor,
      timeoutMs: 100,
    });

    expect(run.overallSuccess).toBe(false);
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal!.aborted).toBe(true);
  });

  it("no timeout when timeoutMs not specified", async () => {
    const yaml = `
workflow: test
phases:
  - name: no-timeout
    executor: llm
    prompt: No rush
`;
    const filePath = join(ws, "workflow.yaml");
    writeFileSync(filePath, yaml);

    const config = loadWorkflow(filePath);
    let receivedSignal: AbortSignal | undefined;
    const llmExecutor: LlmExecutor = {
      execute: async (_phase, ctx) => {
        receivedSignal = ctx.signal;
        return { success: true, output: "done" };
      },
    };

    const run = await executeWorkflow({
      config,
      workflowDir: ws,
      llmExecutor,
    });

    expect(run.overallSuccess).toBe(true);
    expect(receivedSignal).toBeUndefined();
  });
});
