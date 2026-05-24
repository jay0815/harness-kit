import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeCode } from "./code-executor.js";
import type { PhaseConfig } from "./workflow-schema.js";

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "hk-exec-"));
});

afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe("executeCode", () => {
  it("executes shell command successfully", async () => {
    const phase: PhaseConfig = {
      name: "echo",
      executor: "code",
      command: "echo hello",
    };

    const result = await executeCode({ phase, workflowDir: ws });
    expect(result.success).toBe(true);
    expect(result.output).toBe("hello");
    expect(result.phaseName).toBe("echo");
    expect(result.executor).toBe("code");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures command failure", async () => {
    const phase: PhaseConfig = {
      name: "fail",
      executor: "code",
      command: "exit 1",
    };

    const result = await executeCode({ phase, workflowDir: ws });
    expect(result.success).toBe(false);
    expect(result.phaseName).toBe("fail");
  });

  it("captures stderr on failure", async () => {
    const phase: PhaseConfig = {
      name: "stderr",
      executor: "code",
      command: "echo error >&2 && exit 1",
    };

    const result = await executeCode({ phase, workflowDir: ws });
    expect(result.success).toBe(false);
    expect(result.output).toContain("error");
  });

  it("sets working directory", async () => {
    const phase: PhaseConfig = {
      name: "pwd",
      executor: "code",
      command: "pwd",
    };

    const result = await executeCode({ phase, workflowDir: ws });
    expect(result.success).toBe(true);
    // macOS resolves /var to /private/var, use realpath for comparison
    expect(result.output).toBe(realpathSync(ws));
  });

  it("returns error for missing command/script", async () => {
    const phase: PhaseConfig = {
      name: "empty",
      executor: "code",
    };

    const result = await executeCode({ phase, workflowDir: ws });
    expect(result.success).toBe(false);
    expect(result.output).toContain("no command or script");
  });

  it("executes external script", async () => {
    const scriptContent = `
export default async function(args, context) {
  return {
    success: true,
    output: "Script executed with args: " + args.join(", "),
  };
}
`;
    const scriptPath = join(ws, "test-script.ts");
    writeFileSync(scriptPath, scriptContent);

    const phase: PhaseConfig = {
      name: "script",
      executor: "code",
      script: "test-script.ts",
      args: ["arg1", "arg2"],
    };

    const result = await executeCode({ phase, workflowDir: ws });
    expect(result.success).toBe(true);
    expect(result.output).toBe("Script executed with args: arg1, arg2");
  });

  it("handles script loading error", async () => {
    const phase: PhaseConfig = {
      name: "missing",
      executor: "code",
      script: "nonexistent.ts",
    };

    const result = await executeCode({ phase, workflowDir: ws });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Failed to load script");
  });

  it("handles script without default export", async () => {
    const scriptContent = `export const notDefault = () => {};`;
    const scriptPath = join(ws, "bad-script.ts");
    writeFileSync(scriptPath, scriptContent);

    const phase: PhaseConfig = {
      name: "bad",
      executor: "code",
      script: "bad-script.ts",
    };

    const result = await executeCode({ phase, workflowDir: ws });
    expect(result.success).toBe(false);
    expect(result.output).toContain("does not export a default function");
  });

  it("respects timeout", async () => {
    const phase: PhaseConfig = {
      name: "timeout",
      executor: "code",
      command: "sleep 10",
    };

    const result = await executeCode({ phase, workflowDir: ws, timeoutMs: 100 });
    expect(result.success).toBe(false);
  });
});
