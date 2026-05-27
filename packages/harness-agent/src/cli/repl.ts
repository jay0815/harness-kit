import readline from "node:readline";
import { HarnessAgentSession } from "../session/harness-session.js";
import type { HarnessAgentSessionConfig, HarnessExtensionAPI } from "../session/types.js";
import * as output from "./output.js";

export interface REPLOptions {
  input?: NodeJS.ReadableStream;
}

export async function startREPL(
  config: HarnessAgentSessionConfig,
  loadExtension: boolean,
  opts?: REPLOptions,
): Promise<void> {
  const session = new HarnessAgentSession(config);

  const rl = readline.createInterface({
    input: opts?.input ?? process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  let busy = false;
  let cleanedUp = false;

  let onSigint: (() => void) | undefined;
  let onSigterm: (() => void) | undefined;

  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;

    if (onSigint) process.off("SIGINT", onSigint);
    if (onSigterm) process.off("SIGTERM", onSigterm);

    rl.close();
    await session.shutdown();
  };

  onSigint = () => {
    void cleanup()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  onSigterm = () => {
    void cleanup()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    if (loadExtension) {
      try {
        const packageName = "@harness-kit/core";
        const coreModule = (await import(packageName)) as {
          default?: (api: HarnessExtensionAPI) => void;
        };
        if (coreModule.default) {
          coreModule.default(session.extensionAPI);
        }
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
          console.log("[harness-agent] @harness-kit/core not available, running in bare mode");
        } else {
          console.error(
            `[harness-agent] Failed to load @harness-kit/core: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    session.extensionAPI.on("turn_start", (event: unknown) => {
      output.turnStart(event as { turnIndex: number });
    });

    session.extensionAPI.on("turn_end", (event: unknown) => {
      output.turnEnd(event as Parameters<typeof output.turnEnd>[0]);
    });

    session.extensionAPI.on("tool_execution_start", (event: unknown) => {
      output.toolStart(event as Parameters<typeof output.toolStart>[0]);
    });

    session.extensionAPI.on("tool_execution_end", (event: unknown) => {
      output.toolEnd(event as Parameters<typeof output.toolEnd>[0]);
    });

    session.extensionAPI.on("agent_end", (event: unknown) => {
      output.agentEnd(event as Parameters<typeof output.agentEnd>[0]);
    });

    await session.start();

    rl.prompt();

    for await (const line of rl) {
      const trimmed = line.trim();

      if (trimmed === "/exit") break;

      if (!trimmed) {
        rl.prompt();
        continue;
      }

      if (busy) {
        console.log("Please wait for the current response...");
        rl.prompt();
        continue;
      }

      busy = true;

      try {
        await session.prompt(trimmed);
      } catch (err) {
        console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        busy = false;
        rl.prompt();
      }
    }
  } finally {
    await cleanup();
  }
}
