import type { Api } from "@earendil-works/pi-ai";
import type { Model, StreamFn } from "@harness-kit/agent";
import { HarnessAgentSession } from "@harness-kit/agent";
import harnessKitExtension from "./index.js";
import { createDefaultWorkflow } from "./workflow.js";
import { loadWorkflow } from "./workflow-loader.js";
import type { WorkflowConfig } from "./workflow-schema.js";
import type { Workflow } from "./types.js";

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
          executor: "self" as const,
          prompt: p.prompt ?? "",
          contextFiles: p.contextFiles ?? [],
          humanConfirm: p.humanConfirm ?? false,
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

  async shutdown(): Promise<void> {
    await this.session.shutdown();
  }
}
