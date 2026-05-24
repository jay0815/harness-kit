import type {
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  ToolExecutionMode,
} from "./types.js";
import { MiddlewarePipeline } from "./middleware.js";
import type { RuntimeState } from "./types.js";

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  result: AgentToolResult<any>;
  isError: boolean;
}

export interface ToolExecutorConfig {
  maxConcurrency?: number; // default 8
}

const DEFAULT_MAX_CONCURRENCY = 8;

// Tools that are safe to run concurrently (read-only)
const PARALLEL_SAFE_TOOLS = new Set(["read_file", "grep", "glob", "search", "list_files"]);

// Tools that must always run sequentially
const NEVER_PARALLEL_TOOLS = new Set(["write_file", "edit_file", "delete_file"]);

export class StreamingToolExecutor {
  private config: ToolExecutorConfig;

  constructor(config: ToolExecutorConfig = {}) {
    this.config = config;
  }

  /**
   * Execute tool calls based on execution mode.
   * - "sequential": one at a time
   * - "parallel": parallel for safe tools, sequential for others
   */
  async execute(
    toolCalls: AgentToolCall[],
    tools: AgentTool<any>[],
    state: RuntimeState,
    pipeline: MiddlewarePipeline,
    mode: ToolExecutionMode = "parallel",
  ): Promise<ToolExecutionResult[]> {
    if (mode === "sequential") {
      return this.executeSequential(toolCalls, tools, state, pipeline);
    }
    return this.executeParallel(toolCalls, tools, state, pipeline);
  }

  private async executeSequential(
    toolCalls: AgentToolCall[],
    tools: AgentTool<any>[],
    state: RuntimeState,
    pipeline: MiddlewarePipeline,
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const toolCall of toolCalls) {
      const result = await this.executeSingle(toolCall, tools, state, pipeline);
      results.push(result);
    }

    return results;
  }

  private async executeParallel(
    toolCalls: AgentToolCall[],
    tools: AgentTool<any>[],
    state: RuntimeState,
    pipeline: MiddlewarePipeline,
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    const pendingParallel: AgentToolCall[] = [];
    const maxConcurrency = this.config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

    const flushParallel = async () => {
      if (pendingParallel.length === 0) return;
      const chunks = chunkArray(pendingParallel.splice(0), maxConcurrency);
      for (const chunk of chunks) {
        const chunkResults = await Promise.all(
          chunk.map((tc) => this.executeSingle(tc, tools, state, pipeline)),
        );
        results.push(...chunkResults);
      }
    };

    for (const toolCall of toolCalls) {
      if (PARALLEL_SAFE_TOOLS.has(toolCall.name)) {
        pendingParallel.push(toolCall);
      } else {
        // Write barrier: flush accumulated parallel tasks first, then execute sequentially
        await flushParallel();
        results.push(await this.executeSingle(toolCall, tools, state, pipeline));
      }
    }

    // Flush any remaining parallel tasks
    await flushParallel();

    return results;
  }

  private async executeSingle(
    toolCall: AgentToolCall,
    tools: AgentTool<any>[],
    state: RuntimeState,
    pipeline: MiddlewarePipeline,
  ): Promise<ToolExecutionResult> {
    const tool = tools.find((t) => t.name === toolCall.name);

    // before_tool chain
    const blocked = await pipeline.runBeforeTool(state, toolCall, tool);
    if (blocked !== null) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: blocked,
        isError: true,
      };
    }

    // Execute
    let result: AgentToolResult<any>;
    try {
      if (!tool) throw new Error(`Tool not found: ${toolCall.name}`);
      const args = (toolCall as any).input ?? (toolCall as any).arguments;
      result = await tool.execute(toolCall.id, args);
    } catch (err) {
      result = {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        details: null,
        isError: true,
      };
    }

    // after_tool chain
    result = await pipeline.runAfterTool(state, toolCall, tool, result);

    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result,
      isError: result.isError ?? false,
    };
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
