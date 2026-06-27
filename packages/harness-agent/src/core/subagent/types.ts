import type { ResultBlock } from "../verify-types.js";

export type SubagentExecutor = "claude" | "codex" | "harness-agent" | "script";

export interface SubagentTask {
  id: string;
  task: string;
  constraints?: string[];
  contextFiles?: string[];
  timeoutMs?: number;
  executor: SubagentExecutor;
  executorCommand?: string;
  settingsPath?: string;
}

export interface SubagentResultFile {
  summary: string;
  currentWork: string;
  facts: Array<{
    file: string;
    startLine: number;
    endLine: number;
    exactText: string;
  }>;
  reasoning?: string;
}

export interface SubagentResult {
  success: boolean;
  subagentId: string;
  block?: ResultBlock;
  rawOutput?: string;
  error?: string;
  errorType?: "timeout" | "no_result" | "invalid_json" | "invalid_schema" | "process_crashed";
  durationMs: number;
}

export interface SpawnSubagentParams {
  task: string;
  executor: SubagentExecutor;
  constraints?: string[];
  timeoutMs?: number;
  settingsPath?: string;
}

export interface CollectResultParams {
  subagentId: string;
}

import { tmpdir } from "node:os";

export const DEFAULT_TIMEOUT_MS = 300_000;
export const RESULT_DIR = tmpdir();
