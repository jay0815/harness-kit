import type { AgentToolCall } from "./types.js";

/**
 * Extract the arguments object from a tool call.
 * Handles both PI's `input` field and legacy `arguments` field.
 */
export function extractToolArgs(toolCall: AgentToolCall): Record<string, unknown> {
  const tc = toolCall as unknown as Record<string, unknown>;
  return (tc.input ?? tc.arguments ?? {}) as Record<string, unknown>;
}
