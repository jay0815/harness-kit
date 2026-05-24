import { loadWorkflow } from "../src/workflow-loader.js";
import { executeWorkflow } from "../src/workflow-executor.js";
import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { createPiLlmExecutor } from "./pi-llm-executor.js";

const workflowPath = resolve(import.meta.dirname ?? ".", "review-workflow.yaml");
const projectRoot = resolve(import.meta.dirname ?? "../../..", "../../..");

console.log("Loading workflow:", workflowPath);
console.log("Project root:", projectRoot);
console.log("=".repeat(60));

const config = loadWorkflow(workflowPath);

console.log(`Workflow: ${config.workflow} (${config.phases.length} phases)`);
console.log("=".repeat(60));

// Build source code context for the LLM review phase
function buildReviewContext(): string {
  const srcDir = resolve(projectRoot, "packages/harness-kit/src");
  const files: string[] = [];

  try {
    const entries = readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        const content = readFileSync(resolve(srcDir, entry.name), "utf-8");
        files.push(`### ${entry.name}\n\`\`\`typescript\n${content}\n\`\`\``);
      }
    }
  } catch (err) {
    console.error("Failed to read source files:", err);
  }

  return `## Source Code\n\n${files.join("\n\n")}`;
}

const sourceContext = buildReviewContext();

const llmExecutor = createPiLlmExecutor({
  buildContext: (_phase, _previousResults) => {
    // Combine source code with phase prompt
    const prompt = _phase.prompt ?? "";
    const prevContext = [..._previousResults.entries()]
      .map(([name, output]) => `### ${name} result\n\`\`\`\n${output}\n\`\`\``)
      .join("\n\n");

    return `${sourceContext}\n\n${prevContext ? `## Previous Phase Results\n\n${prevContext}\n\n` : ""}${prompt}`;
  },
});

console.log("\nExecuting workflow...\n");

const run = await executeWorkflow({
  config,
  workflowDir: projectRoot,
  llmExecutor,
});

console.log("\n" + "=".repeat(60));
console.log("WORKFLOW RESULTS");
console.log("=".repeat(60));
console.log(`Overall: ${run.overallSuccess ? "PASS" : "FAIL"}`);
console.log(`Duration: ${run.startedAt} → ${run.completedAt}`);
console.log("=".repeat(60));

for (const phase of run.phases) {
  const status = phase.success ? "PASS" : "FAIL";
  console.log(`\n[${phase.phaseName}] ${status} (${phase.executor}) ${phase.durationMs}ms`);
  console.log("-".repeat(60));
  console.log(phase.output);
}

process.exit(run.overallSuccess ? 0 : 1);
