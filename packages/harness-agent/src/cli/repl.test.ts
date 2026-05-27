import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessAgentSession } from "../session/harness-session.js";
import type { HarnessAgentSessionConfig } from "../session/types.js";
import type { Model } from "../core/types.js";
import type { Api } from "@earendil-works/pi-ai";
import { cast } from "../core/test-utils.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "repl-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(overrides?: Partial<HarnessAgentSessionConfig>): HarnessAgentSessionConfig {
  return {
    cwd: "/test",
    model: cast<Model<Api>>({}),
    systemPrompt: "You are a helpful assistant.",
    streamFn: vi.fn().mockImplementation(async () => ({
      result: async () => ({
        content: [{ type: "text", text: "default response" }],
        stopReason: "end_turn",
        usage: { input: 100, output: 50 },
      }),
    })) as import("../core/types.js").StreamFn,
    ...overrides,
  };
}

describe("HarnessAgentSession REPL integration", () => {
  it("session processes prompt and returns response", async () => {
    const streamFn = vi.fn().mockImplementation(async () => ({
      result: async () => ({
        content: [{ type: "text", text: "response" }],
        stopReason: "end_turn",
        usage: { input: 100, output: 50 },
      }),
    }));

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    await session.start();

    const events: unknown[] = [];
    session.extensionAPI.on("turn_end", (e: unknown) => events.push(e));

    await session.prompt("hello");

    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(cast<Record<string, unknown>>(events[0]).message).toBeDefined();

    await session.shutdown();
  });

  it("session handles multiple prompts sequentially", async () => {
    const streamFn = vi.fn().mockImplementation(async () => ({
      result: async () => ({
        content: [{ type: "text", text: "ok" }],
        stopReason: "end_turn",
        usage: { input: 100, output: 50 },
      }),
    }));

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    await session.start();

    await session.prompt("first");
    await session.prompt("second");

    expect(streamFn).toHaveBeenCalledTimes(2);

    await session.shutdown();
  });

  it("session rejects concurrent prompts", async () => {
    let resolveStream: () => void;
    const blocker = new Promise<void>((r) => {
      resolveStream = r;
    });

    const streamFn = vi.fn().mockImplementation(async () => {
      await blocker;
      return {
        result: async () => ({
          content: [{ type: "text", text: "ok" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    await session.start();

    const first = session.prompt("first");
    await expect(session.prompt("second")).rejects.toThrow(/Cannot prompt/);

    resolveStream!();
    await first;

    await session.shutdown();
  });

  it("session shutdown is idempotent", async () => {
    const session = new HarnessAgentSession(makeConfig());
    await session.start();

    await session.shutdown();
    await session.shutdown();

    expect(session.sessionState).toBe("shutting_down");
  });

  it("events are dispatched for tool execution", async () => {
    const streamFn = vi.fn().mockImplementation(async () => ({
      result: async () => ({
        content: [{ type: "tool_use", id: "tc1", name: "bash", input: { command: "ls" } }],
        stopReason: "end_turn",
        usage: { input: 100, output: 50 },
      }),
    }));

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    const events: string[] = [];

    session.extensionAPI.on("turn_start", () => events.push("turn_start"));
    session.extensionAPI.on("turn_end", () => events.push("turn_end"));

    await session.start();
    await session.prompt("list files");

    expect(events).toContain("turn_start");
    expect(events).toContain("turn_end");

    await session.shutdown();
  });
});
