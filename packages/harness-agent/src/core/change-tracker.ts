import type {
  AgentMiddleware,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  RuntimeState,
} from "./types.js";
import { PRIORITY_GUARD } from "./types.js";
import { extractToolArgs } from "./tool-utils.js";

export const CHANGE_TRACKER_KEY = "change_tracker";

// Tools that modify code
const CODE_MODIFYING_TOOLS = new Set([
  "write_file",
  "edit_file",
  "delete_file",
  "Write",
  "Edit",
  "MultiEdit",
]);

export interface ChangeEntry {
  generation: number;
  toolName: string;
  path: string;
}

interface TrackerState {
  codeGen: number;
  verifiedGen: number;
  lastVerifyOk: boolean;
  lastVerifyError: string | null;
  changedFiles: ChangeEntry[];
}

function defaultTrackerState(): TrackerState {
  return {
    codeGen: 0,
    verifiedGen: 0,
    lastVerifyOk: false,
    lastVerifyError: null,
    changedFiles: [],
  };
}

function getTracker(state: RuntimeState): TrackerState {
  let tracker = state.metadata[CHANGE_TRACKER_KEY] as TrackerState | undefined;
  if (!tracker) {
    tracker = defaultTrackerState();
    state.metadata[CHANGE_TRACKER_KEY] = tracker;
  }
  return tracker;
}

/**
 * ChangeTracker middleware — single-writer of code-change / verification state.
 *
 * Tracks:
 * - codeGen: incremented on each successful code-modifying tool call
 * - verifiedGen: set to codeGen when verification passes
 * - lastVerifyOk: true after passing verification, false after failure
 * - lastVerifyError: trimmed failure output from most recent failing verify
 *
 * Other middleware read CHANGE_TRACKER_KEY from RuntimeState.metadata (read-only).
 */
export class ChangeTracker implements AgentMiddleware {
  priority = PRIORITY_GUARD; // 10 — guard level
  name = "ChangeTracker";

  async afterTool(
    state: RuntimeState,
    toolCall: AgentToolCall,
    _tool: AgentTool | undefined,
    result: AgentToolResult<unknown>,
  ): Promise<AgentToolResult<unknown>> {
    // Only track relevant tools
    const isCode = CODE_MODIFYING_TOOLS.has(toolCall.name);
    const isVerify = this.isVerifyAttempt(toolCall);

    if (!isCode && !isVerify) return result;

    // Verify failure: track error state but don't update verifiedGen
    if (result.isError) {
      if (isVerify) {
        const tracker = getTracker(state);
        tracker.lastVerifyOk = false;
        tracker.lastVerifyError = this.extractError(result);
      }
      return result;
    }

    const tracker = getTracker(state);

    // Increment codeGen on code-modifying tool success
    if (isCode) {
      tracker.codeGen++;
      const path = this.extractPath(toolCall);
      if (path) {
        tracker.changedFiles.push({
          generation: tracker.codeGen,
          toolName: toolCall.name,
          path,
        });
      }
    }

    // Update verification state
    if (isVerify) {
      tracker.verifiedGen = tracker.codeGen;
      tracker.lastVerifyOk = true;
      tracker.lastVerifyError = null;
    }

    return result;
  }

  private isVerifyAttempt(toolCall: AgentToolCall): boolean {
    if (toolCall.name === "verify" || toolCall.name === "VerifyCommand") return true;
    if (toolCall.name === "bash" || toolCall.name === "Bash") {
      const args = extractToolArgs(toolCall);
      const command = String(args.command ?? "").trim();
      return isVerifyCommand(command);
    }
    return false;
  }

  private extractPath(toolCall: AgentToolCall): string | null {
    const args = extractToolArgs(toolCall);
    const raw = args.path ?? args.file_path;
    const path = typeof raw === "string" ? raw.trim() : "";
    return path.length > 0 ? path : null;
  }

  private extractError(result: AgentToolResult<unknown>): string {
    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");
    return text.slice(0, 500);
  }
}

/**
 * Check if a command is a verification command (test, lint, typecheck).
 */
export function isVerifyCommand(command: string): boolean {
  const verifyPatterns = [
    /\bnpm\s+(run\s+)?test\b/,
    /\bpnpm\s+(run\s+)?test\b/,
    /\byarn\s+(run\s+)?test\b/,
    /\bvitest\b/,
    /\bjest\b/,
    /\bpytest\b/,
    /\bcargo\s+test\b/,
    /\bgo\s+test\b/,
    /\bnpm\s+(run\s+)?lint\b/,
    /\bpnpm\s+(run\s+)?lint\b/,
    /\bnpm\s+(run\s+)?typecheck\b/,
    /\bpnpm\s+(run\s+)?typecheck\b/,
    /\btsc\s+--noEmit\b/,
  ];
  return verifyPatterns.some((p) => p.test(command));
}

/**
 * Helper: check if there are unverified code changes.
 */
export function hasUnverifiedChanges(state: RuntimeState): boolean {
  const tracker = state.metadata[CHANGE_TRACKER_KEY] as TrackerState | undefined;
  if (!tracker) return false;
  return tracker.codeGen > tracker.verifiedGen;
}

/**
 * Helper: get the last verification error.
 */
export function getLastVerifyError(state: RuntimeState): string | null {
  const tracker = state.metadata[CHANGE_TRACKER_KEY] as TrackerState | undefined;
  return tracker?.lastVerifyError ?? null;
}

/**
 * Helper: check if last verification passed.
 */
export function isLastVerifyOk(state: RuntimeState): boolean {
  const tracker = state.metadata[CHANGE_TRACKER_KEY] as TrackerState | undefined;
  return tracker?.lastVerifyOk ?? false;
}

/**
 * Helper: get unverified file changes (files modified after last verification).
 * Filters by generation > verifiedGen, validates entry structure, deduplicates by path.
 */
export function getUnverifiedFiles(state: RuntimeState): ChangeEntry[] {
  const tracker = state.metadata[CHANGE_TRACKER_KEY] as TrackerState | undefined;
  if (!tracker || tracker.codeGen <= tracker.verifiedGen) return [];

  const changedFiles = tracker.changedFiles ?? [];
  const unverified = changedFiles.filter(
    (entry) =>
      typeof entry.generation === "number" &&
      typeof entry.path === "string" &&
      entry.path.trim().length > 0 &&
      typeof entry.toolName === "string" &&
      entry.toolName.length > 0 &&
      entry.generation > tracker.verifiedGen,
  );

  const latestByPath = new Map<string, ChangeEntry>();
  for (const entry of unverified) {
    const existing = latestByPath.get(entry.path);
    if (!existing || entry.generation > existing.generation) {
      latestByPath.set(entry.path, entry);
    }
  }

  return [...latestByPath.values()].sort((a, b) => a.generation - b.generation);
}
