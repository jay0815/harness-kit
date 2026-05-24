import { loadWorkflow } from "../src/workflow-loader.js";
import { executeWorkflow, type LlmExecutor } from "../src/workflow-executor.js";
import { resolve } from "node:path";

const workflowPath = resolve(import.meta.dirname ?? ".", "review-workflow.yaml");
const projectRoot = resolve(import.meta.dirname ?? "../..", "../..");

console.log("Loading workflow from:", workflowPath);
console.log("Project root:", projectRoot);
console.log("=".repeat(60));

const config = loadWorkflow(workflowPath);

console.log(`Workflow: ${config.workflow}`);
console.log(`Description: ${config.description}`);
console.log(`Phases: ${config.phases.length}`);
console.log("=".repeat(60));

// Simple LLM executor that analyzes results
const llmExecutor: LlmExecutor = {
  execute: async (phase, context) => {
    const prompt = phase.prompt ?? "";
    const outputs = context.previousResults;

    // Collect all previous results
    const results: string[] = [];
    for (const [name, output] of outputs) {
      results.push(`### ${name}\n${output}`);
    }

    // Generate analysis based on the results
    const analysis = generateAnalysis(results.join("\n\n"));

    return {
      success: true,
      output: analysis,
    };
  },
};

console.log("\nExecuting workflow...\n");

const run = await executeWorkflow({
  config,
  workflowDir: projectRoot,
  llmExecutor,
});

console.log("\n" + "=".repeat(60));
console.log("WORKFLOW EXECUTION RESULTS");
console.log("=".repeat(60));
console.log(`Workflow: ${run.workflow}`);
console.log(`Overall Success: ${run.overallSuccess}`);
console.log(`Started: ${run.startedAt}`);
console.log(`Completed: ${run.completedAt}`);
console.log("=".repeat(60));

for (const phase of run.phases) {
  const status = phase.success ? "✓ PASS" : "✗ FAIL";
  console.log(`\n[${phase.phaseName}] ${status} (${phase.executor}) - ${phase.durationMs}ms`);
  console.log("-".repeat(60));
  console.log(phase.output);
}

console.log("\n" + "=".repeat(60));

function generateAnalysis(results: string): string {
  // Simple rule-based analysis
  const issues: string[] = [];
  const suggestions: string[] = [];

  // Check for lint errors
  if (results.includes("error") || results.includes("Error")) {
    issues.push("发现 lint 或类型错误，需要修复");
  }

  // Check for test failures
  if (results.includes("failed") || results.includes("FAIL")) {
    issues.push("存在测试失败，需要修复");
  }

  // Check test coverage
  const testMatch = results.match(/Tests\s+(\d+)\s+passed/);
  if (testMatch) {
    const testCount = parseInt(testMatch[1]);
    if (testCount < 50) {
      suggestions.push("测试数量较少，建议增加测试覆盖");
    }
  }

  // Check source files
  const sourceMatch = results.match(/源文件数量:\s*(\d+)/);
  if (sourceMatch) {
    const sourceCount = parseInt(sourceMatch[1]);
    if (sourceCount > 20) {
      suggestions.push("源文件较多，建议按功能模块组织目录结构");
    }
  }

  // Generate report
  let report = "## Code Review Report\n\n";

  if (issues.length > 0) {
    report += "### Issues Found\n";
    issues.forEach((issue, i) => {
      report += `${i + 1}. ${issue}\n`;
    });
    report += "\n";
  }

  if (suggestions.length > 0) {
    report += "### Suggestions\n";
    suggestions.forEach((suggestion, i) => {
      report += `${i + 1}. ${suggestion}\n`;
    });
    report += "\n";
  }

  if (issues.length === 0 && suggestions.length === 0) {
    report += "### Summary\n";
    report += "代码质量检查通过，未发现明显问题。\n\n";
  }

  report += "### Statistics\n";
  report += results;

  return report;
}
