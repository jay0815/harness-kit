// Shared types for harness-kit

export type { Fact, ResultBlock, VerifyReport, VerifyCheck } from "@harness-kit/agent";

export interface Phase {
  /** Phase name */
  name: string;
  /** Which coding agent runs this phase (e.g. "self", "code", "subagent") */
  executor: string;
  /** Human-readable instructions */
  prompt: string;
  /** Files the agent should read */
  contextFiles: string[];
  /** Whether to pause for human confirmation after this phase */
  humanConfirm: boolean;
  /** Shell command for code executor */
  command?: string;
  /** Script path for code executor */
  script?: string;
  /** Arguments for script executor */
  args?: string[];
  /** Subagent executor type (claude, codex, harness-agent, script) */
  subagentType?: string;
  /** Subagent constraints */
  subagentConstraints?: string[];
  /** Subagent timeout in milliseconds */
  subagentTimeoutMs?: number;
  /** Settings file path for claude subagent */
  subagentSettings?: string;
}

export interface Workflow {
  name: string;
  description: string;
  phases: Phase[];
}

export interface PaneInfo {
  id: string;
  label: string;
  executor: string;
}

export interface PhaseState {
  name: string;
  status: "pending" | "completed";
  artifactPath?: string;
  completedAt?: string;
}

export interface SnapshotEntry {
  size: number;
  mtimeNs: bigint;
  sha256: string;
}

export interface HarnessState {
  schemaVersion: 1;
  workspaceDir: string;
  createdAt: string;
  updatedAt: string;
  currentPhase: number;
  phases: PhaseState[];
  phaseSnapshot?: Record<string, SnapshotEntry>;
}
