import { ImageContent, TextContent, ThinkingContent, ToolCall } from "@earendil-works/pi-ai";
import type { AgentEvent } from "../core/types.js";
import type {
  AgentEndPayload,
  AgentStartPayload,
  MessageEndPayload,
  MessageStartPayload,
  MessageUpdatePayload,
  ToolExecutionEndPayload,
  ToolExecutionStartPayload,
  ToolExecutionUpdatePayload,
  TurnEndPayload,
  TurnStartPayload,
} from "./types.js";

/** PI-shaped extension event with turnIndex — discriminated union */
export type BridgedEvent =
  | { type: "agent_start"; event: AgentStartPayload }
  | { type: "agent_end"; event: AgentEndPayload }
  | { type: "turn_start"; event: TurnStartPayload }
  | { type: "turn_end"; event: TurnEndPayload }
  | { type: "tool_execution_start"; event: ToolExecutionStartPayload }
  | { type: "tool_execution_update"; event: ToolExecutionUpdatePayload }
  | { type: "tool_execution_end"; event: ToolExecutionEndPayload }
  | { type: "message_start"; event: MessageStartPayload }
  | { type: "message_update"; event: MessageUpdatePayload }
  | { type: "message_end"; event: MessageEndPayload };

type ContentBlocks = (TextContent | ImageContent)[] | (TextContent | ThinkingContent | {
  type: "tool_use"
  id: string
  name: string
  // oxlint-disable-next-line typescript/no-explicit-any
  input: Record<string, any>
})[]

/**
 * Convert internal toolCall content blocks to PI's tool_use format.
 * Only transforms blocks in assistant messages; other roles pass through.
 */
export function bridgeContentBlocks(
  content: (TextContent | ImageContent)[] | (TextContent | ThinkingContent | ToolCall)[],
): ContentBlocks {
  if (!Array.isArray(content)) return content;
  return content.map((block) => {
    if (block?.type === "toolCall") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.arguments,
      };
    }
    return block;
  }) as ContentBlocks;
}

/**
 * Bridge an AgentEvent to PI's extension event shape.
 * Returns null for unknown event types.
 */
export function bridgeAgentEvent(event: AgentEvent, turnIndex: number): BridgedEvent | null {
  switch (event.type) {
    case "turn_start":
      return {
        type: "turn_start",
        event: {
          type: "turn_start",
          turnIndex,
          timestamp: Date.now(),
        },
      };

    case "turn_end": {
      const msg = event.message;
      const bridgedContent = Array.isArray(msg.content)
        ? bridgeContentBlocks(msg.content)
        : undefined;
      return {
        type: "turn_end",
        event: {
          type: "turn_end",
          turnIndex,
          message: { ...event.message, content: bridgedContent } as TurnEndPayload["message"],
          toolResults: event.toolResults,
          metadata: event.metadata,
        },
      };
    }

    case "message_start":
      return {
        type: "message_start",
        event: {
          type: "message_start",
          message: event.message,
        },
      };

    case "message_update":
      return {
        type: "message_update",
        event: {
          type: "message_update",
          message: event.message,
          assistantMessageEvent: event.assistantMessageEvent,
        },
      };

    case "message_end":
      return {
        type: "message_end",
        event: {
          type: "message_end",
          message: event.message,
        },
      };

    case "tool_execution_start":
      return {
        type: "tool_execution_start",
        event: {
          type: "tool_execution_start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        },
      };

    case "tool_execution_update":
      return {
        type: "tool_execution_update",
        event: {
          type: "tool_execution_update",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          partialResult: event.partialResult,
        },
      };

    case "tool_execution_end":
      return {
        type: "tool_execution_end",
        event: {
          type: "tool_execution_end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        },
      };

    case "agent_start":
      return { type: "agent_start", event: { type: "agent_start" } };

    case "agent_end":
      return {
        type: "agent_end",
        event: { type: "agent_end", messages: event.messages },
      };

    default:
      return null;
  }
}
