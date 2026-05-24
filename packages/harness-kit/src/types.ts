// Shared types for harness-kit

export interface Fact {
  /** File path relative to workspace root */
  file: string;
  /** 1-indexed start line */
  startLine: number;
  /** 1-indexed end line (inclusive) */
  endLine: number;
  /** Exact text claimed to be at this location */
  exactText: string;
}

export interface ResultBlock {
  /** What the agent claims it did */
  currentWork: string;
  /** Facts cited to support the work */
  facts: Fact[];
  /** Reasoning / notes */
  reasoning?: string;
}

export interface Phase {
  /** Phase name */
  name: string;
  /** Which coding agent runs this phase (e.g. "claude-code", "codex") */
  executor: string;
  /** Human-readable instructions */
  prompt: string;
  /** Files the agent should read */
  contextFiles: string[];
  /** Whether to pause for human confirmation after this phase */
  humanConfirm: boolean;
}

export interface Workflow {
  name: string;
  description: string;
  phases: Phase[];
}

export interface VerifyReport {
  overall: "PASS" | "FAIL";
  checks: VerifyCheck[];
}

export interface VerifyCheck {
  fact: Fact;
  status: "PASS" | "FAIL";
  /** Actual text found on disk (only present on FAIL) */
  actual?: string;
  /** Error message if file/line could not be read */
  error?: string;
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

export interface HarnessState {
  schemaVersion: 1;
  workspaceDir: string;
  createdAt: string;
  updatedAt: string;
  currentPhase: number;
  phases: PhaseState[];
}
