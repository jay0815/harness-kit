import { describe, it, expect, afterEach } from "vitest";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai";
import { runAgentLoop } from "./agent-loop.js";
import { MiddlewarePipeline } from "./middleware.js";
import { IterationBudget } from "./types.js";
import type { AgentLoopConfig, AgentEvent, AgentTool, AgentToolResult } from "./types.js";

function makeTool(
  name: string,
  handler: (id: string, args: any) => Promise<AgentToolResult<any>>,
): AgentTool<any> {
  return {
    name,
    label: name,
    description: name,
    parameters: {} as any,
    execute: handler,
  };
}

function textResult(text: string): AgentToolResult<any> {
  return { content: [{ type: "text" as const, text }], details: null };
}

function fauxMsg(content: any[], usage = { input: 50, output: 20, cacheRead: 0 }): any {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "test",
    model: "test",
    usage,
    stopReason: "end_turn",
    timestamp: Date.now(),
  };
}

function userMsg(text: string): any {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

describe("registerFauxProvider integration", () => {
  let registration: ReturnType<typeof registerFauxProvider> | undefined;

  afterEach(() => {
    registration?.unregister();
    registration = undefined;
  });

  it("completes toolCall -> toolResult -> second model call", async () => {
    registration = registerFauxProvider({ provider: "test-faux" });
    const model = registration.getModel();

    registration.setResponses([
      fauxMsg([
        { type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "/test.txt" } },
      ]),
      fauxMsg([{ type: "text", text: "File contains: hello world" }], {
        input: 80,
        output: 30,
        cacheRead: 0,
      }),
    ]);

    const tool = makeTool("read_file", async (_id, args) => textResult(`content of ${args.path}`));
    const events: AgentEvent[] = [];

    const config: AgentLoopConfig = {
      model,
      systemPrompt: "test",
      messages: [userMsg("read the file")],
      tools: [tool],
      contextWindow: 200_000,
      streamFn: (m, ctx, opts) => streamSimple(m, ctx, opts),
    };

    const result = await runAgentLoop(
      config,
      new IterationBudget(10),
      new MiddlewarePipeline(),
      (e) => {
        events.push(e);
      },
    );

    const roles = result.messages.map((m: any) => m.role);
    expect(roles).toEqual(["user", "assistant", "toolResult", "assistant"]);

    const toolMsg = result.messages[2] as any;
    expect(toolMsg.role).toBe("toolResult");
    expect(toolMsg.toolName).toBe("read_file");
    expect(toolMsg.content[0].text).toBe("content of /test.txt");

    const finalMsg = result.messages[3] as any;
    expect(finalMsg.content[0].text).toContain("hello world");

    expect(result.tokenUsage.inputTokens).toBeGreaterThan(0);
    expect(result.tokenUsage.outputTokens).toBeGreaterThan(0);
    expect(result.tokenUsage.totalTokens).toBe(
      result.tokenUsage.inputTokens + result.tokenUsage.outputTokens,
    );

    const toolStarts = events.filter((e) => e.type === "tool_execution_start");
    const toolEnds = events.filter((e) => e.type === "tool_execution_end");
    expect(toolStarts).toHaveLength(1);
    expect(toolEnds).toHaveLength(1);
    expect((toolEnds[0] as any).toolName).toBe("read_file");
  });

  it("handles multiple rounds of tool calls", async () => {
    registration = registerFauxProvider({ provider: "test-faux-multi" });
    const model = registration.getModel();

    registration.setResponses([
      fauxMsg([{ type: "toolCall", id: "tc1", name: "grep", arguments: { query: "foo" } }]),
      fauxMsg([{ type: "toolCall", id: "tc2", name: "grep", arguments: { query: "bar" } }], {
        input: 80,
        output: 20,
        cacheRead: 0,
      }),
      fauxMsg([{ type: "text", text: "Search complete." }], {
        input: 100,
        output: 15,
        cacheRead: 0,
      }),
    ]);

    let toolCallCount = 0;
    const tool = makeTool("grep", async () => {
      toolCallCount++;
      return textResult(`match ${toolCallCount}`);
    });

    const config: AgentLoopConfig = {
      model,
      systemPrompt: "test",
      messages: [userMsg("search")],
      tools: [tool],
      contextWindow: 200_000,
      streamFn: (m, ctx, opts) => streamSimple(m, ctx, opts),
    };

    const result = await runAgentLoop(
      config,
      new IterationBudget(10),
      new MiddlewarePipeline(),
      () => {},
    );

    expect(toolCallCount).toBe(2);
    const roles = result.messages.map((m: any) => m.role);
    expect(roles).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
      "toolResult",
      "assistant",
    ]);
  });

  it("handles tool error gracefully", async () => {
    registration = registerFauxProvider({ provider: "test-faux-error" });
    const model = registration.getModel();

    registration.setResponses([
      fauxMsg([{ type: "toolCall", id: "tc1", name: "fail_tool", arguments: {} }]),
      fauxMsg([{ type: "text", text: "Sorry, the tool failed." }], {
        input: 80,
        output: 25,
        cacheRead: 0,
      }),
    ]);

    const tool = makeTool("fail_tool", async () => {
      throw new Error("tool broke");
    });

    const config: AgentLoopConfig = {
      model,
      systemPrompt: "test",
      messages: [userMsg("do something")],
      tools: [tool],
      contextWindow: 200_000,
      streamFn: (m, ctx, opts) => streamSimple(m, ctx, opts),
    };

    const result = await runAgentLoop(
      config,
      new IterationBudget(10),
      new MiddlewarePipeline(),
      () => {},
    );

    const toolMsg = result.messages[2] as any;
    expect(toolMsg.role).toBe("toolResult");
    expect(toolMsg.isError).toBe(true);
    expect(toolMsg.content[0].text).toContain("tool broke");
  });
});
