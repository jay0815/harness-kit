export interface ParsedArgs {
  provider: string;
  model: string;
  workspace: string;
  systemPrompt: string | undefined;
  maxIterations: number | undefined;
  noExtension: boolean;
  help: boolean;
  version: boolean;
}

const FLAG_DEFS: Record<string, { key: keyof ParsedArgs; needsValue: boolean }> = {
  "--provider":        { key: "provider",       needsValue: true },
  "--model":           { key: "model",          needsValue: true },
  "--workspace":       { key: "workspace",      needsValue: true },
  "--system-prompt":   { key: "systemPrompt",   needsValue: true },
  "--max-iterations":  { key: "maxIterations",  needsValue: true },
  "--no-extension":    { key: "noExtension",    needsValue: false },
  "--help":            { key: "help",           needsValue: false },
  "-h":                { key: "help",           needsValue: false },
  "--version":         { key: "version",        needsValue: false },
  "-v":                { key: "version",        needsValue: false },
};

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    workspace: process.cwd(),
    systemPrompt: undefined,
    maxIterations: undefined,
    noExtension: false,
    help: false,
    version: false,
  };

  const filtered = argv.filter((a) => a !== "--");

  let i = 0;
  while (i < filtered.length) {
    const arg = filtered[i];
    const def = FLAG_DEFS[arg];

    if (!def) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    if (def.needsValue) {
      const value = filtered[++i];
      if (value === undefined) {
        throw new Error(`Flag ${arg} requires a value`);
      }

      if (def.key === "maxIterations") {
        const num = Number(value);
        if (!Number.isFinite(num) || !Number.isInteger(num)) {
          throw new Error(`Flag ${arg} must be a number, got: ${value}`);
        }
        (result as any)[def.key] = num;
      } else {
        (result as any)[def.key] = value;
      }
    } else {
      (result as any)[def.key] = true;
    }

    i++;
  }

  return result;
}
