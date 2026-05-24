import { describe, it, expect } from "vitest";
import { greet } from "./greet.js";

describe("greet", () => {
  it("returns personalized greeting for non-empty name", () => {
    expect(greet("Alice")).toBe("Hello, Alice!");
    expect(greet("Bob")).toBe("Hello, Bob!");
  });

  it('returns "Hello, World!" for empty string', () => {
    expect(greet("")).toBe("Hello, World!");
  });
});
