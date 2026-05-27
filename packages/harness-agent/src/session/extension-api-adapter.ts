import type { HarnessExtensionAPI, ToolDefinition } from "./types.js";

/** Internal session surface that the adapter delegates to */
export interface SessionAdapterTarget {
  addEventHandler(event: string, handler: (...args: unknown[]) => unknown): void;
  registerTool(tool: ToolDefinition): void;
  enqueueUserMessage(content: string): void;
}

/**
 * Create an ExtensionAPI that delegates to the session's internal methods.
 * PI-compatible: on(), registerTool(), sendUserMessage().
 */
export function createExtensionAPI(target: SessionAdapterTarget): HarnessExtensionAPI {
  const on = (event: string, handler: (...args: unknown[]) => unknown): void => {
    target.addEventHandler(event, handler);
  };

  return {
    on: on as HarnessExtensionAPI["on"],

    registerTool(tool: ToolDefinition): void {
      target.registerTool(tool);
    },

    sendUserMessage(content: string): void {
      target.enqueueUserMessage(content);
    },
  };
}
