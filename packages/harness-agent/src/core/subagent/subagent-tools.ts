import type { AgentTool } from "../types.js";
import { SubagentRunner } from "./subagent-runner.js";
import type { SubagentExecutor, SubagentTask } from "./types.js";
import { DEFAULT_TIMEOUT_MS } from "./types.js";

export interface SubagentToolsConfig {
  runner?: SubagentRunner;
  settingsPath?: string;
}

export function createSubagentTools(config: SubagentToolsConfig = {}): AgentTool[] {
  const runner = config.runner ?? new SubagentRunner();
  const activeTasks = new Map<string, { startTime: number; executor: SubagentExecutor }>();

  const spawnSubagent: AgentTool = {
    name: "spawn_subagent",
    label: "Spawn Subagent",
    description:
      "Spawn a subagent to execute a focused task. The subagent writes results to a JSON file. Use collect_result to retrieve results.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task description for the subagent" },
        executor: {
          type: "string",
          enum: ["claude", "codex", "harness-agent", "script"],
          description: "Which subagent to use",
        },
        constraints: {
          type: "array",
          items: { type: "string" },
          description: "Constraints the subagent must follow",
        },
        timeoutMs: {
          type: "number",
          description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
        },
        settingsPath: {
          type: "string",
          description: "Path to settings file for claude executor",
        },
      },
      required: ["task", "executor"],
    } as unknown as import("@sinclair/typebox").TSchema,
    execute: async (_toolCallId, params) => {
      const { task, executor, constraints, timeoutMs, settingsPath } = params as {
        task: string;
        executor: SubagentExecutor;
        constraints?: string[];
        timeoutMs?: number;
        settingsPath?: string;
      };

      const subagentId = runner.generateId();
      const resultPath = runner.getResultPath(subagentId);

      const subagentTask: SubagentTask = {
        id: subagentId,
        task,
        executor,
        constraints,
        timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
        settingsPath: settingsPath ?? config.settingsPath,
      };

      const { command, args } = runner.buildCommand(subagentTask);

      activeTasks.set(subagentId, { startTime: Date.now(), executor });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Subagent spawned: ${subagentId}`,
              `Executor: ${executor}`,
              `Command: ${command} ${args.join(" ")}`,
              `Result file: ${resultPath}`,
              `Timeout: ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
              "",
              "The subagent will write results to the JSON file.",
              "Use collect_result with this ID to retrieve results when done.",
            ].join("\n"),
          },
        ],
        details: { subagentId, command, args, resultPath },
      };
    },
  };

  const collectResult: AgentTool = {
    name: "collect_result",
    label: "Collect Result",
    description:
      "Collect and validate the result from a spawned subagent. Reads the JSON result file, validates the schema, and returns structured data.",
    parameters: {
      type: "object",
      properties: {
        subagentId: {
          type: "string",
          description: "The subagent ID returned by spawn_subagent",
        },
      },
      required: ["subagentId"],
    } as unknown as import("@sinclair/typebox").TSchema,
    execute: async (_toolCallId, params) => {
      const { subagentId } = params as { subagentId: string };
      const result = runner.collectResult(subagentId);
      const active = activeTasks.get(subagentId);

      if (result.success) {
        activeTasks.delete(subagentId);
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Subagent ${subagentId} completed successfully.`,
                `Summary: ${result.block?.currentWork ?? "N/A"}`,
                `Facts: ${result.block?.facts.length ?? 0} file references`,
                `Duration: ${result.durationMs}ms`,
              ].join("\n"),
            },
          ],
          details: { block: result.block, durationMs: result.durationMs },
        };
      }

      const isTimeout =
        active && Date.now() - active.startTime > (DEFAULT_TIMEOUT_MS);

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Subagent ${subagentId} result collection failed.`,
              `Error: ${result.error}`,
              `Type: ${result.errorType ?? "unknown"}`,
              isTimeout ? "The subagent may have timed out." : "",
              "",
              "The subagent may still be running. Try again later or check the result file manually.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        details: { error: result.error, errorType: result.errorType },
        isError: true,
      };
    },
  };

  return [spawnSubagent, collectResult];
}
