import { describe, it, expect } from "vitest";
import { StreamingToolExecutor } from "./streaming-tool-executor.js";
import { MiddlewarePipeline } from "./middleware.js";
import type { AgentTool, AgentToolCall, RuntimeState } from "./types.js";

function makeState(): RuntimeState {
  return {
    context: { systemPrompt: "", messages: [] },
    iteration: 0,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextWindow: 200_000 },
    metadata: {},
  };
}

function makeToolCall(id: string, name: string): AgentToolCall {
  return { id, name, type: "toolCall" } as any;
}

function makeTool(
  name: string,
  handler?: (id: string, params: unknown) => Promise<any>,
): AgentTool<any> {
  return {
    name,
    label: name,
    description: name,
    parameters: {} as any,
    execute: handler ?? (async () => ({ content: [{ type: "text", text: "ok" }], details: null })),
  };
}

describe("StreamingToolExecutor", () => {
  it("executes sequential tools one at a time", async () => {
    const executor = new StreamingToolExecutor();
    const pipeline = new MiddlewarePipeline();
    const order: string[] = [];

    const tools = [
      makeTool("a", async () => {
        order.push("a-start");
        await delay(10);
        order.push("a-end");
        return { content: [], details: null };
      }),
      makeTool("b", async () => {
        order.push("b-start");
        await delay(10);
        order.push("b-end");
        return { content: [], details: null };
      }),
    ];

    const calls = [makeToolCall("1", "a"), makeToolCall("2", "b")];
    await executor.execute(calls, tools, makeState(), pipeline, "sequential");

    // Sequential: a finishes before b starts
    expect(order.indexOf("a-end")).toBeLessThan(order.indexOf("b-start"));
  });

  it("executes parallel-safe tools concurrently", async () => {
    const executor = new StreamingToolExecutor();
    const pipeline = new MiddlewarePipeline();
    const order: string[] = [];

    const tools = [
      makeTool("read_file", async () => {
        order.push("read-start");
        await delay(10);
        order.push("read-end");
        return { content: [], details: null };
      }),
      makeTool("grep", async () => {
        order.push("grep-start");
        await delay(10);
        order.push("grep-end");
        return { content: [], details: null };
      }),
    ];

    const calls = [makeToolCall("1", "read_file"), makeToolCall("2", "grep")];
    await executor.execute(calls, tools, makeState(), pipeline, "parallel");

    // Both should start before either ends
    expect(order.indexOf("read-start")).toBeLessThan(order.indexOf("grep-end"));
    expect(order.indexOf("grep-start")).toBeLessThan(order.indexOf("read-end"));
  });

  it("never-parallel tools run sequentially even in parallel mode", async () => {
    const executor = new StreamingToolExecutor();
    const pipeline = new MiddlewarePipeline();
    const order: string[] = [];

    const tools = [
      makeTool("write_file", async () => {
        order.push("write-start");
        await delay(10);
        order.push("write-end");
        return { content: [], details: null };
      }),
      makeTool("edit_file", async () => {
        order.push("edit-start");
        await delay(10);
        order.push("edit-end");
        return { content: [], details: null };
      }),
    ];

    const calls = [makeToolCall("1", "write_file"), makeToolCall("2", "edit_file")];
    await executor.execute(calls, tools, makeState(), pipeline, "parallel");

    // Sequential: write finishes before edit starts
    expect(order.indexOf("write-end")).toBeLessThan(order.indexOf("edit-start"));
  });

  it("preserves original order with write barrier in parallel mode", async () => {
    const executor = new StreamingToolExecutor();
    const pipeline = new MiddlewarePipeline();
    const order: string[] = [];

    const tools = [
      makeTool("write_file", async () => {
        order.push("write");
        return { content: [], details: null };
      }),
      makeTool("read_file", async () => {
        order.push("read");
        return { content: [], details: null };
      }),
    ];

    // write_file first, then read_file — order must be preserved
    const calls = [makeToolCall("1", "write_file"), makeToolCall("2", "read_file")];
    await executor.execute(calls, tools, makeState(), pipeline, "parallel");

    expect(order).toEqual(["write", "read"]);
  });

  it("handles tool execution errors gracefully", async () => {
    const executor = new StreamingToolExecutor();
    const pipeline = new MiddlewarePipeline();

    const tools = [
      makeTool("fail", async () => {
        throw new Error("boom");
      }),
    ];

    const calls = [makeToolCall("1", "fail")];
    const results = await executor.execute(calls, tools, makeState(), pipeline, "sequential");

    expect(results).toHaveLength(1);
    expect(results[0].result.content[0]).toEqual(
      expect.objectContaining({ text: expect.stringContaining("boom") }),
    );
  });

  it("handles missing tool", async () => {
    const executor = new StreamingToolExecutor();
    const pipeline = new MiddlewarePipeline();

    const calls = [makeToolCall("1", "nonexistent")];
    const results = await executor.execute(calls, [], makeState(), pipeline, "sequential");

    expect(results).toHaveLength(1);
    expect(results[0].result.content[0]).toEqual(
      expect.objectContaining({ text: expect.stringContaining("not found") }),
    );
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
