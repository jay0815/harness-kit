import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyFacts } from "./verify.js";
import type { Fact } from "./types.js";

function usage(): never {
  console.error("Usage: harness-verify --input <facts.json> [--workspace <dir>] [--output <report.json>]");
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  let inputFile: string | undefined;
  let workspaceDir = process.cwd();
  let outputFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input":
        if (++i >= args.length) usage();
        inputFile = args[i];
        break;
      case "--workspace":
        if (++i >= args.length) usage();
        workspaceDir = resolve(args[i]);
        break;
      case "--output":
        if (++i >= args.length) usage();
        outputFile = args[i];
        break;
      default:
        usage();
    }
  }

  if (!inputFile) usage();

  const inputPath = resolve(inputFile);
  let facts: Fact[];
  try {
    const raw = readFileSync(inputPath, "utf-8");
    facts = JSON.parse(raw);
    if (!Array.isArray(facts)) {
      console.error("Error: Input file must contain a JSON array of facts");
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error reading input: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const report = verifyFacts(facts, workspaceDir);

  const reportJson = JSON.stringify(report, null, 2);

  if (outputFile) {
    writeFileSync(resolve(outputFile), reportJson + "\n", "utf-8");
    console.log(`Report written to ${outputFile}`);
  } else {
    console.log(reportJson);
  }

  process.exit(report.overall === "PASS" ? 0 : 1);
}

main();
