import { describe, it, expect, vi } from "vitest";
import { createExtensionAPI } from "./extension-api-adapter.js";
import type { SessionAdapterTarget } from "./extension-api-adapter.js";
import type { ToolDefinition } from "./types.js";
import { Type } from "@sinclair/typebox";

function makeTarget(): SessionAdapterTarget & {
  events: Map<string, Function[]>;
  tools: Map<string, ToolDefinition>;
  messages: string[];
} {
  const events = new Map<string, Function[]>();
  const tools = new Map<string, ToolDefinition>();
  const messages: string[] = [];

  return {
    events,
    tools,
    messages,
    addEventHandler(event, handler) {
      const list = events.get(event) ?? [];
      list.push(handler);
      events.set(event, list);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    enqueueUserMessage(content) {
      messages.push(content);
    },
  };
}

describe("createExtensionAPI", () => {
  it("on() delegates to addEventHandler", () => {
    const target = makeTarget();
    const api = createExtensionAPI(target);
    const handler = vi.fn();

    api.on("turn_end", handler);

    expect(target.events.get("turn_end")).toContain(handler);
  });

  it("registerTool() delegates to target", () => {
    const target = makeTarget();
    const api = createExtensionAPI(target);

    const tool: ToolDefinition = {
      name: "test_tool",
      label: "Test",
      description: "A test tool",
      parameters: Type.Object({}),
      execute: async () => ({ content: [], details: null }),
    };

    api.registerTool(tool);
    expect(target.tools.get("test_tool")).toBe(tool);
  });

  it("sendUserMessage() enqueues content", () => {
    const target = makeTarget();
    const api = createExtensionAPI(target);

    api.sendUserMessage("verify failed");
    api.sendUserMessage("retry");

    expect(target.messages).toEqual(["verify failed", "retry"]);
  });

  it("multiple handlers on same event", () => {
    const target = makeTarget();
    const api = createExtensionAPI(target);

    api.on("turn_end", () => {});
    api.on("turn_end", () => {});

    expect(target.events.get("turn_end")).toHaveLength(2);
  });
});
