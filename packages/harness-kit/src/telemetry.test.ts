import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTelemetry, emit, flush, close, getLogPath, getSessionId } from "./telemetry.js";

let tmpDir: string;
let logFile: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `hk-telemetry-test-${Date.now()}`);
  logFile = join(tmpDir, "test.jsonl");
});

afterEach(() => {
  close();
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("telemetry", () => {
  it("initTelemetry returns session ID and creates log file", () => {
    const sid = initTelemetry(logFile);
    assert.ok(sid.length > 0, "session ID should not be empty");
    assert.equal(getLogPath(), logFile);
    assert.equal(getSessionId(), sid);
    assert.ok(existsSync(logFile), "log file should exist after init");
  });

  it("emit writes JSONL lines to file", () => {
    initTelemetry(logFile);
    emit("tool_call", "start", { tool: "acp_send" });
    emit("tool_call", "end", { tool: "acp_send", success: true }, 150);
    flush();

    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    // First line is session start, then 2 emits
    assert.equal(lines.length, 3);

    const event1 = JSON.parse(lines[1]!);
    assert.equal(event1.type, "tool_call");
    assert.equal(event1.action, "start");
    assert.deepEqual(event1.data, { tool: "acp_send" });
    assert.ok(event1.ts, "should have timestamp");
    assert.equal(event1.durationMs, undefined);

    const event2 = JSON.parse(lines[2]!);
    assert.equal(event2.type, "tool_call");
    assert.equal(event2.action, "end");
    assert.equal(event2.durationMs, 150);
  });

  it("emit is no-op before init", () => {
    // Should not throw
    emit("test", "noop", {});
    assert.ok(!existsSync(logFile), "no file should be created");
  });

  it("close writes session end event", () => {
    initTelemetry(logFile);
    close();

    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    const lastEvent = JSON.parse(lines.at(-1)!);
    assert.equal(lastEvent.type, "session");
    assert.equal(lastEvent.action, "end");
  });

  it("multiple inits create separate sessions", () => {
    const file1 = join(tmpDir, "s1.jsonl");
    const file2 = join(tmpDir, "s2.jsonl");

    initTelemetry(file1);
    emit("test", "a", {});
    close();

    initTelemetry(file2);
    emit("test", "b", {});
    close();

    const lines1 = readFileSync(file1, "utf-8").trim().split("\n");
    const lines2 = readFileSync(file2, "utf-8").trim().split("\n");

    assert.ok(lines1.length >= 2, "first session should have events");
    assert.ok(lines2.length >= 2, "second session should have events");

    const sid1 = JSON.parse(lines1[0]!).data.sessionId;
    const sid2 = JSON.parse(lines2[0]!).data.sessionId;
    assert.notEqual(sid1, sid2, "session IDs should differ");
  });
});
