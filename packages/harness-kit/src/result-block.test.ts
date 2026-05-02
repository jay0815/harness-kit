import assert from "node:assert";
import test from "node:test";
import { extractResultBlock, hasCompleteResultBlock } from "./result-block.js";

const validBlock = `<HK_RESULT>
{
  "currentWork": "Implemented auth middleware",
  "facts": [
    {
      "file": "src/auth.ts",
      "startLine": 1,
      "endLine": 5,
      "exactText": "const verify = (t: string) => {}"
    }
  ],
  "reasoning": "Used JWT pattern"
}
</HK_RESULT>`;

test("extractResultBlock parses valid block", () => {
  const result = extractResultBlock(validBlock);
  assert.ok(result);
  assert.strictEqual(result!.currentWork, "Implemented auth middleware");
  assert.strictEqual(result!.facts.length, 1);
  assert.strictEqual(result!.facts[0].file, "src/auth.ts");
});

test("extractResultBlock returns last block when multiple exist", () => {
  const multi = `${validBlock}\nsome noise\n<HK_RESULT>{"currentWork":"second"}</HK_RESULT>`;
  const result = extractResultBlock(multi);
  assert.ok(result);
  assert.strictEqual(result!.currentWork, "second");
});

test("extractResultBlock returns null for incomplete block", () => {
  assert.strictEqual(extractResultBlock("<HK_RESULT>{"), null);
});

test("extractResultBlock returns null for no block", () => {
  assert.strictEqual(extractResultBlock("just terminal output"), null);
});

test("hasCompleteResultBlock detects completion", () => {
  assert.strictEqual(hasCompleteResultBlock(validBlock), true);
  assert.strictEqual(hasCompleteResultBlock("<HK_RESULT>{"), false);
});

test("extractResultBlock ignores extra fields", () => {
  const block = `<HK_RESULT>{"currentWork":"x","facts":[],"extra":123}</HK_RESULT>`;
  const result = extractResultBlock(block);
  assert.ok(result);
  assert.strictEqual(result!.currentWork, "x");
});
