import { describe, it, expect, vi } from "vitest";
import { setWorkspaceDir, harnessKitTools, startAgentTool, acpSendTool, acpReadTool, hardVerifyTool } from "./tools.js";

vi.mock("./pane.js", () => ({
  createPane: vi.fn().mockReturnValue("%42"),
  labelPane: vi.fn(),
  startAgentInPane: vi.fn(),
  typeToPane: vi.fn(),
  sendKeysToPane: vi.fn(),
  readPane: vi.fn().mockReturnValue(""),
  isPaneAlive: vi.fn().mockReturnValue(true),
}));

vi.mock("./telemetry.js", () => ({
  emit: vi.fn(),
}));

describe("harnessKitTools", () => {
  it("exports 4 tools", () => {
    expect(harnessKitTools).toHaveLength(4);
  });

  it("has correct tool names", () => {
    const names = harnessKitTools.map((t) => t.name);
    expect(names).toContain("start_agent");
    expect(names).toContain("acp_send");
    expect(names).toContain("acp_read");
    expect(names).toContain("hard_verify");
  });
});

describe("setWorkspaceDir", () => {
  it("sets workspace directory", () => {
    expect(() => setWorkspaceDir("/tmp/test")).not.toThrow();
  });
});

describe("startAgentTool", () => {
  it("has correct metadata", () => {
    expect(startAgentTool.name).toBe("start_agent");
    expect(startAgentTool.label).toBe("Start Agent");
    expect(startAgentTool.description).toContain("tmux");
  });

  it("creates pane and starts agent", async () => {
    const { createPane, labelPane, startAgentInPane } = await import("./pane.js");
    const result = await startAgentTool.execute("tc-1", {
      role: "executor",
      executor: "claude-code",
    });

    expect(createPane).toHaveBeenCalled();
    expect(labelPane).toHaveBeenCalledWith("%42", "executor");
    expect(startAgentInPane).toHaveBeenCalled();
    expect(result.details).toEqual({ paneId: "%42", role: "executor" });
  });

  it("handles contextFiles", async () => {
    const { startAgentInPane } = await import("./pane.js");
    const mockFn = startAgentInPane as ReturnType<typeof vi.fn>;
    mockFn.mockClear();

    await startAgentTool.execute("tc-2", {
      role: "worker",
      executor: "codex",
      contextFiles: ["src/a.ts", "src/b.ts"],
    });

    expect(mockFn).toHaveBeenCalled();
    const call = mockFn.mock.calls[0];
    // Executor is shell-quoted for injection prevention
    expect(call[1]).toContain("'codex'");
    expect(call[1]).toContain("'src/a.ts'");
    expect(call[1]).toContain("'src/b.ts'");
  });
});

describe("acpSendTool", () => {
  it("has correct metadata", () => {
    expect(acpSendTool.name).toBe("acp_send");
    expect(acpSendTool.label).toBe("ACP Send");
  });

  it("returns error when agent not found", async () => {
    const result = await acpSendTool.execute("tc-3", {
      target: "nonexistent",
      task: "do something",
    });

    expect(result.details).toEqual({ error: "AGENT_NOT_FOUND" });
    expect(result.content[0].text).toContain("No agent found");
  });

  it("sends task to existing agent", async () => {
    const { typeToPane, sendKeysToPane } = await import("./pane.js");

    // First register an agent
    await startAgentTool.execute("tc-4", { role: "worker", executor: "claude" });

    // Then send a task
    const result = await acpSendTool.execute("tc-5", {
      target: "worker",
      task: "Fix the bug",
    });

    expect(typeToPane).toHaveBeenCalled();
    expect(sendKeysToPane).toHaveBeenCalledWith("%42", "Enter");
    expect(result.details).toEqual({ target: "worker" });
  });
});

describe("acpReadTool", () => {
  it("has correct metadata", () => {
    expect(acpReadTool.name).toBe("acp_read");
    expect(acpReadTool.label).toBe("ACP Read");
  });

  it("returns error when agent not found", async () => {
    const result = await acpReadTool.execute("tc-6", {
      target: "nonexistent",
    });

    expect(result.details).toEqual({ error: "AGENT_NOT_FOUND" });
  });

  it("returns PENDING when no HK_RESULT block", async () => {
    const { readPane } = await import("./pane.js");
    (readPane as ReturnType<typeof vi.fn>).mockReturnValue("Still working...");

    // Register an agent first
    await startAgentTool.execute("tc-7", { role: "reader", executor: "claude" });

    const result = await acpReadTool.execute("tc-8", { target: "reader" });
    expect(result.details).toEqual({ status: "PENDING" });
  });

  it("returns COMPLETE when HK_RESULT block found", async () => {
    const { readPane } = await import("./pane.js");
    (readPane as ReturnType<typeof vi.fn>).mockReturnValue(
      'Done!\n<HK_RESULT>\n{"currentWork":"fixed bug","facts":[{"file":"a.ts","startLine":1,"endLine":3,"exactText":"hello"}]}\n</HK_RESULT>',
    );

    await startAgentTool.execute("tc-9", { role: "completer", executor: "claude" });

    const result = await acpReadTool.execute("tc-10", { target: "completer" });
    expect(result.details).toHaveProperty("status", "COMPLETE");
    expect(result.details).toHaveProperty("result");
  });
});

describe("hardVerifyTool", () => {
  it("has correct metadata", () => {
    expect(hardVerifyTool.name).toBe("hard_verify");
    expect(hardVerifyTool.label).toBe("Hard Verify");
  });

  it("verifies facts against disk", async () => {
    setWorkspaceDir(process.cwd());

    const result = await hardVerifyTool.execute("tc-11", {
      facts: [
        {
          file: "package.json",
          startLine: 2,
          endLine: 2,
          exactText: '  "name": "harness-kit",',
        },
      ],
    });

    expect(result.details).toHaveProperty("overall");
    expect(result.content[0].text).toContain("Hard Verification");
  });

  it("reports FAIL for incorrect facts", async () => {
    setWorkspaceDir(process.cwd());

    const result = await hardVerifyTool.execute("tc-12", {
      facts: [
        {
          file: "package.json",
          startLine: 2,
          endLine: 2,
          exactText: '  "name": "wrong-name",',
        },
      ],
    });

    expect(result.details).toHaveProperty("overall", "FAIL");
  });
});
