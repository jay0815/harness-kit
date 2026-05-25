import { describe, it, expect, vi, beforeEach } from "vitest";
import * as output from "./output.js";

let stdout: string[];

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdout.push(String(chunk));
    return true;
  });
});

function getOutput(): string {
  return stdout.join("");
}

describe("output", () => {
  describe("turnStart", () => {
    it("prints turn index", () => {
      output.turnStart({ turnIndex: 3 } as any);
      expect(getOutput()).toContain("Turn 3");
    });
  });

  describe("turnEnd", () => {
    it("prints assistant text content", () => {
      output.turnEnd({
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      } as any);
      expect(getOutput()).toContain("Hello world");
    });

    it("prints tool_use name and args", () => {
      output.turnEnd({
        message: {
          content: [{ type: "tool_use", id: "tc1", name: "read_file", input: { path: "/test" } }],
        },
      } as any);
      const out = getOutput();
      expect(out).toContain("read_file");
      expect(out).toContain("/test");
    });

    it("handles empty content", () => {
      output.turnEnd({
        message: { content: [] },
      } as any);
      expect(getOutput()).toContain("empty");
    });

    it("handles thinking content", () => {
      output.turnEnd({
        message: {
          content: [
            { type: "thinking", thinking: "reasoning..." },
            { type: "text", text: "Answer" },
          ],
        },
      } as any);
      expect(getOutput()).toContain("Answer");
    });
  });

  describe("toolStart", () => {
    it("prints tool name and args", () => {
      output.toolStart({
        toolName: "bash",
        args: { command: "ls -la" },
      } as any);
      const out = getOutput();
      expect(out).toContain("bash");
      expect(out).toContain("ls -la");
    });
  });

  describe("toolEnd", () => {
    it("prints tool result text", () => {
      output.toolEnd({
        toolName: "bash",
        result: { content: [{ type: "text", text: "file1.txt" }] },
        isError: false,
      } as any);
      expect(getOutput()).toContain("file1.txt");
    });

    it("prints error indicator", () => {
      output.toolEnd({
        toolName: "bash",
        result: { content: [{ type: "text", text: "command not found" }], isError: true },
        isError: true,
      } as any);
      const out = getOutput();
      expect(out).toContain("Error");
      expect(out).toContain("command not found");
    });
  });

  describe("agentEnd", () => {
    it("prints completion message", () => {
      output.agentEnd({ messages: [] } as any);
      expect(getOutput()).toContain("complete");
    });
  });
});
