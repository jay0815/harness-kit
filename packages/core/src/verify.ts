import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
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
  if (isAbsolute(fact.file)) {
    return {
      fact,
      status: "FAIL",
      error: `Absolute path not allowed: ${fact.file}`,
    };
  }

  // Resolve workspace to real path (follows symlinks like macOS /var → /private/var)
  let realWorkspace: string;
  try {
    realWorkspace = realpathSync(workspaceDir);
  } catch {
    realWorkspace = workspaceDir;
  }

  const absPath = resolve(realWorkspace, fact.file);
  const rel = relative(realWorkspace, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      fact,
      status: "FAIL",
      error: `Path escapes workspace: ${fact.file}`,
    };
  }

  // Reject symlinks that point outside workspace
  let realAbsPath: string;
  try {
    realAbsPath = realpathSync(absPath);
  } catch {
    // File doesn't exist — readFileSync below will handle this
    realAbsPath = absPath;
  }
  const realRel = relative(realWorkspace, realAbsPath);
  if (realRel.startsWith("..") || isAbsolute(realRel)) {
    return {
      fact,
      status: "FAIL",
      error: `Symlink escapes workspace: ${fact.file}`,
    };
  }

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

  // Normalize CRLF to LF for consistent line handling
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const lines = normalizedContent.split("\n");
  const startIdx = fact.startLine - 1; // 1-indexed -> 0-indexed
  const endIdx = fact.endLine; // exclusive

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
