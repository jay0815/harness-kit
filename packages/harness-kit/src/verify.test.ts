import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { writeFileSync, mkdirSync, symlinkSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyFacts } from "./verify.js";
import type { Fact } from "./types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "hk-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("verifyFacts", () => {
  it("passes for exact match", () => {
    writeFileSync(join(tmpDir, "a.ts"), "line1\nline2\nline3\n");
    const facts: Fact[] = [
      { file: "a.ts", startLine: 2, endLine: 3, exactText: "line2\nline3" },
    ];
    const report = verifyFacts(facts, tmpDir);
    expect(report.overall).toBe("PASS");
    expect(report.checks[0].status).toBe("PASS");
  });

  it("fails for text mismatch", () => {
    writeFileSync(join(tmpDir, "a.ts"), "line1\nline2\nline3\n");
    const facts: Fact[] = [
      { file: "a.ts", startLine: 2, endLine: 3, exactText: "wrong\ntext" },
    ];
    const report = verifyFacts(facts, tmpDir);
    expect(report.overall).toBe("FAIL");
    expect(report.checks[0].status).toBe("FAIL");
    expect(report.checks[0].actual).toBe("line2\nline3");
  });

  it("fails for missing file", () => {
    const facts: Fact[] = [
      { file: "missing.ts", startLine: 1, endLine: 2, exactText: "x" },
    ];
    const report = verifyFacts(facts, tmpDir);
    expect(report.overall).toBe("FAIL");
    expect(report.checks[0].error).toContain("Cannot read file");
  });

  it("fails for out of range line", () => {
    writeFileSync(join(tmpDir, "a.ts"), "line1\n");
    const facts: Fact[] = [
      { file: "a.ts", startLine: 5, endLine: 6, exactText: "x" },
    ];
    const report = verifyFacts(facts, tmpDir);
    expect(report.overall).toBe("FAIL");
    expect(report.checks[0].error).toContain("out of range");
  });

  it("rejects absolute path", () => {
    const facts: Fact[] = [
      { file: "/etc/passwd", startLine: 1, endLine: 2, exactText: "x" },
    ];
    const report = verifyFacts(facts, tmpDir);
    expect(report.overall).toBe("FAIL");
    expect(report.checks[0].error).toContain("Absolute path not allowed");
  });

  it("rejects path traversal escaping workspace", () => {
    const facts: Fact[] = [
      { file: "../../etc/passwd", startLine: 1, endLine: 2, exactText: "x" },
    ];
    const report = verifyFacts(facts, tmpDir);
    expect(report.overall).toBe("FAIL");
    expect(report.checks[0].error).toContain("Path escapes workspace");
  });

  it("allows valid relative path with subdirectories", () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "a.ts"), "line1\n");
    const facts: Fact[] = [
      { file: "src/a.ts", startLine: 1, endLine: 1, exactText: "line1" },
    ];
    const report = verifyFacts(facts, tmpDir);
    expect(report.overall).toBe("PASS");
  });

  it("rejects symlink escaping workspace", () => {
    const externalDir = mkdtempSync(join(tmpdir(), "hk-ext-"));
    writeFileSync(join(externalDir, "secret.txt"), "secret\n");
    mkdirSync(join(tmpDir, "link"), { recursive: true });
    symlinkSync(join(externalDir, "secret.txt"), join(tmpDir, "link", "s.txt"));
    const facts: Fact[] = [
      { file: "link/s.txt", startLine: 1, endLine: 1, exactText: "secret" },
    ];
    const report = verifyFacts(facts, tmpDir);
    expect(report.overall).toBe("FAIL");
    expect(report.checks[0].error).toContain("Symlink escapes workspace");
    rmSync(externalDir, { recursive: true, force: true });
  });
});
