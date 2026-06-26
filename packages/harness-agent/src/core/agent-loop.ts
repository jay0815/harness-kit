import type { Message, AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentEvent,
  AgentMessage,
  AgentToolCall,
  AgentToolResult,
  AgentLoopConfig,
  IterationBudget,
  LLMResponse,
  RuntimeState,
  TokenUsage,
  StreamResult,
} from "./types.js";
import { MiddlewarePipeline } from "./middleware.js";
import { extractToolArgs } from "./tool-utils.js";

export interface AgentLoopResult {
  messages: AgentMessage[];
  tokenUsage: TokenUsage;
}

export type AsyncEmit = (event: AgentEvent) => void | Promise<void>;

export async function runAgentLoop(
  config: AgentLoopConfig,
  budget: IterationBudget,
  pipeline: MiddlewarePipeline,
  emit: AsyncEmit,
): Promise<AgentLoopResult> {
  const messages: AgentMessage[] = [];
  const tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    contextWindow: config.contextWindow ?? 200_000,
  };

  const state: RuntimeState = {
    context: {
      systemPrompt: config.systemPrompt,
      messages: [],
      tools: config.tools,
    },
    iteration: 0,
    tokenUsage,
    metadata: {},
  };

  // Apply transformContext if provided
  let contextMessages = config.messages;
  if (config.transformContext) {
    contextMessages = await config.transformContext(contextMessages, config.signal);
  }

  state.context.messages = contextMessages;
  messages.push(...contextMessages);

  while (budget.remaining > 0) {
    if (config.signal?.aborted) break;

    if (!budget.consume()) break;

    await emit({ type: "turn_start" });

    // before_model chain
    await pipeline.runBeforeModel(state);

    // Convert to LLM messages
    const llmMessages = config.convertToLlm
      ? await config.convertToLlm(state.context.messages)
      : (state.context.messages as Message[]);

    // LLM call
    const stream = await config.streamFn(
      config.model,
      {
        messages: llmMessages,
        systemPrompt: state.context.systemPrompt,
        tools: state.context.tools as import("@earendil-works/pi-ai").Tool[],
      },
      config,
    );

    const response = await collectStream(stream);
    state.iteration++;

    // Update token usage
    if (response.usage) {
      tokenUsage.inputTokens += response.usage.inputTokens;
      tokenUsage.outputTokens += response.usage.outputTokens;
      tokenUsage.totalTokens += response.usage.inputTokens + response.usage.outputTokens;
    }

    // after_model chain
    const afterResult = await pipeline.runAfterModel(state, response);

    if (afterResult.action === "retry") {
      messages.push({
        role: "user",
        content: [{ type: "text", text: afterResult.feedback }],
        timestamp: Date.now(),
      } as AgentMessage);
      state.context.messages = messages;
      budget.refund();
      continue;
    }

    if (afterResult.action === "fail") {
      throw new Error(`Agent loop failed: ${afterResult.reason}`);
    }

    // accept — continue with original logic
    const finalResponse = afterResult.response;

    // Check for tool calls
    const toolCalls = finalResponse.content.filter((c) => c.type === "toolCall") as AgentToolCall[];

    if (toolCalls.length === 0) {
      // Pure text response — append and end
      messages.push({ role: "assistant", content: finalResponse.content } as AgentMessage);
      state.context.messages = messages;
      await emit({
        type: "turn_end",
        message: { role: "assistant", content: finalResponse.content } as AgentMessage,
        toolResults: [],
        metadata: { ...state.metadata },
      });
      break;
    }

    // Execute tool calls
    const toolResults = await executeToolCalls(toolCalls, config, state, pipeline, emit);

    // Check terminate flag — any tool can request loop termination
    const shouldTerminate = toolResults.some((r) => r.terminate);

    // Append assistant message (with tool calls) and tool result messages
    messages.push({ role: "assistant", content: finalResponse.content } as AgentMessage);
    for (let i = 0; i < toolCalls.length; i++) {
      messages.push({
        role: "toolResult",
        toolCallId: toolCalls[i].id,
        toolName: toolCalls[i].name,
        content: toolResults[i].content,
        details: toolResults[i].details,
        isError: toolResults[i].isError ?? false,
        timestamp: Date.now(),
      } as AgentMessage);
    }
    state.context.messages = messages;

    await emit({
      type: "turn_end",
      message: { role: "assistant", content: finalResponse.content } as AgentMessage,
      toolResults,
      metadata: { ...state.metadata },
    });

    if (shouldTerminate) break;

    // Backoff: wait if any tool requested a delay (e.g., rate-limit recovery)
    const maxBackoff = Math.max(0, ...toolResults.map((r) => r.backoffMs ?? 0));
    if (maxBackoff > 0) {
      await new Promise((resolve) => setTimeout(resolve, maxBackoff));
    }

    // Check shouldStopAfterTurn
    if (config.shouldStopAfterTurn) {
      const shouldStop = await config.shouldStopAfterTurn({
        message: { role: "assistant", content: finalResponse.content } as AssistantMessage,
        toolResults,
        context: state.context,
        newMessages: messages,
      });
      if (shouldStop) break;
    }

    // Check steering messages
    if (config.getSteeringMessages) {
      const steering = await config.getSteeringMessages();
      if (steering.length > 0) {
        messages.push(...steering);
        state.context.messages = messages;
      }
    }

    // Check follow-up messages
    if (config.getFollowUpMessages) {
      const followUp = await config.getFollowUpMessages();
      if (followUp.length > 0) {
        messages.push(...followUp);
        state.context.messages = messages;
      }
    }

    // Continue loop — LLM sees tool results and can make more calls
    continue;
  }

  return { messages, tokenUsage };
}

async function executeToolCalls(
  toolCalls: AgentToolCall[],
  config: AgentLoopConfig,
  state: RuntimeState,
  pipeline: MiddlewarePipeline,
  emit: AsyncEmit,
): Promise<AgentToolResult<unknown>[]> {
  const results: AgentToolResult<unknown>[] = [];
  const tools = config.tools ?? [];

  for (const toolCall of toolCalls) {
    const tool = tools.find((t) => t.name === toolCall.name);
    const args = extractToolArgs(toolCall);

    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args,
    });

    // before_tool chain
    const blocked = await pipeline.runBeforeTool(state, toolCall, tool);
    if (blocked !== null) {
      results.push(blocked);
      await emit({
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: blocked,
        isError: true,
      });
      continue;
    }

    // Execute tool
    let result: AgentToolResult<unknown>;
    try {
      if (!tool) throw new Error(`Tool not found: ${toolCall.name}`);
      result = await tool.execute(toolCall.id, args, config.signal);
    } catch (err) {
      result = {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        details: null,
        isError: true,
      };
    }

    // after_tool chain
    result = await pipeline.runAfterTool(state, toolCall, tool, result);
    results.push(result);

    await emit({
      type: "tool_execution_end",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result,
      isError: result.isError ?? false,
    });
  }

  return results;
}

async function collectStream(stream: StreamResult): Promise<LLMResponse> {
  let msg: AssistantMessage;

  try {
    msg = await stream.result();
  } catch (err) {
    throw new Error(`LLM stream failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (msg.stopReason === "error" || msg.stopReason === "aborted") {
    const detail = msg.errorMessage ? ` - ${msg.errorMessage}` : "";
    throw new Error(`LLM response stopped: ${msg.stopReason}${detail}`);
  }

  const content = msg.content.map((c) => {
    if (c.type === "toolCall") {
      const tc = c as unknown as Record<string, unknown>;
      return { ...c, input: tc.input ?? tc.arguments };
    }
    return c;
  });

  return {
    content,
    stopReason: msg.stopReason,
    usage: msg.usage ? { inputTokens: msg.usage.input, outputTokens: msg.usage.output } : undefined,
  };
}
