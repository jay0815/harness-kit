import type { Model, StreamFn } from "./types.js";
import type { TaskEvaluation } from "./types.js";

// ─── Config ───────────────────────────────────────────────────────

export interface EvaluateTaskConfig {
  model: Model<any>;
  streamFn: StreamFn;
  /** Reserved for future evaluator context/tool boundaries */
  workspaceDir: string;
}

// ─── Source tracking (package-internal) ────────────────────────────

export interface TaskEvaluationWithSource {
  evaluation: TaskEvaluation;
  source: "model" | "fallback";
  error?: unknown;
}

// ─── System Prompt ─────────────────────────────────────────────────

const ASSESSMENT_SYSTEM_PROMPT = `You are a task evaluation agent. Your only job is to understand user input and produce a structured assessment.

Rules:
1. Determine if the user wants to "ask a question" or "execute a task"
2. If it's a task, assess complexity and risk
3. If the input is vague, point out what specifically needs clarification
4. Output strict JSON only, no other content

Complexity criteria:
- low: single file change, simple query, formatting
- medium: multi-file change, requires context understanding, involves tests
- high: architecture change, cross-module refactor, security/data related

Risk criteria:
- low: read-only, adding new code, documentation
- medium: modifying existing code, refactoring, dependency changes
- high: deleting code, database changes, security related, production operations

Output format (strict JSON):
{
  "understood": true/false,
  "taskOverview": "clear task description after organizing",
  "complexity": "low/medium/high",
  "complexityReason": "reason for complexity assessment",
  "risk": "low/medium/high",
  "riskReason": "reason for risk assessment",
  "needsExecution": true/false,
  "executor": "internal",
  "clarificationNeeded": "if understood=false, what needs clarification",
  "reasoning": "assessment reasoning process"
}`;

// ─── Conservative fallback ─────────────────────────────────────────

function conservativeFallback(_error?: unknown): TaskEvaluation {
  return {
    understood: false,
    taskOverview: "",
    complexity: "medium",
    complexityReason: "Evaluation failed or produced invalid output.",
    risk: "medium",
    riskReason: "The request could not be reliably assessed.",
    needsExecution: false,
    executor: "internal",
    clarificationNeeded:
      "I couldn't reliably assess this request. Could you clarify what you'd like me to do?",
    reasoning: "Evaluation failed or produced invalid structured output.",
  };
}

// ─── JSON parsing — multi-stage ────────────────────────────────────

function extractJson(text: string): unknown | null {
  // Stage 1: direct JSON.parse
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // Stage 2: fenced json code block
  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
      // continue
    }
  }

  // Stage 3: balanced-brace extractor
  const firstBrace = text.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    for (let i = firstBrace; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(firstBrace, i + 1));
        } catch {
          // continue
        }
        break;
      }
    }
  }

  return null;
}

function parseEvaluation(text: string): TaskEvaluation {
  const parsed = extractJson(text);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("No valid JSON found in evaluation response");
  }

  const p = parsed as Record<string, unknown>;

  // Core fields — missing = throw to trigger fallback
  if (typeof p.understood !== "boolean" || typeof p.taskOverview !== "string") {
    throw new Error("Missing required fields in evaluation response");
  }

  if (typeof p.needsExecution !== "boolean") {
    throw new Error("Missing needsExecution in evaluation response");
  }

  const validComplexity = ["low", "medium", "high"];
  const validRisk = ["low", "medium", "high"];

  if (!validComplexity.includes(p.complexity as string)) {
    throw new Error("Invalid or missing complexity");
  }
  if (!validRisk.includes(p.risk as string)) {
    throw new Error("Invalid or missing risk");
  }

  return {
    understood: p.understood,
    taskOverview: p.taskOverview,
    complexity: p.complexity as TaskEvaluation["complexity"],
    complexityReason: typeof p.complexityReason === "string" ? p.complexityReason : "",
    risk: p.risk as TaskEvaluation["risk"],
    riskReason: typeof p.riskReason === "string" ? p.riskReason : "",
    needsExecution: p.needsExecution,
    executor: "internal",
    clarificationNeeded:
      typeof p.clarificationNeeded === "string" ? p.clarificationNeeded : undefined,
    reasoning: typeof p.reasoning === "string" ? p.reasoning : "",
  };
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Evaluate a user message using an independent, single-turn LLM call.
 * No tools, no conversation history — pure context-isolated assessment.
 */
export async function evaluateTask(
  config: EvaluateTaskConfig,
  userMessage: string,
): Promise<TaskEvaluation> {
  const result = await evaluateTaskWithSource(config, userMessage);
  return result.evaluation;
}

/**
 * Like evaluateTask(), but also returns the source ("model" or "fallback")
 * so callers can distinguish LLM judgment from failure fallback.
 * Package-internal: not exported from index.ts.
 */
export async function evaluateTaskWithSource(
  config: EvaluateTaskConfig,
  userMessage: string,
): Promise<TaskEvaluationWithSource> {
  // Context isolation boundary: only raw user string, no conversation history
  const messages = [{ role: "user", content: [{ type: "text", text: userMessage }] }] as any[];

  let text: string;
  try {
    const stream = await config.streamFn(
      config.model,
      { messages, systemPrompt: ASSESSMENT_SYSTEM_PROMPT },
      {},
    );
    const result = await stream.result();

    if (result.stopReason === "error" || result.stopReason === "aborted") {
      const detail = result.errorMessage ? ` - ${result.errorMessage}` : "";
      throw new Error(`LLM response stopped: ${result.stopReason}${detail}`);
    }

    text = result.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text ?? "")
      .join("");
  } catch (err) {
    return {
      evaluation: conservativeFallback(err),
      source: "fallback",
      error: err,
    };
  }

  try {
    const evaluation = parseEvaluation(text);
    // Force normalize executor
    evaluation.executor = "internal";
    return { evaluation, source: "model" };
  } catch (err) {
    return {
      evaluation: conservativeFallback(err),
      source: "fallback",
      error: err,
    };
  }
}
