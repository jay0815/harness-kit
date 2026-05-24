import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { harnessKitTools, setWorkspaceDir } from "./tools.js";
import { createDefaultWorkflow } from "./workflow.js";
import { initTelemetry, close as closeTelemetry, emit } from "./telemetry.js";
import { extractResultBlock } from "./result-block.js";
import { verifyFacts } from "./verify.js";
import { reconcileFromDisk, initState, saveArtifact, saveState } from "./state.js";
import { snapshotWorkspace, detectOutOfScope } from "./guardrails.js";
import type { HarnessState } from "./types.js";

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
  let workspaceDir = process.cwd();
  let harnessState: HarnessState | null = null;
  let phaseSnapshot: ReturnType<typeof snapshotWorkspace> | null = null;

  pi.on("session_start", (_event, ctx) => {
    workspaceDir = ctx.cwd;
    setWorkspaceDir(ctx.cwd);
    initTelemetry();

    harnessState = reconcileFromDisk(ctx.cwd, workflow.phases.length);
    if (harnessState && harnessState.currentPhase > 0) {
      emit("state", "recovered", {
        currentPhase: harnessState.currentPhase,
        completedPhases: harnessState.phases.filter((p) => p.status === "completed").length,
      });
    } else {
      harnessState = initState(workflow, ctx.cwd);
    }

    // Take initial snapshot for guardrails
    phaseSnapshot = snapshotWorkspace(ctx.cwd);
  });

  pi.on("session_shutdown", () => {
    closeTelemetry();
  });

  // Register all harness-kit tools
  for (const tool of harnessKitTools) {
    pi.registerTool(tool);
  }

  // Auto-verify: intercept LLM output, verify facts, inject failure feedback
  pi.on("turn_end", (event) => {
    const msg = event.message as { content?: unknown[] };
    if (!Array.isArray(msg.content)) return;

    // Observability: extract LLM content types
    const content = msg.content as Array<{ type: string; text?: string; name?: string; input?: unknown; thinking?: string }>;
    const textParts = content.filter((c) => c.type === "text");
    const thinkingParts = content.filter((c) => c.type === "thinking");
    const toolCalls = content.filter((c) => c.type === "tool_use");

    const text = textParts.map((c) => c.text ?? "").join("");

    // Observability: turn summary — what the LLM did
    emit("turn", "end", {
      turnIndex: event.turnIndex,
      textLength: text.length,
      textPreview: text.slice(0, 200),
      hasThinking: thinkingParts.length > 0,
      toolCalls: toolCalls.map((t) => ({ name: t.name, input: t.input })),
      currentPhase: harnessState?.currentPhase,
    });

    const block = extractResultBlock(text);

    // Observability: HK_RESULT parsing
    emit("hk_result", block ? "parsed" : "not_found", {
      hasBlock: !!block,
      factCount: block?.facts.length ?? 0,
      currentWork: block?.currentWork?.slice(0, 100),
    });

    if (block?.warnings && block.warnings.length > 0) {
      emit("hk_result", "warnings", { warnings: block.warnings });
    }

    if (!block || block.facts.length === 0) return;

    const t0 = Date.now();
    const report = verifyFacts(block.facts, workspaceDir);
    const durationMs = Date.now() - t0;

    // Observability: auto-verify result
    emit("auto_verify", report.overall.toLowerCase(), {
      factCount: block.facts.length,
      passCount: report.checks.filter((c) => c.status === "PASS").length,
      failCount: report.checks.filter((c) => c.status === "FAIL").length,
      durationMs,
    });

    // Observability: verify failure details
    if (report.overall === "FAIL") {
      emit("verify_detail", "fail", {
        failures: report.checks
          .filter((c) => c.status === "FAIL")
          .map((c) => ({
            file: c.fact.file,
            lines: `${c.fact.startLine}-${c.fact.endLine}`,
            reason: c.error ?? "text mismatch",
          })),
      });

      const failures = report.checks
        .filter((c) => c.status === "FAIL")
        .map((c) => {
          const reason = c.error ?? `text mismatch (expected: ${c.fact.exactText.slice(0, 60)}...)`;
          return `  ✗ ${c.fact.file}:${c.fact.startLine}-${c.fact.endLine} — ${reason}`;
        })
        .join("\n");

      pi.sendUserMessage(
        `[harness-kit auto-verify] FAIL:\n${failures}\nFix the incorrect facts and output a corrected <HK_RESULT> block.`,
      );
    } else if (harnessState && harnessState.currentPhase < harnessState.phases.length) {
      const phase = harnessState.phases[harnessState.currentPhase];

      // Guardrails: check for out-of-scope file changes
      if (phaseSnapshot) {
        const afterSnapshot = snapshotWorkspace(workspaceDir);
        const declaredFiles = block.facts.map((f) => f.file);
        const outOfScope = detectOutOfScope(phaseSnapshot, afterSnapshot, declaredFiles);

        if (outOfScope.length > 0) {
          emit("guardrail", "out_of_scope", {
            phase: harnessState.currentPhase,
            phaseName: phase.name,
            files: outOfScope,
          });
        }

        // Update snapshot for next phase
        phaseSnapshot = afterSnapshot;
      }

      try {
        saveArtifact(harnessState.currentPhase, phase.name, block, workspaceDir);
        phase.status = "completed";
        phase.completedAt = new Date().toISOString();
        harnessState.currentPhase++;
        harnessState.updatedAt = new Date().toISOString();
        saveState(harnessState, workspaceDir);
        emit("state", "phase_completed", { phase: harnessState.currentPhase - 1, name: phase.name });
      } catch (err) {
        emit("state", "save_failed", {
          phase: harnessState.currentPhase,
          phaseName: phase.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  // Inject harness-kit workflow instructions into system prompt
  pi.on("before_agent_start", (event) => {
    let combined = event.systemPrompt + "\n\n" + harnessPrompt;

    if (harnessState && harnessState.currentPhase > 0) {
      const completed = harnessState.phases
        .slice(0, harnessState.currentPhase)
        .map((p) => `  ✓ ${p.name} (completed)`)
        .join("\n");
      const current = harnessState.phases[harnessState.currentPhase]?.name ?? "unknown";
      combined += `\n\n### Session Recovery\nPreviously completed phases:\n${completed}\n\nResume from: **${current}** (phase ${harnessState.currentPhase + 1}).`;

      emit("prompt", "recovery_injected", {
        completedPhases: harnessState.currentPhase,
        resumePhase: current,
      });
    }

    emit("prompt", "system_injected", {
      originalLength: event.systemPrompt.length,
      harnessPromptLength: harnessPrompt.length,
      combinedLength: combined.length,
    });

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
