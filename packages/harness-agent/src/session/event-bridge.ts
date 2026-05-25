import type { AgentEvent } from "../core/types.js";

/** PI-shaped extension event with turnIndex */
export interface BridgedEvent {
  type: string;
  event: any;
}

/**
 * Convert internal toolCall content blocks to PI's tool_use format.
 * Only transforms blocks in assistant messages; other roles pass through.
 */
export function bridgeContentBlocks(content: any[]): any[] {
  if (!Array.isArray(content)) return content;
  return content.map((block) => {
    if (block?.type === "toolCall") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input ?? block.arguments,
      };
    }
    return block;
  });
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
      const msg = event.message as any;
      const bridgedMessage = msg ? { ...msg, content: bridgeContentBlocks(msg.content) } : msg;
      return {
        type: "turn_end",
        event: {
          type: "turn_end",
          turnIndex,
          message: bridgedMessage,
          toolResults: event.toolResults,
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
          assistantMessageEvent: (event as any).assistantMessageEvent,
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
          partialResult: (event as any).partialResult,
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
        event: { type: "agent_end", messages: (event as any).messages },
      };

    default:
      return null;
  }
}
