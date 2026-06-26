#!/usr/bin/env node

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { getModels, getProviders, getEnvApiKey, streamSimple } from "@earendil-works/pi-ai";
import type { KnownProvider } from "@earendil-works/pi-ai";
import { WorkflowRunner } from "./workflow-runner.js";

const { values } = parseArgs({
  options: {
    workflow: { type: "string", short: "w" },
    workspace: { type: "string", short: "d" },
    provider: { type: "string", short: "p", default: "anthropic" },
    model: { type: "string", short: "m" },
    verify: { type: "string", default: "strict" },
    "max-iterations": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  strict: false,
});

if (values.help) {
  console.log(`
harness-kit run — Standalone workflow runner

Usage:
  harness-kit run [options]

Options:
  -w, --workflow <path>     Workflow YAML path (default: built-in feature-impl)
  -d, --workspace <path>    Working directory (default: cwd)
  -p, --provider <name>     AI provider (default: anthropic)
  -m, --model <id>          Model ID
  --verify <mode>           Verification mode: strict|warn|off (default: strict)
  --max-iterations <n>      Max iterations per prompt
  -h, --help                Show this help
`);
  process.exit(0);
}

const provider = values.provider as string;
const providers = getProviders();
if (!providers.includes(provider as KnownProvider)) {
  console.error(`Unknown provider "${provider}". Available: ${providers.join(", ")}`);
  process.exit(1);
}

const models = getModels(provider as KnownProvider);
const modelId = values.model ?? models[0]?.id;
if (!modelId) {
  console.error(`No models available for provider "${provider}"`);
  process.exit(1);
}

const model = models.find((m) => m.id === modelId);
if (!model) {
  console.error(
    `Unknown model "${modelId}" for provider "${provider}". Available: ${models.map((m) => m.id).join(", ")}`,
  );
  process.exit(1);
}

const apiKey = getEnvApiKey(provider);
const streamFn = (m: never, ctx: never, opts: never) =>
  streamSimple(m as never, ctx as never, { ...(opts as object), apiKey } as never);

const verifyMode = values.verify as string;
if (verifyMode !== "strict" && verifyMode !== "warn" && verifyMode !== "off") {
  console.error(`Invalid --verify mode "${verifyMode}". Must be: strict, warn, off`);
  process.exit(1);
}

const cwd = resolve(String(values.workspace ?? process.cwd()));

async function main() {
  const runner = new WorkflowRunner({
    cwd,
    model: model as never,
    streamFn: streamFn as never,
    workflowPath: values.workflow as string | undefined,
    verifyMode: verifyMode as "strict" | "warn" | "off",
    maxIterations: values["max-iterations"] ? Number(values["max-iterations"]) : undefined,
  });

  await runner.start();

  const workflow = runner.getWorkflow();
  console.log(`\n[harness-kit] Workflow: ${runner.getWorkflowName()}`);
  console.log(`[harness-kit] Phases: ${workflow.phases.map((p) => p.name).join(" → ")}`);
  console.log(`[harness-kit] Verify: ${values.verify ?? "strict"}\n`);

  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const question = (prompt: string): Promise<string> =>
    new Promise((r) => rl.question(prompt, r));

  try {
    while (true) {
      const input = await question("\n> ");
      if (!input.trim()) continue;
      if (input.trim() === "/exit" || input.trim() === "/quit") break;

      await runner.prompt(input);
    }
  } finally {
    rl.close();
    await runner.shutdown();
  }
}

main().catch((err) => {
  console.error("[harness-kit] Fatal:", err);
  process.exit(1);
});
