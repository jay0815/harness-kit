import { describe, it, expect } from "vitest";
import {
  ChangeTracker,
  hasUnverifiedChanges,
  isLastVerifyOk,
  getLastVerifyError,
  getUnverifiedFiles,
  isVerifyCommand,
  CHANGE_TRACKER_KEY,
} from "./change-tracker.js";
import type { RuntimeState, AgentToolResult } from "./types.js";
import { cast, getProp, mockToolCall } from "./test-utils.js";

function makeState(): RuntimeState {
  return {
    context: { systemPrompt: "", messages: [] },
    iteration: 0,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextWindow: 200_000 },
    metadata: {},
  };
}

function makeToolCall(name: string, input?: Record<string, unknown>) {
  return mockToolCall(name, input);
}

function makeResult(text = "ok", isError = false): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text }],
    details: null,
    isError,
  };
}

describe("ChangeTracker", () => {
  const tracker = new ChangeTracker();

  it("has correct priority and name", () => {
    expect(tracker.priority).toBe(10);
    expect(tracker.name).toBe("ChangeTracker");
  });

  it("increments codeGen on code-modifying tool", async () => {
    const state = makeState();
    await tracker.afterTool(state, makeToolCall("write_file"), undefined, makeResult());
    expect(getProp(state.metadata[CHANGE_TRACKER_KEY], "codeGen")).toBe(1);
  });

  it("does not increment codeGen on non-code tool", async () => {
    const state = makeState();
    await tracker.afterTool(state, makeToolCall("read_file"), undefined, makeResult());
    expect(state.metadata[CHANGE_TRACKER_KEY]).toBeUndefined();
  });

  it("skips errored results", async () => {
    const state = makeState();
    await tracker.afterTool(
      state,
      makeToolCall("write_file"),
      undefined,
      makeResult("error", true),
    );
    expect(state.metadata[CHANGE_TRACKER_KEY]).toBeUndefined();
  });

  it("sets verifiedGen on successful verify", async () => {
    const state = makeState();
    // First, make a code change
    await tracker.afterTool(state, makeToolCall("write_file"), undefined, makeResult());
    expect(getProp(state.metadata[CHANGE_TRACKER_KEY], "codeGen")).toBe(1);
    expect(getProp(state.metadata[CHANGE_TRACKER_KEY], "verifiedGen")).toBe(0);

    // Then verify
    await tracker.afterTool(state, makeToolCall("verify"), undefined, makeResult());
    expect(getProp(state.metadata[CHANGE_TRACKER_KEY], "verifiedGen")).toBe(1);
    expect(isLastVerifyOk(state)).toBe(true);
  });

  it("tracks verify failure via isError flag", async () => {
    const state = makeState();
    await tracker.afterTool(
      state,
      makeToolCall("verify"),
      undefined,
      makeResult("FAIL: test broken", true),
    );
    // Verify failure updates lastVerifyOk/lastVerifyError but NOT verifiedGen
    expect(isLastVerifyOk(state)).toBe(false);
    expect(getLastVerifyError(state)).toContain("FAIL: test broken");
    expect(getProp(state.metadata[CHANGE_TRACKER_KEY], "verifiedGen")).toBe(0);
  });

  it("detects bash verify commands", async () => {
    const state = makeState();
    await tracker.afterTool(state, makeToolCall("write_file"), undefined, makeResult());

    await tracker.afterTool(
      state,
      makeToolCall("Bash", { command: "pnpm run test" }),
      undefined,
      makeResult(),
    );
    expect(isLastVerifyOk(state)).toBe(true);
    expect(hasUnverifiedChanges(state)).toBe(false);
  });

  it("detects tsc --noEmit as verify", async () => {
    const state = makeState();
    await tracker.afterTool(state, makeToolCall("write_file"), undefined, makeResult());

    await tracker.afterTool(
      state,
      makeToolCall("Bash", { command: "tsc --noEmit" }),
      undefined,
      makeResult(),
    );
    expect(isLastVerifyOk(state)).toBe(true);
  });
});

describe("helper functions", () => {
  it("hasUnverifiedChanges returns false when no changes", () => {
    const state = makeState();
    expect(hasUnverifiedChanges(state)).toBe(false);
  });

  it("hasUnverifiedChanges returns true when codeGen > verifiedGen", () => {
    const state = makeState();
    state.metadata[CHANGE_TRACKER_KEY] = {
      codeGen: 2,
      verifiedGen: 1,
      lastVerifyOk: true,
      lastVerifyError: null,
      changedFiles: [],
    };
    expect(hasUnverifiedChanges(state)).toBe(true);
  });

  it("hasUnverifiedChanges returns false when codeGen === verifiedGen", () => {
    const state = makeState();
    state.metadata[CHANGE_TRACKER_KEY] = {
      codeGen: 2,
      verifiedGen: 2,
      lastVerifyOk: true,
      lastVerifyError: null,
      changedFiles: [],
    };
    expect(hasUnverifiedChanges(state)).toBe(false);
  });

  it("isLastVerifyOk returns false by default", () => {
    expect(isLastVerifyOk(makeState())).toBe(false);
  });

  it("getLastVerifyError returns null by default", () => {
    expect(getLastVerifyError(makeState())).toBeNull();
  });
});

describe("file tracking", () => {
  const tracker = new ChangeTracker();

  it("records generation, path, toolName on code-modifying tool", async () => {
    const state = makeState();
    await tracker.afterTool(
      state,
      makeToolCall("write_file", { path: "src/auth.ts" }),
      undefined,
      makeResult(),
    );
    const files = getUnverifiedFiles(state);
    expect(files).toHaveLength(1);
    expect(files[0].generation).toBe(1);
    expect(files[0].path).toBe("src/auth.ts");
    expect(files[0].toolName).toBe("write_file");
  });

  it("extracts from input.path, input.file_path, arguments.path, arguments.file_path", async () => {
    const state = makeState();

    await tracker.afterTool(
      state,
      makeToolCall("write_file", { path: "a.ts" }),
      undefined,
      makeResult(),
    );
    await tracker.afterTool(
      state,
      makeToolCall("Write", { file_path: "b.ts" }),
      undefined,
      makeResult(),
    );

    // Also test arguments fallback
    const tc3 = mockToolCall("edit_file", undefined, "tc_3");
    cast<Record<string, unknown>>(tc3).arguments = { path: "c.ts" };
    await tracker.afterTool(state, tc3, undefined, makeResult());

    const tc4 = mockToolCall("Edit", undefined, "tc_4");
    cast<Record<string, unknown>>(tc4).arguments = { file_path: "d.ts" };
    await tracker.afterTool(state, tc4, undefined, makeResult());

    const files = getUnverifiedFiles(state);
    expect(files).toHaveLength(4);
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });

  it("trims path whitespace", async () => {
    const state = makeState();
    await tracker.afterTool(
      state,
      makeToolCall("write_file", { path: "  src/auth.ts  " }),
      undefined,
      makeResult(),
    );
    const files = getUnverifiedFiles(state);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/auth.ts");
  });

  it("skips non-string, empty, and whitespace-only paths", async () => {
    const state = makeState();

    await tracker.afterTool(
      state,
      makeToolCall("write_file", { path: 123 }),
      undefined,
      makeResult(),
    );
    await tracker.afterTool(
      state,
      makeToolCall("write_file", { path: "" }),
      undefined,
      makeResult(),
    );
    await tracker.afterTool(
      state,
      makeToolCall("write_file", { path: "   " }),
      undefined,
      makeResult(),
    );
    await tracker.afterTool(state, makeToolCall("write_file", {}), undefined, makeResult());

    expect(getUnverifiedFiles(state)).toHaveLength(0);
    // codeGen should still be 4 (each call increments)
    expect(getProp(state.metadata[CHANGE_TRACKER_KEY], "codeGen")).toBe(4);
  });

  it("returns unverified file after pathless change + verify + pathed change", async () => {
    const state = makeState();

    // Pathless change (codeGen=1, no changedFiles entry)
    await tracker.afterTool(state, makeToolCall("write_file"), undefined, makeResult());
    // Verify (verifiedGen=1)
    await tracker.afterTool(state, makeToolCall("verify"), undefined, makeResult());
    // Pathed change (codeGen=2, changedFiles=[{generation:2}])
    await tracker.afterTool(
      state,
      makeToolCall("write_file", { path: "src/new.ts" }),
      undefined,
      makeResult(),
    );

    const files = getUnverifiedFiles(state);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/new.ts");
    expect(files[0].generation).toBe(2);
  });

  it("does not include verified old files when unverified range has pathless changes", async () => {
    const state = makeState();

    // Pathed change (codeGen=1, changedFiles=[{generation:1, path:"old.ts"}])
    await tracker.afterTool(
      state,
      makeToolCall("write_file", { path: "old.ts" }),
      undefined,
      makeResult(),
    );
    // Verify (verifiedGen=1)
    await tracker.afterTool(state, makeToolCall("verify"), undefined, makeResult());
    // Pathless change (codeGen=2, no changedFiles entry)
    await tracker.afterTool(state, makeToolCall("write_file"), undefined, makeResult());

    const files = getUnverifiedFiles(state);
    expect(files).toHaveLength(0);
  });

  it("deduplicates same file, keeps latest toolName", async () => {
    const state = makeState();

    await tracker.afterTool(
      state,
      makeToolCall("write_file", { path: "src/auth.ts" }),
      undefined,
      makeResult(),
    );
    await tracker.afterTool(
      state,
      makeToolCall("edit_file", { path: "src/auth.ts" }),
      undefined,
      makeResult(),
    );

    const files = getUnverifiedFiles(state);
    expect(files).toHaveLength(1);
    expect(files[0].toolName).toBe("edit_file");
    expect(files[0].generation).toBe(2);
  });

  it("detects bash verify via arguments.command", async () => {
    const state = makeState();
    await tracker.afterTool(
      state,
      makeToolCall("write_file", { path: "a.ts" }),
      undefined,
      makeResult(),
    );

    const tc = mockToolCall("Bash", undefined, "tc_1");
    cast<Record<string, unknown>>(tc).arguments = { command: "pnpm run test" };
    await tracker.afterTool(state, tc, undefined, makeResult());

    expect(isLastVerifyOk(state)).toBe(true);
    expect(hasUnverifiedChanges(state)).toBe(false);
  });
});

describe("getUnverifiedFiles", () => {
  it("ignores dirty entries missing generation, path, or toolName", async () => {
    const state = makeState();
    // Manually inject dirty data
    state.metadata[CHANGE_TRACKER_KEY] = {
      codeGen: 3,
      verifiedGen: 0,
      lastVerifyOk: false,
      lastVerifyError: null,
      changedFiles: [
        { path: "good.ts", toolName: "write_file" }, // missing generation
        { generation: 2, toolName: "write_file" }, // missing path
        { generation: 3, path: "bad.ts" }, // missing toolName
        { generation: 1, path: "", toolName: "write_file" }, // empty path
        { generation: 2, path: "  ", toolName: "write_file" }, // whitespace path
      ],
    };

    const files = getUnverifiedFiles(state);
    expect(files).toHaveLength(0);
  });

  it("returns sorted by generation after dedup", async () => {
    const state = makeState();
    state.metadata[CHANGE_TRACKER_KEY] = {
      codeGen: 4,
      verifiedGen: 0,
      lastVerifyOk: false,
      lastVerifyError: null,
      changedFiles: [
        { generation: 3, path: "c.ts", toolName: "write_file" },
        { generation: 1, path: "a.ts", toolName: "write_file" },
        { generation: 4, path: "b.ts", toolName: "edit_file" },
        { generation: 2, path: "a.ts", toolName: "edit_file" }, // dup, should keep this one
      ],
    };

    const files = getUnverifiedFiles(state);
    expect(files).toHaveLength(3);
    // Dedup: a.ts keeps gen 2, b.ts gen 4, c.ts gen 3
    // Sort by generation: a.ts(2), c.ts(3), b.ts(4)
    expect(files.map((f) => f.path)).toEqual(["a.ts", "c.ts", "b.ts"]);
    expect(files.map((f) => f.generation)).toEqual([2, 3, 4]);
  });
});

describe("isVerifyCommand", () => {
  it("matches npm/pnpm/yarn test", () => {
    expect(isVerifyCommand("npm test")).toBe(true);
    expect(isVerifyCommand("npm run test")).toBe(true);
    expect(isVerifyCommand("pnpm test")).toBe(true);
    expect(isVerifyCommand("pnpm run test")).toBe(true);
    expect(isVerifyCommand("yarn test")).toBe(true);
  });

  it("matches test runners", () => {
    expect(isVerifyCommand("vitest")).toBe(true);
    expect(isVerifyCommand("vitest run")).toBe(true);
    expect(isVerifyCommand("jest")).toBe(true);
    expect(isVerifyCommand("pytest")).toBe(true);
    expect(isVerifyCommand("cargo test")).toBe(true);
    expect(isVerifyCommand("go test")).toBe(true);
  });

  it("matches lint and typecheck", () => {
    expect(isVerifyCommand("npm run lint")).toBe(true);
    expect(isVerifyCommand("pnpm run lint")).toBe(true);
    expect(isVerifyCommand("npm run typecheck")).toBe(true);
    expect(isVerifyCommand("pnpm run typecheck")).toBe(true);
    expect(isVerifyCommand("tsc --noEmit")).toBe(true);
  });

  it("does not match non-verify commands", () => {
    expect(isVerifyCommand("echo hello")).toBe(false);
    expect(isVerifyCommand("ls -la")).toBe(false);
    expect(isVerifyCommand("npm install")).toBe(false);
  });
});
