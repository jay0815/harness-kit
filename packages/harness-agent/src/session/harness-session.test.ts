import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Type } from "@sinclair/typebox";
import { HarnessAgentSession } from "./harness-session.js";
import type { HarnessAgentSessionConfig } from "./types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "session-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(overrides?: Partial<HarnessAgentSessionConfig>): HarnessAgentSessionConfig {
  return {
    cwd: "/test",
    model: {} as any,
    systemPrompt: "You are a helpful assistant.",
    streamFn: vi.fn().mockImplementation(async () => ({
      result: async () => ({
        content: [{ type: "text", text: "default" }],
        stopReason: "end_turn",
        usage: { input: 100, output: 50 },
      }),
    })) as any,
    ...overrides,
  };
}

function mockStreamFn(responseText: string, toolCalls: any[] = []) {
  return vi.fn().mockImplementation(async () => ({
    result: async () => ({
      content: [
        { type: "text", text: responseText },
        ...toolCalls.map((tc) => ({ type: "toolCall", ...tc })),
      ],
      stopReason: "end_turn",
      usage: { input: 100, output: 50 },
    }),
  }));
}

describe("HarnessAgentSession", () => {
  it("dispatches session_start with (event, ctx)", async () => {
    const handler = vi.fn();
    const session = new HarnessAgentSession(makeConfig());
    session.extensionAPI.on("session_start", handler);

    await session.start();

    expect(handler).toHaveBeenCalledTimes(1);
    const [event, ctx] = handler.mock.calls[0];
    expect(event.type).toBe("session_start");
    expect(event.reason).toBe("startup");
    expect(ctx.cwd).toBe("/test");
    expect(typeof ctx.shutdown).toBe("function");
  });

  it("dispatches session_shutdown on shutdown", async () => {
    const handler = vi.fn();
    const session = new HarnessAgentSession(makeConfig());
    session.extensionAPI.on("session_shutdown", handler);

    await session.start();
    await session.shutdown();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(session.sessionState).toBe("shutting_down");
  });

  it("registerTool makes tool available during prompt", async () => {
    let receivedTools: any[] | undefined;
    const streamFn = vi.fn().mockImplementation(async (_model: any, ctx: any) => {
      receivedTools = ctx.tools;
      return {
        result: async () => ({
          content: [{ type: "text", text: "done" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.registerTool({
      name: "custom_tool",
      label: "Custom",
      description: "A custom tool",
      parameters: Type.Object({}),
      execute: async () => ({ content: [], details: null }),
    });

    await session.start();
    await session.prompt("hello");

    expect(receivedTools).toBeDefined();
    expect(receivedTools!.some((t: any) => t.name === "custom_tool")).toBe(true);
  });

  it("before_agent_start handler modifies systemPrompt", async () => {
    let capturedPrompt: string | undefined;
    const streamFn = vi.fn().mockImplementation(async (_model: any, ctx: any) => {
      capturedPrompt = ctx.systemPrompt;
      return {
        result: async () => ({
          content: [{ type: "text", text: "ok" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("before_agent_start", (event: any) => {
      return { systemPrompt: event.systemPrompt + " EXTRA" };
    });

    await session.start();
    await session.prompt("hi");

    expect(capturedPrompt).toBe("You are a helpful assistant. EXTRA");
  });

  it("chains multiple before_agent_start handlers", async () => {
    let capturedPrompt: string | undefined;
    const streamFn = vi.fn().mockImplementation(async (_model: any, ctx: any) => {
      capturedPrompt = ctx.systemPrompt;
      return {
        result: async () => ({
          content: [{ type: "text", text: "ok" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("before_agent_start", (event: any) => ({
      systemPrompt: event.systemPrompt + " A",
    }));
    session.extensionAPI.on("before_agent_start", (event: any) => ({
      systemPrompt: event.systemPrompt + " B",
    }));

    await session.start();
    await session.prompt("hi");

    expect(capturedPrompt).toBe("You are a helpful assistant. A B");
  });

  it("supports async before_agent_start handlers", async () => {
    let capturedPrompt: string | undefined;
    const streamFn = vi.fn().mockImplementation(async (_model: any, ctx: any) => {
      capturedPrompt = ctx.systemPrompt;
      return {
        result: async () => ({
          content: [{ type: "text", text: "ok" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("before_agent_start", async (event: any) => {
      await new Promise((r) => setTimeout(r, 10));
      return { systemPrompt: event.systemPrompt + " ASYNC" };
    });

    await session.start();
    await session.prompt("hi");

    expect(capturedPrompt).toBe("You are a helpful assistant. ASYNC");
  });

  it("bridges toolCall to tool_use in turn_end event", async () => {
    const turnEndEvents: any[] = [];
    const streamFn = mockStreamFn("I'll read it", [
      { id: "tc1", name: "read_file", input: { path: "/f" } },
    ]);

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("turn_end", (event: any) => {
      turnEndEvents.push(event);
    });

    await session.start();
    await session.prompt("read the file");

    expect(turnEndEvents.length).toBeGreaterThan(0);
    const lastTurn = turnEndEvents[turnEndEvents.length - 1];
    expect(lastTurn.message.content[1].type).toBe("tool_use");
    expect(lastTurn.message.content[1].name).toBe("read_file");
  });

  it("injects user message into queue via sendUserMessage", async () => {
    const session = new HarnessAgentSession(makeConfig());
    session.extensionAPI.sendUserMessage("feedback message");

    expect(session.sessionState).toBe("idle");
  });

  it("auto-retries when sendUserMessage is called during prompt", async () => {
    let promptCount = 0;
    const responses = [
      "first response <HK_RESULT>FAIL</HK_RESULT>",
      "corrected response <HK_RESULT>OK</HK_RESULT>",
    ];

    const streamFn = vi.fn().mockImplementation(async () => {
      const text = responses[promptCount] ?? responses[responses.length - 1];
      promptCount++;
      return {
        result: async () => ({
          content: [{ type: "text", text }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    let callCount = 0;
    session.extensionAPI.on("turn_end", () => {
      callCount++;
      if (callCount === 1) {
        session.extensionAPI.sendUserMessage("FAIL: verification failed");
      }
    });

    await session.start();
    await session.prompt("do something");

    expect(promptCount).toBe(2);
  });

  it("respects maxAutoRetries limit", async () => {
    let promptCount = 0;
    const streamFn = vi.fn().mockImplementation(async () => {
      promptCount++;
      return {
        result: async () => ({
          content: [{ type: "text", text: "response" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn, maxAutoRetries: 2 }));
    session.extensionAPI.on("turn_end", () => {
      session.extensionAPI.sendUserMessage("retry");
    });

    await session.start();
    await session.prompt("do something");

    expect(promptCount).toBe(3);
  });

  it("dispatches agent_end after all retries", async () => {
    const agentEndEvents: any[] = [];
    const streamFn = mockStreamFn("done");

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("agent_end", (event: any) => {
      agentEndEvents.push(event);
    });

    await session.start();
    await session.prompt("hi");

    expect(agentEndEvents).toHaveLength(1);
    expect(agentEndEvents[0].messages).toBeDefined();
  });

  it("enables persistence when configured", async () => {
    const sessionDir = join(tmpDir, "persist");
    const streamFn = mockStreamFn("hello");

    const session = new HarnessAgentSession(
      makeConfig({ streamFn, sessionDir, enablePersistence: true }),
    );

    await session.start();
    await session.prompt("test");
    await session.shutdown();

    const { readdirSync } = await import("node:fs");
    const files = readdirSync(sessionDir);
    expect(files.some((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("aborts the current loop", async () => {
    const session = new HarnessAgentSession(makeConfig());
    session.abort();
    // Abort before prompt is a no-op (no current controller)
    expect(session.sessionState).toBe("idle");
  });

  it("starts in idle state", () => {
    const session = new HarnessAgentSession(makeConfig());
    expect(session.sessionState).toBe("idle");
  });

  it("returns cwd from config", () => {
    const session = new HarnessAgentSession(makeConfig({ cwd: "/workspace" }));
    expect(session.cwd).toBe("/workspace");
  });

  it("throws when prompt called while running", async () => {
    let resolveFirst: () => void;
    const firstBlocker = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const streamFn = vi.fn().mockImplementation(async () => {
      await firstBlocker;
      return {
        result: async () => ({
          content: [{ type: "text", text: "done" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    await session.start();

    const firstPrompt = session.prompt("first");

    await expect(session.prompt("second")).rejects.toThrow(
      /Cannot prompt while session is (running|dispatching)/,
    );

    resolveFirst!();
    await firstPrompt;
  });

  it("turn_start handler receives event with turnIndex", async () => {
    const turnStartEvents: any[] = [];
    const streamFn = mockStreamFn("ok");

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("turn_start", (event: any) => {
      turnStartEvents.push(event);
    });

    await session.start();
    await session.prompt("hi");

    expect(turnStartEvents.length).toBeGreaterThan(0);
    expect(turnStartEvents[0].turnIndex).toBe(0);
    expect(turnStartEvents[0].type).toBe("turn_start");
    expect(turnStartEvents[0].timestamp).toBeDefined();
  });

  it("turnIndex does not reset on auto-retry", async () => {
    const turnEndEvents: any[] = [];
    let callCount = 0;

    const streamFn = vi.fn().mockImplementation(async () => {
      return {
        result: async () => ({
          content: [{ type: "text", text: "response" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("turn_end", (event: any) => {
      turnEndEvents.push(event.turnIndex);
      callCount++;
      if (callCount === 1) {
        session.extensionAPI.sendUserMessage("retry");
      }
    });

    await session.start();
    await session.prompt("do something");

    // First turn_index=0, retry turn_index=1 (not reset to 0)
    expect(turnEndEvents).toEqual([0, 1]);
  });

  it("persistence does not duplicate messages on retry", async () => {
    const sessionDir = join(tmpDir, "persist-dedup");
    let callCount = 0;

    const streamFn = vi.fn().mockImplementation(async () => {
      return {
        result: async () => ({
          content: [{ type: "text", text: "response" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(
      makeConfig({ streamFn, sessionDir, enablePersistence: true, maxAutoRetries: 1 }),
    );

    session.extensionAPI.on("turn_end", () => {
      callCount++;
      if (callCount === 1) {
        session.extensionAPI.sendUserMessage("retry");
      }
    });

    await session.start();
    await session.prompt("test");
    await session.shutdown();

    const { readdirSync, readFileSync } = await import("node:fs");
    const files = readdirSync(sessionDir).filter((f: string) => f.endsWith(".jsonl"));
    expect(files.length).toBe(1);

    const content = readFileSync(join(sessionDir, files[0]), "utf-8");
    const lines = content
      .trim()
      .split("\n")
      .filter((l: string) => l.trim());
    const entries = lines.map((l: string) => JSON.parse(l));
    const messageEntries = entries.filter((e: any) => e.type === "message");

    // Should have: user + assistant (round 1) + user (retry feedback) + assistant (round 2) = 4
    // NOT 6 (duplicates)
    const userMsgs = messageEntries.filter((e: any) => e.message?.role === "user");
    const assistantMsgs = messageEntries.filter((e: any) => e.message?.role === "assistant");
    expect(userMsgs.length).toBe(2);
    expect(assistantMsgs.length).toBe(2);
  });

  it("async event handlers maintain ordering: turn_start before turn_end", async () => {
    const order: string[] = [];
    const streamFn = mockStreamFn("ok");

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("turn_start", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("turn_start");
    });
    session.extensionAPI.on("turn_end", () => {
      order.push("turn_end");
    });

    await session.start();
    await session.prompt("hi");

    expect(order).toEqual(["turn_start", "turn_end"]);
  });

  it("async turn_end handler with await before sendUserMessage triggers retry", async () => {
    let promptCount = 0;
    const streamFn = vi.fn().mockImplementation(async () => {
      promptCount++;
      return {
        result: async () => ({
          content: [{ type: "text", text: "response" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    let callCount = 0;
    session.extensionAPI.on("turn_end", async () => {
      callCount++;
      if (callCount === 1) {
        await new Promise((r) => setTimeout(r, 10));
        session.extensionAPI.sendUserMessage("FAIL: needs fix");
      }
    });

    await session.start();
    await session.prompt("do something");

    expect(promptCount).toBe(2);
  });

  it("async handler reject: state cleaned up, subsequent prompt works", async () => {
    const streamFn = vi.fn().mockImplementation(async () => ({
      result: async () => ({
        content: [{ type: "text", text: "ok" }],
        stopReason: "end_turn",
        usage: { input: 100, output: 50 },
      }),
    }));

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    let shouldFail = true;
    session.extensionAPI.on("turn_end", async () => {
      if (shouldFail) {
        await new Promise((r) => setTimeout(r, 5));
        throw new Error("handler failure");
      }
    });

    await session.start();
    await expect(session.prompt("first")).rejects.toThrow("handler failure");

    expect(session.sessionState).toBe("idle");

    shouldFail = false;
    await expect(session.prompt("second")).resolves.toBeUndefined();
    expect(session.sessionState).toBe("idle");
  });

  it("shutdown during running prompt: aborts and preserves shutting_down", async () => {
    let resolveStream: () => void;
    const streamBlocker = new Promise<void>((r) => {
      resolveStream = r;
    });

    const streamFn = vi.fn().mockImplementation(async () => {
      await streamBlocker;
      return {
        result: async () => ({
          content: [{ type: "text", text: "late" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    await session.start();

    const promptPromise = session.prompt("hello");

    await new Promise((r) => setTimeout(r, 10));
    expect(session.sessionState).toBe("running");

    const shutdownPromise = session.shutdown();

    resolveStream!();

    await promptPromise;
    await shutdownPromise;

    expect(session.sessionState).toBe("shutting_down");
  });

  it("shutdown sets signal.aborted on running prompt", async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveStream: () => void;
    const streamBlocker = new Promise<void>((r) => {
      resolveStream = r;
    });
    let resolveStarted!: () => void;
    const started = new Promise<void>((r) => {
      resolveStarted = r;
    });

    const streamFn = vi.fn().mockImplementation(async (_model: any, _ctx: any, opts: any) => {
      capturedSignal = opts.signal;
      resolveStarted();
      await streamBlocker;
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

    const promptPromise = session.prompt("hello");
    await started;

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    const shutdownPromise = session.shutdown();

    expect(capturedSignal!.aborted).toBe(true);

    resolveStream!();
    await promptPromise;
    await shutdownPromise;
    expect(session.sessionState).toBe("shutting_down");
  });

  it("abort during running prompt, then new prompt works", async () => {
    let resolveStream: () => void;
    const streamBlocker = new Promise<void>((r) => {
      resolveStream = r;
    });
    let callCount = 0;

    const streamFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        await streamBlocker;
      }
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

    const promptPromise = session.prompt("first");
    await new Promise((r) => setTimeout(r, 10));

    session.abort();
    resolveStream!();

    await promptPromise;
    expect(session.sessionState).toBe("idle");

    // Second prompt should work with a fresh AbortController
    await session.prompt("second");
    expect(session.sessionState).toBe("idle");
    expect(callCount).toBe(2);
  });

  it("default verifyMode (off) allows text without HK_RESULT", async () => {
    const streamFn = mockStreamFn("just a plain text response");
    const session = new HarnessAgentSession(makeConfig({ streamFn }));

    await session.start();
    await session.prompt("hello");

    expect(session.sessionState).toBe("idle");
  });

  it("verifyMode off allows text without HK_RESULT", async () => {
    const streamFn = mockStreamFn("just a plain text response");
    const session = new HarnessAgentSession(makeConfig({ streamFn, verifyMode: "off" }));

    await session.start();
    await session.prompt("hello");

    expect(session.sessionState).toBe("idle");
  });

  it("verifyMode strict retries then fails on missing HK_RESULT", async () => {
    let callCount = 0;
    const streamFn = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        result: async () => ({
          content: [{ type: "text", text: "just text, no HK_RESULT" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(
      makeConfig({ streamFn, verifyMode: "strict", maxVerificationRetries: 1 }),
    );
    await session.start();

    await expect(session.prompt("hello")).rejects.toThrow(/Agent loop failed/);
    // 1 initial + 1 retry = 2 calls
    expect(callCount).toBe(2);
  });

  it("user middleware registered and executed by priority", async () => {
    const order: string[] = [];
    const streamFn = mockStreamFn("done");

    const session = new HarnessAgentSession(
      makeConfig({
        streamFn,
        middlewares: [
          {
            priority: 20,
            name: "second",
            beforeModel: async () => {
              order.push("second");
            },
          },
          {
            priority: 10,
            name: "first",
            beforeModel: async () => {
              order.push("first");
            },
          },
        ],
      }),
    );

    await session.start();
    await session.prompt("hello");

    expect(order).toEqual(["first", "second"]);
  });

  it("user middleware instance reused across prompts", async () => {
    let callCount = 0;
    const streamFn = mockStreamFn("done");

    const trackingMiddleware = {
      priority: 10,
      name: "tracker",
      beforeModel: async () => {
        callCount++;
      },
    };

    const session = new HarnessAgentSession(
      makeConfig({ streamFn, middlewares: [trackingMiddleware] }),
    );

    await session.start();
    await session.prompt("first");
    await session.prompt("second");

    // Same instance, called once per prompt
    expect(callCount).toBe(2);
  });
});
