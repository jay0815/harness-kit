import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { Value } from "@sinclair/typebox/value";
import type { WorkflowConfig, PhaseConfig } from "./workflow-schema.js";
import { WorkflowConfig as WorkflowConfigSchema } from "./workflow-schema.js";

export class WorkflowLoadError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "WorkflowLoadError";
  }
}

export function loadWorkflow(filePath: string): WorkflowConfig {
  const absPath = resolve(filePath);
  let content: string;

  try {
    content = readFileSync(absPath, "utf-8");
  } catch (err) {
    throw new WorkflowLoadError(`Cannot read workflow file: ${absPath}`, err);
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    throw new WorkflowLoadError(`Invalid YAML in ${absPath}`, err);
  }

  if (!Value.Check(WorkflowConfigSchema, raw)) {
    const errors = [...Value.Errors(WorkflowConfigSchema, raw)];
    throw new WorkflowLoadError(`Workflow validation failed`, errors);
  }

  const config = raw as WorkflowConfig;
  validatePhaseConfigs(config, absPath);

  return config;
}

function validatePhaseConfigs(config: WorkflowConfig, filePath: string): void {
  const baseDir = dirname(filePath);
  const names = new Set<string>();

  for (const phase of config.phases) {
    // Check duplicate names
    if (names.has(phase.name)) {
      throw new WorkflowLoadError(`Duplicate phase name: "${phase.name}"`);
    }
    names.add(phase.name);

    // Validate executor-specific fields
    if (phase.executor === "llm") {
      if (!phase.prompt) {
        throw new WorkflowLoadError(
          `Phase "${phase.name}": executor "llm" requires "prompt"`,
        );
      }
    } else if (phase.executor === "code") {
      if (!phase.command && !phase.script) {
        throw new WorkflowLoadError(
          `Phase "${phase.name}": executor "code" requires "command" or "script"`,
        );
      }
      if (phase.command && phase.script) {
        throw new WorkflowLoadError(
          `Phase "${phase.name}": cannot specify both "command" and "script"`,
        );
      }
      // Script path is relative to workflow file
      if (phase.script) {
        resolve(baseDir, phase.script);
      }
    }
  }
}

// Template substitution: {{phaseName.output}} → actual output
export function substituteTemplate(
  template: string,
  results: Map<string, string>,
): string {
  return template.replace(/\{\{(\w+)\.output\}\}/g, (_match, phaseName) => {
    const output = results.get(phaseName);
    if (output === undefined) {
      return `{{${phaseName}.output}}`; // Keep as-is if not found
    }
    return output;
  });
}
