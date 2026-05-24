import { loadWorkflow } from "../src/workflow-loader.js";
import { executeWorkflow } from "../src/workflow-executor.js";
import { resolve } from "node:path";

// Usage: tsx examples/dry-run.ts [workflow.yaml]
const workflowFile = process.argv[2] ?? "custom-workflow.yaml";
const workflowPath = resolve(import.meta.dirname ?? ".", workflowFile);

console.log("Loading workflow from:", workflowPath);
console.log("---");

const config = loadWorkflow(workflowPath);

console.log("Workflow:", config.workflow);
console.log("Description:", config.description);
console.log("Phases:", config.phases.length);
console.log("---");

console.log("Running dry-run...\n");

const run = await executeWorkflow({
  config,
  workflowDir: resolve(import.meta.dirname ?? ".", "../.."),
  dryRun: true,
});

console.log("=".repeat(60));
console.log("DRY RUN RESULTS");
console.log("=".repeat(60));
console.log(`Workflow: ${run.workflow}`);
console.log(`Overall Success: ${run.overallSuccess}`);
console.log(`Started: ${run.startedAt}`);
console.log(`Completed: ${run.completedAt}`);
console.log("---");

for (const phase of run.phases) {
  console.log(`\n[${phase.phaseName}] (${phase.executor})`);
  console.log("-".repeat(40));
  console.log(phase.output);
}

console.log("\n" + "=".repeat(60));
console.log("Dry-run complete!");
