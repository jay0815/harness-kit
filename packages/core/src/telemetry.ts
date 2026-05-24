import { appendFileSync, mkdirSync, closeSync, openSync, fsyncSync } from "node:fs";
import { join, dirname } from "node:path";

export interface TelemetryEvent {
  ts: string;
  type: string;
  action: string;
  data: Record<string, unknown>;
  durationMs?: number;
}

let fd: number | null = null;
let logPath = "";
let sessionId = "";

export function initTelemetry(outputPath?: string): string {
  // Close existing fd if re-initializing
  if (fd !== null) {
    try {
      closeSync(fd);
    } catch {
      // Ignore close errors
    }
    fd = null;
  }

  sessionId = Date.now().toString(36);
  logPath = outputPath ?? join(process.cwd(), ".harness-kit", "telemetry", `${sessionId}.jsonl`);
  mkdirSync(dirname(logPath), { recursive: true });
  fd = openSync(logPath, "a");
  emit("session", "start", { sessionId });
  return sessionId;
}

export function emit(type: string, action: string, data: Record<string, unknown>, durationMs?: number): void {
  if (fd === null) return;
  const event: TelemetryEvent = {
    ts: new Date().toISOString(),
    type,
    action,
    data,
    ...(durationMs !== undefined && { durationMs }),
  };
  appendFileSync(fd, JSON.stringify(event) + "\n");
}

export function flush(): void {
  if (fd !== null) {
    fsyncSync(fd);
  }
}

export function close(): void {
  if (fd !== null) {
    emit("session", "end", { sessionId });
    flush();
    closeSync(fd);
    fd = null;
  }
}

export function getLogPath(): string {
  return logPath;
}

export function getSessionId(): string {
  return sessionId;
}
