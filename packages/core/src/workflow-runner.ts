import type { Api } from "@earendil-works/pi-ai";
import type { Model, StreamFn } from "@harness-kit/agent";
import { HarnessAgentSession } from "@harness-kit/agent";
import harnessKitExtension from "./index.js";
import { createDefaultWorkflow } from "./workflow.js";
import { loadWorkflow } from "./workflow-loader.js";
import { executeCode } from "./code-executor.js";
import type { Workflow, Phase } from "./types.js";

export interface WorkflowRunnerConfig {
  cwd: string;
  model: Model<Api>;
  streamFn: StreamFn;
  systemPrompt?: string;
  workflow?: Workflow;
  workflowPath?: string;
  verifyMode?: "strict" | "warn" | "off";
  maxIterations?: number;
  contextWindow?: number;
}

export class WorkflowRunner {
  private session: HarnessAgentSession;
  private workflow: Workflow;
  private cwd: string;

  constructor(config: WorkflowRunnerConfig) {
    this.cwd = config.cwd;

    if (config.workflowPath) {
      const loaded = loadWorkflow(config.workflowPath);
      this.workflow = {
        name: loaded.workflow,
        description: loaded.description ?? "",
        phases: loaded.phases.map((p) => ({
          name: p.name,
          executor: p.executor,
          prompt: p.prompt ?? "",
          contextFiles: p.contextFiles ?? [],
          humanConfirm: p.humanConfirm ?? false,
          command: p.command,
          script: p.script,
          args: p.args,
        })),
      };
    } else if (config.workflow) {
      this.workflow = config.workflow;
    } else {
      this.workflow = createDefaultWorkflow();
    }

    const systemPrompt = config.systemPrompt ?? "You are a coding agent guided by a structured workflow.";

    this.session = new HarnessAgentSession({
      cwd: this.cwd,
      model: config.model,
      systemPrompt,
      streamFn: config.streamFn,
      verifyMode: config.verifyMode ?? "strict",
      maxIterations: config.maxIterations,
      contextWindow: config.contextWindow,
      enablePersistence: true,
      sessionDir: `${this.cwd}/.harness-kit/sessions`,
    });

    harnessKitExtension(this.session.extensionAPI);
  }

  getWorkflow(): Workflow {
    return this.workflow;
  }

  getWorkflowName(): string {
    return this.workflow.name;
  }

  async start(): Promise<void> {
    await this.session.start();
  }

  async prompt(text: string): Promise<void> {
    await this.session.prompt(text);
  }

  async executePhase(phase: Phase): Promise<{ success: boolean; output: string }> {
    if (phase.executor === "code") {
      return this.executeCodePhase(phase);
    }
    return this.executeLlmPhase(phase);
  }

  async shutdown(): Promise<void> {
    await this.session.shutdown();
  }

  private async executeCodePhase(phase: Phase): Promise<{ success: boolean; output: string }> {
    try {
      const result = await executeCode({
        phase: {
          name: phase.name,
          executor: "code",
          command: phase.command,
          script: phase.script,
          args: phase.args,
        },
        workflowDir: this.cwd,
      });
      return { success: result.success, output: result.output };
    } catch (err) {
      return {
        success: false,
        output: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeLlmPhase(phase: Phase): Promise<{ success: boolean; output: string }> {
    await this.session.prompt(phase.prompt);
    return { success: true, output: "" };
  }
}
