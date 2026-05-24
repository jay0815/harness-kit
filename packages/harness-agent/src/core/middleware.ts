import type {
  AgentMiddleware,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  LLMResponse,
  RuntimeState,
} from "./types.js";

export class MiddlewarePipeline {
  private middlewares: AgentMiddleware[] = [];

  register(middleware: AgentMiddleware): void {
    this.middlewares.push(middleware);
    this.middlewares.sort((a, b) => a.priority - b.priority);
  }

  unregister(name: string): void {
    this.middlewares = this.middlewares.filter((m) => m.name !== name);
  }

  async runBeforeModel(state: RuntimeState): Promise<void> {
    for (const mw of this.middlewares) {
      if (mw.beforeModel) {
        await mw.beforeModel(state);
      }
    }
  }

  async runAfterModel(state: RuntimeState, response: LLMResponse): Promise<LLMResponse> {
    let current = response;
    for (const mw of this.middlewares) {
      if (mw.afterModel) {
        current = await mw.afterModel(state, current);
      }
    }
    return current;
  }

  async runBeforeTool(
    state: RuntimeState,
    toolCall: AgentToolCall,
    tool: AgentTool | undefined,
  ): Promise<AgentToolResult<any> | null> {
    for (const mw of this.middlewares) {
      if (mw.beforeTool) {
        const result = await mw.beforeTool(state, toolCall, tool);
        if (result !== null) return result;
      }
    }
    return null;
  }

  async runAfterTool(
    state: RuntimeState,
    toolCall: AgentToolCall,
    tool: AgentTool | undefined,
    result: AgentToolResult<any>,
  ): Promise<AgentToolResult<any>> {
    let current = result;
    for (const mw of this.middlewares) {
      if (mw.afterTool) {
        current = await mw.afterTool(state, toolCall, tool, current);
      }
    }
    return current;
  }
}
