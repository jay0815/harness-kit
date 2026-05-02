import assert from "node:assert";
import test from "node:test";
import { createDefaultWorkflow } from "./workflow.js";

test("createDefaultWorkflow returns 3 phases", () => {
  const wf = createDefaultWorkflow();
  assert.strictEqual(wf.phases.length, 3);
  assert.strictEqual(wf.phases[0].name, "design");
  assert.strictEqual(wf.phases[1].name, "implement");
  assert.strictEqual(wf.phases[2].name, "test");
});

test("design phase requires human confirmation", () => {
  const wf = createDefaultWorkflow();
  assert.strictEqual(wf.phases[0].humanConfirm, true);
  assert.strictEqual(wf.phases[1].humanConfirm, false);
  assert.strictEqual(wf.phases[2].humanConfirm, true);
});
