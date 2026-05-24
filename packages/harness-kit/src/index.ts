import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { harnessKitTools, setWorkspaceDir } from "./tools.js";
import { createDefaultWorkflow } from "./workflow.js";
import { initTelemetry, close as closeTelemetry } from "./telemetry.js";

/**
 * Harness-kit PI Extension entry point.
 *
 * Usage in pi:
 *   pi --extension path/to/harness-kit/dist/index.js
 *
 * Or load via pi's extension discovery.
 */
export default function harnessKitExtension(pi: ExtensionAPI) {
  const workflow = createDefaultWorkflow();
  const harnessPrompt = buildHarnessPrompt(workflow);

  pi.on("session_start", (_event, ctx) => {
    setWorkspaceDir(ctx.cwd);
    initTelemetry();
  });

  pi.on("session_shutdown", () => {
    closeTelemetry();
  });

  // Register all harness-kit tools
  for (const tool of harnessKitTools) {
    pi.registerTool(tool);
  }

  // Inject harness-kit workflow instructions into system prompt
  pi.on("before_agent_start", (event) => {
    const combined = event.systemPrompt + "\n\n" + harnessPrompt;
    return { systemPrompt: combined };
  });
}

function buildHarnessPrompt(workflow: ReturnType<typeof createDefaultWorkflow>): string {
  const phaseList = workflow.phases
    .map((p, i) => `${i + 1}. ${p.name} (executor: ${p.executor}, humanConfirm: ${p.humanConfirm})`)
    .join("\n");

  return `## harness-kit Workflow Orchestrator

You are the harness-kit orchestrator. Your job is to drive coding agents through a structured workflow using the tools available to you.

### Current Workflow: ${workflow.name}
${workflow.description}

### Phases
${phaseList}

### How to drive a phase

1. **Start the executor agent** with \`start_agent\`:
   - role: "executor" or "validator"
   - executor: the coding agent command (e.g. "claude-code", "codex")

2. **Send the task** with \`acp_send\`:
   - target: the role you started
   - task: the phase prompt + any context
   - The agent will respond with a \`<HK_RESULT>\` block

3. **Poll for response** with \`acp_read\`:
   - target: the same role
   - Check the \`status\` in the result details:
     - "COMPLETE": agent finished, result block extracted
     - "PENDING": agent still working, wait and read again
     - "MALFORMED": agent produced a block but JSON is bad

4. **Verify facts** with \`hard_verify\`:
   - Pass the \`facts\` array from the result block
   - If overall is "FAIL", STOP and report the failure

5. **Human confirmation** (if phase.humanConfirm is true):
   - Summarize the result for the user
   - Ask for confirmation before proceeding

6. **Validation phase** (after executor completes):
   - Start a validator agent (different executor)
   - Send the executor's result + original task to validator
   - Validator checks: direction correct, no deviation, input/output consistent
   - If validator rejects, STOP and report

### Important Rules

- ALWAYS verify facts with \`hard_verify\` before accepting agent output
- If hard_verify FAILs, do NOT proceed. Report the failure.
- If a pane dies (acp_send/acp_read returns PANE_DEAD), report it.
- Agents may take time to respond. Poll \`acp_read\` until status is COMPLETE.
- The \`<HK_RESULT>\` block is the ONLY valid output format from agents.`;
}
