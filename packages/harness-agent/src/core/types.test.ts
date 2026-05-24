import { describe, it, expect } from "vitest";
import { IterationBudget, AGENT_B_TOKEN_THRESHOLD, COMPACTION_THRESHOLD } from "./types.js";

describe("IterationBudget", () => {
  it("starts with full budget", () => {
    const budget = new IterationBudget(10);
    expect(budget.remaining).toBe(10);
    expect(budget.total).toBe(10);
  });

  it("consume decrements remaining", () => {
    const budget = new IterationBudget(3);
    expect(budget.consume()).toBe(true);
    expect(budget.remaining).toBe(2);
    expect(budget.consume()).toBe(true);
    expect(budget.remaining).toBe(1);
    expect(budget.consume()).toBe(true);
    expect(budget.remaining).toBe(0);
  });

  it("consume returns false when exhausted", () => {
    const budget = new IterationBudget(1);
    budget.consume();
    expect(budget.consume()).toBe(false);
    expect(budget.remaining).toBe(0);
  });

  it("refund adds back to remaining", () => {
    const budget = new IterationBudget(5);
    budget.consume();
    budget.consume();
    expect(budget.remaining).toBe(3);
    budget.refund(2);
    expect(budget.remaining).toBe(5);
  });

  it("refund does not exceed total", () => {
    const budget = new IterationBudget(3);
    budget.consume();
    budget.refund(10);
    expect(budget.remaining).toBe(3);
  });

  it("refund defaults to 1", () => {
    const budget = new IterationBudget(3);
    budget.consume();
    budget.refund();
    expect(budget.remaining).toBe(3);
  });
});

describe("constants", () => {
  it("AGENT_B_TOKEN_THRESHOLD is 0.9", () => {
    expect(AGENT_B_TOKEN_THRESHOLD).toBe(0.9);
  });

  it("COMPACTION_THRESHOLD is 0.75", () => {
    expect(COMPACTION_THRESHOLD).toBe(0.75);
  });
});
