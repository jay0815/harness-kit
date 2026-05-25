import type { ResultBlock } from "./verify-types.js";

const BLOCK_START = "<HK_RESULT>";
const BLOCK_END = "</HK_RESULT>";

/**
 * Extract the last HK_RESULT block from pane output.
 * Returns null if no complete block is found.
 */
export function extractResultBlock(output: string): ResultBlock | null {
  const startIdx = output.lastIndexOf(BLOCK_START);
  if (startIdx === -1) return null;

  const endIdx = output.indexOf(BLOCK_END, startIdx);
  if (endIdx === -1) return null;

  const jsonStr = output.slice(startIdx + BLOCK_START.length, endIdx).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return validateResultBlock(parsed);
  } catch {
    return null;
  }
}

function validateResultBlock(parsed: unknown): ResultBlock | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;

  if (typeof p.currentWork !== "string") return null;

  const warnings: string[] = [];
  let facts: ResultBlock["facts"];

  if (Array.isArray(p.facts)) {
    const raw = p.facts;
    const validated = raw.map((f) => validateFact(f));
    const dropped = raw.length - validated.filter((f) => f !== null).length;
    if (dropped > 0) {
      warnings.push(`Dropped ${dropped} of ${raw.length} invalid facts`);
    }
    facts = validated.filter((f): f is NonNullable<typeof f> => f !== null);
  } else {
    facts = [];
  }

  return {
    currentWork: p.currentWork,
    facts,
    reasoning: typeof p.reasoning === "string" ? p.reasoning : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function validateFact(
  f: unknown,
): { file: string; startLine: number; endLine: number; exactText: string } | null {
  if (typeof f !== "object" || f === null) return null;
  const fact = f as Record<string, unknown>;

  if (typeof fact.file !== "string") return null;
  if (typeof fact.startLine !== "number" || fact.startLine < 1) return null;
  if (typeof fact.endLine !== "number" || fact.endLine < fact.startLine) return null;
  if (typeof fact.exactText !== "string") return null;

  return {
    file: fact.file,
    startLine: fact.startLine,
    endLine: fact.endLine,
    exactText: fact.exactText,
  };
}

/**
 * Check if pane output contains a complete result block.
 * Use this to poll for completion.
 */
export function hasCompleteResultBlock(output: string): boolean {
  const startIdx = output.lastIndexOf(BLOCK_START);
  if (startIdx === -1) return false;
  return output.indexOf(BLOCK_END, startIdx) !== -1;
}
