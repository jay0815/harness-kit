import { describe, it, expect } from "vitest";
import { createDefaultWorkflow } from "./workflow.js";

describe("createDefaultWorkflow", () => {
  it("returns 3 phases", () => {
    const wf = createDefaultWorkflow();
    expect(wf.phases.length).toBe(3);
    expect(wf.phases[0].name).toBe("design");
    expect(wf.phases[1].name).toBe("implement");
    expect(wf.phases[2].name).toBe("test");
  });

  it("design phase requires human confirmation", () => {
    const wf = createDefaultWorkflow();
    expect(wf.phases[0].humanConfirm).toBe(true);
    expect(wf.phases[1].humanConfirm).toBe(false);
    expect(wf.phases[2].humanConfirm).toBe(true);
  });

  it("does not ask PI scheduler phases to output legacy HK_RESULT blocks", () => {
    const wf = createDefaultWorkflow();
    for (const phase of wf.phases) {
      expect(phase.prompt).not.toContain("<HK_RESULT>");
      expect(phase.prompt).not.toContain("</HK_RESULT>");
    }
  });
});
