import { describe, it, expect } from "vitest";
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

describe("extractResultBlock", () => {
  it("parses valid block", () => {
    const result = extractResultBlock(validBlock);
    expect(result).not.toBeNull();
    expect(result!.currentWork).toBe("Implemented auth middleware");
    expect(result!.facts.length).toBe(1);
    expect(result!.facts[0].file).toBe("src/auth.ts");
  });

  it("returns last block when multiple exist", () => {
    const multi = `${validBlock}\nsome noise\n<HK_RESULT>{"currentWork":"second"}</HK_RESULT>`;
    const result = extractResultBlock(multi);
    expect(result).not.toBeNull();
    expect(result!.currentWork).toBe("second");
  });

  it("returns null for incomplete block", () => {
    expect(extractResultBlock("<HK_RESULT>{")).toBeNull();
  });

  it("returns null for no block", () => {
    expect(extractResultBlock("just terminal output")).toBeNull();
  });

  it("ignores extra fields", () => {
    const block = `<HK_RESULT>{"currentWork":"x","facts":[],"extra":123}</HK_RESULT>`;
    const result = extractResultBlock(block);
    expect(result).not.toBeNull();
    expect(result!.currentWork).toBe("x");
  });
});

describe("hasCompleteResultBlock", () => {
  it("detects completion", () => {
    expect(hasCompleteResultBlock(validBlock)).toBe(true);
    expect(hasCompleteResultBlock("<HK_RESULT>{")).toBe(false);
  });
});
