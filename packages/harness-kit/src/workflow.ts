import type { Workflow } from "./types.js";

/**
 * Hardcoded MVP workflow: design -> implement -> test.
 * Each phase has one executor. Validation is done by a separate
 * validator agent after each phase (configured in harness-kit tools).
 */
export function createDefaultWorkflow(): Workflow {
  return {
    name: "feature-impl",
    description: "Design, implement, and test a feature",
    phases: [
      {
        name: "design",
        executor: "claude-code",
        prompt:
          "Read the requirements and design the implementation. " +
          "Output your design inside a <HK_RESULT> block. " +
          "For every file you reference, include a fact with file path, " +
          "line range, and exact text.",
        contextFiles: ["docs/requirements.md"],
        humanConfirm: true,
      },
      {
        name: "implement",
        executor: "codex",
        prompt:
          "Implement the feature based on the design document. " +
          "Output your changes inside a <HK_RESULT> block. " +
          "For every file you modified, include a fact with file path, " +
          "line range, and exact text from the modified file.",
        contextFiles: ["output/design.md"],
        humanConfirm: false,
      },
      {
        name: "test",
        executor: "codex",
        prompt:
          "Write and run tests for the implementation. " +
          "Output test results inside a <HK_RESULT> block. " +
          "Include facts for any code you referenced.",
        contextFiles: ["output/design.md", "src/"],
        humanConfirm: true,
      },
    ],
  };
}
