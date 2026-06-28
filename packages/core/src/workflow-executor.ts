import type { WorkflowConfig, PhaseConfig, PhaseResult, WorkflowRun } from "./workflow-schema.js";
import { substituteTemplate } from "./workflow-loader.js";
import { executeCode, type ExecuteCodeOptions } from "./code-executor.js";

export interface WorkflowExecutorOptions {
  config: WorkflowConfig;
  workflowDir: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  dryRun?: boolean;
  llmExecutor?: LlmExecutor;
}

export interface LlmExecutor {
  execute(
    phase: PhaseConfig,
    context: { previousResults: Map<string, string>; signal?: AbortSignal },
  ): Promise<{ success: boolean; output: string }>;
}

export async function executeWorkflow(options: WorkflowExecutorOptions): Promise<WorkflowRun> {
  const { config, workflowDir, env, timeoutMs, dryRun, llmExecutor } = options;

  const run: WorkflowRun = {
    workflow: config.workflow,
    phases: [],
    overallSuccess: true,
    startedAt: new Date().toISOString(),
  };

  const outputs = new Map<string, string>();

  for (const phase of config.phases) {
    const result = dryRun
      ? executePhaseDryRun(phase, outputs)
      : await executePhase(phase, {
          workflowDir,
          env,
          timeoutMs,
          outputs,
          llmExecutor,
        });

    run.phases.push(result);
    outputs.set(phase.name, result.output);

    if (!result.success) {
      run.overallSuccess = false;
      break; // Fail-stop
    }
  }

  run.completedAt = new Date().toISOString();
  return run;
}

async function executePhase(
  phase: PhaseConfig,
  context: {
    workflowDir: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    outputs: Map<string, string>;
    llmExecutor?: LlmExecutor;
  },
): Promise<PhaseResult> {
  const executor = getExecutor(phase);

  switch (executor) {
    case "code": {
      const options: ExecuteCodeOptions = {
        phase,
        workflowDir: context.workflowDir,
        env: context.env,
        timeoutMs: context.timeoutMs,
      };
      return executeCode(options);
    }
    case "subagent":
      return {
        phaseName: phase.name,
        executor,
        success: false,
        output: 'Error: executor "subagent" is only supported by WorkflowRunner',
        durationMs: 0,
      };
    case "llm":
    case "self":
      return executeLlmPhase(phase, context);
    default:
      return {
        phaseName: phase.name,
        executor,
        success: false,
        output: `Error: unknown executor "${executor}"`,
        durationMs: 0,
      };
  }
}

async function executeLlmPhase(
  phase: PhaseConfig,
  context: {
    outputs: Map<string, string>;
    timeoutMs?: number;
    llmExecutor?: LlmExecutor;
  },
): Promise<PhaseResult> {
  const executor = getExecutor(phase);

  if (!context.llmExecutor) {
    return {
      phaseName: phase.name,
      executor,
      success: false,
      output: "Error: no LLM executor provided",
      durationMs: 0,
    };
  }

  const startTime = Date.now();
  const timeoutMs = context.timeoutMs;

  let signal: AbortSignal | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  if (timeoutMs && timeoutMs > 0) {
    controller = new AbortController();
    signal = controller.signal;
    timer = setTimeout(() => controller!.abort(), timeoutMs);
  }

  try {
    const result = await context.llmExecutor.execute(phase, {
      previousResults: context.outputs,
      signal,
    });

    return {
      phaseName: phase.name,
      executor,
      success: result.success,
      output: result.output,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      phaseName: phase.name,
      executor,
      success: false,
      output: isAbort
        ? `Error: LLM phase "${phase.name}" timed out after ${timeoutMs}ms`
        : `Error: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function executePhaseDryRun(phase: PhaseConfig, outputs: Map<string, string>): PhaseResult {
  const executor = getExecutor(phase);

  switch (executor) {
    case "llm":
    case "self": {
      const prompt = phase.prompt ? substituteTemplate(phase.prompt, outputs) : "(no prompt)";

      return {
        phaseName: phase.name,
        executor,
        success: true,
        output: `[DRY RUN] Would execute LLM with prompt:\n${prompt}`,
        durationMs: 0,
      };
    }
    case "subagent": {
      const prompt = phase.prompt ? substituteTemplate(phase.prompt, outputs) : "(no prompt)";
      return {
        phaseName: phase.name,
        executor,
        success: true,
        output: `[DRY RUN] Would execute subagent ${phase.subagentType ?? "claude"} with prompt:\n${prompt}`,
        durationMs: 0,
      };
    }
    case "code": {
      const command = phase.command ?? phase.script ?? "(unknown)";
      return {
        phaseName: phase.name,
        executor,
        success: true,
        output: `[DRY RUN] Would execute: ${command}`,
        durationMs: 0,
      };
    }
    default:
      return {
        phaseName: phase.name,
        executor,
        success: false,
        output: `Error: unknown executor "${executor}"`,
        durationMs: 0,
      };
  }
}

function getExecutor(phase: PhaseConfig): string {
  return String((phase as { executor?: unknown }).executor ?? "");
}
