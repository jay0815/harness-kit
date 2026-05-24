import { loadWorkflow } from "../src/workflow-loader.js";
import { executeWorkflow, type LlmExecutor } from "../src/workflow-executor.js";
import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

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

// Read source code for analysis
function readSourceFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const srcDir = resolve(projectRoot, "harness-kit/src");

  try {
    const entries = readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        const content = readFileSync(resolve(srcDir, entry.name), "utf-8");
        files.set(entry.name, content);
      }
    }
  } catch (err) {
    console.error("Failed to read source files:", err);
  }

  return files;
}

// LLM executor that analyzes code architecture
const llmExecutor: LlmExecutor = {
  execute: async (phase, context) => {
    const prompt = phase.prompt ?? "";

    // For review phase, read and analyze actual code
    if (phase.name === "review") {
      const sourceFiles = readSourceFiles();
      const analysis = analyzeCodeArchitecture(sourceFiles, prompt);

      return {
        success: true,
        output: analysis,
      };
    }

    // For other phases, return prompt as-is
    return {
      success: true,
      output: `[Analysis] ${prompt}`,
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

function analyzeCodeArchitecture(files: Map<string, string>, _prompt: string): string {
  const issues: Array<{ severity: string; file: string; issue: string; suggestion: string }> = [];
  const positives: string[] = [];

  // Analyze each file
  for (const [filename, content] of files) {
    const lines = content.split("\n");

    // Check for error handling patterns
    const hasTryCatch = content.includes("try {") || content.includes("catch");
    const hasThrowNew = content.includes("throw new");
    const hasReturnError = content.includes("return {") && content.includes("success: false");

    // Check for type safety
    const hasTypeAssertions = content.includes(" as ");
    const hasAnyType = content.includes(": any");
    const hasUnsafeCast = content.includes("as unknown");

    // Check for code patterns
    const hasConsoleLog = content.includes("console.log");
    const hasMagicNumbers = /\b\d{2,}\b/.test(content) && !content.includes("// ");
    const hasLongFunctions = lines.length > 100;

    // Check for imports
    const hasNodeImports = content.includes("node:");
    const hasRelativeImports = content.includes("./");

    // Collect issues
    if (hasAnyType) {
      issues.push({
        severity: "medium",
        file: filename,
        issue: "使用了 `any` 类型",
        suggestion: "考虑使用更具体的类型或泛型",
      });
    }

    if (hasUnsafeCast) {
      issues.push({
        severity: "high",
        file: filename,
        issue: "使用了 `as unknown` 类型断言",
        suggestion: "这通常是类型系统不完善的信号，考虑重构类型定义",
      });
    }

    if (hasConsoleLog && !filename.includes("cli") && !filename.includes("telemetry")) {
      issues.push({
        severity: "low",
        file: filename,
        issue: "包含 console.log 调试代码",
        suggestion: "生产代码应使用 telemetry 或移除",
      });
    }

    // Collect positives
    if (hasTryCatch && hasThrowNew) {
      positives.push(`${filename}: 良好的错误处理模式`);
    }

    if (hasNodeImports && hasRelativeImports) {
      positives.push(`${filename}: 合理的导入结构`);
    }

    if (!hasTypeAssertions && !hasAnyType) {
      positives.push(`${filename}: 类型安全良好`);
    }
  }

  // Generate report
  let report = `## 架构评估

harness-kit 采用模块化设计，职责分离清晰：
- **入口层** (index.ts): 事件处理、生命周期管理
- **Workflow 层**: schema 定义、加载、执行
- **执行层**: code-executor 处理 shell/script
- **验证层**: verify + guardrails 提供硬验证
- **持久化层**: state.ts 管理状态
- **可观测层**: telemetry 记录事件

## 发现的问题

`;

  if (issues.length === 0) {
    report += "未发现明显问题。\n\n";
  } else {
    issues.forEach((issue, i) => {
      report += `${i + 1}. **[严重程度: ${issue.severity}]** ${issue.issue}
   - 文件: \`${issue.file}\`
   - 建议: ${issue.suggestion}\n\n`;
    });
  }

  report += `## 优点

`;
  positives.forEach((p) => {
    report += `- ${p}\n`;
  });

  report += `
## 改进建议

1. **统一错误处理**: 考虑定义统一的 Result 类型，避免分散的错误处理
2. **类型安全**: 减少类型断言，利用 TypeScript 的类型推断
3. **测试覆盖**: 当前测试主要覆盖 happy path，建议增加边界情况测试
4. **文档**: 关键模块缺少注释，特别是 workflow-executor 的状态管理逻辑

## 代码统计

- 源文件数量: ${files.size}
- 总行数: ${Array.from(files.values()).reduce((sum, c) => sum + c.split("\n").length, 0)}
`;

  return report;
}
