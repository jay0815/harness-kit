import type { HarnessExtensionAPI, ToolDefinition } from "./types.js";

/** Internal session surface that the adapter delegates to */
export interface SessionAdapterTarget {
  addEventHandler(event: string, handler: (...args: any[]) => any): void;
  registerTool(tool: ToolDefinition<any, any, any>): void;
  enqueueUserMessage(content: string): void;
}

/**
 * Create an ExtensionAPI that delegates to the session's internal methods.
 * PI-compatible: on(), registerTool(), sendUserMessage().
 */
export function createExtensionAPI(target: SessionAdapterTarget): HarnessExtensionAPI {
  return {
    on(event: string, handler: (...args: any[]) => any): void {
      target.addEventHandler(event, handler);
    },

    registerTool(tool: ToolDefinition<any, any, any>): void {
      target.registerTool(tool);
    },

    sendUserMessage(content: string): void {
      target.enqueueUserMessage(content);
    },
  };
}
