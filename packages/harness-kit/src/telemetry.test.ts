import { describe, it, beforeEach, afterEach, expect } from "vitest";
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
    expect(sid.length).toBeGreaterThan(0);
    expect(getLogPath()).toBe(logFile);
    expect(getSessionId()).toBe(sid);
    expect(existsSync(logFile)).toBe(true);
  });

  it("emit writes JSONL lines to file", () => {
    initTelemetry(logFile);
    emit("tool_call", "start", { tool: "acp_send" });
    emit("tool_call", "end", { tool: "acp_send", success: true }, 150);
    flush();

    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);

    const event1 = JSON.parse(lines[1]!);
    expect(event1.type).toBe("tool_call");
    expect(event1.action).toBe("start");
    expect(event1.data).toEqual({ tool: "acp_send" });
    expect(event1.ts).toBeTruthy();
    expect(event1.durationMs).toBeUndefined();

    const event2 = JSON.parse(lines[2]!);
    expect(event2.type).toBe("tool_call");
    expect(event2.action).toBe("end");
    expect(event2.durationMs).toBe(150);
  });

  it("emit is no-op before init", () => {
    emit("test", "noop", {});
    expect(existsSync(logFile)).toBe(false);
  });

  it("close writes session end event", () => {
    initTelemetry(logFile);
    close();

    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    const lastEvent = JSON.parse(lines.at(-1)!);
    expect(lastEvent.type).toBe("session");
    expect(lastEvent.action).toBe("end");
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

    expect(lines1.length).toBeGreaterThanOrEqual(2);
    expect(lines2.length).toBeGreaterThanOrEqual(2);

    const sid1 = JSON.parse(lines1[0]!).data.sessionId;
    const sid2 = JSON.parse(lines2[0]!).data.sessionId;
    expect(sid1).not.toBe(sid2);
  });
});
