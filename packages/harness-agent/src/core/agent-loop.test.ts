import { describe, it, expect } from "vitest";
import { runAgentLoop } from "./agent-loop.js";
import { MiddlewarePipeline } from "./middleware.js";
import { IterationBudget } from "./types.js";
import type {
  AgentLoopConfig,
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolResult,
} from "./types.js";
import { cast, getProp, mockModel } from "./test-utils.js";

function makeBudget(max = 10): IterationBudget {
  return new IterationBudget(max);
}

function mockStream(
  ...responses: Array<{ content: Array<Record<string, unknown>>; stopReason?: string }>
): (...args: unknown[]) => Promise<{ result: () => Promise<Record<string, unknown>> }> {
  let callIndex = 0;
  return async (_model: unknown, _ctx: unknown, _opts: unknown) => {
    const resp = responses[Math.min(callIndex++, responses.length - 1)];
    return {
      result: async () => ({
        content: resp.content.map((c) =>
          c.type === "toolCall" ? { ...c, input: c.input ?? c.arguments } : c,
        ),
        stopReason: resp.stopReason ?? "end_turn",
        usage: { input: 100, output: 50 },
      }),
    };
  };
}

function makeTool(
  name: string,
  handler: (id: string, args: unknown) => Promise<AgentToolResult<unknown>>,
): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: {} as import("@sinclair/typebox").TSchema,
    execute: handler,
  };
}

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text" as const, text }], details: null };
}

function toolCallBlock(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): Record<string, unknown> {
  return { type: "toolCall" as const, id, name, input };
}

describe("runAgentLoop", () => {
  it("appends assistant message and tool results to messages after tool execution", async () => {
    const tool = makeTool("read_file", async () => textResult("file content"));
    const events: AgentEvent[] = [];

    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [tool],
      contextWindow: 200_000,
      streamFn: cast<import("./types.js").StreamFn>(
        mockStream(
          { content: [toolCallBlock("tc1", "read_file", { path: "/test" })] },
          { content: [{ type: "text", text: "Done reading." }] },
        ),
      ),
    };

    const result = await runAgentLoop(config, makeBudget(), new MiddlewarePipeline(), (e) => {
      events.push(e);
    });

    // messages should contain: assistant(toolCall) + tool result + final assistant text
    const roles = result.messages.map((m) => getProp<string>(m, "role"));
    expect(roles).toEqual(["assistant", "toolResult", "assistant"]);

    // Tool result message should have the file content
    const toolMsg = cast<Record<string, unknown>>(result.messages[1]);
    expect(getProp(toolMsg, "toolCallId")).toBe("tc1");
    expect(getProp<Array<Record<string, unknown>>>(toolMsg, "content")[0].text).toBe(
      "file content",
    );
  });

  it("supports multi-round tool calls", async () => {
    let toolCallCount = 0;
    const tool = makeTool("grep", async () => {
      toolCallCount++;
      return textResult(`match ${toolCallCount}`);
    });
    const events: AgentEvent[] = [];

    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [tool],
      contextWindow: 200_000,
      streamFn: cast<import("./types.js").StreamFn>(
        mockStream(
          { content: [toolCallBlock("tc1", "grep", { query: "foo" })] },
          { content: [toolCallBlock("tc2", "grep", { query: "bar" })] },
          { content: [{ type: "text", text: "Search complete." }] },
        ),
      ),
    };

    const result = await runAgentLoop(config, makeBudget(), new MiddlewarePipeline(), (e) => {
      events.push(e);
    });

    // 3 LLM calls, 2 tool results, final text appended.
    expect(toolCallCount).toBe(2);
    const roles = result.messages.map((m) => getProp<string>(m, "role"));
    expect(roles).toEqual([
      "assistant",
      "toolResult", // round 1
      "assistant",
      "toolResult", // round 2
      "assistant", // final text
    ]);
  });

  it("marks error results with isError: true", async () => {
    const tool = makeTool("fail", async () => {
      throw new Error("boom");
    });
    const events: AgentEvent[] = [];

    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [tool],
      contextWindow: 200_000,
      streamFn: cast<import("./types.js").StreamFn>(
        mockStream(
          { content: [toolCallBlock("tc1", "fail")] },
          { content: [{ type: "text", text: "Sorry about that." }] },
        ),
      ),
    };

    const result = await runAgentLoop(config, makeBudget(), new MiddlewarePipeline(), (e) => {
      events.push(e);
    });

    // Tool result should be marked as error
    const toolMsg = cast<Record<string, unknown>>(result.messages[1]);
    expect(getProp(toolMsg, "isError")).toBe(true);
    expect(getProp<Array<Record<string, unknown>>>(toolMsg, "content")[0].text).toContain("boom");

    // Event should also reflect error
    const endEvent = cast<Record<string, unknown> | undefined>(
      events.find((e) => e.type === "tool_execution_end"),
    );
    expect(endEvent?.isError).toBe(true);
  });

  it("terminates on pure text response (no tool calls)", async () => {
    const events: AgentEvent[] = [];

    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [],
      contextWindow: 200_000,
      streamFn: cast<import("./types.js").StreamFn>(
        mockStream({ content: [{ type: "text", text: "Hello!" }] }),
      ),
    };

    const result = await runAgentLoop(config, makeBudget(), new MiddlewarePipeline(), (e) => {
      events.push(e);
    });

    // Final text response should be appended to messages
    expect(result.messages).toHaveLength(1);
    expect(getProp<string>(result.messages[0], "role")).toBe("assistant");
    expect(getProp<Array<Record<string, unknown>>>(result.messages[0], "content")[0].text).toBe(
      "Hello!",
    );
    expect(result.tokenUsage.totalTokens).toBe(150);

    const turnEnds = events.filter((e) => e.type === "turn_end");
    expect(turnEnds).toHaveLength(1);
  });

  it("respects budget exhaustion", async () => {
    const tool = makeTool("loop", async () => textResult("ok"));
    const events: AgentEvent[] = [];

    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [tool],
      contextWindow: 200_000,
      streamFn: cast<import("./types.js").StreamFn>(
        mockStream(
          { content: [toolCallBlock("tc1", "loop")] },
          { content: [toolCallBlock("tc2", "loop")] },
          { content: [toolCallBlock("tc3", "loop")] },
        ),
      ),
    };

    // Budget of 2 — only 2 LLM calls allowed
    const result = await runAgentLoop(config, makeBudget(2), new MiddlewarePipeline(), (e) => {
      events.push(e);
    });

    // Should have made 2 rounds of tool calls
    const toolMsgs = result.messages.filter((m) => getProp<string>(m, "role") === "toolResult");
    expect(toolMsgs).toHaveLength(2);
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    const tool = makeTool("read_file", async () => textResult("content"));
    const events: AgentEvent[] = [];

    let callCount = 0;
    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [tool],
      contextWindow: 200_000,
      signal: controller.signal,
      streamFn: cast<import("./types.js").StreamFn>(
        async (model: unknown, ctx: unknown, opts: unknown) => {
          callCount++;
          if (callCount === 2) controller.abort(); // Abort after first round
          return mockStream(
            { content: [toolCallBlock(`tc${callCount}`, "read_file")] },
            { content: [{ type: "text", text: "done" }] },
          )(model, ctx, opts);
        },
      ),
    };

    await runAgentLoop(config, makeBudget(), new MiddlewarePipeline(), (e) => {
      events.push(e);
    });

    // Should have stopped after abort
    expect(callCount).toBe(2);
  });

  it("consumes stream.result() correctly", async () => {
    const events: AgentEvent[] = [];

    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [],
      contextWindow: 200_000,
      streamFn: cast<import("./types.js").StreamFn>(
        mockStream({ content: [{ type: "text", text: "Hello!" }] }),
      ),
    };

    const result = await runAgentLoop(config, makeBudget(), new MiddlewarePipeline(), (e) => {
      events.push(e);
    });

    expect(result.messages).toHaveLength(1);
    expect(getProp<Array<Record<string, unknown>>>(result.messages[0], "content")[0].text).toBe(
      "Hello!",
    );
    expect(result.tokenUsage.inputTokens).toBe(100);
    expect(result.tokenUsage.outputTokens).toBe(50);
  });

  it("throws on stream.result() rejection", async () => {
    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [],
      contextWindow: 200_000,
      streamFn: cast<AgentLoopConfig["streamFn"]>(async () => ({
        result: async () => {
          throw new Error("stream failed");
        },
      })),
    };

    await expect(
      runAgentLoop(config, makeBudget(), new MiddlewarePipeline(), () => {}),
    ).rejects.toThrow("LLM stream failed: stream failed");
  });

  it("throws on error stopReason", async () => {
    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [],
      contextWindow: 200_000,
      streamFn: cast<AgentLoopConfig["streamFn"]>(async () => ({
        result: async () => ({
          content: [],
          stopReason: "error",
          errorMessage: "rate limited",
          usage: undefined,
        }),
      })),
    };

    await expect(
      runAgentLoop(config, makeBudget(), new MiddlewarePipeline(), () => {}),
    ).rejects.toThrow("LLM response stopped: error - rate limited");
  });

  it("throws on aborted stopReason", async () => {
    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [],
      contextWindow: 200_000,
      streamFn: cast<AgentLoopConfig["streamFn"]>(async () => ({
        result: async () => ({
          content: [],
          stopReason: "aborted",
          usage: undefined,
        }),
      })),
    };

    await expect(
      runAgentLoop(config, makeBudget(), new MiddlewarePipeline(), () => {}),
    ).rejects.toThrow("LLM response stopped: aborted");
  });

  it("preserves arguments and adds input for toolCall", async () => {
    const tool = makeTool("read_file", async (_id, args) => textResult(JSON.stringify(args)));
    const events: AgentEvent[] = [];

    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [tool],
      contextWindow: 200_000,
      streamFn: cast<import("./types.js").StreamFn>(
        mockStream(
          {
            content: [
              { type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "/f" } },
            ],
          },
          { content: [{ type: "text", text: "done" }] },
        ),
      ),
    };

    const result = await runAgentLoop(config, makeBudget(), new MiddlewarePipeline(), (e) => {
      events.push(e);
    });

    // Tool should have received args with input field
    const toolMsg = result.messages.find((m) => getProp<string>(m, "role") === "toolResult");
    expect(toolMsg).toBeDefined();
    expect(
      JSON.parse(getProp<Array<Record<string, unknown>>>(toolMsg, "content")[0].text as string),
    ).toEqual({ path: "/f" });
  });

  it("uses toolResult role with toolName and timestamp", async () => {
    const tool = makeTool("grep", async () => textResult("match"));
    const events: AgentEvent[] = [];

    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [tool],
      contextWindow: 200_000,
      streamFn: cast<import("./types.js").StreamFn>(
        mockStream(
          { content: [toolCallBlock("tc1", "grep", { query: "foo" })] },
          { content: [{ type: "text", text: "done" }] },
        ),
      ),
    };

    const result = await runAgentLoop(config, makeBudget(), new MiddlewarePipeline(), (e) => {
      events.push(e);
    });

    const toolResultMsg = cast<Record<string, unknown> | undefined>(
      result.messages.find((m) => getProp<string>(m, "role") === "toolResult"),
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg?.toolCallId).toBe("tc1");
    expect(toolResultMsg?.toolName).toBe("grep");
    expect(toolResultMsg?.timestamp).toBeDefined();
    expect(toolResultMsg?.isError).toBe(false);
  });

  it("turn_end carries metadata snapshot on pure text response", async () => {
    const events: AgentEvent[] = [];
    let stateMetadataRef: Record<string, unknown> | null = null;
    const pipeline = new MiddlewarePipeline();

    // Register a middleware that writes metadata and captures the reference
    pipeline.register({
      priority: 10,
      name: "meta-writer",
      afterModel: (state, response) => {
        state.metadata["test_key"] = { value: "hello" };
        stateMetadataRef = state.metadata;
        return response;
      },
    });

    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [],
      contextWindow: 200_000,
      streamFn: cast<import("./types.js").StreamFn>(
        mockStream({ content: [{ type: "text", text: "done" }] }),
      ),
    };

    await runAgentLoop(config, makeBudget(), pipeline, (e) => {
      events.push(e);
    });

    const turnEnd = cast<Record<string, unknown> | undefined>(
      events.find((e) => e.type === "turn_end"),
    );
    expect(turnEnd).toBeDefined();
    expect(turnEnd?.metadata).toBeDefined();
    expect(getProp<Record<string, unknown>>(turnEnd, "metadata").test_key).toEqual({
      value: "hello",
    });

    // Prove copy semantics: emitted metadata is NOT the same object as state.metadata
    expect(getProp(turnEnd, "metadata")).not.toBe(stateMetadataRef);
    // Mutating the emitted copy does not affect state.metadata
    getProp<Record<string, unknown>>(turnEnd, "metadata").injected = true;
    expect(getProp(stateMetadataRef, "injected")).toBeUndefined();
  });

  it("turn_end carries metadata snapshot after tool execution", async () => {
    const events: AgentEvent[] = [];
    const pipeline = new MiddlewarePipeline();

    pipeline.register({
      priority: 10,
      name: "meta-writer",
      afterModel: (_state, response) => {
        _state.metadata["tool_run"] = true;
        return response;
      },
    });

    const tool = makeTool("read_file", async () => textResult("content"));

    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: [],
      tools: [tool],
      contextWindow: 200_000,
      streamFn: cast<import("./types.js").StreamFn>(
        mockStream(
          { content: [toolCallBlock("tc1", "read_file", { path: "/test" })] },
          { content: [{ type: "text", text: "done" }] },
        ),
      ),
    };

    await runAgentLoop(config, makeBudget(), pipeline, (e) => {
      events.push(e);
    });

    const turnEnds = cast<Array<Record<string, unknown>>>(
      events.filter((e) => e.type === "turn_end"),
    );
    // Second turn_end (after tool execution) should carry metadata
    const lastTurnEnd = turnEnds[turnEnds.length - 1];
    expect(lastTurnEnd?.metadata).toBeDefined();
    expect(getProp<Record<string, unknown>>(lastTurnEnd, "metadata").tool_run).toBe(true);
  });

  it("preserves beforeModel message mutations as loop source of truth", async () => {
    const initialMessages = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `message ${i}` }],
    })) as AgentMessage[];

    const compactedMessages = [
      {
        role: "user",
        content: [{ type: "text", text: "summary" }],
      },
      initialMessages[4],
    ] as AgentMessage[];

    const pipeline = new MiddlewarePipeline();
    pipeline.register({
      priority: 10,
      name: "compact-test",
      beforeModel: async (state) => {
        state.context.messages.splice(0, state.context.messages.length, ...compactedMessages);
      },
    });

    let llmMessageCount = 0;
    const config: AgentLoopConfig = {
      model: mockModel("test-model"),
      systemPrompt: "test",
      messages: initialMessages,
      tools: [],
      contextWindow: 200_000,
      streamFn: cast<import("./types.js").StreamFn>(
        async (_model: unknown, ctx: { messages: AgentMessage[] }) => {
          llmMessageCount = ctx.messages.length;
          return {
            result: async () => ({
              content: [{ type: "text", text: "done" }],
              stopReason: "end_turn",
              usage: { input: 10, output: 5 },
            }),
          };
        },
      ),
    };

    const result = await runAgentLoop(config, makeBudget(), pipeline, () => {});

    expect(llmMessageCount).toBe(2);
    expect(result.messages).toHaveLength(3);
    expect(getProp<Array<Record<string, unknown>>>(result.messages[0], "content")[0].text).toBe(
      "summary",
    );
    expect(getProp<Array<Record<string, unknown>>>(result.messages[1], "content")[0].text).toBe(
      "message 4",
    );
  });
});
