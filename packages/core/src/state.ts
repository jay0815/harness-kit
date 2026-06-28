import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  fsyncSync,
  openSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import type {
  AwaitingHumanState,
  HarnessState,
  PhaseState,
  ResultBlock,
  Workflow,
} from "./types.js";

const STATE_DIR = ".harness-kit";
const PHASES_DIR = "phases";
const STATE_FILE = "state.json";

function stateDir(ws: string): string {
  return join(ws, STATE_DIR);
}

function phasesDir(ws: string): string {
  return join(ws, STATE_DIR, PHASES_DIR);
}

function statePath(ws: string): string {
  return join(ws, STATE_DIR, STATE_FILE);
}

export function initState(workflow: Workflow, workspaceDir: string): HarnessState {
  const now = new Date().toISOString();
  const state: HarnessState = {
    schemaVersion: 1,
    workspaceDir,
    createdAt: now,
    updatedAt: now,
    currentPhase: 0,
    phases: workflow.phases.map((p) => ({
      name: p.name,
      status: "pending",
    })),
  };
  saveState(state, workspaceDir);
  return state;
}

export function saveState(state: HarnessState, workspaceDir: string): void {
  const dir = stateDir(workspaceDir);
  mkdirSync(dir, { recursive: true });

  const target = statePath(workspaceDir);
  const tmp = target + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");

  const fd = openSync(tmp, "r+");
  fsyncSync(fd);
  closeSync(fd);

  renameSync(tmp, target);
}

export function loadState(workspaceDir: string): HarnessState | null {
  try {
    const raw = readFileSync(statePath(workspaceDir), "utf-8");
    const parsed = JSON.parse(raw) as HarnessState;
    if (parsed.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveArtifact(
  phaseIndex: number,
  phaseName: string,
  resultBlock: ResultBlock,
  workspaceDir: string,
): string {
  const dir = phasesDir(workspaceDir);
  mkdirSync(dir, { recursive: true });

  const filename = `${phaseIndex}-${phaseName}.json`;
  const filepath = join(dir, filename);
  const tmp = filepath + ".tmp";

  writeFileSync(tmp, JSON.stringify(resultBlock, null, 2), "utf-8");

  const fd = openSync(tmp, "r+");
  fsyncSync(fd);
  closeSync(fd);

  renameSync(tmp, filepath);
  return join(STATE_DIR, PHASES_DIR, filename);
}

export function reconcileFromDisk(workspaceDir: string, totalPhases?: number): HarnessState | null {
  const loadedState = loadState(workspaceDir);
  const dir = phasesDir(workspaceDir);
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return loadedState;
  }

  const phases: PhaseState[] = [];
  let maxCompleted = -1;

  for (const entry of entries.sort()) {
    const match = entry.match(/^(\d+)-(.+)\.json$/);
    if (!match) continue;

    const idx = parseInt(match[1], 10);
    const name = match[2];
    const filepath = join(dir, entry);

    try {
      const raw = readFileSync(filepath, "utf-8");
      JSON.parse(raw);
      phases[idx] = { name, status: "completed", artifactPath: join(STATE_DIR, PHASES_DIR, entry) };
      maxCompleted = Math.max(maxCompleted, idx);
    } catch {
      unlinkSync(filepath);
    }
  }

  if (phases.length === 0) return loadedState;

  const count = totalPhases ?? Math.max(phases.length, loadedState?.phases.length ?? 0);
  for (let i = 0; i < count; i++) {
    if (!phases[i]) {
      phases[i] = { name: `phase-${i}`, status: "pending" };
    }
  }

  const now = new Date().toISOString();
  const currentPhase = maxCompleted + 1;
  const state: HarnessState = {
    schemaVersion: 1,
    workspaceDir,
    createdAt: loadedState?.createdAt ?? now,
    updatedAt: now,
    currentPhase,
    phases,
  };
  const awaitingHuman = preserveAwaitingHuman(loadedState?.awaitingHuman, currentPhase, phases);
  if (awaitingHuman) {
    state.awaitingHuman = awaitingHuman;
  }

  saveState(state, workspaceDir);
  return state;
}

function preserveAwaitingHuman(
  gate: AwaitingHumanState | undefined,
  currentPhase: number,
  phases: PhaseState[],
): AwaitingHumanState | undefined {
  if (!gate) return undefined;
  if (gate.phaseIndex < 0 || gate.phaseIndex >= phases.length) return undefined;
  if (gate.nextPhaseIndex !== currentPhase) return undefined;
  if (gate.nextPhaseIndex < 0 || gate.nextPhaseIndex > phases.length) return undefined;
  if (phases[gate.phaseIndex]?.status !== "completed") return undefined;
  return gate;
}
