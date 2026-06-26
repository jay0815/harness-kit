export enum ErrorType {
  TOOL_ERROR = "tool_error",
  MODEL_ERROR = "model_error",
  TIMEOUT = "timeout",
  PERMISSION_DENIED = "permission_denied",
  RESOURCE_EXHAUSTED = "resource_exhausted",
  PARSE_ERROR = "parse_error",
  UNKNOWN = "unknown",
}

export enum RecoveryAction {
  RETRY_SAME = "retry_same",
  SWITCH_TOOL = "switch_tool",
  UPGRADE_MODEL = "upgrade_model",
  REDUCE_SCOPE = "reduce_scope",
  SKIP_ITEM = "skip_item",
  WAIT_AND_RETRY = "wait_and_retry",
  ABORT = "abort",
}

export interface ErrorRecord {
  toolName: string;
  errorType: ErrorType;
  message: string;
  timestamp: number;
  attempt: number;
}

export interface RecoveryDecision {
  action: RecoveryAction;
  reason: string;
  feedback: string;
  backoffMs?: number;
  blacklisted?: boolean;
}

export interface ErrorRecoveryState {
  errors: ErrorRecord[];
  toolFailureCounts: Map<string, number>;
  blacklistedTools: Set<string>;
  consecutiveUnknown: number;
  lastRecovery?: RecoveryDecision;
}

export const ERROR_RECOVERY_KEY = "error_recovery";

export interface ErrorRecoveryConfig {
  maxRetriesPerTool?: number;
  maxConsecutiveUnknown?: number;
  blacklistThreshold?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}
