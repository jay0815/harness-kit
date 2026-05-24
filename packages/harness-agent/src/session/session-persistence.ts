import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

interface PersistEntry {
  type: "session" | "message";
  id: string;
  timestamp: string;
  message?: any;
}

/**
 * Lightweight JSONL persistence for session messages.
 * Stores messages in internal format (toolCall, not tool_use).
 */
export class SessionPersistence {
  private readonly filePath: string;
  private sessionId: string;
  private closed = false;

  constructor(sessionDir: string, sessionId?: string) {
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }
    this.sessionId = sessionId ?? randomUUID();
    this.filePath = join(sessionDir, `${this.sessionId}.jsonl`);
  }

  get id(): string {
    return this.sessionId;
  }

  /** Write a session header entry */
  startSession(): void {
    this.assertNotClosed();
    const entry: PersistEntry = {
      type: "session",
      id: this.sessionId,
      timestamp: new Date().toISOString(),
    };
    this.appendLine(entry);
  }

  /** Append a message in internal format */
  appendMessage(message: any): void {
    this.assertNotClosed();
    const entry: PersistEntry = {
      type: "message",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      message,
    };
    this.appendLine(entry);
  }

  /** Read all messages back. Returns empty array if file doesn't exist. */
  getMessages(): any[] {
    if (!existsSync(this.filePath)) return [];

    const content = readFileSync(this.filePath, "utf-8");
    const messages: any[] = [];

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry: PersistEntry = JSON.parse(line);
        if (entry.type === "message" && entry.message) {
          messages.push(entry.message);
        }
      } catch {
        // skip malformed lines
      }
    }

    return messages;
  }

  /** Close the persistence (no-op, just marks as closed) */
  close(): void {
    this.closed = true;
  }

  private appendLine(entry: PersistEntry): void {
    appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf-8");
  }

  private assertNotClosed(): void {
    if (this.closed) throw new Error("SessionPersistence is closed");
  }
}
