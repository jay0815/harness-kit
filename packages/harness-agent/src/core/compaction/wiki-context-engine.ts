import type { AgentMessage, TokenUsage } from "../types.js";
import type { WikiGeneratorConfig } from "./wiki-generator.js";
import { generateWikiWithRetry } from "./wiki-generator.js";
import { ContextEngine, type ContextEngineConfig } from "./context-engine.js";
import type { CompactionResult, WikiEntry, WikiScore } from "./types.js";

export interface WikiContextEngineConfig extends ContextEngineConfig {
  generator?: WikiGeneratorConfig;
}

export class WikiContextEngine extends ContextEngine {
  private wikiEntries: WikiEntry[] = [];
  private wikiSummary = "";
  private generator?: WikiGeneratorConfig;
  private pendingJob: Promise<void> | null = null;
  private messagesRef: AgentMessage[] = [];

  constructor(config: WikiContextEngineConfig = {}) {
    super(config);
    this.generator = config.generator;
  }

  shouldCompact(tokenUsage: TokenUsage): boolean {
    if (tokenUsage.contextWindow <= 0) return false;
    return tokenUsage.totalTokens / tokenUsage.contextWindow >= this.config.threshold;
  }

  async compact(messages: AgentMessage[], _tokenUsage: TokenUsage): Promise<CompactionResult> {
    const keepTurns = this.config.keepRecentTurns * 2;
    const removeCount = Math.max(0, messages.length - keepTurns);

    if (removeCount === 0) {
      return { removedCount: 0, summaryTokens: 0, trigger: "threshold" };
    }

    const toCompact = messages.slice(0, removeCount);
    const remaining = messages.slice(removeCount);

    messages.length = 0;
    messages.push(...remaining);

    const summaryMsg = this.buildSummaryMessage(toCompact);
    messages.unshift(summaryMsg);

    const summaryTokens = this.estimateTokens(JSON.stringify(summaryMsg));

    if (this.generator) {
      const job = this.runWikiGeneration(toCompact, [0, removeCount]);
      this.pendingJob = job;
      job.finally(() => {
        if (this.pendingJob === job) this.pendingJob = null;
      });
    }

    return {
      removedCount: removeCount,
      summaryTokens,
      trigger: "threshold",
    };
  }

  getWikiSummary(): string {
    return this.wikiSummary;
  }

  setMessages(messages: AgentMessage[]): void {
    this.messagesRef = messages;
  }

  async searchMemory(query: string, scope: "wiki" | "all" = "wiki"): Promise<string[]> {
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();

    for (const entry of this.wikiEntries) {
      const fields = [
        entry.projectGoals,
        entry.completedWork,
        entry.keyDecisions,
        entry.fileChanges,
        entry.problemsAndSolutions,
        entry.unfinishedTasks,
      ];

      for (const field of fields) {
        if (field.toLowerCase().includes(lowerQuery)) {
          results.push(field);
        }
      }
    }

    if (scope === "all") {
      if (this.wikiSummary && this.wikiSummary.toLowerCase().includes(lowerQuery)) {
        results.push(this.wikiSummary);
      }

      for (const msg of this.messagesRef) {
        if (!("role" in msg) || !("content" in msg) || !Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
          if (block.type === "text" && "text" in block && typeof block.text === "string") {
            if (block.text.toLowerCase().includes(lowerQuery)) {
              results.push(block.text);
            }
          }
        }
      }
    }

    return results;
  }

  getWikiEntries(): WikiEntry[] {
    return [...this.wikiEntries];
  }

  addWikiEntry(entry: WikiEntry): void {
    this.wikiEntries.push(entry);
    this.updateSummary();
  }

  async scoreWiki(entry: WikiEntry): Promise<WikiScore | null> {
    if (!this.generator) return null;
    const { scoreWiki } = await import("./wiki-generator.js");
    return scoreWiki(this.generator, entry);
  }

  async waitForPending(): Promise<void> {
    if (this.pendingJob) await this.pendingJob;
  }

  private buildSummaryMessage(messages: AgentMessage[]): AgentMessage {
    const parts: string[] = ["[Compaction Summary]"];
    parts.push(`Compacted ${messages.length} messages at ${new Date().toISOString()}.`);
    parts.push("Use search_memory tool to retrieve details from earlier conversation.");

    return {
      role: "user",
      content: [{ type: "text", text: parts.join("\n") }],
      timestamp: Date.now(),
    } as AgentMessage;
  }

  private async runWikiGeneration(
    messages: AgentMessage[],
    range: [number, number],
  ): Promise<void> {
    if (!this.generator) return;

    const { entry } = await generateWikiWithRetry(
      this.generator,
      messages,
      range,
      this.config.maxWikiRetries,
      this.config.minWikiScore,
    );

    if (entry) {
      this.wikiEntries.push(entry);
      this.updateSummary();
    }
  }

  private updateSummary(): void {
    if (this.wikiEntries.length === 0) {
      this.wikiSummary = "";
      return;
    }

    const latest = this.wikiEntries[this.wikiEntries.length - 1];
    const parts: string[] = [];

    if (latest.projectGoals) parts.push(`Goals: ${latest.projectGoals}`);
    if (latest.completedWork) parts.push(`Done: ${latest.completedWork}`);
    if (latest.unfinishedTasks) parts.push(`Todo: ${latest.unfinishedTasks}`);

    this.wikiSummary = parts.join(" | ").slice(0, this.config.wikiSummaryMaxTokens * 4);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
