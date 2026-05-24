import type {
  AgentBState,
  AgentMessage,
  AgentTool,
  IterationBudget,
  Model,
  TaskStatus,
  TaskSummary,
  TokenUsage,
} from "./types.js";
import { IterationBudget as IterationBudgetImpl, AGENT_B_TOKEN_THRESHOLD } from "./types.js";
import { MiddlewarePipeline } from "./middleware.js";
import { runAgentLoop } from "./agent-loop.js";

export interface AgentBConfig {
  model: Model<any>;
  workspaceDir: string;
  tools: AgentTool<any>[];
  maxIterations?: number;
  tokenThreshold?: number; // default 0.9
}

export interface AgentBResult {
  summary: string;
  status: TaskStatus;
  output: string;
  taskSummary?: TaskSummary; // for handoff
}

export class AgentB {
  private state: AgentBState;
  private config: AgentBConfig;
  private pipeline: MiddlewarePipeline;
  private budget: IterationBudget;

  constructor(config: AgentBConfig) {
    this.config = config;
    this.state = {
      task: "",
      taskStatus: "pending",
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextWindow: 200_000,
      },
      messages: [],
      output: "",
    };
    this.pipeline = new MiddlewarePipeline();
    this.budget = new IterationBudgetImpl(config.maxIterations ?? 50);
  }

  getState(): AgentBState {
    return this.state;
  }

  getPipeline(): MiddlewarePipeline {
    return this.pipeline;
  }

  async execute(
    task: string,
    context: string,
    emit: (event: { type: string; data: any }) => void,
  ): Promise<AgentBResult> {
    this.state.task = task;
    this.state.taskStatus = "running";

    const systemPrompt = this.buildSystemPrompt(task, context);
    const initialMessages: AgentMessage[] = [
      { role: "user", content: task } as any,
    ];

    try {
      const result = await runAgentLoop(
        {
          model: this.config.model,
          systemPrompt,
          messages: initialMessages,
          tools: this.config.tools,
          contextWindow: 200_000,
          streamFn: async () => {
            throw new Error("streamFn not injected by session layer");
          },
          convertToLlm: (msgs) => msgs as any,
        },
        this.budget,
        this.pipeline,
        (event) => emit({ type: `agent_b_${event.type}`, data: event }),
      );

      // Sync state from loop result
      this.state.messages = result.messages;
      this.state.tokenUsage = result.tokenUsage;

      // Check token threshold
      const threshold = this.config.tokenThreshold ?? AGENT_B_TOKEN_THRESHOLD;
      const usageRatio = result.tokenUsage.totalTokens / result.tokenUsage.contextWindow;

      if (usageRatio >= threshold) {
        const taskSummary = this.generateTaskSummary(result.tokenUsage);
        this.state.taskStatus = "handoff";

        return {
          summary: `Task in progress, handoff needed at ${Math.round(usageRatio * 100)}% token usage`,
          status: "handoff",
          output: result.messages.map((m) => this.messageToText(m)).join("\n"),
          taskSummary,
        };
      }

      this.state.taskStatus = "completed";
      this.state.output = result.messages.map((m) => this.messageToText(m)).join("\n");

      return {
        summary: this.extractSummary(result.messages),
        status: "completed",
        output: this.state.output,
      };
    } catch (err) {
      this.state.taskStatus = "failed";
      return {
        summary: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        status: "failed",
        output: "",
      };
    }
  }

  private buildSystemPrompt(task: string, context: string): string {
    return `You are an executor agent. Your job is to complete the given task.

Task: ${task}

${context ? `Context:\n${context}` : ""}

Rules:
- Focus on the task. Do not deviate.
- Use tools to read files, write code, and verify your work.
- Output a clear summary when done.
- If you need clarification, ask.`;
  }

  private generateTaskSummary(tokenUsage: TokenUsage): TaskSummary {
    return {
      task: this.state.task,
      progress: `Token usage: ${tokenUsage.totalTokens}/${tokenUsage.contextWindow}`,
      completedSteps: [],
      remainingSteps: ["Continue task with fresh Agent B"],
      context: this.state.messages
        .slice(-3)
        .map((m) => this.messageToText(m))
        .join("\n"),
    };
  }

  private extractSummary(messages: AgentMessage[]): string {
    const last = messages[messages.length - 1];
    if (!last) return "No output";
    return this.messageToText(last).slice(0, 200);
  }

  private messageToText(msg: AgentMessage): string {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
    }
    return "";
  }
}

export function createAgentB(config: AgentBConfig): AgentB {
  return new AgentB(config);
}

export async function runAgentB(
  agentB: AgentB,
  task: string,
  context: string,
  emit: (event: { type: string; data: any }) => void,
): Promise<AgentBResult> {
  return agentB.execute(task, context, emit);
}
