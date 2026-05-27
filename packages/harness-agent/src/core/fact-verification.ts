import type { AgentMiddleware, AfterModelResult, LLMResponse, RuntimeState } from "./types.js";
import type { ResultBlock, VerifyReport } from "./verify-types.js";
import { extractResultBlock } from "./result-block.js";
import { verifyFacts } from "./verify.js";

export type VerificationMode = "strict" | "warn" | "off";

export type FactVerificationMetadata = {
  status: "missing" | "empty" | "pass" | "fail";
  block: ResultBlock | null;
  report: VerifyReport | null;
  timestamp: number;
};

export const FACT_VERIFICATION_KEY = "fact_verification";

export interface FactVerificationConfig {
  mode: VerificationMode;
  maxRetries: number; // retry 次数，不是总 attempts。0 = 第一次失败直接 fail
  workspaceDir: string;
}

export class FactVerificationMiddleware implements AgentMiddleware {
  // Finalizer: must run after all other afterModel middleware.
  // If any middleware mutates response.content (e.g. QualityGate injects tool call),
  // FactVerification sees the final state and skips verification on tool-call turns.
  // Reserved: do not use priority >= MAX_SAFE_INTEGER for user middleware.
  priority = Number.MAX_SAFE_INTEGER;
  name = "FactVerification";
  private retryCount = 0; // prompt scoped: 每次 prompt() 创建新实例
  private readonly maxRetries: number;

  constructor(private readonly config: FactVerificationConfig) {
    this.maxRetries = Math.max(0, config.maxRetries);
  }

  async afterModel(state: RuntimeState, response: LLMResponse): Promise<AfterModelResult> {
    // Clear stale metadata from previous turn before any checks
    delete state.metadata[FACT_VERIFICATION_KEY];

    if (this.config.mode === "off") {
      return { action: "accept", response };
    }

    // tool-call turn 跳过 — LLM 返回工具调用时没有 <HK_RESULT>
    const hasToolCalls = response.content.some((c) => c.type === "toolCall");
    if (hasToolCalls) {
      return { action: "accept", response };
    }

    // 从 response content 提取文本
    const text = response.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");

    const block = extractResultBlock(text);
    const now = Date.now();

    // <HK_RESULT> 缺失
    if (!block) {
      if (this.config.mode === "warn") {
        state.metadata[FACT_VERIFICATION_KEY] = {
          status: "missing",
          block: null,
          report: null,
          timestamp: now,
        };
        return { action: "accept", response };
      }
      // strict
      if (this.retryCount >= this.maxRetries) {
        return { action: "fail", reason: "Missing <HK_RESULT> block after max retries" };
      }
      this.retryCount++;
      return {
        action: "retry",
        feedback:
          "[Fact Verification] No <HK_RESULT> block found. Output a <HK_RESULT> block declaring your work.",
      };
    }

    // 有非法 facts 被 parser 丢弃（放在 empty 之前，区分"没给 facts"和"给了但格式全错"）
    if (block.warnings?.length) {
      if (this.config.mode === "warn") {
        state.metadata[FACT_VERIFICATION_KEY] = {
          status: "fail",
          block,
          report: null,
          timestamp: now,
        };
        return { action: "accept", response };
      }
      if (this.retryCount >= this.maxRetries) {
        return { action: "fail", reason: "Invalid facts in <HK_RESULT> after max retries" };
      }
      this.retryCount++;
      return {
        action: "retry",
        feedback: `[Fact Verification] Invalid facts in <HK_RESULT>:\n${block.warnings.join("\n")}\nFix the fact schema and output a corrected <HK_RESULT> block.`,
      };
    }

    // facts 为空（无 warnings，说明模型确实没给 facts）
    if (block.facts.length === 0) {
      if (this.config.mode === "warn") {
        state.metadata[FACT_VERIFICATION_KEY] = {
          status: "empty",
          block,
          report: null,
          timestamp: now,
        };
        return { action: "accept", response };
      }
      if (this.retryCount >= this.maxRetries) {
        return { action: "fail", reason: "Empty facts in <HK_RESULT> after max retries" };
      }
      this.retryCount++;
      return {
        action: "retry",
        feedback:
          "[Fact Verification] <HK_RESULT> has no facts. Add at least one fact with file, startLine, endLine, exactText.",
      };
    }

    // 校验 facts
    const report = verifyFacts(block.facts, this.config.workspaceDir);

    // 存入 metadata（strict 和 warn 都写）
    const status = report.overall === "PASS" ? "pass" : "fail";
    state.metadata[FACT_VERIFICATION_KEY] = { status, block, report, timestamp: now };

    if (report.overall === "PASS") {
      this.retryCount = 0;
      return { action: "accept", response };
    }

    // FAIL
    if (this.config.mode === "warn") {
      return { action: "accept", response };
    }

    // strict
    if (this.retryCount >= this.maxRetries) {
      return { action: "fail", reason: "Fact verification failed after max retries" };
    }
    this.retryCount++;

    const failures = report.checks
      .filter((c) => c.status === "FAIL")
      .map((c) => {
        const reason = c.error ?? `text mismatch (expected: ${c.fact.exactText.slice(0, 60)}...)`;
        return `  ✗ ${c.fact.file}:${c.fact.startLine}-${c.fact.endLine} — ${reason}`;
      })
      .join("\n");

    return {
      action: "retry",
      feedback: `[Fact Verification] FAIL:\n${failures}\nFix the incorrect facts and output a corrected <HK_RESULT> block.`,
    };
  }
}
