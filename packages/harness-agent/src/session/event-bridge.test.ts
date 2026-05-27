import { describe, it, expect } from "vitest";
import { bridgeAgentEvent, bridgeContentBlocks } from "./event-bridge.js";
import type { ToolCall } from "@earendil-works/pi-ai";
import type { AgentEvent } from "../core/types.js";
import { cast, getProp } from "../core/test-utils.js";

describe("bridgeContentBlocks", () => {
  it("converts toolCall to tool_use", () => {
    const input = cast<ToolCall[]>([
      { type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "/test" } },
    ]);
    const result = bridgeContentBlocks(input);
    const block = cast<Record<string, unknown>>(result[0]);
    expect(block.type).toBe("tool_use");
    expect(block.id).toBe("tc1");
    expect(block.name).toBe("read_file");
    expect(block.input).toEqual({ path: "/test" });
  });

  it("leaves text blocks unchanged", () => {
    const input = [{ type: "text" as const, text: "hello" }];
    const result = bridgeContentBlocks(cast(input));
    expect(result).toEqual(input);
  });

  it("leaves thinking blocks unchanged", () => {
    const input = [{ type: "thinking" as const, thinking: "reasoning..." }];
    const result = bridgeContentBlocks(cast(input));
    expect(result).toEqual(input);
  });

  it("handles mixed content", () => {
    const input = cast<(ToolCall | { type: "text"; text: string })[]>([
      { type: "text", text: "I'll read the file" },
      { type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "/f" } },
    ]);
    const result = bridgeContentBlocks(input);
    expect(cast<Record<string, unknown>>(result[0]).type).toBe("text");
    expect(cast<Record<string, unknown>>(result[1]).type).toBe("tool_use");
    expect(cast<Record<string, unknown>>(result[1]).name).toBe("read_file");
  });

  it("handles non-array input", () => {
    expect(bridgeContentBlocks(cast<ToolCall[]>(null))).toBeNull();
    expect(bridgeContentBlocks(cast<ToolCall[]>(undefined))).toBeUndefined();
  });

  it("uses arguments for tool_use input", () => {
    const input = cast<ToolCall[]>([
      { type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "/test" } },
    ]);
    const result = bridgeContentBlocks(input);
    expect(cast<Record<string, unknown>>(result[0]).input).toEqual({ path: "/test" });
  });
});

describe("bridgeAgentEvent", () => {
  it("bridges turn_start with turnIndex and timestamp", () => {
    const result = bridgeAgentEvent(cast<AgentEvent>({ type: "turn_start" }), 5);
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
    const result = bridgeAgentEvent(cast<AgentEvent>(event), 3);

    const ev = cast<Record<string, unknown>>(result!.event);
    expect(result!.type).toBe("turn_end");
    expect(ev.turnIndex).toBe(3);
    const msgContent = cast<Array<Record<string, unknown>>>(
      getProp<Record<string, unknown>>(ev, "message").content,
    );
    expect(msgContent[0].type).toBe("text");
    expect(msgContent[1].type).toBe("tool_use");
    expect(msgContent[1].name).toBe("bash");
  });

  it("bridges tool_execution_start", () => {
    const event = {
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "ls" },
    };
    const result = bridgeAgentEvent(cast<AgentEvent>(event), 0);
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
    const result = bridgeAgentEvent(cast<AgentEvent>(event), 0);
    expect(getProp<unknown>(result!.event, "isError")).toBe(true);
  });

  it("bridges agent_start", () => {
    const result = bridgeAgentEvent(cast<AgentEvent>({ type: "agent_start" }), 0);
    expect(result).toEqual({ type: "agent_start", event: { type: "agent_start" } });
  });

  it("returns null for unknown events", () => {
    const result = bridgeAgentEvent(cast<AgentEvent>({ type: "unknown_event" }), 0);
    expect(result).toBeNull();
  });

  it("bridges turn_end with metadata", () => {
    const event = {
      type: "turn_end",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      toolResults: [],
      metadata: {
        fact_verification: {
          status: "pass",
          block: null,
          report: null,
          timestamp: 123,
        },
      },
    };
    const result = bridgeAgentEvent(cast<AgentEvent>(event), 0);
    expect(getProp<unknown>(result!.event, "metadata")).toEqual(event.metadata);
  });

  it("bridges turn_end without metadata (backward compatibility)", () => {
    const event = {
      type: "turn_end",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      toolResults: [],
    };
    const result = bridgeAgentEvent(cast<AgentEvent>(event), 0);
    expect(getProp<unknown>(result!.event, "metadata")).toBeUndefined();
  });

  it("preserves extra message fields when bridging turn_end", () => {
    const event = {
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        providerMetadata: { traceId: "abc" },
      },
      toolResults: [],
    };

    const result = bridgeAgentEvent(cast<AgentEvent>(event), 0);
    const msg = getProp<Record<string, unknown>>(
      cast<Record<string, unknown>>(result!.event),
      "message",
    );

    expect(msg.providerMetadata).toEqual({ traceId: "abc" });
  });
});
