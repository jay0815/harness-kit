import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionPersistence } from "./session-persistence.js";

describe("SessionPersistence", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-persist-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates session directory if needed", () => {
    const nested = join(dir, "a", "b");
    const p = new SessionPersistence(nested, "test-1");
    p.startSession();
    expect(existsSync(join(nested, "test-1.jsonl"))).toBe(true);
  });

  it("writes session header on startSession", () => {
    const p = new SessionPersistence(dir, "test-2");
    p.startSession();
    p.close();

    const content = readFileSync(join(dir, "test-2.jsonl"), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.type).toBe("session");
    expect(entry.id).toBe("test-2");
    expect(entry.timestamp).toBeDefined();
  });

  it("appends and reads back messages", () => {
    const p = new SessionPersistence(dir, "test-3");
    p.startSession();

    const msg1 = { role: "user", content: [{ type: "text", text: "hello" }] };
    const msg2 = {
      role: "assistant",
      content: [
        { type: "text", text: "I'll help" },
        { type: "toolCall", id: "tc1", name: "bash", input: { command: "ls" } },
      ],
    };

    p.appendMessage(msg1);
    p.appendMessage(msg2);

    const messages = p.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(msg1);
    expect(messages[1]).toEqual(msg2);
    // toolCall format preserved (not converted to tool_use)
    expect(messages[1].content[1].type).toBe("toolCall");
  });

  it("returns empty array for non-existent file", () => {
    const p = new SessionPersistence(dir, "nonexistent");
    expect(p.getMessages()).toEqual([]);
  });

  it("skips session header entries when reading messages", () => {
    const p = new SessionPersistence(dir, "test-4");
    p.startSession();
    p.appendMessage({ role: "user", content: "hi" });

    const messages = p.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("skips malformed lines", () => {
    const p = new SessionPersistence(dir, "test-5");
    p.startSession();
    p.appendMessage({ role: "user", content: "ok" });
    p.close();

    appendFileSync(join(dir, "test-5.jsonl"), "not-json\n", "utf-8");

    const p2 = new SessionPersistence(dir, "test-5");
    const messages = p2.getMessages();
    expect(messages).toHaveLength(1);
  });

  it("throws after close", () => {
    const p = new SessionPersistence(dir, "test-6");
    p.close();
    expect(() => p.startSession()).toThrow("closed");
    expect(() => p.appendMessage({})).toThrow("closed");
  });

  it("generates sessionId when not provided", () => {
    const p = new SessionPersistence(dir);
    expect(p.id).toBeDefined();
    expect(p.id.length).toBeGreaterThan(0);
  });

  it("preserves internal toolCall format roundtrip", () => {
    const p = new SessionPersistence(dir, "test-7");
    p.startSession();

    const toolResult = {
      role: "tool",
      toolCallId: "tc1",
      content: [{ type: "text", text: "file content" }],
      isError: false,
    };
    p.appendMessage(toolResult);
    p.close();

    const messages = new SessionPersistence(dir, "test-7").getMessages();
    expect(messages[0]).toEqual(toolResult);
    expect(messages[0].toolCallId).toBe("tc1");
  });
});
