import { ErrorType, RecoveryAction, type RecoveryDecision, type ErrorRecoveryConfig, type ErrorRecoveryState } from "./types.js";

const DEFAULT_CONFIG: Required<ErrorRecoveryConfig> = {
  maxRetriesPerTool: 3,
  maxConsecutiveUnknown: 5,
  blacklistThreshold: 3,
  baseBackoffMs: 1000,
  maxBackoffMs: 30000,
};

export function decideRecovery(
  toolName: string,
  errorType: ErrorType,
  state: ErrorRecoveryState,
  config: ErrorRecoveryConfig = {},
): RecoveryDecision {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const toolFailures = state.toolFailureCounts.get(toolName) ?? 0;

  if (state.blacklistedTools.has(toolName)) {
    return {
      action: RecoveryAction.SWITCH_TOOL,
      reason: `Tool "${toolName}" is blacklisted`,
      feedback: `Tool "${toolName}" has been disabled due to repeated failures. Use an alternative approach.`,
      blacklisted: true,
    };
  }

  switch (errorType) {
    case ErrorType.PERMISSION_DENIED:
      return {
        action: RecoveryAction.ABORT,
        reason: "Permission denied — cannot recover",
        feedback: `Permission denied for tool "${toolName}". This cannot be automatically recovered. Please check permissions.`,
      };

    case ErrorType.TIMEOUT:
      return {
        action: RecoveryAction.WAIT_AND_RETRY,
        reason: "Transient timeout — retry with backoff",
        feedback: `Tool "${toolName}" timed out. This is usually transient. Retrying may help.`,
        backoffMs: computeBackoff(toolFailures, cfg.baseBackoffMs, cfg.maxBackoffMs),
      };

    case ErrorType.RESOURCE_EXHAUSTED:
      return {
        action: RecoveryAction.WAIT_AND_RETRY,
        reason: "Rate limit or resource exhaustion — retry with longer backoff",
        feedback: `Tool "${toolName}" hit a rate limit or resource limit. Waiting before retry.`,
        backoffMs: computeBackoff(toolFailures, cfg.baseBackoffMs * 2, cfg.maxBackoffMs),
      };

    case ErrorType.PARSE_ERROR:
      return {
        action: RecoveryAction.REDUCE_SCOPE,
        reason: "Parse error — likely input/output format issue",
        feedback: `Tool "${toolName}" produced unparseable output. Try simplifying the request or breaking it into smaller steps.`,
      };

    case ErrorType.TOOL_ERROR:
      if (toolFailures >= cfg.blacklistThreshold) {
        return {
          action: RecoveryAction.SWITCH_TOOL,
          reason: `Tool "${toolName}" failed ${toolFailures} times — blacklisting`,
          feedback: `Tool "${toolName}" has failed ${toolFailures} times. It has been disabled. Use an alternative approach or tool.`,
          blacklisted: true,
        };
      }
      if (toolFailures >= cfg.maxRetriesPerTool) {
        return {
          action: RecoveryAction.SWITCH_TOOL,
          reason: `Tool "${toolName}" exceeded retry limit`,
          feedback: `Tool "${toolName}" has failed ${toolFailures} times. Try a different approach.`,
        };
      }
      return {
        action: RecoveryAction.RETRY_SAME,
        reason: "Tool error — retry may succeed",
        feedback: `Tool "${toolName}" failed: ${state.errors[state.errors.length - 1]?.message ?? "unknown error"}. Retrying.`,
      };

    case ErrorType.MODEL_ERROR:
      return {
        action: RecoveryAction.UPGRADE_MODEL,
        reason: "Model error — may need different model",
        feedback: `The model encountered an error. This may be a model-specific issue.`,
      };

    case ErrorType.UNKNOWN:
    default:
      if (state.consecutiveUnknown >= cfg.maxConsecutiveUnknown) {
        return {
          action: RecoveryAction.ABORT,
          reason: `${state.consecutiveUnknown} consecutive unknown errors — aborting`,
          feedback: `Too many consecutive unknown errors (${state.consecutiveUnknown}). Aborting to prevent infinite loop.`,
        };
      }
      if (toolFailures >= cfg.blacklistThreshold) {
        return {
          action: RecoveryAction.SWITCH_TOOL,
          reason: `Tool "${toolName}" failed ${toolFailures} times with unknown errors`,
          feedback: `Tool "${toolName}" has failed ${toolFailures} times. Try a different approach.`,
          blacklisted: true,
        };
      }
      return {
        action: RecoveryAction.RETRY_SAME,
        reason: "Unknown error — retry may succeed",
        feedback: `Tool "${toolName}" failed with an unknown error. Retrying.`,
      };
  }
}

function computeBackoff(attempt: number, base: number, max: number): number {
  const delay = base * Math.pow(2, attempt);
  return Math.min(delay, max);
}
