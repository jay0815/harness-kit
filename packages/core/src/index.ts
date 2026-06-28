import type { HarnessExtensionAPI } from "@harness-kit/agent";
import { extractResultBlock, verifyFacts, FACT_VERIFICATION_KEY } from "@harness-kit/agent";
import type { FactVerificationMetadata, ResultBlock } from "@harness-kit/agent";
import { harnessKitTools, setWorkspaceDir } from "./tools.js";
import { createCompletePhaseTool } from "./phase-tool.js";
import { createDefaultWorkflow } from "./workflow.js";
import { initTelemetry, close as closeTelemetry, emit } from "./telemetry.js";
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
export default function harnessKitExtension(pi: HarnessExtensionAPI) {
  const workflow = createDefaultWorkflow();
  let workspaceDir = process.cwd();
  let harnessState: HarnessState | null = null;
  let phaseSnapshot: ReturnType<typeof snapshotWorkspace> | null = null;
  let phaseCompletedByToolThisTurn = false;

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

  pi.on("turn_start", () => {
    phaseCompletedByToolThisTurn = false;
  });

  pi.registerTool(
    createCompletePhaseTool({
      workflow,
      getState: () => harnessState,
      getWorkspaceDir: () => workspaceDir,
      getPhaseSnapshot: () => phaseSnapshot,
      setPhaseSnapshot: (snapshot) => {
        phaseSnapshot = snapshot;
      },
      onPhaseCompleted: () => {
        phaseCompletedByToolThisTurn = true;
      },
    }),
  );

  // Register all legacy harness-kit tools
  for (const tool of harnessKitTools) {
    pi.registerTool(tool);
  }

  // completeCurrentPhase — closure over harnessState, phaseSnapshot, workspaceDir
  function completeCurrentPhase(block: ResultBlock): void {
    if (!harnessState || harnessState.currentPhase >= harnessState.phases.length) {
      return;
    }

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

      phaseSnapshot = afterSnapshot;
    }

    try {
      saveArtifact(harnessState.currentPhase, phase.name, block, workspaceDir);

      // Save state before mutating in-memory state
      const prevStatus = phase.status;
      const prevCompletedAt = phase.completedAt;
      const prevPhase = harnessState.currentPhase;
      const prevUpdatedAt = harnessState.updatedAt;

      phase.status = "completed";
      phase.completedAt = new Date().toISOString();
      harnessState.currentPhase++;
      harnessState.updatedAt = new Date().toISOString();

      try {
        saveState(harnessState, workspaceDir);
      } catch (saveErr) {
        // Rollback in-memory state on save failure
        phase.status = prevStatus;
        phase.completedAt = prevCompletedAt;
        harnessState.currentPhase = prevPhase;
        harnessState.updatedAt = prevUpdatedAt;
        throw saveErr;
      }
      emit("state", "phase_completed", {
        phase: harnessState.currentPhase - 1,
        name: phase.name,
      });
    } catch (err) {
      emit("state", "save_failed", {
        phase: harnessState.currentPhase,
        phaseName: phase.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Auto-verify: intercept LLM output, verify facts, inject failure feedback
  pi.on("turn_end", (event) => {
    if (!Array.isArray(event.message.content)) return;

    // 1. Public observability (all paths)
    const content = event.message.content;
    const textParts = content.filter((c) => c.type === "text");
    const thinkingParts = content.filter((c) => c.type === "thinking");
    const toolCalls = content.filter((c) => c.type === "tool_use");

    const text = textParts.map((c) => (c as { text?: string }).text ?? "").join("");

    emit("turn", "end", {
      turnIndex: event.turnIndex,
      textLength: text.length,
      textPreview: text.slice(0, 200),
      hasThinking: thinkingParts.length > 0,
      toolCalls: toolCalls.map((t) => ({
        name: (t as { name?: string }).name,
        input: (t as { input?: unknown }).input,
      })),
      currentPhase: harnessState?.currentPhase,
    });

    const agentMeta = event.metadata?.[FACT_VERIFICATION_KEY] as
      | FactVerificationMetadata
      | undefined;
    const block = agentMeta?.block ?? extractResultBlock(text);

    emit("hk_result", block ? "parsed" : "not_found", {
      hasBlock: !!block,
      factCount: block?.facts.length ?? 0,
      currentWork: block?.currentWork?.slice(0, 100),
    });

    if (block?.warnings && block.warnings.length > 0) {
      emit("hk_result", "warnings", { warnings: block.warnings });
    }

    if (phaseCompletedByToolThisTurn) {
      emit("turn", "fallback_skipped", {
        turnIndex: event.turnIndex,
        reason: "phase_completed_by_complete_phase",
        currentPhase: harnessState?.currentPhase,
      });
      return;
    }

    // 2. Metadata path — trust agent layer verification
    if (agentMeta) {
      emitVerificationTelemetryFromMetadata(agentMeta);

      if (agentMeta.status === "pass" && agentMeta.block) {
        completeCurrentPhase(agentMeta.block);
      }
      return;
    }

    // 3. Fallback path — bare mode or legacy agent
    if (!block || block.facts.length === 0) return;

    const t0 = Date.now();
    const report = verifyFacts(block.facts, workspaceDir);
    const durationMs = Date.now() - t0;

    const outcome = report.overall === "PASS" ? "pass" : "fail";
    emit("auto_verify", outcome, {
      factCount: block.facts.length,
      passCount: report.checks.filter((c) => c.status === "PASS").length,
      failCount: report.checks.filter((c) => c.status === "FAIL").length,
      durationMs,
    });

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
      return;
    }

    completeCurrentPhase(block);
  });

  function emitVerificationTelemetryFromMetadata(meta: FactVerificationMetadata): void {
    const factCount = meta.block?.facts.length ?? 0;

    if (meta.report) {
      const passCount = meta.report.checks.filter((c) => c.status === "PASS").length;
      const failCount = meta.report.checks.filter((c) => c.status === "FAIL").length;
      emit("auto_verify", meta.report.overall.toLowerCase(), {
        factCount,
        passCount,
        failCount,
        durationMs: 0,
        source: "agent_metadata",
      });
      if (meta.report.overall === "FAIL") {
        emit("verify_detail", "fail", {
          failures: meta.report.checks
            .filter((c) => c.status === "FAIL")
            .map((c) => ({
              file: c.fact.file,
              lines: `${c.fact.startLine}-${c.fact.endLine}`,
              reason: c.error ?? "text mismatch",
            })),
        });
      }
      return;
    }

    // missing / empty / fail without report
    emit("auto_verify", meta.status === "pass" ? "pass" : "fail", {
      status: meta.status,
      factCount,
      passCount: 0,
      failCount: 0,
      durationMs: 0,
      source: "agent_metadata",
    });
  }

  // Inject harness-kit workflow instructions into system prompt
  pi.on("before_agent_start", (event) => {
    const schedulerPrompt = buildHarnessPrompt(workflow, harnessState);
    const combined = event.systemPrompt + "\n\n" + schedulerPrompt;

    if (harnessState && harnessState.currentPhase > 0) {
      const current = workflow.phases[harnessState.currentPhase]?.name ?? "complete";

      emit("prompt", "recovery_injected", {
        completedPhases: harnessState.currentPhase,
        resumePhase: current,
      });
    }

    emit("prompt", "system_injected", {
      originalLength: event.systemPrompt.length,
      harnessPromptLength: schedulerPrompt.length,
      combinedLength: combined.length,
    });

    return { systemPrompt: combined };
  });
}

function buildHarnessPrompt(
  workflow: ReturnType<typeof createDefaultWorkflow>,
  state: HarnessState | null,
): string {
  const currentPhaseIndex = Math.min(state?.currentPhase ?? 0, workflow.phases.length);
  const currentPhase = workflow.phases[currentPhaseIndex];
  const completedPhases =
    state?.phases
      .slice(0, currentPhaseIndex)
      .map((phase) => `- ${phase.name} (completed)`)
      .join("\n") || "- none";

  if (!currentPhase) {
    return `## harness-kit Phase Scheduler

Workflow: ${workflow.name}
${workflow.description}

Completed phases:
${completedPhases}

The workflow is complete. Do not start additional workflow phases.`;
  }

  const humanConfirm = currentPhase.humanConfirm ? "yes" : "no";

  return `## harness-kit Phase Scheduler

You are working under a scheduler-controlled workflow. Execute only the current phase. Do not start future phases or decide the next phase yourself.

### Workflow
${workflow.name}
${workflow.description}

### Completed phases:
${completedPhases}

### Current phase
Current phase: **${currentPhase.name}** (phase ${currentPhaseIndex + 1} of ${workflow.phases.length})

Instruction:
${currentPhase.prompt}

Human confirmation after this phase: ${humanConfirm}

### Completion contract

When this phase is complete, call \`complete_phase\` with phaseName: "${currentPhase.name}" and a ResultBlock:

\`\`\`json
{
  "phaseName": "${currentPhase.name}",
  "result": {
    "currentWork": "what you did in this phase",
    "facts": [
      { "file": "relative/path.ts", "startLine": 1, "endLine": 5, "exactText": "exact text from file" }
    ],
    "reasoning": "optional notes"
  }
}
\`\`\`

### Rules

- Every \`fact\` must cite real file content: exact file path, line range, and text.
- Do not complete a different phase. The only accepted phaseName is "${currentPhase.name}".
- Do not output standalone \`<HK_RESULT>\` as the completion mechanism; call \`complete_phase\`.
- If \`complete_phase\` returns an error, fix the current phase and call it again.
- Do not skip phases or continue to the next phase until harness-kit returns the next instruction.`;
}
