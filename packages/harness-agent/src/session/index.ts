export { HarnessAgentSession } from "./harness-session.js";
export { createExtensionAPI } from "./extension-api-adapter.js";
export type { SessionAdapterTarget } from "./extension-api-adapter.js";
export { bridgeAgentEvent, bridgeContentBlocks } from "./event-bridge.js";
export type { BridgedEvent } from "./event-bridge.js";
export { adaptToolDefinition, mergeTools } from "./tool-adapter.js";
export { SessionPersistence } from "./session-persistence.js";
export type {
  ToolDefinition,
  HarnessExtensionContext,
  HarnessExtensionAPI,
  SessionState,
  StreamFn,
  HarnessAgentSessionConfig,
  ExtensionHandler,
  SessionStartPayload,
  SessionShutdownPayload,
  BeforeAgentStartPayload,
  BeforeAgentStartResult,
  AssessmentClarificationPayload,
  AgentStartPayload,
  AgentEndPayload,
  TurnStartPayload,
  TurnEndPayload,
  ToolExecutionStartPayload,
  ToolExecutionUpdatePayload,
  ToolExecutionEndPayload,
  MessageStartPayload,
  MessageUpdatePayload,
  MessageEndPayload,
} from "./types.js";
