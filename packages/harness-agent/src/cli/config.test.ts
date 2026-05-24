import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveConfig } from "./config.js";
import type { ParsedArgs } from "./args.js";

function makeArgs(overrides?: Partial<ParsedArgs>): ParsedArgs {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    workspace: "/tmp/test",
    systemPrompt: undefined,
    maxIterations: undefined,
    noExtension: false,
    help: false,
    version: false,
    ...overrides,
  };
}

describe("resolveConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns config with cwd resolved", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const config = resolveConfig(makeArgs({ workspace: "/tmp/test" }));
    expect(config.cwd).toBe("/tmp/test");
  });

  it("uses default system prompt when not provided", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const config = resolveConfig(makeArgs());
    expect(config.systemPrompt).toContain("CLI coding assistant");
  });

  it("uses custom system prompt when provided", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const config = resolveConfig(makeArgs({ systemPrompt: "Custom prompt" }));
    expect(config.systemPrompt).toBe("Custom prompt");
  });

  it("sets maxIterations when provided", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const config = resolveConfig(makeArgs({ maxIterations: 5 }));
    expect(config.maxIterations).toBe(5);
  });

  it("leaves maxIterations undefined when not provided", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const config = resolveConfig(makeArgs());
    expect(config.maxIterations).toBeUndefined();
  });

  it("throws when provider is unknown", () => {
    expect(() => resolveConfig(makeArgs({ provider: "nonexistent" }))).toThrow(/Unknown provider/);
  });

  it("throws when model is unknown for provider", () => {
    expect(() => resolveConfig(makeArgs({ model: "nonexistent-model" }))).toThrow(/Unknown model/);
  });

  it("throws when anthropic API key is missing", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => resolveConfig(makeArgs())).toThrow(/No API key/);
  });

  it("throws when openai API key is missing", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => resolveConfig(makeArgs({ provider: "openai", model: "gpt-4o" }))).toThrow(/No API key/);
  });

  it("creates streamFn that is a function", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const config = resolveConfig(makeArgs());
    expect(typeof config.streamFn).toBe("function");
  });

  it("sets model object in config", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const config = resolveConfig(makeArgs());
    expect(config.model).toBeDefined();
    expect((config.model as any).id).toBeDefined();
  });
});
