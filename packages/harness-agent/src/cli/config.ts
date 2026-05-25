import { resolve } from "node:path";
import { getModel, getModels, getProviders, getEnvApiKey, streamSimple } from "@earendil-works/pi-ai";
import type { Model, StreamFn } from "../core/types.js";
import type { HarnessAgentSessionConfig } from "../session/types.js";
import type { ParsedArgs } from "./args.js";

const DEFAULT_SYSTEM_PROMPT =
  "You are a CLI coding assistant. Answer based on actual context. Do not pretend to execute operations you haven't performed.";

const KEY_REQUIRED_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "deepseek",
  "groq",
  "xai",
  "openrouter",
]);

export function resolveConfig(args: ParsedArgs): HarnessAgentSessionConfig {
  const providers = getProviders();
  if (!providers.includes(args.provider as any)) {
    throw new Error(`Unknown provider "${args.provider}". Available: ${providers.join(", ")}`);
  }

  let model: Model<any> | undefined;
  try {
    model = getModel(args.provider as any, args.model as any) as Model<any> | undefined;
  } catch {
    model = undefined;
  }
  if (!model) {
    const models = getModels(args.provider as any).map((m) => m.id);
    throw new Error(
      `Unknown model "${args.model}" for provider "${args.provider}". Available: ${models.join(", ")}`,
    );
  }

  const apiKey = getEnvApiKey(args.provider);
  if (KEY_REQUIRED_PROVIDERS.has(args.provider) && !apiKey) {
    throw new Error(`No API key found for provider "${args.provider}".`);
  }

  const streamFn: StreamFn = (model, context, options) =>
    streamSimple(model, context, { ...options, apiKey });

  return {
    cwd: resolve(args.workspace),
    model,
    systemPrompt: args.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    streamFn,
    maxIterations: args.maxIterations,
    verifyMode: args.verify ?? "strict",
    maxVerificationRetries: 3,
  };
}
