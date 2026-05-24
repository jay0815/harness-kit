import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { Fact } from "./types.js";
import {
  createPane,
  labelPane,
  startAgentInPane,
  typeToPane,
  sendKeysToPane,
  readPane,
  isPaneAlive,
} from "./pane.js";
import { extractResultBlock, hasCompleteResultBlock } from "./result-block.js";
import { verifyFacts } from "./verify.js";
import { emit } from "./telemetry.js";

/** In-memory registry of panes managed by this harness-kit session */
const paneRegistry = new Map<string, { id: string; executor: string }>();

/** Absolute path to workspace root */
let workspaceDir = process.cwd();

export function setWorkspaceDir(dir: string): void {
  workspaceDir = dir;
}

const startAgentSchema = Type.Object({
  role: Type.String({
    description: 'Role label for this agent, e.g. "executor" or "validator"',
  }),
  executor: Type.String({
    description: 'Command to launch the coding agent, e.g. "claude-code" or "codex"',
  }),
  contextFiles: Type.Optional(
    Type.Array(Type.String(), {
      description: "Files to pass as initial context (agent-specific)",
    }),
  ),
});

type StartAgentParams = Static<typeof startAgentSchema>;

/**
 * Tool: start_agent
 * Create a tmux pane, label it, and start a coding agent.
 */
export const startAgentTool: ToolDefinition<typeof startAgentSchema> = {
  name: "start_agent",
  label: "Start Agent",
  description:
    "Create a new tmux pane and launch a coding agent (claude-code, codex, etc.). " +
    "The agent will run in its own pane and can receive tasks via acp_send.",
  parameters: startAgentSchema,
  execute: async (_toolCallId, params: StartAgentParams) => {
    const t0 = Date.now();
    emit("tool_call", "start", { tool: "start_agent", role: params.role, executor: params.executor });
    try {
      const paneId = createPane();
      labelPane(paneId, params.role);
      emit("pane_event", "create", { paneId, role: params.role });

      let cmd = params.executor;
      if (params.contextFiles && params.contextFiles.length > 0) {
        // Escape paths with spaces using shell quoting
        const escapedFiles = params.contextFiles.map((f) => `'${f.replace(/'/g, "'\\''")}'`);
        cmd += ` ${escapedFiles.join(" ")}`;
      }

      startAgentInPane(paneId, cmd);
      paneRegistry.set(params.role, { id: paneId, executor: params.executor });

      return {
        content: [
          {
            type: "text",
            text: `Started ${params.executor} in pane ${paneId} as role "${params.role}"`,
          },
        ],
        details: { paneId, role: params.role },
      };
    } finally {
      emit("tool_call", "end", { tool: "start_agent", role: params.role }, Date.now() - t0);
    }
  },
};

const acpSendSchema = Type.Object({
  target: Type.String({ description: "Role label of target agent pane" }),
  task: Type.String({ description: "Task instructions for the agent" }),
  outputFormat: Type.Optional(
    Type.Array(Type.String(), {
      description: "Required fields in the HK_RESULT block",
    }),
  ),
});

type AcpSendParams = Static<typeof acpSendSchema>;

/**
 * Tool: acp_send
 * Send a structured task message to an agent pane.
 */
export const acpSendTool: ToolDefinition<typeof acpSendSchema> = {
  name: "acp_send",
  label: "ACP Send",
  description:
    "Send a task to a coding agent in a tmux pane. " +
    "The agent must respond with a <HK_RESULT> JSON block.",
  parameters: acpSendSchema,
  execute: async (_toolCallId, params: AcpSendParams) => {
    const t0 = Date.now();
    emit("tool_call", "start", { tool: "acp_send", target: params.target });
    try {
      const pane = paneRegistry.get(params.target);
      if (!pane) {
        emit("acp_msg", "send_error", { target: params.target, error: "AGENT_NOT_FOUND" });
        return {
          content: [{ type: "text", text: `Error: No agent found with role "${params.target}"` }],
          details: { error: "AGENT_NOT_FOUND" },
        };
      }

      if (!isPaneAlive(pane.id)) {
        emit("pane_event", "dead_detected", { paneId: pane.id, role: params.target });
        return {
          content: [{ type: "text", text: `Error: Pane for "${params.target}" is dead` }],
          details: { error: "PANE_DEAD" },
        };
      }

      const outputFormat = params.outputFormat || [
        "currentWork: describe what you did",
        "facts: array of {file, startLine, endLine, exactText}",
      ];

      const message = [
        `TASK: ${params.task}`,
        ``,
        `OUTPUT FORMAT — You MUST wrap your response in a <HK_RESULT> block:`,
        `<HK_RESULT>`,
        JSON.stringify({
          currentWork: "describe what you did in this task",
          facts: [
            {
              file: "relative/path/to/file.ts",
              startLine: 1,
              endLine: 3,
              exactText: "exact text as it appears in the file",
            },
          ],
          reasoning: "optional reasoning",
        }, null, 2),
        `</HK_RESULT>`,
        ``,
        `Required fields:`,
        ...outputFormat.map((f) => `- ${f}`),
      ].join("\n");

      typeToPane(pane.id, message);
      sendKeysToPane(pane.id, "Enter");
      emit("acp_msg", "send", { target: params.target, paneId: pane.id });

      return {
        content: [{ type: "text", text: `Task sent to "${params.target}"` }],
        details: { target: params.target },
      };
    } finally {
      emit("tool_call", "end", { tool: "acp_send", target: params.target }, Date.now() - t0);
    }
  },
};

const acpReadSchema = Type.Object({
  target: Type.String({ description: "Role label of agent pane to read" }),
  lines: Type.Optional(
    Type.Number({ default: 100, description: "Number of lines to read from pane" }),
  ),
});

type AcpReadParams = Static<typeof acpReadSchema>;

/**
 * Tool: acp_read
 * Read output from an agent pane and extract the latest HK_RESULT block.
 */
export const acpReadTool: ToolDefinition<typeof acpReadSchema> = {
  name: "acp_read",
  label: "ACP Read",
  description:
    "Read the latest output from a coding agent pane. " +
    "Returns the extracted <HK_RESULT> block if present, or indicates that the agent is still working.",
  parameters: acpReadSchema,
  execute: async (_toolCallId, params: AcpReadParams) => {
    const t0 = Date.now();
    emit("tool_call", "start", { tool: "acp_read", target: params.target });
    try {
      const pane = paneRegistry.get(params.target);
      if (!pane) {
        return {
          content: [{ type: "text", text: `Error: No agent found with role "${params.target}"` }],
          details: { error: "AGENT_NOT_FOUND" },
        };
      }

      const output = readPane(pane.id, params.lines ?? 100);
      const result = extractResultBlock(output);

      if (result) {
        emit("acp_msg", "read", { target: params.target, status: "COMPLETE", factCount: result.facts.length });
        return {
          content: [
            {
              type: "text",
              text: `Agent "${params.target}" has responded:\n\nCurrent work: ${result.currentWork}\nFacts cited: ${result.facts.length}`,
            },
          ],
          details: { status: "COMPLETE", result },
        };
      }

      const hasBlock = hasCompleteResultBlock(output);
      if (hasBlock) {
        emit("acp_msg", "read", { target: params.target, status: "MALFORMED" });
        return {
          content: [
            {
              type: "text",
              text: `Agent "${params.target}" produced a <HK_RESULT> block but it could not be parsed. Raw output:\n${output.slice(-500)}`,
            },
          ],
          details: { status: "MALFORMED", output: output.slice(-500) },
        };
      }

      emit("acp_msg", "read", { target: params.target, status: "PENDING" });
      return {
        content: [
          {
            type: "text",
            text: `Agent "${params.target}" is still working. No <HK_RESULT> block found yet.`,
          },
        ],
        details: { status: "PENDING" },
      };
    } finally {
      emit("tool_call", "end", { tool: "acp_read", target: params.target }, Date.now() - t0);
    }
  },
};

const hardVerifySchema = Type.Object({
  facts: Type.Array(
    Type.Object({
      file: Type.String(),
      startLine: Type.Number(),
      endLine: Type.Number(),
      exactText: Type.String(),
    }),
    { description: "Facts to verify" },
  ),
});

type HardVerifyParams = Static<typeof hardVerifySchema>;

/**
 * Tool: hard_verify
 * Run hard verification on facts from an agent's result block.
 */
export const hardVerifyTool: ToolDefinition<typeof hardVerifySchema> = {
  name: "hard_verify",
  label: "Hard Verify",
  description:
    "Verify that facts claimed by an agent match actual files on disk. " +
    "Checks file path, line range, and exact text. Does NOT judge correctness of conclusions.",
  parameters: hardVerifySchema,
  execute: async (_toolCallId, params: HardVerifyParams) => {
    const t0 = Date.now();
    emit("tool_call", "start", { tool: "hard_verify", factCount: params.facts.length });
    try {
      const report = verifyFacts(params.facts as Fact[], workspaceDir);

      const passCount = report.checks.filter((c) => c.status === "PASS").length;
      const failCount = report.checks.filter((c) => c.status === "FAIL").length;
      emit("verify_run", "complete", {
        overall: report.overall,
        passCount,
        failCount,
        totalFacts: params.facts.length,
      });

      const lines: string[] = [
        `Hard Verification: ${report.overall}`,
        ``,
        ...report.checks.map((check) => {
          const f = check.fact;
          if (check.status === "PASS") {
            return `✓ ${f.file}:${f.startLine}-${f.endLine}`;
          }
          if (check.error) {
            return `✗ ${f.file}:${f.startLine}-${f.endLine} — ${check.error}`;
          }
          return `✗ ${f.file}:${f.startLine}-${f.endLine} — text mismatch\n  Claimed: ${f.exactText.slice(0, 80)}\n  Actual:  ${check.actual?.slice(0, 80) ?? "N/A"}`;
        }),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: report,
      };
    } finally {
      emit("tool_call", "end", { tool: "hard_verify" }, Date.now() - t0);
    }
  },
};

/** All harness-kit tools */
export const harnessKitTools: ToolDefinition[] = [
  startAgentTool,
  acpSendTool,
  acpReadTool,
  hardVerifyTool,
];
