import { describe, it, expect } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("returns defaults when no args given", () => {
    const args = parseArgs([]);
    expect(args.provider).toBe("anthropic");
    expect(args.model).toBe("claude-sonnet-4-20250514");
    expect(args.workspace).toBe(process.cwd());
    expect(args.systemPrompt).toBeUndefined();
    expect(args.maxIterations).toBeUndefined();
    expect(args.noExtension).toBe(false);
    expect(args.help).toBe(false);
    expect(args.version).toBe(false);
  });

  it("parses --provider", () => {
    const args = parseArgs(["--provider", "openai"]);
    expect(args.provider).toBe("openai");
  });

  it("parses --model", () => {
    const args = parseArgs(["--model", "gpt-4o"]);
    expect(args.model).toBe("gpt-4o");
  });

  it("parses --workspace", () => {
    const args = parseArgs(["--workspace", "/tmp/test"]);
    expect(args.workspace).toBe("/tmp/test");
  });

  it("parses --system-prompt", () => {
    const args = parseArgs(["--system-prompt", "Be helpful"]);
    expect(args.systemPrompt).toBe("Be helpful");
  });

  it("parses --max-iterations", () => {
    const args = parseArgs(["--max-iterations", "5"]);
    expect(args.maxIterations).toBe(5);
  });

  it("parses --no-extension", () => {
    const args = parseArgs(["--no-extension"]);
    expect(args.noExtension).toBe(true);
  });

  it("parses --help", () => {
    const args = parseArgs(["--help"]);
    expect(args.help).toBe(true);
  });

  it("parses --version", () => {
    const args = parseArgs(["--version"]);
    expect(args.version).toBe(true);
  });

  it("parses combined args", () => {
    const args = parseArgs([
      "--provider", "openai",
      "--model", "gpt-4o",
      "--workspace", "/tmp",
      "--max-iterations", "3",
      "--no-extension",
    ]);
    expect(args.provider).toBe("openai");
    expect(args.model).toBe("gpt-4o");
    expect(args.workspace).toBe("/tmp");
    expect(args.maxIterations).toBe(3);
    expect(args.noExtension).toBe(true);
  });

  it("throws on unknown flag", () => {
    expect(() => parseArgs(["--unknown"])).toThrow(/Unknown flag/);
  });

  it("throws on --max-iterations with non-number", () => {
    expect(() => parseArgs(["--max-iterations", "abc"])).toThrow(/must be a number/);
  });

  it("throws on --provider without value", () => {
    expect(() => parseArgs(["--provider"])).toThrow(/requires a value/);
  });

  it("accepts -h as alias for --help", () => {
    const args = parseArgs(["-h"]);
    expect(args.help).toBe(true);
  });

  it("accepts -v as alias for --version", () => {
    const args = parseArgs(["-v"]);
    expect(args.version).toBe(true);
  });

  it("ignores -- separator from pnpm", () => {
    const args = parseArgs(["--", "--help"]);
    expect(args.help).toBe(true);
  });

  it("handles -- separator before value flags", () => {
    const args = parseArgs(["--", "--provider", "openai", "--model", "gpt-4o"]);
    expect(args.provider).toBe("openai");
    expect(args.model).toBe("gpt-4o");
  });
});
