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
    .map((p, i) => {
      const confirm = p.humanConfirm ? " [human confirm required]" : "";
      return `${i + 1}. **${p.name}**${confirm}: ${p.prompt}`;
    })
    .join("\n");

  return `## harness-kit Workflow

You are a coding agent guided by a structured workflow. Complete each phase in order.

### Workflow: ${workflow.name}
${workflow.description}

### Phases
${phaseList}

### How to work

1. **Execute each phase** by reading context files, writing code, and producing results.

2. **After each phase**, output a \`<HK_RESULT>\` block:
   \`\`\`
   <HK_RESULT>
   {
     "currentWork": "what you did in this phase",
     "facts": [
       { "file": "relative/path.ts", "startLine": 1, "endLine": 5, "exactText": "exact text from file" }
     ],
     "reasoning": "optional notes"
   }
   </HK_RESULT>
   \`\`\`

3. **Verify your facts** with \`hard_verify\` before moving to the next phase.

4. **If human confirmation is required**, pause and ask the user before proceeding.

### Rules

- Every \`fact\` must cite real file content: exact file path, line range, and text.
- Run \`hard_verify\` on your own facts. If FAIL, fix the issue before continuing.
- The \`<HK_RESULT>\` block is your ONLY structured output boundary.
- Work through all phases sequentially. Do not skip phases.`;
}
