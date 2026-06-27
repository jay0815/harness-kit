import type { Api } from "@earendil-works/pi-ai";
import type { Model, StreamFn } from "@harness-kit/agent";
import { HarnessAgentSession, SubagentRunner } from "@harness-kit/agent";
import type { SubagentExecutor } from "@harness-kit/agent";
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
  enableSubagent?: boolean;
  subagentSettingsPath?: string;
}

export class WorkflowRunner {
  private session: HarnessAgentSession;
  private workflow: Workflow;
  private cwd: string;
  private subagentRunner: SubagentRunner;
  private subagentSettingsPath?: string;

  constructor(config: WorkflowRunnerConfig) {
    this.cwd = config.cwd;
    this.subagentRunner = new SubagentRunner({ resultDir: "/tmp" });
    this.subagentSettingsPath = config.subagentSettingsPath;

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
      enableSubagent: config.enableSubagent,
      subagentSettingsPath: config.subagentSettingsPath,
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
    switch (phase.executor) {
      case "code":
        return this.executeCodePhase(phase);
      case "subagent":
        return this.executeSubagentPhase(phase);
      default:
        return this.executeLlmPhase(phase);
    }
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

  private async executeSubagentPhase(phase: Phase): Promise<{ success: boolean; output: string }> {
    const subagentId = this.subagentRunner.generateId();
    const executor = (phase.subagentType ?? "claude") as SubagentExecutor;

    const { command, args } = this.subagentRunner.buildCommand({
      id: subagentId,
      task: phase.prompt,
      executor,
      constraints: phase.subagentConstraints,
      timeoutMs: phase.subagentTimeoutMs,
      settingsPath: phase.subagentSettings ?? this.subagentSettingsPath,
    });

    const { spawn } = await import("node:child_process");

    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd: this.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        resolve({
          success: false,
          output: `Subagent timed out after ${phase.subagentTimeoutMs ?? 300_000}ms`,
        });
      }, phase.subagentTimeoutMs ?? 300_000);

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);

        const result = this.subagentRunner.collectResult(subagentId);
        if (result.success) {
          resolve({
            success: true,
            output: result.block?.currentWork ?? stdout,
          });
        } else {
          resolve({
            success: false,
            output: result.error ?? stderr ?? `Process exited with code ${code}`,
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          output: `Failed to start subagent: ${err.message}`,
        });
      });
    });
  }

  private async executeLlmPhase(phase: Phase): Promise<{ success: boolean; output: string }> {
    await this.session.prompt(phase.prompt);
    return { success: true, output: "" };
  }
}
