import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { adaptToolDefinition, mergeTools } from "./tool-adapter.js";
import type { ToolDefinition, HarnessExtensionContext } from "./types.js";
import type { AgentTool } from "../core/types.js";

function makeCtx(): HarnessExtensionContext {
  return { cwd: "/test", shutdown: () => {} };
}

const testSchema = Type.Object({ path: Type.String() });

function makeToolDef(overrides?: Partial<ToolDefinition<typeof testSchema>>): ToolDefinition<typeof testSchema> {
  return {
    name: "read_file",
    label: "Read File",
    description: "Read a file",
    parameters: testSchema,
    execute: async (id, params) => ({
      content: [{ type: "text" as const, text: `read ${params.path}` }],
      details: null,
    }),
    ...overrides,
  };
}

describe("adaptToolDefinition", () => {
  it("adapts name, label, description, parameters", () => {
    const toolDef = makeToolDef();
    const tool = adaptToolDefinition(toolDef, makeCtx);

    expect(tool.name).toBe("read_file");
    expect(tool.label).toBe("Read File");
    expect(tool.description).toBe("Read a file");
    expect(tool.parameters).toBe(testSchema);
  });

  it("passes through params to execute", async () => {
    const toolDef = makeToolDef();
    const tool = adaptToolDefinition(toolDef, makeCtx);

    const result = await tool.execute("tc1", { path: "/foo.txt" });
    expect(result.content[0]).toEqual({ type: "text", text: "read /foo.txt" });
  });

  it("injects ctx from factory", async () => {
    let receivedCtx: HarnessExtensionContext | undefined;
    const toolDef = makeToolDef({
      execute: async (id, params, signal, onUpdate, ctx) => {
        receivedCtx = ctx;
        return { content: [], details: null };
      },
    });

    const tool = adaptToolDefinition(toolDef, () => ({ cwd: "/workspace", shutdown: () => {} }));
    await tool.execute("tc1", { path: "/foo" });

    expect(receivedCtx).toBeDefined();
    expect(receivedCtx!.cwd).toBe("/workspace");
  });

  it("wraps onUpdate callback from AgentToolResult to raw detail", async () => {
    const toolDef = makeToolDef({
      execute: async (id, params, signal, onUpdate, _ctx) => {
        onUpdate?.({ path: "/partial" });
        return { content: [], details: null };
      },
    });

    const tool = adaptToolDefinition(toolDef, makeCtx);
    const coreUpdates: any[] = [];
    await tool.execute("tc1", { path: "/foo" }, undefined, (result) => {
      coreUpdates.push(result);
    });

    expect(coreUpdates).toHaveLength(1);
    expect(coreUpdates[0]).toEqual({ content: [], details: { path: "/partial" } });
  });

  it("preserves executionMode", () => {
    const toolDef = makeToolDef({ executionMode: "sequential" });
    const tool = adaptToolDefinition(toolDef, makeCtx);
    expect(tool.executionMode).toBe("sequential");
  });

  it("propagates errors", async () => {
    const toolDef = makeToolDef({
      execute: async () => { throw new Error("boom"); },
    });
    const tool = adaptToolDefinition(toolDef, makeCtx);

    await expect(tool.execute("tc1", { path: "/foo" })).rejects.toThrow("boom");
  });
});

describe("mergeTools", () => {
  it("includes base tools", () => {
    const base: AgentTool[] = [{
      name: "grep",
      label: "Grep",
      description: "Search",
      parameters: {} as any,
      execute: async () => ({ content: [], details: null }),
    }];

    const result = mergeTools(base, new Map(), makeCtx);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("grep");
  });

  it("includes registered tools", () => {
    const registered = new Map<string, ToolDefinition>();
    registered.set("custom", makeToolDef({ name: "custom" }));

    const result = mergeTools([], registered, makeCtx);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("custom");
  });

  it("registered overrides base with same name", () => {
    const base: AgentTool[] = [{
      name: "read_file",
      label: "Original",
      description: "Original",
      parameters: {} as any,
      execute: async () => ({ content: [{ type: "text" as const, text: "original" }], details: null }),
    }];

    const registered = new Map<string, ToolDefinition>();
    registered.set("read_file", makeToolDef({ label: "Override" }));

    const result = mergeTools(base, registered, makeCtx);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Override");
  });
});
