import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join, normalize, relative } from "node:path";
import { createHash } from "node:crypto";
import type { SnapshotEntry } from "./types.js";

const SKIP_DIRS = new Set([".git", ".harness-kit", "node_modules"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB - avoid hashing larger files

export type WorkspaceSnapshot = Map<string, SnapshotEntry>;

export function snapshotWorkspace(workspaceDir: string): WorkspaceSnapshot {
  const snapshot: WorkspaceSnapshot = new Map();
  walkDir(workspaceDir, workspaceDir, snapshot);
  return snapshot;
}

function walkDir(root: string, dir: string, snapshot: WorkspaceSnapshot): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    if (entry.isSymbolicLink()) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(root, fullPath, snapshot);
    } else if (entry.isFile()) {
      const relPath = normalizeSnapshotPath(relative(root, fullPath));
      try {
        const st = statSync(fullPath);
        // Use mtimeNs if available (Node 22+), otherwise convert from mtimeMs with better precision
        const mtimeNs = getMtimeNs(st);
        if (st.size > MAX_FILE_SIZE) {
          snapshot.set(relPath, {
            size: st.size,
            mtimeNs,
            sha256: `large:${st.size}:${mtimeNs.toString()}`,
          });
          continue;
        }
        const content = readFileSync(fullPath);
        const sha256 = createHash("sha256").update(content).digest("hex");
        snapshot.set(relPath, { size: st.size, mtimeNs, sha256 });
      } catch {
        // skip unreadable files
      }
    }
  }
}

export function detectOutOfScope(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  declaredFiles: string[],
): string[] {
  const declared = new Set(declaredFiles.map(normalizeSnapshotPath));
  const allKeys = new Set([...before.keys(), ...after.keys()]);
  const outOfScope: string[] = [];

  for (const key of allKeys) {
    if (declared.has(key)) continue;

    const beforeEntry = before.get(key);
    const afterEntry = after.get(key);

    if (!beforeEntry && afterEntry) {
      outOfScope.push(key);
    } else if (beforeEntry && !afterEntry) {
      outOfScope.push(key);
    } else if (beforeEntry && afterEntry && beforeEntry.sha256 !== afterEntry.sha256) {
      outOfScope.push(key);
    }
  }

  return outOfScope.sort();
}

function normalizeSnapshotPath(filePath: string): string {
  return normalize(filePath).replace(/\\/g, "/").replace(/^\.\//, "");
}

function getMtimeNs(st: { mtimeMs: number; mtimeNs?: bigint }): bigint {
  return st.mtimeNs ?? BigInt(Math.round(st.mtimeMs * 1_000_000));
}
