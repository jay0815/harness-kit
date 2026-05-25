import type { TSchema, Static } from "@sinclair/typebox";
import type { AgentToolResult, AgentTool, Model, StreamFn } from "../core/types.js";

/**
 * ToolDefinition — structurally compatible with PI's ToolDefinition.
 * packages/core/src/tools.ts uses `ToolDefinition<typeof schema>`.
 */
export interface ToolDefinition<
  TParameters extends TSchema = TSchema,
  TDetails = any,
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

/**
 * The ExtensionAPI interface that packages/core will code against.
 * Structurally compatible with PI's ExtensionAPI for the 6 methods we use.
 */
export interface HarnessExtensionAPI {
  on(event: string, handler: (...args: any[]) => any): void;
  registerTool(tool: ToolDefinition<any, any, any>): void;
  sendUserMessage(content: string): void;
}

/** Session lifecycle state */
export type SessionState = "idle" | "running" | "dispatching" | "shutting_down";

export type { StreamFn };

/** Configuration for creating a HarnessAgentSession */
export interface HarnessAgentSessionConfig {
  cwd: string;
  model: Model<any>;
  systemPrompt: string;
  streamFn: StreamFn;
  tools?: AgentTool<any>[];
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
}
