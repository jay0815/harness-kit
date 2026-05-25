#!/usr/bin/env node
import { parseArgs } from "./cli/args.js";
import { resolveConfig } from "./cli/config.js";
import { startREPL } from "./cli/repl.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`harness-agent v${version}

Usage: harness-agent [options]

Options:
  --provider <name>       Model provider (default: anthropic)
  --model <id>            Model ID (default: claude-sonnet-4-20250514)
  --workspace <dir>       Working directory (default: cwd)
  --system-prompt <text>  Custom system prompt
  --max-iterations <n>    Maximum agent loop iterations
  --verify <mode>         Fact verification: strict (default), warn, off
  --no-extension          Don't load @harness-kit/core extension
  --help, -h              Show this help
  --version, -v           Show version`);
  process.exit(0);
}

if (args.version) {
  console.log(version);
  process.exit(0);
}

try {
  const config = resolveConfig(args);
  await startREPL(config, !args.noExtension);
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
