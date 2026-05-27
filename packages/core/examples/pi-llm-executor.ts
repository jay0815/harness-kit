import { completeSimple } from "@earendil-works/pi-ai";
import type { Model, Context } from "@earendil-works/pi-ai";
import type { LlmExecutor } from "../src/workflow-executor.js";
import type { PhaseConfig } from "../src/workflow-schema.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const KIMI_CREDENTIALS_PATH = join(homedir(), ".kimi", "credentials", "kimi-code.json");
const KIMI_AUTH_URL = "https://auth.kimi.com";
const KIMI_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const BASE_URL = "https://api.kimi.com/coding/v1";

interface KimiToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function loadKimiToken(): KimiToken | null {
  try {
    if (!existsSync(KIMI_CREDENTIALS_PATH)) return null;
    return JSON.parse(readFileSync(KIMI_CREDENTIALS_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function saveKimiToken(token: KimiToken): void {
  mkdirSync(dirname(KIMI_CREDENTIALS_PATH), { recursive: true });
  writeFileSync(KIMI_CREDENTIALS_PATH, JSON.stringify(token), { encoding: "utf-8", mode: 0o600 });
}

async function refreshKimiToken(refreshToken: string): Promise<KimiToken> {
  const response = await fetch(`${KIMI_AUTH_URL}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: KIMI_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(data.error_description || `Refresh failed (${response.status})`);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_at: Date.now() / 1000 + Number(data.expires_in || 3600),
  };
}

async function loadKimiApiKey(): Promise<string | undefined> {
  // 1. Env var
  if (process.env.KIMI_CODER_API_KEY) return process.env.KIMI_CODER_API_KEY;

  // 2. kimi-cli credentials (with auto-refresh)
  const token = loadKimiToken();
  if (!token) return undefined;

  if (token.expires_at > Date.now() / 1000 + 60) {
    return token.access_token;
  }

  // Token expired — try refresh
  if (token.refresh_token) {
    try {
      const refreshed = await refreshKimiToken(token.refresh_token);
      saveKimiToken(refreshed);
      console.log("  [PI] Token refreshed successfully");
      return refreshed.access_token;
    } catch (err) {
      console.error("  [PI] Token refresh failed:", err instanceof Error ? err.message : err);
    }
  }

  return undefined;
}

function buildModel(modelId: string): Model<"openai-completions"> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "kimi-coder",
    baseUrl: BASE_URL,
    headers: { "User-Agent": "KimiCLI/1.5" },
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 32768,
    compat: {
      thinkingFormat: "zai",
      maxTokensField: "max_tokens",
      supportsDeveloperRole: false,
      supportsStore: false,
    },
  };
}

export interface PiLlmExecutorOptions {
  modelId?: string;
  maxTokens?: number;
  systemPrompt?: string;
  buildContext?: (phase: PhaseConfig, previousResults: Map<string, string>) => string;
}

export function createPiLlmExecutor(options: PiLlmExecutorOptions = {}): LlmExecutor {
  const {
    modelId = "kimi-for-coding",
    maxTokens = 16384,
    systemPrompt = "You are a code reviewer. Analyze the provided code and give detailed feedback.",
    buildContext,
  } = options;

  return {
    execute: async (phase, context) => {
      const prompt = phase.prompt ?? "";
      const model = buildModel(modelId);
      const apiKey = await loadKimiApiKey();

      if (!apiKey) {
        return {
          success: false,
          output: "No Kimi API key found. Run `kimi-cli login` or set KIMI_CODER_API_KEY.",
        };
      }

      const userContent = buildContext ? buildContext(phase, context.previousResults) : prompt;

      const messages: Context = {
        systemPrompt,
        messages: [{ role: "user", content: userContent, timestamp: Date.now() }],
      };

      console.log(`  [PI] Calling ${model.id}...`);

      try {
        const response = await completeSimple(model, messages, {
          maxTokens,
          apiKey,
          reasoning: "low",
          signal: context.signal,
        });

        console.log(`  [PI] Done. Stop: ${response.stopReason}, items: ${response.content.length}`);
        console.log(`  [PI] Content types: ${response.content.map((c) => c.type).join(", ")}`);

        const textParts = response.content.filter((c) => c.type === "text");
        const thinkingParts = response.content.filter((c) => c.type === "thinking");
        const output =
          textParts.map((c) => c.text).join("\n") ||
          thinkingParts.map((c) => c.thinking).join("\n");

        return { success: true, output: output || "(No text content in response)" };
      } catch (err) {
        console.error(`  [PI] Error:`, err);
        return {
          success: false,
          output: `LLM Error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
