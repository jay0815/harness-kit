import { describe, it, expect, vi } from "vitest";
import { MiddlewarePipeline } from "./middleware.js";
import type { RuntimeState, LLMResponse, AgentToolCall, AgentToolResult } from "./types.js";
import { PRIORITY_GUARD, PRIORITY_EVAL } from "./types.js";

function makeState(): RuntimeState {
  return {
    context: { systemPrompt: "", messages: [] },
    iteration: 0,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextWindow: 200_000 },
    metadata: {},
  };
}

function makeResponse(): LLMResponse {
  return { content: [], stopReason: "end_turn" };
}

function makeToolCall(name = "test"): AgentToolCall {
  return { id: "tc_1", name, type: "toolCall" } as any;
}

function makeToolResult(): AgentToolResult<any> {
  return { content: [{ type: "text", text: "ok" }], details: null };
}

describe("MiddlewarePipeline", () => {
  it("executes beforeModel in priority order", async () => {
    const pipeline = new MiddlewarePipeline();
    const order: number[] = [];

    pipeline.register({
      priority: PRIORITY_EVAL,
      name: "eval",
      beforeModel: async () => {
        order.push(2);
      },
    });
    pipeline.register({
      priority: PRIORITY_GUARD,
      name: "guard",
      beforeModel: async () => {
        order.push(1);
      },
    });

    await pipeline.runBeforeModel(makeState());
    expect(order).toEqual([1, 2]);
  });

  it("chains afterModel responses", async () => {
    const pipeline = new MiddlewarePipeline();

    pipeline.register({
      priority: 10,
      name: "a",
      afterModel: async (_state, response) => {
        response.stopReason = "modified_a";
        return response;
      },
    });
    pipeline.register({
      priority: 20,
      name: "b",
      afterModel: async (_state, response) => {
        response.stopReason = response.stopReason + "_b";
        return response;
      },
    });

    const result = await pipeline.runAfterModel(makeState(), makeResponse());
    expect(result.action).toBe("accept");
    expect(result.response!.stopReason).toBe("modified_a_b");
  });

  it("beforeTool returns null to continue", async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.register({
      priority: 10,
      name: "pass",
      beforeTool: async () => null,
    });

    const result = await pipeline.runBeforeTool(makeState(), makeToolCall(), undefined);
    expect(result).toBeNull();
  });

  it("beforeTool returns result to block", async () => {
    const pipeline = new MiddlewarePipeline();
    const blocked: AgentToolResult<any> = {
      content: [{ type: "text", text: "blocked" }],
      details: null,
      isError: true,
    };

    pipeline.register({
      priority: 10,
      name: "blocker",
      beforeTool: async () => blocked,
    });

    const result = await pipeline.runBeforeTool(makeState(), makeToolCall(), undefined);
    expect(result).toBe(blocked);
  });

  it("first beforeTool block wins", async () => {
    const pipeline = new MiddlewarePipeline();
    const block1: AgentToolResult<any> = {
      content: [{ type: "text", text: "block1" }],
      details: null,
    };
    const block2: AgentToolResult<any> = {
      content: [{ type: "text", text: "block2" }],
      details: null,
    };

    pipeline.register({
      priority: PRIORITY_GUARD,
      name: "guard",
      beforeTool: async () => block1,
    });
    pipeline.register({
      priority: PRIORITY_EVAL,
      name: "eval",
      beforeTool: async () => block2,
    });

    const result = await pipeline.runBeforeTool(makeState(), makeToolCall(), undefined);
    expect(result).toBe(block1);
  });

  it("afterTool chains results", async () => {
    const pipeline = new MiddlewarePipeline();

    pipeline.register({
      priority: 10,
      name: "a",
      afterTool: async (_s, _tc, _t, result) => {
        result.content.push({ type: "text", text: "+a" } as any);
        return result;
      },
    });
    pipeline.register({
      priority: 20,
      name: "b",
      afterTool: async (_s, _tc, _t, result) => {
        result.content.push({ type: "text", text: "+b" } as any);
        return result;
      },
    });

    const result = await pipeline.runAfterTool(
      makeState(),
      makeToolCall(),
      undefined,
      makeToolResult(),
    );
    expect(result.content).toHaveLength(3);
  });

  it("unregister removes middleware", async () => {
    const pipeline = new MiddlewarePipeline();
    const fn = vi.fn(async () => {});

    pipeline.register({ priority: 10, name: "test", beforeModel: fn });
    await pipeline.runBeforeModel(makeState());
    expect(fn).toHaveBeenCalledTimes(1);

    pipeline.unregister("test");
    await pipeline.runBeforeModel(makeState());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("empty pipeline does nothing", async () => {
    const pipeline = new MiddlewarePipeline();
    const state = makeState();

    await pipeline.runBeforeModel(state);
    const response = await pipeline.runAfterModel(state, makeResponse());
    expect(response.action).toBe("accept");
    expect(response.response!.stopReason).toBe("end_turn");

    const toolResult = await pipeline.runBeforeTool(state, makeToolCall(), undefined);
    expect(toolResult).toBeNull();

    const finalResult = await pipeline.runAfterTool(
      state,
      makeToolCall(),
      undefined,
      makeToolResult(),
    );
    expect(finalResult.content).toHaveLength(1);
  });

  it("afterModel legacy LLMResponse returns accept", async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.register({
      priority: 10,
      name: "legacy",
      afterModel: (_state, response) => {
        response.stopReason = "modified";
        return response;
      },
    });

    const result = await pipeline.runAfterModel(makeState(), makeResponse());
    expect(result.action).toBe("accept");
    expect(result.response!.stopReason).toBe("modified");
  });

  it("afterModel retry short-circuits", async () => {
    const pipeline = new MiddlewarePipeline();
    const secondFn = vi.fn();

    pipeline.register({
      priority: 10,
      name: "retrier",
      afterModel: () => ({ action: "retry" as const, feedback: "fix it" }),
    });
    pipeline.register({
      priority: 20,
      name: "second",
      afterModel: secondFn,
    });

    const result = await pipeline.runAfterModel(makeState(), makeResponse());
    expect(result.action).toBe("retry");
    expect((result as any).feedback).toBe("fix it");
    expect(secondFn).not.toHaveBeenCalled();
  });

  it("afterModel fail short-circuits", async () => {
    const pipeline = new MiddlewarePipeline();
    const secondFn = vi.fn();

    pipeline.register({
      priority: 10,
      name: "failer",
      afterModel: () => ({ action: "fail" as const, reason: "broken" }),
    });
    pipeline.register({
      priority: 20,
      name: "second",
      afterModel: secondFn,
    });

    const result = await pipeline.runAfterModel(makeState(), makeResponse());
    expect(result.action).toBe("fail");
    expect((result as any).reason).toBe("broken");
    expect(secondFn).not.toHaveBeenCalled();
  });
});
