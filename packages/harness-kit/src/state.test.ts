import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initState, loadState, saveArtifact, reconcileFromDisk } from "./state.js";
import type { ResultBlock, Workflow } from "./types.js";

const testWorkflow: Workflow = {
  name: "test",
  description: "test workflow",
  phases: [
    { name: "design", executor: "self", prompt: "design", contextFiles: [], humanConfirm: false },
    { name: "implement", executor: "self", prompt: "implement", contextFiles: [], humanConfirm: false },
  ],
};

const testBlock: ResultBlock = {
  currentWork: "did something",
  facts: [{ file: "src/foo.ts", startLine: 1, endLine: 3, exactText: "line1\nline2\nline3" }],
  reasoning: "test",
};

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "hk-state-"));
});

afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe("initState", () => {
  it("creates state.json with correct structure", () => {
    const state = initState(testWorkflow, ws);
    expect(state.schemaVersion).toBe(1);
    expect(state.currentPhase).toBe(0);
    expect(state.phases).toHaveLength(2);
    expect(state.phases[0].name).toBe("design");
    expect(state.phases[0].status).toBe("pending");
    expect(existsSync(join(ws, ".harness-kit", "state.json"))).toBe(true);
  });
});

describe("loadState", () => {
  it("returns null when state.json missing", () => {
    expect(loadState(ws)).toBeNull();
  });

  it("loads saved state", () => {
    initState(testWorkflow, ws);
    const loaded = loadState(ws);
    expect(loaded).not.toBeNull();
    expect(loaded!.phases).toHaveLength(2);
  });
});

describe("saveArtifact", () => {
  it("creates phase artifact file", () => {
    const path = saveArtifact(0, "design", testBlock, ws);
    expect(path).toBe(".harness-kit/phases/0-design.json");
    const full = join(ws, path);
    expect(existsSync(full)).toBe(true);
    const parsed = JSON.parse(readFileSync(full, "utf-8"));
    expect(parsed.currentWork).toBe("did something");
    expect(parsed.facts).toHaveLength(1);
  });
});

describe("reconcileFromDisk", () => {
  it("returns null when no artifacts exist", () => {
    expect(reconcileFromDisk(ws)).toBeNull();
  });

  it("rebuilds state from artifacts", () => {
    saveArtifact(0, "design", testBlock, ws);
    saveArtifact(1, "implement", testBlock, ws);

    const state = reconcileFromDisk(ws);
    expect(state).not.toBeNull();
    expect(state!.currentPhase).toBe(2);
    expect(state!.phases[0].status).toBe("completed");
    expect(state!.phases[1].status).toBe("completed");
  });

  it("deletes malformed artifacts", () => {
    const phasesDir = join(ws, ".harness-kit", "phases");
    mkdirSync(phasesDir, { recursive: true });
    writeFileSync(join(phasesDir, "0-bad.json"), "not json", "utf-8");
    saveArtifact(1, "implement", testBlock, ws);

    const state = reconcileFromDisk(ws);
    expect(state).not.toBeNull();
    expect(state!.phases).toHaveLength(2);
    expect(state!.phases[0].status).toBe("pending");
    expect(state!.phases[1].status).toBe("completed");
    expect(existsSync(join(phasesDir, "0-bad.json"))).toBe(false);
  });

  it("handles mixed completed and pending phases", () => {
    saveArtifact(0, "design", testBlock, ws);

    const state = reconcileFromDisk(ws, 2);
    expect(state).not.toBeNull();
    expect(state!.currentPhase).toBe(1);
    expect(state!.phases[0].status).toBe("completed");
    expect(state!.phases[1].status).toBe("pending");
  });
});

describe("atomic write", () => {
  it("does not leave tmp file after saveState", () => {
    initState(testWorkflow, ws);
    const tmpPath = join(ws, ".harness-kit", "state.json.tmp");
    expect(existsSync(tmpPath)).toBe(false);
  });

  it("does not leave tmp file after saveArtifact", () => {
    saveArtifact(0, "design", testBlock, ws);
    const tmpPath = join(ws, ".harness-kit", "phases", "0-design.json.tmp");
    expect(existsSync(tmpPath)).toBe(false);
  });
});
