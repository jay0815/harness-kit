import type { HarnessState, Phase, ResultBlock, Workflow } from "./types.js";
import {
  initState,
  reconcileFromDisk,
  saveArtifact as defaultSaveArtifact,
  saveState as defaultSaveState,
} from "./state.js";

export type SchedulerStatus =
  | "idle"
  | "running_phase"
  | "verifying_phase"
  | "awaiting_human"
  | "phase_completed"
  | "phase_failed_retryable"
  | "workflow_completed"
  | "failed"
  | "aborted";

export interface SchedulerPersistence {
  saveState(state: HarnessState, workspaceDir: string): void;
  saveArtifact(
    phaseIndex: number,
    phaseName: string,
    resultBlock: ResultBlock,
    workspaceDir: string,
  ): string;
}

export interface PhaseSchedulerOptions {
  workflow: Workflow;
  state: HarnessState;
  workspaceDir: string;
  persistence?: Partial<SchedulerPersistence>;
  now?: () => string;
}

export interface ResumePhaseSchedulerOptions {
  workflow: Workflow;
  workspaceDir: string;
  persistence?: Partial<SchedulerPersistence>;
  now?: () => string;
}

export interface ConfirmAwaitingHumanInput {
  phaseName?: string;
}

export type SchedulerResult = SchedulerSuccess | SchedulerFailure;
export type SchedulerSuccessStatus = Extract<
  SchedulerStatus,
  "running_phase" | "awaiting_human" | "phase_completed" | "workflow_completed"
>;
export type SchedulerFailureStatus = Extract<
  SchedulerStatus,
  "phase_failed_retryable" | "failed" | "aborted"
>;

export interface SchedulerSuccess {
  ok: true;
  status: SchedulerSuccessStatus;
  state: HarnessState;
  currentPhase?: Phase;
  completedPhase?: Phase;
  nextPhase?: Phase;
  artifactPath?: string;
}

export interface SchedulerFailure {
  ok: false;
  status: SchedulerFailureStatus;
  state: HarnessState;
  reason: string;
  expectedPhase?: string;
  actualPhase?: string;
}

export class PhaseScheduler {
  readonly workflow: Workflow;
  readonly state: HarnessState;
  readonly workspaceDir: string;

  private readonly persistence: SchedulerPersistence;
  private readonly now: () => string;
  private runStatus: SchedulerStatus = "idle";

  constructor(options: PhaseSchedulerOptions) {
    this.workflow = options.workflow;
    this.state = options.state;
    this.workspaceDir = options.workspaceDir;
    this.persistence = {
      saveState: options.persistence?.saveState ?? defaultSaveState,
      saveArtifact: options.persistence?.saveArtifact ?? defaultSaveArtifact,
    };
    this.now = options.now ?? (() => new Date().toISOString());
    normalizeStateWithWorkflow(this.state, this.workflow);
  }

  get status(): SchedulerStatus {
    return this.runStatus;
  }

  getCurrentPhase(): Phase | null {
    if (this.state.currentPhase >= this.workflow.phases.length) return null;
    return this.workflow.phases[this.state.currentPhase] ?? null;
  }

  startCurrentPhase(): SchedulerResult {
    if (this.state.awaitingHuman) {
      this.runStatus = "awaiting_human";
      return {
        ok: true,
        status: "awaiting_human",
        state: this.state,
        completedPhase: this.workflow.phases[this.state.awaitingHuman.phaseIndex],
        nextPhase: this.workflow.phases[this.state.awaitingHuman.nextPhaseIndex],
      };
    }

    const currentPhase = this.getCurrentPhase();
    if (!currentPhase) {
      this.runStatus = "workflow_completed";
      return {
        ok: true,
        status: "workflow_completed",
        state: this.state,
      };
    }

    this.runStatus = "running_phase";
    return {
      ok: true,
      status: "running_phase",
      state: this.state,
      currentPhase,
    };
  }

  submitPhaseResult(input: { phaseName: string; result: ResultBlock }): SchedulerResult {
    if (this.state.awaitingHuman) {
      this.runStatus = "phase_failed_retryable";
      return {
        ok: false,
        status: "phase_failed_retryable",
        state: this.state,
        reason: `Workflow is awaiting human confirmation for phase "${this.state.awaitingHuman.phaseName}".`,
        expectedPhase: this.state.awaitingHuman.phaseName,
        actualPhase: input.phaseName,
      };
    }

    const phaseIndex = this.state.currentPhase;
    const phase = this.getCurrentPhase();

    if (!phase) {
      this.runStatus = "failed";
      return {
        ok: false,
        status: "failed",
        state: this.state,
        reason: "Workflow is already complete.",
        actualPhase: input.phaseName,
      };
    }

    if (input.phaseName !== phase.name) {
      return this.failCurrentPhase(
        `Cannot complete phase "${input.phaseName}" while current phase is "${phase.name}".`,
        input.phaseName,
      );
    }

    this.runStatus = "verifying_phase";
    let artifactPath: string;
    try {
      artifactPath = this.persistence.saveArtifact(
        phaseIndex,
        phase.name,
        input.result,
        this.workspaceDir,
      );
    } catch (err) {
      this.runStatus = "failed";
      throw err;
    }

    const phaseState = this.state.phases[phaseIndex];
    const previousPhaseState = { ...phaseState };
    const previousCurrentPhase = this.state.currentPhase;
    const previousUpdatedAt = this.state.updatedAt;
    const completedAt = this.now();

    phaseState.status = "completed";
    phaseState.completedAt = completedAt;
    phaseState.artifactPath = artifactPath;
    this.state.currentPhase = phaseIndex + 1;
    this.state.updatedAt = completedAt;
    const nextPhase = this.getCurrentPhase() ?? undefined;

    if (phase.humanConfirm) {
      this.state.awaitingHuman = {
        phaseIndex,
        phaseName: phase.name,
        nextPhaseIndex: this.state.currentPhase,
        nextPhaseName: nextPhase?.name,
        requestedAt: completedAt,
        artifactPath,
      };
    } else {
      delete this.state.awaitingHuman;
    }

    try {
      this.persistence.saveState(this.state, this.workspaceDir);
    } catch (err) {
      this.state.phases[phaseIndex] = previousPhaseState;
      this.state.currentPhase = previousCurrentPhase;
      this.state.updatedAt = previousUpdatedAt;
      delete this.state.awaitingHuman;
      this.runStatus = "failed";
      throw err;
    }

    this.runStatus = this.state.awaitingHuman
      ? "awaiting_human"
      : nextPhase
        ? "phase_completed"
        : "workflow_completed";

    return {
      ok: true,
      status: this.runStatus,
      state: this.state,
      completedPhase: phase,
      nextPhase,
      artifactPath,
    };
  }

  confirmAwaitingHuman(input: ConfirmAwaitingHumanInput = {}): SchedulerResult {
    const awaitingHuman = this.state.awaitingHuman;
    if (!awaitingHuman) {
      this.runStatus = "phase_failed_retryable";
      return {
        ok: false,
        status: "phase_failed_retryable",
        state: this.state,
        reason: "Workflow is not awaiting human confirmation.",
        actualPhase: input.phaseName,
      };
    }

    if (input.phaseName && input.phaseName !== awaitingHuman.phaseName) {
      this.runStatus = "phase_failed_retryable";
      return {
        ok: false,
        status: "phase_failed_retryable",
        state: this.state,
        reason: `Cannot confirm phase "${input.phaseName}" while awaiting confirmation for "${awaitingHuman.phaseName}".`,
        expectedPhase: awaitingHuman.phaseName,
        actualPhase: input.phaseName,
      };
    }

    const previousAwaitingHuman = { ...awaitingHuman };
    const previousUpdatedAt = this.state.updatedAt;
    const confirmedAt = this.now();

    delete this.state.awaitingHuman;
    this.state.updatedAt = confirmedAt;

    try {
      this.persistence.saveState(this.state, this.workspaceDir);
    } catch (err) {
      this.state.awaitingHuman = previousAwaitingHuman;
      this.state.updatedAt = previousUpdatedAt;
      this.runStatus = "failed";
      throw err;
    }

    const nextPhase = this.getCurrentPhase() ?? undefined;
    this.runStatus = nextPhase ? "running_phase" : "workflow_completed";

    return {
      ok: true,
      status: this.runStatus,
      state: this.state,
      completedPhase: this.workflow.phases[awaitingHuman.phaseIndex],
      currentPhase: nextPhase,
      nextPhase,
      artifactPath: awaitingHuman.artifactPath,
    };
  }

  failCurrentPhase(reason: string, actualPhase?: string): SchedulerFailure {
    const phase = this.getCurrentPhase();
    if (!phase) {
      this.runStatus = "failed";
      return {
        ok: false,
        status: "failed",
        state: this.state,
        reason,
        actualPhase,
      };
    }

    this.runStatus = "phase_failed_retryable";
    return {
      ok: false,
      status: "phase_failed_retryable",
      state: this.state,
      reason,
      expectedPhase: phase?.name,
      actualPhase,
    };
  }
}

export function resumePhaseScheduler(options: ResumePhaseSchedulerOptions): PhaseScheduler {
  const state =
    reconcileFromDisk(options.workspaceDir, options.workflow.phases.length) ??
    initState(options.workflow, options.workspaceDir);

  normalizeStateWithWorkflow(state, options.workflow);

  return new PhaseScheduler({
    workflow: options.workflow,
    state,
    workspaceDir: options.workspaceDir,
    persistence: options.persistence,
    now: options.now,
  });
}

function normalizeStateWithWorkflow(state: HarnessState, workflow: Workflow): void {
  for (let i = 0; i < workflow.phases.length; i++) {
    if (!state.phases[i]) {
      state.phases[i] = { name: workflow.phases[i].name, status: "pending" };
      continue;
    }
    state.phases[i].name = workflow.phases[i].name;
  }

  if (state.currentPhase > workflow.phases.length) {
    state.currentPhase = workflow.phases.length;
  }

  if (!state.awaitingHuman) return;

  const gate = state.awaitingHuman;
  const completedPhase = workflow.phases[gate.phaseIndex];
  if (
    !completedPhase ||
    state.phases[gate.phaseIndex]?.status !== "completed" ||
    gate.nextPhaseIndex !== state.currentPhase ||
    gate.nextPhaseIndex > workflow.phases.length
  ) {
    delete state.awaitingHuman;
    return;
  }

  gate.phaseName = completedPhase.name;
  gate.nextPhaseName = workflow.phases[gate.nextPhaseIndex]?.name;
}
