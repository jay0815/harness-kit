import type {
  WorkflowConfig,
  PhaseConfig,
  PhaseResult,
  WorkflowRun,
} from "./workflow-schema.js";
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
    context: { previousResults: Map<string, string> },
  ): Promise<{ success: boolean; output: string }>;
}

export async function executeWorkflow(
  options: WorkflowExecutorOptions,
): Promise<WorkflowRun> {
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
  if (phase.executor === "code") {
    const options: ExecuteCodeOptions = {
      phase,
      workflowDir: context.workflowDir,
      env: context.env,
      timeoutMs: context.timeoutMs,
    };
    return executeCode(options);
  }

  // LLM executor
  if (!context.llmExecutor) {
    return {
      phaseName: phase.name,
      executor: "llm",
      success: false,
      output: "Error: no LLM executor provided",
      durationMs: 0,
    };
  }

  const startTime = Date.now();
  const result = await context.llmExecutor.execute(phase, {
    previousResults: context.outputs,
  });

  return {
    phaseName: phase.name,
    executor: "llm",
    success: result.success,
    output: result.output,
    durationMs: Date.now() - startTime,
  };
}

function executePhaseDryRun(
  phase: PhaseConfig,
  outputs: Map<string, string>,
): PhaseResult {
  // In dry-run mode, we simulate execution
  if (phase.executor === "llm") {
    const prompt = phase.prompt
      ? substituteTemplate(phase.prompt, outputs)
      : "(no prompt)";

    return {
      phaseName: phase.name,
      executor: "llm",
      success: true,
      output: `[DRY RUN] Would execute LLM with prompt:\n${prompt}`,
      durationMs: 0,
    };
  }

  // Code executor
  const command = phase.command ?? phase.script ?? "(unknown)";
  return {
    phaseName: phase.name,
    executor: "code",
    success: true,
    output: `[DRY RUN] Would execute: ${command}`,
    durationMs: 0,
  };
}
