import { Type, type Static } from "@sinclair/typebox";

// Executor types
export const ExecutorType = Type.Union([
  Type.Literal("self"),
  Type.Literal("llm"),
  Type.Literal("code"),
  Type.Literal("subagent"),
]);
export type ExecutorType = Static<typeof ExecutorType>;

export const SubagentExecutorType = Type.Union([
  Type.Literal("claude"),
  Type.Literal("codex"),
  Type.Literal("harness-agent"),
  Type.Literal("script"),
]);
export type SubagentExecutorType = Static<typeof SubagentExecutorType>;

// Code execution: shell command or script reference
export const CodeExecution = Type.Union([
  Type.Object({ command: Type.String() }),
  Type.Object({
    script: Type.String(),
    args: Type.Optional(Type.Array(Type.String())),
  }),
]);
export type CodeExecution = Static<typeof CodeExecution>;

// Phase definition
export const PhaseConfig = Type.Object({
  name: Type.String({ minLength: 1 }),
  executor: ExecutorType,
  // LLM executor fields
  prompt: Type.Optional(Type.String()),
  contextFiles: Type.Optional(Type.Array(Type.String())),
  humanConfirm: Type.Optional(Type.Boolean()),
  // Code executor fields (union: command or script)
  command: Type.Optional(Type.String()),
  script: Type.Optional(Type.String()),
  args: Type.Optional(Type.Array(Type.String())),
  // Subagent executor fields
  subagentType: Type.Optional(SubagentExecutorType),
  subagentConstraints: Type.Optional(Type.Array(Type.String())),
  subagentTimeoutMs: Type.Optional(Type.Number()),
  subagentSettings: Type.Optional(Type.String()),
});
export type PhaseConfig = Static<typeof PhaseConfig>;

// Workflow definition
export const WorkflowConfig = Type.Object({
  workflow: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  phases: Type.Array(PhaseConfig, { minItems: 1 }),
});
export type WorkflowConfig = Static<typeof WorkflowConfig>;

// Runtime types (after loading and validation)

export interface PhaseResult {
  phaseName: string;
  executor: ExecutorType;
  success: boolean;
  output: string;
  durationMs: number;
  artifacts?: string[];
}

export interface WorkflowRun {
  workflow: string;
  phases: PhaseResult[];
  overallSuccess: boolean;
  startedAt: string;
  completedAt?: string;
}
