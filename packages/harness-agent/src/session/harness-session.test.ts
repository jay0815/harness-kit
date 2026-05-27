import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Type } from "@sinclair/typebox";
import { HarnessAgentSession } from "./harness-session.js";
import type { HarnessAgentSessionConfig } from "./types.js";
import { cast, getProp } from "../core/test-utils.js";

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
    model: cast<HarnessAgentSessionConfig["model"]>({}),
    systemPrompt: "You are a helpful assistant.",
    streamFn: vi.fn().mockImplementation(async () => ({
      result: async () => ({
        content: [{ type: "text", text: "default" }],
        stopReason: "end_turn",
        usage: { input: 100, output: 50 },
      }),
    })) as HarnessAgentSessionConfig["streamFn"],
    ...overrides,
  };
}

function mockStreamFn(responseText: string, toolCalls: Array<Record<string, unknown>> = []) {
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
    const e = cast<Record<string, unknown>>(event);
    const c = cast<Record<string, unknown>>(ctx);
    expect(e.type).toBe("session_start");
    expect(e.reason).toBe("startup");
    expect(c.cwd).toBe("/test");
    expect(typeof c.shutdown).toBe("function");
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
    let receivedTools: Array<Record<string, unknown>> | undefined;
    const streamFn = vi.fn().mockImplementation(async (_model: unknown, ctx: unknown) => {
      receivedTools = getProp<unknown>(ctx, "tools") as Array<Record<string, unknown>> | undefined;
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
    expect(
      receivedTools!.some(
        (t: Record<string, unknown>) => getProp<string | undefined>(t, "name") === "custom_tool",
      ),
    ).toBe(true);
  });

  it("before_agent_start handler modifies systemPrompt", async () => {
    let capturedPrompt: string | undefined;
    const streamFn = vi
      .fn()
      .mockImplementation(async (_model: unknown, ctx: Record<string, unknown>) => {
        capturedPrompt = ctx.systemPrompt as string;
        return {
          result: async () => ({
            content: [{ type: "text", text: "ok" }],
            stopReason: "end_turn",
            usage: { input: 100, output: 50 },
          }),
        };
      });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("before_agent_start", (event: unknown) => {
      const e = cast<Record<string, unknown>>(event);
      return { systemPrompt: (e.systemPrompt as string) + " EXTRA" };
    });

    await session.start();
    await session.prompt("hi");

    expect(capturedPrompt).toBe("You are a helpful assistant. EXTRA");
  });

  it("chains multiple before_agent_start handlers", async () => {
    let capturedPrompt: string | undefined;
    const streamFn = vi
      .fn()
      .mockImplementation(async (_model: unknown, ctx: Record<string, unknown>) => {
        capturedPrompt = ctx.systemPrompt as string;
        return {
          result: async () => ({
            content: [{ type: "text", text: "ok" }],
            stopReason: "end_turn",
            usage: { input: 100, output: 50 },
          }),
        };
      });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("before_agent_start", (event: unknown) => {
      const e = cast<Record<string, unknown>>(event);
      return { systemPrompt: (e.systemPrompt as string) + " A" };
    });
    session.extensionAPI.on("before_agent_start", (event: unknown) => {
      const e = cast<Record<string, unknown>>(event);
      return { systemPrompt: (e.systemPrompt as string) + " B" };
    });

    await session.start();
    await session.prompt("hi");

    expect(capturedPrompt).toBe("You are a helpful assistant. A B");
  });

  it("supports async before_agent_start handlers", async () => {
    let capturedPrompt: string | undefined;
    const streamFn = vi
      .fn()
      .mockImplementation(async (_model: unknown, ctx: Record<string, unknown>) => {
        capturedPrompt = ctx.systemPrompt as string;
        return {
          result: async () => ({
            content: [{ type: "text", text: "ok" }],
            stopReason: "end_turn",
            usage: { input: 100, output: 50 },
          }),
        };
      });

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("before_agent_start", async (event: unknown) => {
      const e = cast<Record<string, unknown>>(event);
      await new Promise((r) => setTimeout(r, 10));
      return { systemPrompt: (e.systemPrompt as string) + " ASYNC" };
    });

    await session.start();
    await session.prompt("hi");

    expect(capturedPrompt).toBe("You are a helpful assistant. ASYNC");
  });

  it("bridges toolCall to tool_use in turn_end event", async () => {
    const turnEndEvents: Array<Record<string, unknown>> = [];
    const streamFn = mockStreamFn("I'll read it", [
      { id: "tc1", name: "read_file", input: { path: "/f" } },
    ]);

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("turn_end", (event: unknown) => {
      turnEndEvents.push(cast<Record<string, unknown>>(event));
    });

    await session.start();
    await session.prompt("read the file");

    expect(turnEndEvents.length).toBeGreaterThan(0);
    const lastTurn = turnEndEvents[turnEndEvents.length - 1];
    const lastMsg = cast<Record<string, unknown>>(getProp<unknown>(lastTurn, "message"));
    const lastContent = cast<Array<Record<string, unknown>>>(getProp<unknown>(lastMsg, "content"));
    expect(lastContent[1].type).toBe("tool_use");
    expect(lastContent[1].name).toBe("read_file");
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
    const agentEndEvents: Array<Record<string, unknown>> = [];
    const streamFn = mockStreamFn("done");

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("agent_end", (event: unknown) => {
      agentEndEvents.push(cast<Record<string, unknown>>(event));
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
    const turnStartEvents: Array<Record<string, unknown>> = [];
    const streamFn = mockStreamFn("ok");

    const session = new HarnessAgentSession(makeConfig({ streamFn }));
    session.extensionAPI.on("turn_start", (event: unknown) => {
      turnStartEvents.push(cast<Record<string, unknown>>(event));
    });

    await session.start();
    await session.prompt("hi");

    expect(turnStartEvents.length).toBeGreaterThan(0);
    expect(turnStartEvents[0].turnIndex).toBe(0);
    expect(turnStartEvents[0].type).toBe("turn_start");
    expect(turnStartEvents[0].timestamp).toBeDefined();
  });

  it("turnIndex does not reset on auto-retry", async () => {
    const turnEndEvents: Array<unknown> = [];
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
    session.extensionAPI.on("turn_end", (event: unknown) => {
      turnEndEvents.push(getProp<unknown>(event, "turnIndex"));
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
    const entries = lines.map((l: string) => cast<Record<string, unknown>>(JSON.parse(l)));
    const messageEntries = entries.filter((e) => e.type === "message");

    // Should have: user + assistant (round 1) + user (retry feedback) + assistant (round 2) = 4
    // NOT 6 (duplicates)
    const userMsgs = messageEntries.filter(
      (e) =>
        cast<Record<string, unknown> | undefined>(getProp<unknown>(e, "message"))?.role === "user",
    );
    const assistantMsgs = messageEntries.filter(
      (e) =>
        cast<Record<string, unknown> | undefined>(getProp<unknown>(e, "message"))?.role ===
        "assistant",
    );
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

    const streamFn = vi
      .fn()
      .mockImplementation(async (_model: unknown, _ctx: unknown, opts: Record<string, unknown>) => {
        capturedSignal = opts.signal as AbortSignal;
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

describe("assessment preflight", () => {
  function evaluationResponse(overrides?: Record<string, unknown>) {
    return JSON.stringify({
      understood: true,
      taskOverview: "Implement auth",
      complexity: "medium",
      complexityReason: "Multi-file",
      risk: "low",
      riskReason: "New code",
      needsExecution: true,
      executor: "internal",
      reasoning: "Task",
      ...overrides,
    });
  }

  it("enableAssessment: false skips evaluation entirely", async () => {
    const streamFn = mockStreamFn("done");
    const session = new HarnessAgentSession(makeConfig({ streamFn, enableAssessment: false }));

    await session.start();
    await session.prompt("hello");

    // streamFn called once — no evaluation call
    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it("evaluation only sees raw user input, not session history", async () => {
    let capturedEvalMessages: Array<Record<string, unknown>> = [];
    let callCount = 0;

    const streamFn = vi
      .fn()
      .mockImplementation(async (_model: unknown, ctx: Record<string, unknown>) => {
        callCount++;
        if (callCount === 1) {
          // First call = evaluation — capture its messages
          capturedEvalMessages = ctx.messages as Array<Record<string, unknown>>;
        }
        return {
          result: async () => ({
            content: [{ type: "text", text: callCount === 1 ? evaluationResponse() : "done" }],
            stopReason: "end_turn",
            usage: { input: 100, output: 50 },
          }),
        };
      });

    const session = new HarnessAgentSession(makeConfig({ streamFn, enableAssessment: true }));

    await session.start();
    await session.prompt("hello");

    // Evaluation call should have exactly 1 message (the raw user input)
    // and NOT the session's accumulated history
    expect(capturedEvalMessages).toHaveLength(1);
    const firstMsgContent = cast<Array<Record<string, unknown>>>(
      getProp<unknown>(capturedEvalMessages[0], "content"),
    );
    expect(firstMsgContent[0].text).toBe("hello");
  });

  it("source: model && understood continues to main loop", async () => {
    let callCount = 0;
    const streamFn = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        result: async () => ({
          content: [{ type: "text", text: callCount === 1 ? evaluationResponse() : "done" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn, enableAssessment: true }));

    await session.start();
    await session.prompt("hello");

    // Both evaluation and main loop called
    expect(streamFn).toHaveBeenCalledTimes(2);
  });

  it("source: model && !understood dispatches assessment_clarification", async () => {
    const evalJson = evaluationResponse({
      understood: false,
      clarificationNeeded: "What do you need?",
    });
    const streamFn = vi.fn().mockImplementation(async () => ({
      result: async () => ({
        content: [{ type: "text", text: evalJson }],
        stopReason: "end_turn",
        usage: { input: 100, output: 50 },
      }),
    }));

    const session = new HarnessAgentSession(makeConfig({ streamFn, enableAssessment: true }));

    const events: string[] = [];
    session.extensionAPI.on("assessment_clarification", () => {
      events.push("assessment_clarification");
    });
    session.extensionAPI.on("agent_end", () => {
      events.push("agent_end");
    });

    await session.start();
    await session.prompt("hello");

    expect(events).toContain("assessment_clarification");
    // agent_end dispatched exactly once (by prompt() end, not by clarification branch)
    expect(events.filter((e) => e === "agent_end")).toHaveLength(1);
    // streamFn called only once (evaluation), not for main loop
    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it("source: fallback bypasses assessment and continues main loop", async () => {
    let callCount = 0;
    const streamFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("network error");
      }
      return {
        result: async () => ({
          content: [{ type: "text", text: "done" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }),
      };
    });

    const session = new HarnessAgentSession(makeConfig({ streamFn, enableAssessment: true }));

    await session.start();
    await session.prompt("hello");

    // Fallback → bypass → main loop still runs
    expect(streamFn).toHaveBeenCalledTimes(2);
  });

  it("clarification does not add user message to messages", async () => {
    const evalJson = evaluationResponse({
      understood: false,
      clarificationNeeded: "What?",
    });
    const streamFn = vi.fn().mockImplementation(async () => ({
      result: async () => ({
        content: [{ type: "text", text: evalJson }],
        stopReason: "end_turn",
        usage: { input: 100, output: 50 },
      }),
    }));

    const session = new HarnessAgentSession(makeConfig({ streamFn, enableAssessment: true }));

    await session.start();
    await session.prompt("hello");

    // messages should not contain the user text (clarification happened before push)
    const messages = cast<{ messages: Array<Record<string, unknown>> }>(session).messages;
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(0);
  });
});
