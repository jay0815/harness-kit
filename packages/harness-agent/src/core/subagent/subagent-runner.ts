import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ResultBlock } from "../verify-types.js";
import type {
  SubagentTask,
  SubagentResult,
  SubagentResultFile,
} from "./types.js";
import { RESULT_DIR } from "./types.js";

export interface SubagentRunnerConfig {
  resultDir?: string;
}

export class SubagentRunner {
  private resultDir: string;
  private counter = 0;
  private activeTasks = new Set<string>();

  constructor(config: SubagentRunnerConfig = {}) {
    this.resultDir = config.resultDir ?? RESULT_DIR;
  }

  generateId(): string {
    this.counter++;
    const id = `${Date.now().toString(36)}-${this.counter}`;
    this.activeTasks.add(id);
    return id;
  }

  getResultPath(subagentId: string): string {
    return join(this.resultDir, `hk-result-${subagentId}.json`);
  }

  getActive(): string[] {
    return [...this.activeTasks];
  }

  collectResult(subagentId: string): SubagentResult {
    const path = this.getResultPath(subagentId);
    const startTime = Date.now();

    if (!existsSync(path)) {
      this.activeTasks.delete(subagentId);
      return {
        success: false,
        subagentId,
        error: "No result file found",
        errorType: "no_result",
        durationMs: 0,
      };
    }

    const parsed = parseResultFile(path);
    if (!parsed) {
      this.activeTasks.delete(subagentId);
      return {
        success: false,
        subagentId,
        error: "Invalid JSON in result file",
        errorType: "invalid_json",
        durationMs: Date.now() - startTime,
      };
    }

    if (!validateResultFile(parsed)) {
      this.activeTasks.delete(subagentId);
      return {
        success: false,
        subagentId,
        error: "Result does not match required schema",
        errorType: "invalid_schema",
        durationMs: Date.now() - startTime,
      };
    }

    const block = toResultBlock(parsed);

    try {
      unlinkSync(path);
    } catch {
      // ignore cleanup errors
    }

    this.activeTasks.delete(subagentId);

    return {
      success: true,
      subagentId,
      block,
      durationMs: Date.now() - startTime,
    };
  }

  clearActive(subagentId: string): void {
    this.activeTasks.delete(subagentId);
  }

  buildCommand(task: SubagentTask): { command: string; args: string[] } {
    const resultPath = this.getResultPath(task.id);
    const prompt = buildSubagentPrompt(task, resultPath);

    switch (task.executor) {
      case "claude":
        return buildClaudeCommand(prompt, task, resultPath);
      case "codex":
        return buildCodexCommand(prompt, task);
      case "harness-agent":
        return buildHarnessAgentCommand(prompt, task);
      case "script":
        return buildScriptCommand(prompt, task);
    }
  }
}

export function buildSubagentPrompt(task: SubagentTask, resultPath?: string): string {
  const outputPath = resultPath ?? join(RESULT_DIR, `hk-result-${task.id}.json`);
  const constraints = (task.constraints ?? []).map((c) => `- ${c}`).join("\n");

  return `You are a focused coding agent. Complete the assigned task.

## Task
${task.task}

${constraints ? `## Constraints\n${constraints}\n` : ""}## Output Requirements

After completing the task, write the result as JSON to: ${outputPath}

JSON format:
{
  "summary": "Brief description of what was done",
  "currentWork": "Detailed description of current work",
  "facts": [
    {
      "file": "relative/path/to/file.ts",
      "startLine": 10,
      "endLine": 20,
      "exactText": "exact text from the file"
    }
  ],
  "reasoning": "Optional reasoning process"
}

## Rules
- Focus ONLY on the assigned task
- Every modified file must be cited in facts
- exactText must be the exact text from the file after changes
- Write the JSON file ONCE when done
- Do not modify files outside the task scope`;
}

export function parseResultFile(filePath: string): SubagentResultFile | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    return parsed as SubagentResultFile;
  } catch {
    return null;
  }
}

export function validateResultFile(data: SubagentResultFile): boolean {
  if (typeof data !== "object" || data === null) return false;
  if (typeof data.summary !== "string") return false;
  if (typeof data.currentWork !== "string") return false;
  if (!Array.isArray(data.facts)) return false;

  for (const fact of data.facts) {
    if (typeof fact !== "object" || fact === null) return false;
    if (typeof fact.file !== "string") return false;
    if (typeof fact.startLine !== "number") return false;
    if (typeof fact.endLine !== "number") return false;
    if (typeof fact.exactText !== "string") return false;
  }

  return true;
}

function toResultBlock(data: SubagentResultFile): ResultBlock {
  return {
    currentWork: data.currentWork,
    facts: data.facts.map((f) => ({
      file: f.file,
      startLine: f.startLine,
      endLine: f.endLine,
      exactText: f.exactText,
    })),
    reasoning: data.reasoning,
  };
}

function buildClaudeCommand(
  prompt: string,
  task: SubagentTask,
  resultPath: string,
): { command: string; args: string[] } {
  const args = ["-p"];
  if (task.settingsPath) {
    args.push("--settings", task.settingsPath);
  }
  // Prompt must come before --add-dir
  args.push(prompt);
  // Grant write access to the result file directory
  const resultDir = resultPath.substring(0, resultPath.lastIndexOf("/"));
  args.push("--add-dir", resultDir);
  return { command: "claude", args };
}

function buildCodexCommand(prompt: string, _task: SubagentTask): { command: string; args: string[] } {
  return { command: "codex", args: ["exec", prompt] };
}

function buildHarnessAgentCommand(prompt: string, _task: SubagentTask): { command: string; args: string[] } {
  return { command: "harness-agent", args: ["--prompt", prompt] };
}

function buildScriptCommand(prompt: string, task: SubagentTask): { command: string; args: string[] } {
  const cmd = task.executorCommand ?? "echo";
  return { command: cmd, args: [prompt] };
}
