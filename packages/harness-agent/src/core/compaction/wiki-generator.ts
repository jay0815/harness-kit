import type { Api } from "@earendil-works/pi-ai";
import type { Model, StreamFn, AgentMessage } from "../types.js";
import type { WikiEntry, WikiScore } from "./types.js";

export interface WikiGeneratorConfig {
  model: Model<Api>;
  streamFn: StreamFn;
}

const WIKI_GENERATION_PROMPT = `You are a wiki generator. Given a conversation history, produce a structured knowledge summary.

Output strict JSON only, no other content.

Format:
{
  "projectGoals": "What the project is trying to achieve",
  "completedWork": "What has been done so far",
  "keyDecisions": "Important decisions made and why",
  "fileChanges": "Files modified and why",
  "problemsAndSolutions": "Issues encountered and how they were resolved",
  "unfinishedTasks": "What remains to be done"
}

Rules:
- Be concise but complete
- Focus on facts, not opinions
- Include specific file names and function names when relevant
- If a section has no relevant info, use an empty string`;

const WIKI_SCORING_PROMPT = `You are a wiki quality evaluator. Score the given wiki entry on three dimensions.

Output strict JSON only, no other content.

Format:
{
  "completeness": 0.0-1.0,
  "accuracy": 0.0-1.0,
  "conciseness": 0.0-1.0,
  "overall": 0.0-1.0
}

Criteria:
- completeness: Are all important facts captured? (0=missing critical info, 1=everything important)
- accuracy: Is the information correct? (0=major errors, 1=factually sound)
- conciseness: Is it appropriately brief? (0=too verbose or too sparse, 1=just right)
- overall: Weighted average (completeness*0.4 + accuracy*0.4 + conciseness*0.2)`;

function extractTextContent(content: Array<{ type: string; text?: string }>): string {
  const parts: string[] = [];
  for (const c of content) {
    if (c.type === "text" && typeof c.text === "string") {
      parts.push(c.text);
    }
  }
  return parts.join("");
}

function extractJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
      // continue
    }
  }

  const firstBrace = text.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    for (let i = firstBrace; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(firstBrace, i + 1));
        } catch {
          // continue
        }
        break;
      }
    }
  }

  return null;
}

function serializeMessages(messages: AgentMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (!("role" in msg)) continue;
    const role = msg.role;
    if ("content" in msg && Array.isArray(msg.content)) {
      const textBlocks: string[] = [];
      for (const c of msg.content) {
        if (c.type === "text" && "text" in c && typeof c.text === "string") {
          textBlocks.push(c.text);
        }
      }
      if (textBlocks.length > 0) {
        parts.push(`[${role}]: ${textBlocks.join("\n")}`);
      }
    }
  }
  return parts.join("\n\n");
}

export async function generateWiki(
  config: WikiGeneratorConfig,
  messages: AgentMessage[],
  messageRange: [number, number],
): Promise<WikiEntry | null> {
  const serialized = serializeMessages(messages);
  if (!serialized.trim()) return null;

  const userMessage = [
    { role: "user", content: [{ type: "text", text: serialized }], timestamp: Date.now() },
  ] as import("@earendil-works/pi-ai").Message[];

  try {
    const stream = await config.streamFn(
      config.model,
      { messages: userMessage, systemPrompt: WIKI_GENERATION_PROMPT },
      {},
    );
    const result = await stream.result();

    if (result.stopReason === "error" || result.stopReason === "aborted") {
      return null;
    }

    const text = extractTextContent(result.content as Array<{ type: string; text?: string }>);

    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== "object") return null;

    const p = parsed as Record<string, unknown>;

    return {
      id: `wiki-${Date.now()}`,
      timestamp: Date.now(),
      projectGoals: typeof p.projectGoals === "string" ? p.projectGoals : "",
      completedWork: typeof p.completedWork === "string" ? p.completedWork : "",
      keyDecisions: typeof p.keyDecisions === "string" ? p.keyDecisions : "",
      fileChanges: typeof p.fileChanges === "string" ? p.fileChanges : "",
      problemsAndSolutions:
        typeof p.problemsAndSolutions === "string" ? p.problemsAndSolutions : "",
      unfinishedTasks: typeof p.unfinishedTasks === "string" ? p.unfinishedTasks : "",
      sourceMessageRange: messageRange,
    };
  } catch {
    return null;
  }
}

export async function scoreWiki(
  config: WikiGeneratorConfig,
  entry: WikiEntry,
): Promise<WikiScore | null> {
  const wikiText = JSON.stringify(entry, null, 2);

  const userMessage = [
    { role: "user", content: [{ type: "text", text: wikiText }], timestamp: Date.now() },
  ] as import("@earendil-works/pi-ai").Message[];

  try {
    const stream = await config.streamFn(
      config.model,
      { messages: userMessage, systemPrompt: WIKI_SCORING_PROMPT },
      {},
    );
    const result = await stream.result();

    if (result.stopReason === "error" || result.stopReason === "aborted") {
      return null;
    }

    const text = extractTextContent(result.content as Array<{ type: string; text?: string }>);

    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== "object") return null;

    const p = parsed as Record<string, unknown>;
    const completeness = typeof p.completeness === "number" ? p.completeness : 0;
    const accuracy = typeof p.accuracy === "number" ? p.accuracy : 0;
    const conciseness = typeof p.conciseness === "number" ? p.conciseness : 0;
    const overall =
      typeof p.overall === "number"
        ? p.overall
        : completeness * 0.4 + accuracy * 0.4 + conciseness * 0.2;

    return { completeness, accuracy, conciseness, overall };
  } catch {
    return null;
  }
}

export async function generateWikiWithRetry(
  config: WikiGeneratorConfig,
  messages: AgentMessage[],
  messageRange: [number, number],
  maxRetries: number = 2,
  minScore: number = 0.7,
): Promise<{ entry: WikiEntry | null; score: WikiScore | null; retries: number }> {
  let retries = 0;

  while (retries <= maxRetries) {
    const entry = await generateWiki(config, messages, messageRange);
    if (!entry) return { entry: null, score: null, retries };

    const score = await scoreWiki(config, entry);
    if (!score) return { entry, score: null, retries };

    if (score.overall >= minScore) {
      return { entry, score, retries };
    }

    retries++;
  }

  return { entry: null, score: null, retries };
}
