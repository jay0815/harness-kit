import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { snapshotWorkspace, detectOutOfScope } from "./guardrails.js";

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "hk-guard-"));
});

afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe("snapshotWorkspace", () => {
  it("captures files in workspace", () => {
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, "src/foo.ts"), "export const x = 1;");
    writeFileSync(join(ws, "README.md"), "# hello");

    const snap = snapshotWorkspace(ws);
    expect(snap.has("src/foo.ts")).toBe(true);
    expect(snap.has("README.md")).toBe(true);
    expect(snap.get("src/foo.ts")!.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("skips .git directory", () => {
    mkdirSync(join(ws, ".git"), { recursive: true });
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, ".git/config"), "data");
    writeFileSync(join(ws, "src/app.ts"), "code");

    const snap = snapshotWorkspace(ws);
    expect(snap.has(".git/config")).toBe(false);
    expect(snap.has("src/app.ts")).toBe(true);
  });

  it("skips .harness-kit directory", () => {
    mkdirSync(join(ws, ".harness-kit"), { recursive: true });
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, ".harness-kit/state.json"), "{}");
    writeFileSync(join(ws, "src/app.ts"), "code");

    const snap = snapshotWorkspace(ws);
    expect(snap.has(".harness-kit/state.json")).toBe(false);
    expect(snap.has("src/app.ts")).toBe(true);
  });

  it("skips node_modules", () => {
    mkdirSync(join(ws, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(ws, "node_modules/pkg/index.js"), "module.exports = {}");

    const snap = snapshotWorkspace(ws);
    expect(snap.has("node_modules/pkg/index.js")).toBe(false);
  });

  it("does not follow symlinks", () => {
    const outside = mkdtempSync(join(tmpdir(), "hk-guard-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "outside");
      symlinkSync(join(outside, "secret.txt"), join(ws, "linked.txt"));

      const snap = snapshotWorkspace(ws);
      expect(snap.has("linked.txt")).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("detectOutOfScope", () => {
  it("detects new undeclared files", () => {
    writeFileSync(join(ws, "existing.ts"), "old");
    const before = snapshotWorkspace(ws);

    writeFileSync(join(ws, "undeclared.ts"), "new file");
    const after = snapshotWorkspace(ws);

    const result = detectOutOfScope(before, after, ["existing.ts"]);
    expect(result).toContain("undeclared.ts");
    expect(result).not.toContain("existing.ts");
  });

  it("detects modified undeclared files", () => {
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, "src/app.ts"), "v1");
    writeFileSync(join(ws, "src/other.ts"), "original");
    const before = snapshotWorkspace(ws);

    writeFileSync(join(ws, "src/other.ts"), "modified");
    const after = snapshotWorkspace(ws);

    const result = detectOutOfScope(before, after, ["src/app.ts"]);
    expect(result).toContain("src/other.ts");
    expect(result).not.toContain("src/app.ts");
  });

  it("ignores declared files", () => {
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, "src/a.ts"), "before");
    writeFileSync(join(ws, "src/b.ts"), "before");
    const before = snapshotWorkspace(ws);

    writeFileSync(join(ws, "src/a.ts"), "after");
    writeFileSync(join(ws, "src/b.ts"), "after");
    const after = snapshotWorkspace(ws);

    const result = detectOutOfScope(before, after, ["src/a.ts", "src/b.ts"]);
    expect(result).toHaveLength(0);
  });

  it("normalizes declared relative paths", () => {
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, "src/a.ts"), "before");
    const before = snapshotWorkspace(ws);

    writeFileSync(join(ws, "src/a.ts"), "after");
    const after = snapshotWorkspace(ws);

    const result = detectOutOfScope(before, after, ["./src/../src/a.ts"]);
    expect(result).toHaveLength(0);
  });

  it("detects deleted files", () => {
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, "src/temp.ts"), "data");
    const before = snapshotWorkspace(ws);

    rmSync(join(ws, "src/temp.ts"));
    const after = snapshotWorkspace(ws);

    const result = detectOutOfScope(before, after, []);
    expect(result).toContain("src/temp.ts");
  });
});
