import type { AgentTool, AgentToolResult } from "../core/types.js";
import type { ToolDefinition, HarnessExtensionContext } from "./types.js";

/**
 * Adapt a PI-compatible ToolDefinition into our AgentTool.
 * Wraps the 5-param execute into 4-param by injecting ctx.
 */
export function adaptToolDefinition<
  TParams extends import("@sinclair/typebox").TSchema = import("@sinclair/typebox").TSchema,
  TDetails = unknown,
>(
  toolDef: ToolDefinition<TParams, TDetails>,
  ctxFactory: () => HarnessExtensionContext,
): AgentTool<TParams, TDetails> {
  return {
    name: toolDef.name,
    label: toolDef.label,
    description: toolDef.description,
    parameters: toolDef.parameters,
    prepareArguments: toolDef.prepareArguments as (
      args: unknown,
    ) => import("@sinclair/typebox").Static<TParams>,
    executionMode: toolDef.executionMode,
    execute: async (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: (partialResult: AgentToolResult<TDetails>) => void,
    ): Promise<AgentToolResult<TDetails>> => {
      const wrappedOnUpdate = onUpdate
        ? (update: TDetails) => onUpdate({ content: [], details: update })
        : undefined;
      return toolDef.execute(toolCallId, params, signal, wrappedOnUpdate, ctxFactory());
    },
  };
}

/**
 * Merge base tools with registered extension tools.
 * Registered tools override base tools with the same name.
 */
export function mergeTools(
  base: AgentTool[],
  registered: Map<string, ToolDefinition>,
  ctxFactory: () => HarnessExtensionContext,
): AgentTool[] {
  const merged = new Map<string, AgentTool>();

  for (const tool of base) {
    merged.set(tool.name, tool);
  }

  for (const [name, toolDef] of registered) {
    merged.set(name, adaptToolDefinition(toolDef, ctxFactory));
  }

  return [...merged.values()];
}
