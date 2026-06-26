import type {
  AgentMiddleware,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  RuntimeState,
} from "../types.js";
import { PRIORITY_GUARD } from "../types.js";
import { classifyError } from "./classifier.js";
import { decideRecovery } from "./strategy.js";
import {
  ErrorType,
  RecoveryAction,
  ERROR_RECOVERY_KEY,
  type ErrorRecoveryConfig,
  type ErrorRecoveryState,
} from "./types.js";

function getErrorState(state: RuntimeState): ErrorRecoveryState {
  let es = state.metadata[ERROR_RECOVERY_KEY] as ErrorRecoveryState | undefined;
  if (!es) {
    es = {
      errors: [],
      toolFailureCounts: new Map(),
      blacklistedTools: new Set(),
      consecutiveUnknown: 0,
    };
    state.metadata[ERROR_RECOVERY_KEY] = es;
  }
  return es;
}

export class ErrorRecoveryMiddleware implements AgentMiddleware {
  readonly priority = PRIORITY_GUARD + 5;
  readonly name = "ErrorRecovery";

  private config: Required<ErrorRecoveryConfig>;

  constructor(config: ErrorRecoveryConfig = {}) {
    this.config = {
      maxRetriesPerTool: config.maxRetriesPerTool ?? 3,
      maxConsecutiveUnknown: config.maxConsecutiveUnknown ?? 5,
      blacklistThreshold: config.blacklistThreshold ?? 3,
      baseBackoffMs: config.baseBackoffMs ?? 1000,
      maxBackoffMs: config.maxBackoffMs ?? 30000,
    };
  }

  async afterTool(
    state: RuntimeState,
    toolCall: AgentToolCall,
    _tool: AgentTool | undefined,
    result: AgentToolResult<unknown>,
  ): Promise<AgentToolResult<unknown>> {
    if (!result.isError) {
      const es = getErrorState(state);
      es.consecutiveUnknown = 0;
      const count = es.toolFailureCounts.get(toolCall.name);
      if (count !== undefined) es.toolFailureCounts.delete(toolCall.name);
      return result;
    }

    const errorMessage = this.extractErrorMessage(result);
    const errorType = classifyError(toolCall.name, errorMessage);
    const es = getErrorState(state);

    const toolFailures = (es.toolFailureCounts.get(toolCall.name) ?? 0) + 1;
    es.toolFailureCounts.set(toolCall.name, toolFailures);

    es.errors.push({
      toolName: toolCall.name,
      errorType,
      message: errorMessage.slice(0, 500),
      timestamp: Date.now(),
      attempt: toolFailures,
    });

    if (errorType === ErrorType.UNKNOWN) {
      es.consecutiveUnknown++;
    } else {
      es.consecutiveUnknown = 0;
    }

    const decision = decideRecovery(toolCall.name, errorType, es, this.config);
    es.lastRecovery = decision;

    if (decision.blacklisted) {
      es.blacklistedTools.add(toolCall.name);
    }

    if (decision.action === RecoveryAction.RETRY_SAME) {
      return result;
    }

    return {
      content: [
        ...result.content,
        {
          type: "text" as const,
          text: `\n[ErrorRecovery] ${decision.feedback}`,
        },
      ],
      details: result.details,
      isError: true,
      terminate: decision.action === RecoveryAction.ABORT,
    };
  }

  private extractErrorMessage(result: AgentToolResult<unknown>): string {
    return result.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("")
      .slice(0, 1000);
  }
}
