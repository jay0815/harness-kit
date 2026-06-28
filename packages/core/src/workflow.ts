import type { Workflow } from "./types.js";

/**
 * Hardcoded MVP workflow: design -> implement -> test.
 * In degraded mode, PI itself executes all phases.
 */
export function createDefaultWorkflow(): Workflow {
  return {
    name: "feature-impl",
    description: "Design, implement, and test a feature",
    phases: [
      {
        name: "design",
        executor: "self",
        prompt:
          "Read the task requirements. Design the implementation: " +
          "what files to create/modify, what functions to write, what the API looks like. " +
          "Prepare facts for every file you reference so the scheduler can verify the phase result.",
        contextFiles: [],
        humanConfirm: true,
      },
      {
        name: "implement",
        executor: "self",
        prompt:
          "Implement the design. Create/modify the files. " +
          "Prepare facts for every file you created or modified. " +
          "Each fact must cite the exact text that exists on disk after your changes.",
        contextFiles: [],
        humanConfirm: false,
      },
      {
        name: "test",
        executor: "self",
        prompt:
          "Write unit tests and run them. Fix any failures. " +
          "Prepare facts for test files you created and report test results (pass/fail count).",
        contextFiles: [],
        humanConfirm: true,
      },
    ],
  };
}
