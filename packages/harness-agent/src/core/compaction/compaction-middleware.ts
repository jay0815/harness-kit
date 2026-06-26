import type { AgentMiddleware, RuntimeState } from "../types.js";
import { PRIORITY_GUARD } from "../types.js";
import type { ContextEngine } from "./context-engine.js";

export const COMPACTION_METADATA_KEY = "compaction";

export interface CompactionState {
  lastCompactionAt?: number;
  totalRemoved: number;
  compactionCount: number;
}

export class CompactionMiddleware implements AgentMiddleware {
  readonly priority = PRIORITY_GUARD - 5;
  readonly name = "Compaction";

  private engine: ContextEngine;

  constructor(engine: ContextEngine) {
    this.engine = engine;
  }

  async beforeModel(state: RuntimeState): Promise<void> {
    if (!this.engine.shouldCompact(state.tokenUsage)) return;

    const result = await this.engine.compact(state.context.messages, state.tokenUsage);

    const existing = (state.metadata[COMPACTION_METADATA_KEY] as CompactionState) ?? {
      totalRemoved: 0,
      compactionCount: 0,
    };

    state.metadata[COMPACTION_METADATA_KEY] = {
      lastCompactionAt: Date.now(),
      totalRemoved: existing.totalRemoved + result.removedCount,
      compactionCount: existing.compactionCount + 1,
    };
  }
}
