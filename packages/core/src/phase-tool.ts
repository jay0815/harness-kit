import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@harness-kit/agent";
import { verifyFacts as defaultVerifyFacts } from "@harness-kit/agent";
import type { Fact, HarnessState, ResultBlock, Workflow } from "./types.js";
import {
  detectOutOfScope as defaultDetectOutOfScope,
  snapshotWorkspace as defaultSnapshotWorkspace,
  type WorkspaceSnapshot,
} from "./guardrails.js";
import { PhaseScheduler, type SchedulerPersistence } from "./phase-scheduler.js";
import { emit as defaultEmit } from "./telemetry.js";

const factSchema = Type.Object({
  file: Type.String(),
  startLine: Type.Number(),
  endLine: Type.Number(),
  exactText: Type.String(),
});

const resultBlockSchema = Type.Object({
  currentWork: Type.String(),
  facts: Type.Array(factSchema),
  reasoning: Type.Optional(Type.String()),
  warnings: Type.Optional(Type.Array(Type.String())),
});

export const completePhaseSchema = Type.Object({
  phaseName: Type.String({ description: "Name of the current phase being completed" }),
  result: resultBlockSchema,
});

export type CompletePhaseParams = Static<typeof completePhaseSchema>;

export interface CompletePhaseToolOptions {
  workflow: Workflow;
  getState(): HarnessState | null;
  getWorkspaceDir(): string;
  getPhaseSnapshot(): WorkspaceSnapshot | null;
  setPhaseSnapshot(snapshot: WorkspaceSnapshot): void;
  persistence?: Partial<SchedulerPersistence>;
  verifyFacts?: typeof defaultVerifyFacts;
  snapshotWorkspace?: typeof defaultSnapshotWorkspace;
  detectOutOfScope?: typeof defaultDetectOutOfScope;
  emit?: typeof defaultEmit;
}

export function createCompletePhaseTool(
  options: CompletePhaseToolOptions,
): ToolDefinition<typeof completePhaseSchema> {
  const verifyFacts = options.verifyFacts ?? defaultVerifyFacts;
  const snapshotWorkspace = options.snapshotWorkspace ?? defaultSnapshotWorkspace;
  const detectOutOfScope = options.detectOutOfScope ?? defaultDetectOutOfScope;
  const emit = options.emit ?? defaultEmit;

  return {
    name: "complete_phase",
    label: "Complete Phase",
    description:
      "Submit the current workflow phase result for hard verification and scheduler-controlled advancement. " +
      "Call this only after completing the current phase.",
    parameters: completePhaseSchema,
    execute: async (_toolCallId, params: CompletePhaseParams) => {
      const state = options.getState();
      if (!state) {
        return errorResult("STATE_UNAVAILABLE", "Harness state is not initialized.");
      }

      const workspaceDir = options.getWorkspaceDir();
      const currentPhase = options.workflow.phases[state.currentPhase];
      if (!currentPhase) {
        return errorResult("WORKFLOW_ALREADY_COMPLETE", "Workflow is already complete.");
      }

      if (params.phaseName !== currentPhase.name) {
        return errorResult(
          "PHASE_REJECTED",
          `Cannot complete phase "${params.phaseName}" while current phase is "${currentPhase.name}".`,
          {
            expectedPhase: currentPhase.name,
            actualPhase: params.phaseName,
          },
        );
      }

      const resultBlock = params.result as ResultBlock;
      const report = verifyFacts(resultBlock.facts as Fact[], workspaceDir);
      if (report.overall === "FAIL") {
        return errorResult("VERIFY_FAILED", formatVerifyFailures(report), { report });
      }

      const beforeSnapshot = options.getPhaseSnapshot();
      const afterSnapshot = snapshotWorkspace(workspaceDir);
      const outOfScope = beforeSnapshot
        ? detectOutOfScope(
            beforeSnapshot,
            afterSnapshot,
            resultBlock.facts.map((fact) => fact.file),
          )
        : [];

      if (outOfScope.length > 0) {
        emit("guardrail", "out_of_scope", {
          phase: state.currentPhase,
          phaseName: currentPhase.name,
          files: outOfScope,
          source: "complete_phase",
        });
        return errorResult(
          "OUT_OF_SCOPE",
          `Out-of-scope file changes detected: ${outOfScope.join(", ")}`,
          { files: outOfScope },
        );
      }

      const scheduler = new PhaseScheduler({
        workflow: options.workflow,
        state,
        workspaceDir,
        persistence: options.persistence,
      });

      try {
        const scheduled = scheduler.submitPhaseResult({
          phaseName: params.phaseName,
          result: resultBlock,
        });

        if (!scheduled.ok) {
          return errorResult("PHASE_REJECTED", scheduled.reason, {
            expectedPhase: scheduled.expectedPhase,
            actualPhase: scheduled.actualPhase,
          });
        }

        options.setPhaseSnapshot(afterSnapshot);
        emit("state", "phase_completed", {
          phase: state.currentPhase - 1,
          name: scheduled.completedPhase?.name,
          source: "complete_phase",
        });

        if (scheduled.status === "workflow_completed") {
          return successResult("WORKFLOW_COMPLETED", "Workflow completed.", {
            completedPhase: scheduled.completedPhase?.name,
            artifactPath: scheduled.artifactPath,
          });
        }

        if (scheduled.completedPhase?.humanConfirm) {
          return successResult(
            "AWAITING_HUMAN",
            `Phase "${scheduled.completedPhase.name}" completed. Ask the user for confirmation before continuing.`,
            {
              completedPhase: scheduled.completedPhase.name,
              nextPhase: scheduled.nextPhase?.name,
              artifactPath: scheduled.artifactPath,
            },
          );
        }

        return successResult(
          "PHASE_COMPLETED",
          `Phase "${scheduled.completedPhase?.name}" completed. Next phase: "${scheduled.nextPhase?.name}".`,
          {
            completedPhase: scheduled.completedPhase?.name,
            nextPhase: scheduled.nextPhase?.name,
            nextPrompt: scheduled.nextPhase?.prompt,
            artifactPath: scheduled.artifactPath,
          },
        );
      } catch (err) {
        return errorResult(
          "PERSIST_FAILED",
          `Failed to persist phase completion: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

function successResult(status: string, text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details: { status, ...details },
  };
}

function errorResult(status: string, text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details: { status, ...details },
    isError: true,
  };
}

function formatVerifyFailures(report: ReturnType<typeof defaultVerifyFacts>): string {
  const failures = report.checks.filter((check) => check.status === "FAIL");
  if (failures.length === 0) return "Fact verification failed.";

  return [
    "Fact verification failed:",
    ...failures.map((check) => {
      const fact = check.fact;
      const reason = check.error ?? "text mismatch";
      return `- ${fact.file}:${fact.startLine}-${fact.endLine}: ${reason}`;
    }),
  ].join("\n");
}
