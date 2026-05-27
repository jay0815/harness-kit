import { describe, it, expect, vi, beforeEach } from "vitest";
import * as output from "./output.js";
import { cast } from "../core/test-utils.js";

let stdout: string[];

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
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
      output.turnStart(cast<Parameters<typeof output.turnStart>[0]>({ turnIndex: 3 }));
      expect(getOutput()).toContain("Turn 3");
    });
  });

  describe("turnEnd", () => {
    it("prints assistant text content", () => {
      output.turnEnd(
        cast<Parameters<typeof output.turnEnd>[0]>({
          message: {
            content: [{ type: "text", text: "Hello world" }],
          },
        }),
      );
      expect(getOutput()).toContain("Hello world");
    });

    it("prints tool_use name and args", () => {
      output.turnEnd(
        cast<Parameters<typeof output.turnEnd>[0]>({
          message: {
            content: [{ type: "tool_use", id: "tc1", name: "read_file", input: { path: "/test" } }],
          },
        }),
      );
      const out = getOutput();
      expect(out).toContain("read_file");
      expect(out).toContain("/test");
    });

    it("handles empty content", () => {
      output.turnEnd(
        cast<Parameters<typeof output.turnEnd>[0]>({
          message: { content: [] },
        }),
      );
      expect(getOutput()).toContain("empty");
    });

    it("handles thinking content", () => {
      output.turnEnd(
        cast<Parameters<typeof output.turnEnd>[0]>({
          message: {
            content: [
              { type: "thinking", thinking: "reasoning..." },
              { type: "text", text: "Answer" },
            ],
          },
        }),
      );
      expect(getOutput()).toContain("Answer");
    });
  });

  describe("toolStart", () => {
    it("prints tool name and args", () => {
      output.toolStart(
        cast<Parameters<typeof output.toolStart>[0]>({
          toolName: "bash",
          args: { command: "ls -la" },
        }),
      );
      const out = getOutput();
      expect(out).toContain("bash");
      expect(out).toContain("ls -la");
    });
  });

  describe("toolEnd", () => {
    it("prints tool result text", () => {
      output.toolEnd(
        cast<Parameters<typeof output.toolEnd>[0]>({
          toolName: "bash",
          result: { content: [{ type: "text", text: "file1.txt" }] },
          isError: false,
        }),
      );
      expect(getOutput()).toContain("file1.txt");
    });

    it("prints error indicator", () => {
      output.toolEnd(
        cast<Parameters<typeof output.toolEnd>[0]>({
          toolName: "bash",
          result: { content: [{ type: "text", text: "command not found" }], isError: true },
          isError: true,
        }),
      );
      const out = getOutput();
      expect(out).toContain("Error");
      expect(out).toContain("command not found");
    });
  });

  describe("agentEnd", () => {
    it("prints completion message", () => {
      output.agentEnd(cast<Parameters<typeof output.agentEnd>[0]>({ messages: [] }));
      expect(getOutput()).toContain("complete");
    });
  });
});
