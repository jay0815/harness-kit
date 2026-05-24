#!/usr/bin/env npx tsx
/**
 * Direct E2E test for harness-kit — no PI required.
 *
 * Prerequisites: tmux running, tmux-bridge in PATH.
 * Usage: npx tsx scripts/test-e2e-direct.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPane,
  labelPane,
  startAgentInPane,
  typeToPane,
  sendKeysToPane,
  readPane,
  killPane,
  isPaneAlive,
} from "../src/pane.js";
import { extractResultBlock, hasCompleteResultBlock } from "../src/result-block.js";
import { verifyFacts } from "../src/verify.js";
import { initTelemetry, emit, close, getLogPath } from "../src/telemetry.js";
import { setWorkspaceDir } from "../src/tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_WORKSPACE = join(__dirname, "mock-workspace");
const MOCK_AGENT = join(__dirname, "mock-agent.sh");

function checkPrerequisites(): void {
  try {
    execFileSync("tmux", ["list-sessions"], { encoding: "utf-8", timeout: 5000 });
  } catch {
    console.error("ERROR: No active tmux session. Start tmux first.");
    process.exit(1);
  }
  if (!existsSync(MOCK_AGENT)) {
    console.error(`ERROR: Mock agent not found at ${MOCK_AGENT}`);
    process.exit(1);
  }
}

function pass(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log("=== harness-kit E2E Test (Direct) ===\n");

  // 0. Prerequisites
  console.log("0. Checking prerequisites...");
  checkPrerequisites();
  pass("tmux session active");

  // 1. Init telemetry
  console.log("\n1. Initializing telemetry...");
  const telemetryDir = join(MOCK_WORKSPACE, ".harness-kit", "telemetry");
  const sid = initTelemetry(join(telemetryDir, "e2e-test.jsonl"));
  setWorkspaceDir(MOCK_WORKSPACE);
  pass(`Session ID: ${sid}`);
  pass(`Log: ${getLogPath()}`);

  let paneId: string | null = null;

  try {
    // 2. Create pane + start mock agent
    console.log("\n2. Creating pane and starting mock agent (--pass)...");
    paneId = createPane();
    labelPane(paneId, "mock-executor");
    emit("pane_event", "create", { paneId, role: "mock-executor" });
    pass(`Pane: ${paneId}`);

    startAgentInPane(paneId, `bash ${MOCK_AGENT} --pass`);
    await sleep(500);
    pass("Mock agent started");

    // 3. Send task
    console.log("\n3. Sending task...");
    const taskMsg = "Analyze the codebase and report findings.";

    typeToPane(paneId, taskMsg);
    sendKeysToPane(paneId, "Enter");
    emit("acp_msg", "send", { target: "mock-executor", paneId });
    pass("Task sent");

    // 4. Poll for result
    console.log("\n4. Polling for HK_RESULT...");
    let result = null;
    for (let i = 0; i < 15; i++) {
      await sleep(500);
      const output = readPane(paneId, 50);
      result = extractResultBlock(output);
      if (result) break;
    }

    if (!result) {
      const output = readPane(paneId, 50);
      console.error("  Last pane output:");
      console.error(output.slice(-500));
      fail("No HK_RESULT block found after 7.5s");
    }
    emit("acp_msg", "read", { target: "mock-executor", status: "COMPLETE", factCount: result.facts.length });
    pass(`Got result: "${result.currentWork}"`);
    pass(`Facts cited: ${result.facts.length}`);

    // 5. Verify facts
    console.log("\n5. Verifying facts against disk...");
    const report = verifyFacts(result.facts, MOCK_WORKSPACE);
    emit("verify_run", "complete", {
      overall: report.overall,
      passCount: report.checks.filter((c) => c.status === "PASS").length,
      failCount: report.checks.filter((c) => c.status === "FAIL").length,
      totalFacts: result.facts.length,
    });

    for (const check of report.checks) {
      const f = check.fact;
      if (check.status === "PASS") {
        pass(`${f.file}:${f.startLine}-${f.endLine}`);
      } else {
        fail(`${f.file}:${f.startLine}-${f.endLine} — ${check.error ?? "text mismatch"}`);
      }
    }

    if (report.overall !== "PASS") {
      fail(`Verification: ${report.overall}`);
    }
    pass(`Verification: ${report.overall}`);

    // 6. Test --fail mode
    console.log("\n6. Testing --fail mode (expect FAIL)...");
    killPane(paneId);
    emit("pane_event", "kill", { paneId });
    paneId = null;

    paneId = createPane();
    labelPane(paneId, "mock-fail-agent");
    emit("pane_event", "create", { paneId, role: "mock-fail-agent" });
    startAgentInPane(paneId, `bash ${MOCK_AGENT} --fail`);
    await sleep(500);

    typeToPane(paneId, taskMsg);
    sendKeysToPane(paneId, "Enter");
    emit("acp_msg", "send", { target: "mock-fail-agent", paneId });

    let failResult = null;
    for (let i = 0; i < 15; i++) {
      await sleep(500);
      const output = readPane(paneId, 50);
      failResult = extractResultBlock(output);
      if (failResult) break;
    }

    if (!failResult) {
      fail("No HK_RESULT from --fail agent");
    }

    const failReport = verifyFacts(failResult.facts, MOCK_WORKSPACE);
    emit("verify_run", "complete", {
      overall: failReport.overall,
      passCount: failReport.checks.filter((c) => c.status === "PASS").length,
      failCount: failReport.checks.filter((c) => c.status === "FAIL").length,
      totalFacts: failResult.facts.length,
    });

    if (failReport.overall !== "FAIL") {
      fail("Expected --fail mode to produce FAIL verification");
    }
    pass(`--fail mode correctly produced FAIL (line 100 doesn't exist)`);

    // 7. Check telemetry
    console.log("\n7. Checking telemetry output...");
    close();
    const logPath = getLogPath();
    if (!existsSync(logPath)) {
      fail(`Telemetry log not found: ${logPath}`);
    }
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    pass(`Telemetry log: ${lines.length} events`);

    const eventTypes = new Map<string, number>();
    for (const line of lines) {
      const evt = JSON.parse(line);
      const key = `${evt.type}:${evt.action}`;
      eventTypes.set(key, (eventTypes.get(key) ?? 0) + 1);
    }
    for (const [key, count] of eventTypes) {
      console.log(`    ${key}: ${count}`);
    }

    // 8. Cleanup
    console.log("\n8. Cleanup...");
    if (paneId && isPaneAlive(paneId)) {
      killPane(paneId);
      paneId = null;
    }
    if (existsSync(telemetryDir)) {
      rmSync(telemetryDir, { recursive: true, force: true });
    }
    pass("Cleaned up");

    console.log("\n=== ALL TESTS PASSED ===");
  } catch (err) {
    console.error("\nFATAL:", err);
    if (paneId) {
      try { killPane(paneId); } catch { /* ignore */ }
    }
    close();
    process.exit(1);
  }
}

main();
