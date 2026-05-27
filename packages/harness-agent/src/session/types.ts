import type { TSchema, Static } from "@sinclair/typebox";
import type { Api, AssistantMessageEvent } from "@earendil-works/pi-ai";
import type {
  AgentMessage,
  AgentMiddleware,
  AgentToolResult,
  AgentTool,
  Model,
  StreamFn,
} from "../core/types.js";

/**
 * ToolDefinition — structurally compatible with PI's ToolDefinition.
 * packages/core/src/tools.ts uses `ToolDefinition<typeof schema>`.
 */
export interface ToolDefinition<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
  _TState = unknown,
> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  executionMode?: "sequential" | "parallel";
  execute(
    toolCallId: string,
    params: Static<TParameters>,
    signal: AbortSignal | undefined,
    onUpdate: ((update: TDetails) => void) | undefined,
    ctx: HarnessExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
}

/**
 * Minimal ExtensionContext provided to tool execution.
 * Satisfies the fields that core tools actually use.
 */
export interface HarnessExtensionContext {
  cwd: string;
  signal?: AbortSignal;
  shutdown(): void;
}

// ─── Extension Event Payloads ──────────────────────────────────────

/** PI SDK compatible handler type. */
export type ExtensionHandler<E, R = undefined> = (
  event: E,
  ctx: HarnessExtensionContext,
) => Promise<R | void> | R | void;

export interface SessionStartPayload {
  type: "session_start";
  reason: string;
}

export interface SessionShutdownPayload {
  type: "session_shutdown";
}

export interface BeforeAgentStartPayload {
  type: "before_agent_start";
  systemPrompt: string;
}

export interface BeforeAgentStartResult {
  systemPrompt?: string;
}

export interface AssessmentClarificationPayload {
  type: "assessment_clarification";
  question: string;
}

export interface AgentStartPayload {
  type: "agent_start";
}

export interface AgentEndPayload {
  type: "agent_end";
  messages: AgentMessage[];
}

export interface TurnStartPayload {
  type: "turn_start";
  turnIndex: number;
  timestamp: number;
}

export interface TurnEndPayload {
  type: "turn_end";
  turnIndex: number;
  message: { content?: Array<Record<string, unknown>>; role?: string } & Record<string, unknown>;
  toolResults: AgentToolResult<unknown>[];
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionStartPayload {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolExecutionUpdatePayload {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args: unknown;
  partialResult: unknown;
}

export interface ToolExecutionEndPayload {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface MessageStartPayload {
  type: "message_start";
  message: AgentMessage;
}

export interface MessageUpdatePayload {
  type: "message_update";
  message: AgentMessage;
  assistantMessageEvent: AssistantMessageEvent;
}

export interface MessageEndPayload {
  type: "message_end";
  message: AgentMessage;
}

// ─── Extension API ─────────────────────────────────────────────────

/**
 * The ExtensionAPI interface that packages/core will code against.
 * Structurally compatible with PI's ExtensionAPI.
 */
export interface HarnessExtensionAPI {
  on(event: "session_start", handler: ExtensionHandler<SessionStartPayload>): void;
  on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownPayload>): void;
  on(
    event: "before_agent_start",
    handler: ExtensionHandler<BeforeAgentStartPayload, BeforeAgentStartResult>,
  ): void;
  on(
    event: "assessment_clarification",
    handler: ExtensionHandler<AssessmentClarificationPayload>,
  ): void;
  on(event: "agent_start", handler: ExtensionHandler<AgentStartPayload>): void;
  on(event: "agent_end", handler: ExtensionHandler<AgentEndPayload>): void;
  on(event: "turn_start", handler: ExtensionHandler<TurnStartPayload>): void;
  on(event: "turn_end", handler: ExtensionHandler<TurnEndPayload>): void;
  on(
    event: "tool_execution_start",
    handler: ExtensionHandler<ToolExecutionStartPayload>,
  ): void;
  on(
    event: "tool_execution_update",
    handler: ExtensionHandler<ToolExecutionUpdatePayload>,
  ): void;
  on(
    event: "tool_execution_end",
    handler: ExtensionHandler<ToolExecutionEndPayload>,
  ): void;
  on(event: "message_start", handler: ExtensionHandler<MessageStartPayload>): void;
  on(event: "message_update", handler: ExtensionHandler<MessageUpdatePayload>): void;
  on(event: "message_end", handler: ExtensionHandler<MessageEndPayload>): void;
  /** @deprecated Add a specific overload for this event, then remove this fallback. */
  on(event: string, handler: (...args: unknown[]) => unknown): void;

  registerTool(tool: ToolDefinition): void;
  sendUserMessage(content: string): void;
}

/** Session lifecycle state */
export type SessionState = "idle" | "running" | "dispatching" | "shutting_down";

export type { StreamFn };

/** Configuration for creating a HarnessAgentSession */
export interface HarnessAgentSessionConfig {
  cwd: string;
  model: Model<Api>;
  systemPrompt: string;
  streamFn: StreamFn;
  tools?: AgentTool[];
  maxIterations?: number;
  contextWindow?: number;
  sessionDir?: string;
  enablePersistence?: boolean;
  /** Max auto-retry rounds for sendUserMessage feedback. Default: 3 */
  maxAutoRetries?: number;
  /** Fact verification mode. Default: "off" (CLI defaults to "strict") */
  verifyMode?: "strict" | "warn" | "off";
  /** Max verification retry rounds. Default: 3 */
  maxVerificationRetries?: number;
  /** User-supplied middleware instances. Reused across prompts; mutable state persists. */
  middlewares?: AgentMiddleware[];
  /** Enable LLM-based task assessment before main loop. Default: false */
  enableAssessment?: boolean;
  /** Model for assessment (defaults to main model) */
  assessmentModel?: Model<Api>;
}
