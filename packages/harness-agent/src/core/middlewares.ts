import type {
  AgentMiddleware,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  LLMResponse,
  RuntimeState,
} from "./types.js";
import { PRIORITY_EVAL, PRIORITY_GUARD, PRIORITY_INJECT } from "./types.js";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "./types.js";
import {
  hasUnverifiedChanges,
  isLastVerifyOk,
  getLastVerifyError,
  getUnverifiedFiles,
  isVerifyCommand,
} from "./change-tracker.js";
import { extractToolArgs } from "./tool-utils.js";

/**
 * VerificationGuidanceMiddleware — injects guidance after verification results.
 * Priority: 60 (after inject, before extract)
 */
export class VerificationGuidanceMiddleware implements AgentMiddleware {
  priority = PRIORITY_INJECT + 10; // 60
  name = "VerificationGuidance";

  async afterTool(
    state: RuntimeState,
    toolCall: AgentToolCall,
    _tool: AgentTool | undefined,
    result: AgentToolResult<unknown>,
  ): Promise<AgentToolResult<unknown>> {
    if (!isVerifyTool(toolCall)) return result;

    if (isLastVerifyOk(state)) {
      // Append success guidance
      result.content.push({
        type: "text" as const,
        text: "\n[Guidance] Verification passed. You may proceed to the next step.",
      });
    } else {
      const error = getLastVerifyError(state);
      const unverified = getUnverifiedFiles(state);
      const fileList =
        unverified.length > 0 ? `\nChanged files: ${unverified.map((f) => f.path).join(", ")}` : "";
      result.content.push({
        type: "text" as const,
        text: `\n[Guidance] Verification failed: ${error ?? "unknown error"}${fileList}\nFix the issue before continuing.`,
      });
    }

    return result;
  }
}

/**
 * ToolCallGuardrailMiddleware — tracks per-turn patterns and blocks problematic behavior.
 * Priority: 10 (guard level)
 *
 * Tracks:
 * - Same error repeated multiple times
 * - Same tool failing repeatedly
 * - No-progress loops (idempotent tools returning same result)
 */
export class ToolCallGuardrailMiddleware implements AgentMiddleware {
  priority = PRIORITY_GUARD;
  name = "ToolCallGuardrail";

  private turnFailures: Map<string, number> = new Map();
  private toolFailures: Map<string, number> = new Map();
  private warnThreshold = 3;
  private blockThreshold = 5;

  async beforeTool(
    state: RuntimeState,
    toolCall: AgentToolCall,
    _tool: AgentTool | undefined,
  ): Promise<AgentToolResult<unknown> | null> {
    const failureCount = this.toolFailures.get(toolCall.name) ?? 0;

    if (failureCount >= this.blockThreshold) {
      return {
        content: [
          {
            type: "text" as const,
            text: `[Guardrail] Tool "${toolCall.name}" has failed ${failureCount} times. Blocked.`,
          },
        ],
        details: null,
        isError: true,
      };
    }

    if (failureCount >= this.warnThreshold) {
      // Warn but allow
      state.metadata[`guardrail_warn_${toolCall.name}`] = true;
    }

    return null;
  }

  async afterTool(
    _state: RuntimeState,
    toolCall: AgentToolCall,
    _tool: AgentTool | undefined,
    result: AgentToolResult<unknown>,
  ): Promise<AgentToolResult<unknown>> {
    if (result.isError) {
      const count = (this.toolFailures.get(toolCall.name) ?? 0) + 1;
      this.toolFailures.set(toolCall.name, count);
    } else {
      // Reset on success
      this.toolFailures.delete(toolCall.name);
    }

    return result;
  }

  reset(): void {
    this.turnFailures.clear();
    this.toolFailures.clear();
  }
}

/**
 * QualityGateMiddleware — uses synthetic tool call to block completion when there are unverified changes.
 * Priority: 95 (eval level)
 */
export class QualityGateMiddleware implements AgentMiddleware {
  priority = PRIORITY_EVAL;
  name = "QualityGate";
  private sentFeedback = false;

  async afterModel(state: RuntimeState, response: LLMResponse): Promise<LLMResponse> {
    // If the model is trying to finish but there are unverified changes, inject a synthetic tool call
    if (!hasUnverifiedChanges(state)) return response;
    if (this.sentFeedback) return response; // Don't loop

    const hasToolCalls = response.content.some((c) => c.type === "toolCall");
    if (hasToolCalls) return response; // Model is still working

    // Model is trying to finish — inject synthetic tool call
    this.sentFeedback = true;
    response.content.push({
      type: "toolCall" as const,
      id: `quality_gate_${Date.now()}`,
      name: "__quality_gate__",
      arguments: {
        message: "You have unverified code changes. Run verification before finishing.",
      },
    } satisfies Extract<AssistantMessage["content"][number], { type: "toolCall" }>);

    return response;
  }

  async beforeTool(
    state: RuntimeState,
    toolCall: AgentToolCall,
    _tool: AgentTool | undefined,
  ): Promise<AgentToolResult<unknown> | null> {
    if (toolCall.name !== "__quality_gate__") return null;

    this.sentFeedback = false;

    const unverified = getUnverifiedFiles(state);

    if (unverified.length > 0) {
      const fileList = unverified.map((f) => `  - ${f.path} (${f.toolName})`).join("\n");
      return {
        content: [
          {
            type: "text" as const,
            text: `[QualityGate] You have unverified changes in ${unverified.length} file(s):\n${fileList}\nRun verification (test, lint, typecheck) before finishing.`,
          },
        ],
        details: null,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: "[QualityGate] You have unverified code changes, but file paths were not captured. Run verification (test, lint, typecheck) before finishing.",
        },
      ],
      details: null,
    };
  }
}

/**
 * IntentGateMiddleware — forces the LLM to verbalize its plan before executing.
 * Priority: 50 (inject level)
 */
export class IntentGateMiddleware implements AgentMiddleware {
  priority = PRIORITY_INJECT;
  name = "IntentGate";
  private planVerbalized = false;

  async beforeModel(state: RuntimeState): Promise<void> {
    if (this.planVerbalized) return;

    // Inject a reminder to verbalize the plan
    state.context.messages.push({
      role: "user" as const,
      content: "[System] Before executing, briefly describe your plan in 1-2 sentences.",
    } as AgentMessage);

    this.planVerbalized = true;
  }

  reset(): void {
    this.planVerbalized = false;
  }
}

function isVerifyTool(toolCall: AgentToolCall): boolean {
  if (toolCall.name === "verify" || toolCall.name === "VerifyCommand") return true;
  if (toolCall.name === "bash" || toolCall.name === "Bash") {
    const args = extractToolArgs(toolCall);
    const command = String(args.command ?? "").trim();
    return isVerifyCommand(command);
  }
  return false;
}
