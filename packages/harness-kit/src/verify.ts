import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Fact, VerifyReport, VerifyCheck } from "./types.js";

/**
 * Verify all facts in a ResultBlock against disk.
 * @param facts Facts claimed by the agent
 * @param workspaceDir Absolute path to workspace root
 */
export function verifyFacts(facts: Fact[], workspaceDir: string): VerifyReport {
  const checks: VerifyCheck[] = facts.map((fact) => verifyOneFact(fact, workspaceDir));
  const allPass = checks.every((c) => c.status === "PASS");

  return {
    overall: allPass ? "PASS" : "FAIL",
    checks,
  };
}

function verifyOneFact(fact: Fact, workspaceDir: string): VerifyCheck {
  const absPath = resolve(workspaceDir, fact.file);

  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch (err) {
    return {
      fact,
      status: "FAIL",
      error: `Cannot read file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const lines = content.split("\n");
  const startIdx = fact.startLine - 1; // 1-indexed -> 0-indexed
  const endIdx = fact.endLine;         // exclusive

  if (startIdx < 0 || startIdx >= lines.length) {
    return {
      fact,
      status: "FAIL",
      error: `startLine ${fact.startLine} out of range (file has ${lines.length} lines)`,
    };
  }

  if (endIdx > lines.length) {
    return {
      fact,
      status: "FAIL",
      error: `endLine ${fact.endLine} out of range (file has ${lines.length} lines)`,
    };
  }

  const actualText = lines.slice(startIdx, endIdx).join("\n");

  if (actualText !== fact.exactText) {
    return {
      fact,
      status: "FAIL",
      actual: actualText,
    };
  }

  return { fact, status: "PASS" };
}
