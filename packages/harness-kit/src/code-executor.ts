import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PhaseConfig, PhaseResult } from "./workflow-schema.js";

interface ExecSyncError extends Error {
  status: number | null;
  stdout: Buffer | null;
  stderr: Buffer | null;
}

export interface ExecuteCodeOptions {
  phase: PhaseConfig;
  workflowDir: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export async function executeCode(options: ExecuteCodeOptions): Promise<PhaseResult> {
  const { phase, workflowDir, env, timeoutMs = 60_000 } = options;
  const startTime = Date.now();

  if (!phase.command && !phase.script) {
    return {
      phaseName: phase.name,
      executor: "code",
      success: false,
      output: "Error: no command or script specified",
      durationMs: Date.now() - startTime,
    };
  }

  try {
    let output: string;
    let success: boolean;

    if (phase.command) {
      // Workflow commands from YAML may use shell features (pipes, redirects)
      // eslint-disable-next-line no-restricted-properties
      const result = execSync(phase.command, {
        cwd: workflowDir,
        env: { ...process.env, ...env },
        timeout: timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
      });
      output = result.toString("utf-8").trim();
      success = true;
    } else {
      const scriptPath = resolve(workflowDir, phase.script!);
      const result = await executeScript(scriptPath, phase.args ?? [], workflowDir, env);
      output = result.output;
      success = result.success;
    }

    return {
      phaseName: phase.name,
      executor: "code",
      success,
      output,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    const execErr = err as ExecSyncError;
    const stdout = execErr.stdout?.toString("utf-8")?.trim() ?? "";
    const stderr = execErr.stderr?.toString("utf-8")?.trim() ?? "";

    return {
      phaseName: phase.name,
      executor: "code",
      success: false,
      output: [stdout, stderr].filter(Boolean).join("\n") || `Exit code: ${execErr.status}`,
      durationMs: Date.now() - startTime,
    };
  }
}

interface ScriptModule {
  default?: (
    args: string[],
    context: { cwd: string; env?: Record<string, string> },
  ) => Promise<{ success: boolean; output: string; artifacts?: string[] }>;
}

async function executeScript(
  scriptPath: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<{ success: boolean; output: string; artifacts?: string[] }> {
  const fileUrl = pathToFileURL(scriptPath).href;

  let mod: ScriptModule;
  try {
    mod = await import(fileUrl);
  } catch (err) {
    return {
      success: false,
      output: `Failed to load script: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (typeof mod.default !== "function") {
    return {
      success: false,
      output: `Script ${scriptPath} does not export a default function`,
    };
  }

  return mod.default(args, { cwd, env });
}
