import type {
  AgentAPreliminaryAssessment,
  AgentAState,
  AgentBState,
  AgentMessage,
  AgentTool,
  LLMResponse,
  Model,
  StreamFn,
  TaskResult,
  TaskSummary,
} from "./types.js";
import { createAgentB, runAgentB, type AgentBConfig } from "./agent-b.js";

export interface AgentAConfig {
  model: Model<any>;
  workspaceDir: string;
  tools: AgentTool<any>[];
  streamFn: StreamFn;
  maxIterations?: number;
  tokenThreshold?: number; // default 0.9
}

export class AgentA {
  private state: AgentAState;
  private config: AgentAConfig;

  constructor(config: AgentAConfig) {
    this.config = config;
    this.state = {
      taskResults: [],
      currentAgentB: null,
      sessionJsonlPath: "",
    };
  }

  getState(): AgentAState {
    return this.state;
  }

  /**
   * Agent A main loop: receive Human message, assess, delegate to Agent B, relay output.
   */
  async processHumanMessage(
    humanMessage: string,
    emit: (event: { type: string; data: any }) => void,
  ): Promise<string> {
    // Step 1: Preliminary assessment
    const assessment = this.assessInput(humanMessage);

    emit({ type: "agent_a_assessment", data: assessment });

    // Step 2: If unclear, ask for clarification
    if (!assessment.assessment.understood) {
      const clarification = assessment.assessment.clarificationNeeded ?? "Could you clarify what you'd like me to do?";
      emit({ type: "agent_a_clarification", data: { question: clarification } });
      return clarification;
    }

    // Step 3: If doesn't need Agent B, handle directly
    if (!assessment.assessment.needsAgentB) {
      return assessment.assessment.taskOverview;
    }

    // Step 4: Organize memory — ignore details, keep key info
    const organizedContext = this.organizeMemory();

    // Step 5: Create and run Agent B
    const agentBConfig: AgentBConfig = {
      model: this.config.model,
      workspaceDir: this.config.workspaceDir,
      tools: this.config.tools,
      streamFn: this.config.streamFn,
      maxIterations: this.config.maxIterations,
      tokenThreshold: this.config.tokenThreshold,
    };

    const agentB = createAgentB(agentBConfig);
    this.state.currentAgentB = agentB.getState();

    emit({ type: "agent_b_start", data: { task: assessment.assessment.taskOverview } });

    const result = await runAgentB(
      agentB,
      assessment.assessment.taskOverview,
      organizedContext,
      emit,
    );

    // Step 6: Save task result
    const taskResult: TaskResult = {
      task: assessment.assessment.taskOverview,
      summary: result.summary,
      status: result.status,
      output: result.output,
      timestamp: new Date().toISOString(),
    };
    this.state.taskResults.push(taskResult);
    this.state.currentAgentB = null;

    emit({ type: "agent_b_complete", data: taskResult });

    // Step 7: Relay Agent B's full output to Human
    return result.output;
  }

  /**
   * Preliminary assessment: understand what Human wants, evaluate complexity/risk.
   */
  private assessInput(input: string): { assessment: AgentAPreliminaryAssessment; overview: string } {
    // Simple heuristic-based assessment
    // In production, this could use LLM for better understanding
    const lower = input.toLowerCase();

    const isQuestion = lower.includes("?") || lower.startsWith("what") || lower.startsWith("how") || lower.startsWith("why");
    const isTask = lower.includes("implement") || lower.includes("create") || lower.includes("fix") || lower.includes("add") || lower.includes("refactor");
    const isVague = input.length < 20 || lower === "help" || lower === "do something";

    if (isVague) {
      return {
        assessment: {
          understood: false,
          taskOverview: "",
          complexity: "low",
          risk: "low",
          needsAgentB: false,
          clarificationNeeded: "Could you provide more details about what you'd like me to do?",
        },
        overview: "",
      };
    }

    if (isQuestion) {
      return {
        assessment: {
          understood: true,
          taskOverview: input,
          complexity: "low",
          risk: "low",
          needsAgentB: false,
        },
        overview: `Answering question: ${input}`,
      };
    }

    if (isTask) {
      return {
        assessment: {
          understood: true,
          taskOverview: input,
          complexity: this.estimateComplexity(input),
          risk: this.estimateRisk(input),
          needsAgentB: true,
        },
        overview: `Executing task: ${input}`,
      };
    }

    return {
      assessment: {
        understood: true,
        taskOverview: input,
        complexity: "medium",
        risk: "low",
        needsAgentB: true,
      },
      overview: `Processing: ${input}`,
    };
  }

  private estimateComplexity(input: string): "low" | "medium" | "high" {
    const wordCount = input.split(/\s+/).length;
    if (wordCount > 50) return "high";
    if (wordCount > 20) return "medium";
    return "low";
  }

  private estimateRisk(input: string): "low" | "medium" | "high" {
    const lower = input.toLowerCase();
    if (lower.includes("delete") || lower.includes("remove") || lower.includes("drop")) return "high";
    if (lower.includes("refactor") || lower.includes("migrate")) return "medium";
    return "low";
  }

  /**
   * Organize memory: keep key info, ignore details.
   * Details can be read from wiki/JSONL on demand.
   */
  private organizeMemory(): string {
    const results = this.state.taskResults;
    if (results.length === 0) return "";

    const summary = results
      .slice(-5) // Keep last 5 task results
      .map((r) => `- ${r.task}: ${r.summary} [${r.status}]`)
      .join("\n");

    return `Previous tasks:\n${summary}`;
  }
}

export function createAgentA(config: AgentAConfig): AgentA {
  return new AgentA(config);
}
