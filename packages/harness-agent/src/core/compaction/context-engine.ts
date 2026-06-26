import type { AgentMessage, TokenUsage } from "../types.js";
import type { CompactionConfig, CompactionResult, WikiEntry, WikiScore } from "./types.js";

export interface ContextEngineConfig extends CompactionConfig {
  wikiSummaryMaxTokens?: number;
}

export abstract class ContextEngine {
  protected config: Required<ContextEngineConfig>;

  constructor(config: ContextEngineConfig = {}) {
    this.config = {
      threshold: config.threshold ?? 0.75,
      keepRecentTurns: config.keepRecentTurns ?? 3,
      wikiDir: config.wikiDir ?? ".harness-kit/wiki",
      maxWikiRetries: config.maxWikiRetries ?? 2,
      minWikiScore: config.minWikiScore ?? 0.7,
      wikiSummaryMaxTokens: config.wikiSummaryMaxTokens ?? 500,
    };
  }

  abstract shouldCompact(tokenUsage: TokenUsage): boolean;
  abstract compact(messages: AgentMessage[], tokenUsage: TokenUsage): Promise<CompactionResult>;
  abstract getWikiSummary(): string;
  abstract searchMemory(query: string, scope?: "wiki" | "all"): Promise<string[]>;
  abstract setMessages(messages: AgentMessage[]): void;
  abstract getWikiEntries(): WikiEntry[];
  abstract addWikiEntry(entry: WikiEntry): void;
  abstract scoreWiki(entry: WikiEntry): Promise<WikiScore | null>;
}
