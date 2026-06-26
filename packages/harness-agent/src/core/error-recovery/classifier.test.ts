import { describe, it, expect } from "vitest";
import { classifyError } from "./classifier.js";
import { ErrorType } from "./types.js";

describe("classifyError", () => {
  it("classifies ECONNRESET as TIMEOUT", () => {
    expect(classifyError("bash", "ECONNRESET")).toBe(ErrorType.TIMEOUT);
  });

  it("classifies ETIMEDOUT as TIMEOUT", () => {
    expect(classifyError("bash", "connect ETIMEDOUT")).toBe(ErrorType.TIMEOUT);
  });

  it("classifies socket hang up as TIMEOUT", () => {
    expect(classifyError("bash", "socket hang up")).toBe(ErrorType.TIMEOUT);
  });

  it("classifies 429 as RESOURCE_EXHAUSTED", () => {
    expect(classifyError("llm", "429 Too Many Requests")).toBe(ErrorType.RESOURCE_EXHAUSTED);
  });

  it("classifies rate limit as RESOURCE_EXHAUSTED", () => {
    expect(classifyError("llm", "rate limit exceeded")).toBe(ErrorType.RESOURCE_EXHAUSTED);
  });

  it("classifies throttling as RESOURCE_EXHAUSTED", () => {
    expect(classifyError("llm", "request throttled")).toBe(ErrorType.RESOURCE_EXHAUSTED);
  });

  it("classifies EACCES as PERMISSION_DENIED", () => {
    expect(classifyError("bash", "EACCES: permission denied")).toBe(ErrorType.PERMISSION_DENIED);
  });

  it("classifies 403 as PERMISSION_DENIED", () => {
    expect(classifyError("api", "HTTP 403 Forbidden")).toBe(ErrorType.PERMISSION_DENIED);
  });

  it("classifies JSON.parse as PARSE_ERROR", () => {
    expect(classifyError("bash", "Unexpected token in JSON.parse")).toBe(ErrorType.PARSE_ERROR);
  });

  it("classifies ENOENT as TOOL_ERROR", () => {
    expect(classifyError("read_file", "ENOENT: no such file or directory")).toBe(ErrorType.TOOL_ERROR);
  });

  it("classifies not found as TOOL_ERROR", () => {
    expect(classifyError("read_file", "file not found: /tmp/test.ts")).toBe(ErrorType.TOOL_ERROR);
  });

  it("classifies OOM as RESOURCE_EXHAUSTED", () => {
    expect(classifyError("bash", "JavaScript heap out of memory")).toBe(ErrorType.RESOURCE_EXHAUSTED);
  });

  it("classifies 503 as RESOURCE_EXHAUSTED", () => {
    expect(classifyError("api", "503 Service Unavailable")).toBe(ErrorType.RESOURCE_EXHAUSTED);
  });

  it("classifies unknown errors as UNKNOWN", () => {
    expect(classifyError("bash", "something weird happened")).toBe(ErrorType.UNKNOWN);
  });

  it("classifies empty message as UNKNOWN", () => {
    expect(classifyError("bash", "")).toBe(ErrorType.UNKNOWN);
  });
});
