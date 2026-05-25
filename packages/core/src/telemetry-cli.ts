#!/usr/bin/env node
/**
 * Telemetry CLI — reads harness-kit JSONL logs and outputs summary statistics.
 *
 * Usage:
 *   harness-telemetry <jsonl-file>              # summary
 *   harness-telemetry <jsonl-file> --timeline   # chronological events
 *   harness-telemetry <jsonl-file> --errors     # only failures/errors
 */
import { readFileSync } from "node:fs";

interface TelemetryEvent {
  ts: string;
  type: string;
  action: string;
  data: Record<string, unknown>;
  durationMs?: number;
}

function loadEvents(path: string): TelemetryEvent[] {
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as TelemetryEvent);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface ToolStat {
  count: number;
  totalMs: number;
  maxMs: number;
}

function printSummary(events: TelemetryEvent[]): void {
  const sessionStart = events.find((e) => e.type === "session" && e.action === "start");
  const sessionEnd = events.find((e) => e.type === "session" && e.action === "end");

  console.log("=== harness-kit Telemetry Report ===");
  if (sessionStart) {
    const sid = sessionStart.data.sessionId ?? "unknown";
    console.log(`Session: ${sid}`);
  }
  if (sessionStart && sessionEnd) {
    const dur = new Date(sessionEnd.ts).getTime() - new Date(sessionStart.ts).getTime();
    console.log(`Duration: ${formatDuration(dur)}`);
  }

  // Tool calls
  const toolStarts = events.filter((e) => e.type === "tool_call" && e.action === "start");
  const toolEnds = events.filter((e) => e.type === "tool_call" && e.action === "end");

  if (toolStarts.length > 0) {
    console.log("\nTool Calls:");
    const byTool = new Map<string, ToolStat>();
    for (const evt of toolEnds) {
      const name = String(evt.data.tool ?? "unknown");
      const stat = byTool.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
      stat.count++;
      const dur = evt.durationMs ?? 0;
      stat.totalMs += dur;
      stat.maxMs = Math.max(stat.maxMs, dur);
      byTool.set(name, stat);
    }
    for (const [name, stat] of byTool) {
      const avg = Math.round(stat.totalMs / stat.count);
      console.log(
        `  ${name.padEnd(16)} ${stat.count} calls   avg ${formatDuration(avg)}   max ${formatDuration(stat.maxMs)}`,
      );
    }
  }

  // ACP messages
  const acpReads = events.filter((e) => e.type === "acp_msg" && e.action === "read");
  if (acpReads.length > 0) {
    console.log("\nACP Read Status:");
    const byStatus = new Map<string, number>();
    for (const evt of acpReads) {
      const status = String(evt.data.status ?? "unknown");
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    }
    for (const [status, count] of byStatus) {
      console.log(`  ${status}: ${count}`);
    }
  }

  // Pane events
  const paneEvents = events.filter((e) => e.type === "pane_event");
  if (paneEvents.length > 0) {
    console.log("\nPane Events:");
    const byAction = new Map<string, number>();
    for (const evt of paneEvents) {
      byAction.set(evt.action, (byAction.get(evt.action) ?? 0) + 1);
    }
    for (const [action, count] of byAction) {
      console.log(`  ${action}: ${count}`);
    }
  }

  // Verification
  const verifyEvents = events.filter((e) => e.type === "verify_run" && e.action === "complete");
  if (verifyEvents.length > 0) {
    console.log("\nVerification:");
    let totalFacts = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    for (const evt of verifyEvents) {
      totalFacts += Number(evt.data.totalFacts ?? 0);
      totalPassed += Number(evt.data.passCount ?? 0);
      totalFailed += Number(evt.data.failCount ?? 0);
    }
    const passRate = totalFacts > 0 ? ((totalPassed / totalFacts) * 100).toFixed(1) : "N/A";
    console.log(
      `  total_facts: ${totalFacts}   passed: ${totalPassed}   failed: ${totalFailed}   pass_rate: ${passRate}%`,
    );
  }
}

function printTimeline(events: TelemetryEvent[]): void {
  console.log("=== Timeline ===");
  const t0 = events.length > 0 ? new Date(events[0]!.ts).getTime() : 0;
  for (const evt of events) {
    const offset = new Date(evt.ts).getTime() - t0;
    const dur = evt.durationMs !== undefined ? ` (${formatDuration(evt.durationMs)})` : "";
    const dataStr = Object.keys(evt.data).length > 0 ? " " + JSON.stringify(evt.data) : "";
    console.log(
      `  +${formatDuration(offset).padStart(8)}  ${evt.type}:${evt.action}${dur}${dataStr}`,
    );
  }
}

function printErrors(events: TelemetryEvent[]): void {
  console.log("=== Errors / Failures ===");
  const errors = events.filter((e) => {
    if (e.type === "pane_event" && e.action === "dead_detected") return true;
    if (e.type === "acp_msg" && e.action === "send_error") return true;
    if (e.type === "verify_run" && e.data.overall === "FAIL") return true;
    if (e.type === "acp_msg" && e.action === "read" && e.data.status === "MALFORMED") return true;
    return false;
  });

  if (errors.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const evt of errors) {
    console.log(`  ${evt.ts}  ${evt.type}:${evt.action}  ${JSON.stringify(evt.data)}`);
  }
}

// Main
const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith("--"));
const mode = args.includes("--timeline")
  ? "timeline"
  : args.includes("--errors")
    ? "errors"
    : "summary";

if (!filePath) {
  console.error("Usage: harness-telemetry <jsonl-file> [--timeline|--errors]");
  process.exit(1);
}

try {
  const events = loadEvents(filePath);
  switch (mode) {
    case "summary":
      printSummary(events);
      break;
    case "timeline":
      printTimeline(events);
      break;
    case "errors":
      printErrors(events);
      break;
  }
} catch (err) {
  console.error(`Error reading ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
