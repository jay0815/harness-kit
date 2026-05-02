import { execFileSync } from "node:child_process";
import type { PaneInfo } from "./types.js";

/** Error thrown when tmux operations fail */
export class PaneError extends Error {
  constructor(message: string, public readonly command: string) {
    super(message);
    this.name = "PaneError";
  }
}

function tmux(args: string[]): string {
  try {
    return execFileSync("tmux", args, { encoding: "utf-8", timeout: 10000 }).trim();
  } catch (err) {
    const cmd = `tmux ${args.join(" ")}`;
    throw new PaneError(
      `tmux failed: ${err instanceof Error ? err.message : String(err)}`,
      cmd,
    );
  }
}

function bridge(args: string[]): string {
  const bridgePath = process.env.TMUX_BRIDGE_PATH || "tmux-bridge";
  try {
    return execFileSync(bridgePath, args, { encoding: "utf-8", timeout: 10000 }).trim();
  } catch (err) {
    const cmd = `${bridgePath} ${args.join(" ")}`;
    throw new PaneError(
      `tmux-bridge failed: ${err instanceof Error ? err.message : String(err)}`,
      cmd,
    );
  }
}

/**
 * Create a new tmux pane in the current session.
 * Returns the pane ID (e.g. "%42").
 */
export function createPane(): string {
  // split-window -d (do not switch to new pane)
  return tmux(["split-window", "-d", "-P", "-F", "#{pane_id}"]);
}

/**
 * Label a pane for easy addressing.
 */
export function labelPane(paneId: string, label: string): void {
  bridge(["name", paneId, label]);
}

/**
 * Start a coding agent in a pane.
 * @param paneId Tmux pane ID
 * @param command Full command to launch the coding agent (e.g. "claude-code")
 */
export function startAgentInPane(paneId: string, command: string): void {
  // Satisfy read guard first
  bridge(["read", paneId, "5"]);
  bridge(["type", paneId, command]);
  bridge(["keys", paneId, "Enter"]);
}

/**
 * Send a text message to a pane (no Enter).
 */
export function typeToPane(paneId: string, text: string): void {
  bridge(["read", paneId, "5"]);
  bridge(["type", paneId, text]);
}

/**
 * Send special keys to a pane.
 */
export function sendKeysToPane(paneId: string, ...keys: string[]): void {
  bridge(["read", paneId, "5"]);
  bridge(["keys", paneId, ...keys]);
}

/**
 * Read last N lines from a pane.
 */
export function readPane(paneId: string, lines: number = 50): string {
  return bridge(["read", paneId, String(lines)]);
}

/**
 * Check if a pane process is still running.
 */
export function isPaneAlive(paneId: string): boolean {
  try {
    const panes = tmux(["list-panes", "-F", "#{pane_id}"]).split("\n");
    return panes.includes(paneId);
  } catch {
    return false;
  }
}

/**
 * Kill a pane.
 */
export function killPane(paneId: string): void {
  try {
    tmux(["kill-pane", "-t", paneId]);
  } catch {
    // Ignore errors (pane may already be dead)
  }
}

/**
 * List all panes in current session.
 */
export function listPanes(): PaneInfo[] {
  const output = bridge(["list"]);
  // Parse tmux-bridge list output:
  // TARGET SESSION:WIN SIZE PROCESS LABEL CWD
  // %3 0:0.0 80x24 zsh - /Users/...
  return output
    .split("\n")
    .slice(1) // skip header
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) return null;
      return {
        id: parts[0]!,
        label: parts[4] !== "-" ? parts[4]! : parts[0]!,
        executor: parts[3]!,
      };
    })
    .filter((p): p is PaneInfo => p !== null);
}
