import type {
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  streamSimple,
  TextContent,
  Tool,
  ToolResultMessage,
} from "@mariozechner/pi-ai";

export type { Model } from "@mariozechner/pi-ai";
import type { Static, TSchema } from "@sinclair/typebox";

// ─── Stream Function ───────────────────────────────────────────────

export type StreamFn = (
  ...args: Parameters<typeof streamSimple>
) => ReturnType<typeof streamSimple> | Promise<ReturnType<typeof streamSimple>>;

// ─── Tool Execution ────────────────────────────────────────────────

export type ToolExecutionMode = "sequential" | "parallel";

export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}

export interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  context: AgentContext;
}

export interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  result: AgentToolResult<any>;
  isError: boolean;
  context: AgentContext;
}

export interface ShouldStopAfterTurnContext {
  message: AssistantMessage;
  toolResults: ToolResultMessage[];
  context: AgentContext;
  newMessages: AgentMessage[];
}

// ─── Agent Loop Config ─────────────────────────────────────────────

export interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<any>;
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentTool<any>[];
  contextWindow?: number;
  streamFn: StreamFn;
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  shouldStopAfterTurn?: (context: ShouldStopAfterTurnContext) => boolean | Promise<boolean>;
  getSteeringMessages?: () => Promise<AgentMessage[]>;
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
  toolExecution?: ToolExecutionMode;
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
}

// ─── Thinking Level ────────────────────────────────────────────────

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// ─── Custom Messages ───────────────────────────────────────────────

export interface CustomAgentMessages {}

export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

// ─── Agent State ───────────────────────────────────────────────────

export interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  set tools(tools: AgentTool<any>[]);
  get tools(): AgentTool<any>[];
  set messages(messages: AgentMessage[]);
  get messages(): AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}

// ─── Tool Types ────────────────────────────────────────────────────

export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
  terminate?: boolean;
  isError?: boolean;
}

export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
  executionMode?: ToolExecutionMode;
}

// ─── Agent Context ─────────────────────────────────────────────────

export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentTool<any>[];
}

// ─── Agent Events ──────────────────────────────────────────────────

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };

// ─── Middleware Pipeline ───────────────────────────────────────────

export interface LLMResponse {
  content: AssistantMessage["content"];
  stopReason: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface RuntimeState {
  context: AgentContext;
  iteration: number;
  tokenUsage: TokenUsage;
  metadata: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow: number;
}

export interface AgentMiddleware {
  priority: number;
  name: string;
  beforeModel?(state: RuntimeState): Promise<void>;
  afterModel?(state: RuntimeState, response: LLMResponse): Promise<LLMResponse>;
  beforeTool?(state: RuntimeState, toolCall: AgentToolCall, tool: AgentTool | undefined): Promise<AgentToolResult<any> | null>;
  afterTool?(state: RuntimeState, toolCall: AgentToolCall, tool: AgentTool | undefined, result: AgentToolResult<any>): Promise<AgentToolResult<any>>;
}

// Priority constants (lower = earlier execution)
export const PRIORITY_GUARD = 10;
export const PRIORITY_CACHE = 20;
export const PRIORITY_INJECT = 50;
export const PRIORITY_EXTRACT = 90;
export const PRIORITY_EVAL = 95;

// ─── Dual-Agent Architecture ───────────────────────────────────────

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "handoff";

export interface TaskResult {
  task: string;
  summary: string;
  status: TaskStatus;
  output: string;
  timestamp: string;
}

export interface TaskSummary {
  task: string;
  progress: string;
  completedSteps: string[];
  remainingSteps: string[];
  context: string;
}

export interface AgentAState {
  taskResults: TaskResult[];
  currentAgentB: AgentBState | null;
  sessionJsonlPath: string;
}

export interface AgentBState {
  task: string;
  taskStatus: TaskStatus;
  tokenUsage: TokenUsage;
  messages: AgentMessage[];
  output: string;
}

export interface AgentAPreliminaryAssessment {
  understood: boolean;
  taskOverview: string;
  complexity: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  needsAgentB: boolean;
  clarificationNeeded?: string;
}

// ─── Iteration Budget ──────────────────────────────────────────────

export class IterationBudget {
  private _remaining: number;
  private _total: number;

  constructor(maxIterations: number) {
    this._remaining = maxIterations;
    this._total = maxIterations;
  }

  get remaining(): number {
    return this._remaining;
  }

  get total(): number {
    return this._total;
  }

  consume(): boolean {
    if (this._remaining <= 0) return false;
    this._remaining--;
    return true;
  }

  refund(count = 1): void {
    this._remaining = Math.min(this._remaining + count, this._total);
  }
}

// ─── Token Threshold ───────────────────────────────────────────────

export const AGENT_B_TOKEN_THRESHOLD = 0.9; // 90%
export const COMPACTION_THRESHOLD = 0.75;    // 75% of context window
