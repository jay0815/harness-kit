import type {
  AgentMiddleware,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  AfterModelResult,
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

  async runAfterModel(state: RuntimeState, response: LLMResponse): Promise<AfterModelResult> {
    let currentResponse = response;

    for (const mw of this.middlewares) {
      if (!mw.afterModel) continue;

      const result = await mw.afterModel(state, currentResponse);

      // normalize: 旧 middleware 返回 LLMResponse，新返回 AfterModelResult
      if (result && typeof result === "object" && "action" in result) {
        if (result.action !== "accept") return result; // short-circuit retry/fail
        currentResponse = result.response;
      } else {
        currentResponse = result as LLMResponse;
      }
    }

    return { action: "accept", response: currentResponse };
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
