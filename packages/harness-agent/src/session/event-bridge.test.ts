import { describe, it, expect } from "vitest";
import { bridgeAgentEvent, bridgeContentBlocks } from "./event-bridge.js";

describe("bridgeContentBlocks", () => {
  it("converts toolCall to tool_use", () => {
    const input = [{ type: "toolCall", id: "tc1", name: "read_file", input: { path: "/test" } }];
    const result = bridgeContentBlocks(input);
    expect(result).toEqual([
      { type: "tool_use", id: "tc1", name: "read_file", input: { path: "/test" } },
    ]);
  });

  it("leaves text blocks unchanged", () => {
    const input = [{ type: "text", text: "hello" }];
    const result = bridgeContentBlocks(input);
    expect(result).toEqual(input);
  });

  it("leaves thinking blocks unchanged", () => {
    const input = [{ type: "thinking", thinking: "reasoning..." }];
    const result = bridgeContentBlocks(input);
    expect(result).toEqual(input);
  });

  it("handles mixed content", () => {
    const input = [
      { type: "text", text: "I'll read the file" },
      { type: "toolCall", id: "tc1", name: "read_file", input: { path: "/f" } },
    ];
    const result = bridgeContentBlocks(input);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("tool_use");
    expect(result[1].name).toBe("read_file");
  });

  it("handles non-array input", () => {
    expect(bridgeContentBlocks(null as any)).toBeNull();
    expect(bridgeContentBlocks(undefined as any)).toBeUndefined();
  });

  it("falls back to arguments when input is absent", () => {
    const input = [
      { type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "/test" } },
    ];
    const result = bridgeContentBlocks(input);
    expect(result[0].input).toEqual({ path: "/test" });
  });

  it("prefers input over arguments when both present", () => {
    const input = [
      {
        type: "toolCall",
        id: "tc1",
        name: "read_file",
        input: { path: "/a" },
        arguments: { path: "/b" },
      },
    ];
    const result = bridgeContentBlocks(input);
    expect(result[0].input).toEqual({ path: "/a" });
  });
});

describe("bridgeAgentEvent", () => {
  it("bridges turn_start with turnIndex and timestamp", () => {
    const result = bridgeAgentEvent({ type: "turn_start" } as any, 5);
    expect(result).toEqual({
      type: "turn_start",
      event: {
        type: "turn_start",
        turnIndex: 5,
        timestamp: expect.any(Number),
      },
    });
  });

  it("bridges turn_end with turnIndex and content block conversion", () => {
    const event = {
      type: "turn_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Done" },
          { type: "toolCall", id: "tc1", name: "bash", input: { command: "ls" } },
        ],
      },
      toolResults: [],
    };
    const result = bridgeAgentEvent(event as any, 3);

    expect(result!.type).toBe("turn_end");
    expect(result!.event.turnIndex).toBe(3);
    expect(result!.event.message.content[0].type).toBe("text");
    expect(result!.event.message.content[1].type).toBe("tool_use");
    expect(result!.event.message.content[1].name).toBe("bash");
  });

  it("bridges tool_execution_start", () => {
    const event = {
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "ls" },
    };
    const result = bridgeAgentEvent(event as any, 0);
    expect(result).toEqual({
      type: "tool_execution_start",
      event: {
        type: "tool_execution_start",
        toolCallId: "tc1",
        toolName: "bash",
        args: { command: "ls" },
      },
    });
  });

  it("bridges tool_execution_end with isError", () => {
    const event = {
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "error" }] },
      isError: true,
    };
    const result = bridgeAgentEvent(event as any, 0);
    expect(result!.event.isError).toBe(true);
  });

  it("bridges agent_start", () => {
    const result = bridgeAgentEvent({ type: "agent_start" } as any, 0);
    expect(result).toEqual({ type: "agent_start", event: { type: "agent_start" } });
  });

  it("returns null for unknown events", () => {
    const result = bridgeAgentEvent({ type: "unknown_event" } as any, 0);
    expect(result).toBeNull();
  });
});
