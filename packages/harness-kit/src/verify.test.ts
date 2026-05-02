import assert from "node:assert";
import test from "node:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyFacts } from "./verify.js";
import type { Fact } from "./types.js";

let tmpDir: string;

test.beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "hk-test-"));
});

test.afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("verifyFacts passes for exact match", () => {
  writeFileSync(join(tmpDir, "a.ts"), "line1\nline2\nline3\n");
  const facts: Fact[] = [
    { file: "a.ts", startLine: 2, endLine: 3, exactText: "line2\nline3" },
  ];
  const report = verifyFacts(facts, tmpDir);
  assert.strictEqual(report.overall, "PASS");
  assert.strictEqual(report.checks[0].status, "PASS");
});

test("verifyFacts fails for text mismatch", () => {
  writeFileSync(join(tmpDir, "a.ts"), "line1\nline2\nline3\n");
  const facts: Fact[] = [
    { file: "a.ts", startLine: 2, endLine: 3, exactText: "wrong\ntext" },
  ];
  const report = verifyFacts(facts, tmpDir);
  assert.strictEqual(report.overall, "FAIL");
  assert.strictEqual(report.checks[0].status, "FAIL");
  assert.strictEqual(report.checks[0].actual, "line2\nline3");
});

test("verifyFacts fails for missing file", () => {
  const facts: Fact[] = [
    { file: "missing.ts", startLine: 1, endLine: 2, exactText: "x" },
  ];
  const report = verifyFacts(facts, tmpDir);
  assert.strictEqual(report.overall, "FAIL");
  assert.ok(report.checks[0].error?.includes("Cannot read file"));
});

test("verifyFacts fails for out of range line", () => {
  writeFileSync(join(tmpDir, "a.ts"), "line1\n");
  const facts: Fact[] = [
    { file: "a.ts", startLine: 5, endLine: 6, exactText: "x" },
  ];
  const report = verifyFacts(facts, tmpDir);
  assert.strictEqual(report.overall, "FAIL");
  assert.ok(report.checks[0].error?.includes("out of range"));
});
