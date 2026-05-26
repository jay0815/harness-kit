import type { AgentAState, AgentTool, Model, StreamFn, TaskResult } from "./types.js";
import { createAgentB, runAgentB, type AgentBConfig } from "./agent-b.js";
import { evaluateTaskWithSource } from "./evaluator.js";

export interface AgentAConfig {
  model: Model<any>;
  assessmentModel?: Model<any>;
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
   * Agent A main loop: receive Human message, assess via LLM, delegate to Agent B, relay output.
   */
  async processHumanMessage(
    humanMessage: string,
    emit: (event: { type: string; data: any }) => void,
  ): Promise<string> {
    // Step 1: LLM evaluation (context-isolated, single-turn)
    const result = await evaluateTaskWithSource(
      {
        model: this.config.assessmentModel ?? this.config.model,
        streamFn: this.config.streamFn,
        workspaceDir: this.config.workspaceDir,
      },
      humanMessage,
    );

    const evaluation = result.evaluation;
    emit({ type: "agent_a_assessment", data: evaluation });

    // Step 2: fallback → don't delegate to AgentB
    if (result.source === "fallback") {
      const clarification =
        evaluation.clarificationNeeded ?? "I couldn't assess this request. Could you clarify?";
      emit({ type: "agent_a_clarification", data: { question: clarification } });
      return clarification;
    }

    // Step 3: model judged unclear → ask for clarification
    if (!evaluation.understood) {
      const clarification =
        evaluation.clarificationNeeded ?? "Could you clarify what you'd like me to do?";
      emit({ type: "agent_a_clarification", data: { question: clarification } });
      return clarification;
    }

    // Step 4: doesn't need execution → return overview (compatibility behavior)
    // AgentA has no primary answer loop today,
    // so non-execution requests return the evaluator's organized overview.
    // Session integration should route these requests to the main loop instead.
    if (!evaluation.needsExecution) {
      return evaluation.taskOverview;
    }

    // Step 5: Organize memory — ignore details, keep key info
    const organizedContext = this.organizeMemory();

    // Step 6: Create and run Agent B
    // Future: route by evaluation.executor (claude / codex)
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

    emit({ type: "agent_b_start", data: { task: evaluation.taskOverview } });

    const agentBResult = await runAgentB(agentB, evaluation.taskOverview, organizedContext, emit);

    // Step 7: Save task result
    const taskResult: TaskResult = {
      task: evaluation.taskOverview,
      summary: agentBResult.summary,
      status: agentBResult.status,
      output: agentBResult.output,
      timestamp: new Date().toISOString(),
    };
    this.state.taskResults.push(taskResult);
    this.state.currentAgentB = null;

    emit({ type: "agent_b_complete", data: taskResult });

    // Step 8: Relay Agent B's full output to Human
    return agentBResult.output;
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
