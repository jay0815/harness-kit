import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaneError } from "./pane.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn().mockImplementation((cmd: string, args: string[]) => {
    if (cmd === "tmux") {
      if (args[0] === "split-window") return "%42\n";
      if (args[0] === "list-panes") return "%42\n%43\n";
      if (args[0] === "kill-pane") return "";
      return "";
    }
    if (cmd === "tmux-bridge" || cmd.endsWith("tmux-bridge")) {
      if (args[0] === "read") return "output from pane\n";
      if (args[0] === "list")
        return "TARGET SESSION SIZE PROCESS LABEL CWD\n%42 0:0 80x24 zsh - /tmp\n";
      return "";
    }
    return "";
  }),
}));

describe("PaneError", () => {
  it("has correct name", () => {
    const err = new PaneError("test error", "tmux split-window");
    expect(err.name).toBe("PaneError");
    expect(err.message).toBe("test error");
    expect(err.command).toBe("tmux split-window");
  });
});

describe("pane functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createPane returns pane ID", async () => {
    const { createPane } = await import("./pane.js");
    const paneId = createPane();
    expect(paneId).toBe("%42");
  });

  it("labelPane calls bridge", async () => {
    const { labelPane } = await import("./pane.js");
    expect(() => labelPane("%42", "executor")).not.toThrow();
  });

  it("startAgentInPane calls bridge sequence", async () => {
    const { startAgentInPane } = await import("./pane.js");
    expect(() => startAgentInPane("%42", "claude-code")).not.toThrow();
  });

  it("typeToPane calls bridge", async () => {
    const { typeToPane } = await import("./pane.js");
    expect(() => typeToPane("%42", "hello")).not.toThrow();
  });

  it("typeToPane strips terminal control characters", async () => {
    const { execFileSync } = await import("node:child_process");
    const { typeToPane } = await import("./pane.js");

    typeToPane("%42", "hello\x1b[31m\nworld\x07");

    expect(execFileSync).toHaveBeenCalledWith(
      "tmux-bridge",
      ["type", "%42", "hello\nworld"],
      expect.any(Object),
    );
  });

  it("typeToPane strips OSC ANSI sequences", async () => {
    const { execFileSync } = await import("node:child_process");
    const { typeToPane } = await import("./pane.js");

    typeToPane("%42", "hello\x1b]0;title\x07world");

    expect(execFileSync).toHaveBeenCalledWith(
      "tmux-bridge",
      ["type", "%42", "helloworld"],
      expect.any(Object),
    );
  });

  it("sendKeysToPane calls bridge", async () => {
    const { sendKeysToPane } = await import("./pane.js");
    expect(() => sendKeysToPane("%42", "Enter")).not.toThrow();
  });

  it("readPane returns output", async () => {
    const { readPane } = await import("./pane.js");
    const output = readPane("%42", 50);
    expect(output).toBe("output from pane");
  });

  it("isPaneAlive returns true for existing pane", async () => {
    const { isPaneAlive } = await import("./pane.js");
    expect(isPaneAlive("%42")).toBe(true);
  });

  it("isPaneAlive returns false for non-existing pane", async () => {
    const { execFileSync } = await import("node:child_process");
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("no pane");
    });
    const { isPaneAlive } = await import("./pane.js");
    expect(isPaneAlive("%99")).toBe(false);
  });

  it("killPane does not throw", async () => {
    const { killPane } = await import("./pane.js");
    expect(() => killPane("%42")).not.toThrow();
  });

  it("listPanes returns parsed pane info", async () => {
    const { listPanes } = await import("./pane.js");
    const panes = listPanes();
    expect(panes).toHaveLength(1);
    expect(panes[0].id).toBe("%42");
    expect(panes[0].executor).toBe("zsh");
  });
});
