import type { AgentMessage } from "../types.js";

export interface CompactionResult {
  removedCount: number;
  summaryTokens: number;
  trigger: "threshold" | "manual";
  wikiJobId?: string;
}

export interface WikiEntry {
  id: string;
  timestamp: number;
  projectGoals: string;
  completedWork: string;
  keyDecisions: string;
  fileChanges: string;
  problemsAndSolutions: string;
  unfinishedTasks: string;
  sourceMessageRange: [number, number];
}

export interface WikiScore {
  completeness: number;
  accuracy: number;
  conciseness: number;
  overall: number;
}

export interface CompactionConfig {
  threshold?: number;
  keepRecentTurns?: number;
  wikiDir?: string;
  maxWikiRetries?: number;
  minWikiScore?: number;
}

export interface SerializedMessages {
  messages: AgentMessage[];
  startIndex: number;
  endIndex: number;
}
