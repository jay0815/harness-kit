import type { AgentEvent, AgentMessage, AgentTool } from "../core/types.js";
import { IterationBudget } from "../core/types.js";
import { MiddlewarePipeline } from "../core/middleware.js";
import { FactVerificationMiddleware } from "../core/fact-verification.js";
import { CompactionMiddleware } from "../core/compaction/compaction-middleware.js";
import { evaluateTaskWithSource } from "../core/evaluator.js";
import { runAgentLoop } from "../core/agent-loop.js";
import type {
  BeforeAgentStartResult,
  HarnessAgentSessionConfig,
  HarnessExtensionAPI,
  HarnessExtensionContext,
  SessionState,
  ToolDefinition,
} from "./types.js";
import { bridgeAgentEvent } from "./event-bridge.js";
import { mergeTools } from "./tool-adapter.js";
import { createExtensionAPI } from "./extension-api-adapter.js";
import { SessionPersistence } from "./session-persistence.js";

export class HarnessAgentSession {
  private readonly config: HarnessAgentSessionConfig;
  private readonly eventHandlers = new Map<string, Set<(...args: unknown[]) => unknown>>();
  private readonly registeredTools = new Map<string, ToolDefinition>();
  private readonly userMessageQueue: string[] = [];
  private readonly maxAutoRetries: number;

  private state: SessionState = "idle";
  private turnIndex = 0;
  private persistence: SessionPersistence | null = null;
  private messages: AgentMessage[] = [];
  private lastPersistedIndex = 0;
  private currentAbortController: AbortController | null = null;

  constructor(config: HarnessAgentSessionConfig) {
    this.config = config;
    this.maxAutoRetries = config.maxAutoRetries ?? 3;
  }

  // ─── Public API ──────────────────────────────────────────────────

  get extensionAPI(): HarnessExtensionAPI {
    return createExtensionAPI({
      addEventHandler: (event, handler) => this.addEventHandler(event, handler),
      registerTool: (tool) => this.registeredTools.set(tool.name, tool),
      enqueueUserMessage: (content) => this.enqueueUserMessage(content),
    });
  }

  get cwd(): string {
    return this.config.cwd;
  }

  get sessionState(): SessionState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.config.enablePersistence && this.config.sessionDir) {
      this.persistence = new SessionPersistence(this.config.sessionDir);
      this.persistence.startSession();
    }

    const ctx = this.makeExtensionContext();
    await this.dispatch("session_start", { type: "session_start", reason: "startup" }, ctx);
  }

  async prompt(text: string): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`Cannot prompt while session is ${this.state}`);
    }

    let autoRetryCount = 0;
    this.turnIndex = 0;

    const runOnce = async (userText: string | null): Promise<void> => {
      this.currentAbortController = new AbortController();
      this.state = "running";

      try {
        // Assessment preflight — context isolation boundary
        // Evaluate BEFORE pushing to messages, only pass raw user string
        if (this.config.enableAssessment && userText !== null && userText.trim().length > 0) {
          const assessment = await evaluateTaskWithSource(
            {
              model: this.config.assessmentModel ?? this.config.model,
              streamFn: this.config.streamFn,
              workspaceDir: this.config.cwd,
            },
            userText,
          );

          if (assessment.source === "model" && !assessment.evaluation.understood) {
            const assessCtx = this.makeExtensionContext();
            await this.dispatch(
              "assessment_clarification",
              {
                type: "assessment_clarification",
                question:
                  assessment.evaluation.clarificationNeeded ??
                  "Could you clarify what you'd like me to do?",
              },
              assessCtx,
            );
            return;
          }

          // source === "fallback" → bypass assessment, continue main loop
          // source === "model" && understood → continue main loop
        }

        if (userText !== null && userText.trim().length > 0) {
          this.messages.push({
            role: "user",
            content: [{ type: "text", text: userText }],
          } as AgentMessage);
        }

        while (this.userMessageQueue.length > 0) {
          const feedback = this.userMessageQueue.shift()!;
          this.messages.push({
            role: "user",
            content: [{ type: "text", text: feedback }],
          } as AgentMessage);
        }

        const baseTools: AgentTool[] = this.config.tools ?? [];

        // 注册 search_memory 工具（如果配置了 contextEngine）
        if (this.config.contextEngine) {
          const engine = this.config.contextEngine;
          baseTools.push({
            name: "search_memory",
            label: "Search Memory",
            description:
              "Search session history and project memory. Use when you need to find previously discussed topics, decisions, or file changes.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query" },
                scope: { type: "string", enum: ["wiki", "all"], description: "Search scope" },
              },
              required: ["query"],
            } as unknown as import("@sinclair/typebox").TSchema,
            execute: async (_toolCallId, params) => {
              const { query, scope } = params as { query: string; scope?: "wiki" | "all" };
              const results = await engine.searchMemory(query, scope);
              return {
                content: [
                  {
                    type: "text" as const,
                    text:
                      results.length > 0 ? results.join("\n---\n") : "No matching memories found.",
                  },
                ],
                details: { results, count: results.length },
              };
            },
          });
        }

        const ctxFactory = () => this.makeExtensionContext();
        const tools = mergeTools(baseTools, this.registeredTools, ctxFactory);

        let systemPrompt = this.config.systemPrompt;

        // 注入 wiki summary 到 system prompt
        if (this.config.contextEngine) {
          const wikiSummary = this.config.contextEngine.getWikiSummary();
          if (wikiSummary) {
            systemPrompt = `${systemPrompt}\n\n## Project Memory\n${wikiSummary}`;
          }
        }

        const basHandlers = this.eventHandlers.get("before_agent_start");
        if (basHandlers) {
          const basCtx = this.makeExtensionContext();
          for (const handler of basHandlers) {
            const result = (await handler(
              { type: "before_agent_start", systemPrompt },
              basCtx,
            )) as BeforeAgentStartResult | void;
            if (result && typeof result.systemPrompt === "string") {
              systemPrompt = result.systemPrompt;
            }
          }
        }

        const budget = new IterationBudget(this.config.maxIterations ?? 50);
        const pipeline = new MiddlewarePipeline();
        const emit = (event: AgentEvent) => this.handleEmit(event);

        // 注册用户提供的 middleware（实例注入，跨 prompt 复用，priority-sorted）
        for (const mw of this.config.middlewares ?? []) {
          pipeline.register(mw);
        }

        // 注册 CompactionMiddleware（如果配置了 contextEngine）
        if (this.config.contextEngine) {
          pipeline.register(new CompactionMiddleware(this.config.contextEngine));
        }

        // 注册内置默认 middleware（每次 prompt 新建，retryCount prompt-scoped）
        const verifyMode = this.config.verifyMode ?? "off";
        if (verifyMode !== "off") {
          pipeline.register(
            new FactVerificationMiddleware({
              mode: verifyMode,
              maxRetries: Math.max(0, this.config.maxVerificationRetries ?? 3),
              workspaceDir: this.config.cwd,
            }),
          );
        }

        const result = await runAgentLoop(
          {
            model: this.config.model,
            systemPrompt,
            messages: [...this.messages],
            tools,
            streamFn: this.config.streamFn,
            contextWindow: this.config.contextWindow,
            signal: this.currentAbortController.signal,
          },
          budget,
          pipeline,
          emit,
        );

        this.messages = result.messages;

        if (this.persistence) {
          for (let i = this.lastPersistedIndex; i < this.messages.length; i++) {
            this.persistence.appendMessage(this.messages[i]);
          }
          this.lastPersistedIndex = this.messages.length;
        }
      } finally {
        if ((this.state as SessionState) !== "shutting_down") {
          this.state = "idle";
        }
        this.currentAbortController = null;
      }
    };

    await runOnce(text);

    while (
      this.userMessageQueue.length > 0 &&
      (this.state as SessionState) !== "shutting_down" &&
      autoRetryCount < this.maxAutoRetries
    ) {
      autoRetryCount++;
      await runOnce(null);
    }

    const endCtx = this.makeExtensionContext();
    await this.dispatch("agent_end", { type: "agent_end", messages: this.messages }, endCtx);
  }

  enqueueUserMessage(content: string): void {
    this.userMessageQueue.push(content);
  }

  abort(): void {
    this.currentAbortController?.abort();
  }

  async shutdown(): Promise<void> {
    this.state = "shutting_down";
    this.currentAbortController?.abort();
    const ctx = this.makeExtensionContext();
    await this.dispatch("session_shutdown", { type: "session_shutdown" }, ctx);
    this.persistence?.close();
  }

  // ─── Internal ────────────────────────────────────────────────────

  private addEventHandler(event: string, handler: (...args: unknown[]) => unknown): void {
    const handlers = this.eventHandlers.get(event) ?? new Set();
    handlers.add(handler);
    this.eventHandlers.set(event, handlers);
  }

  private async handleEmit(event: AgentEvent): Promise<void> {
    const prevState = this.state;
    this.state = "dispatching";

    try {
      const ctx = this.makeExtensionContext();

      if (event.type === "agent_start") {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch("agent_start", bridged.event, ctx);
      } else if (event.type === "turn_start") {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch("turn_start", bridged.event, ctx);
      } else if (event.type === "turn_end") {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch("turn_end", bridged.event, ctx);
        this.turnIndex++;
      } else if (event.type === "tool_execution_start") {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch("tool_execution_start", bridged.event, ctx);
      } else if (event.type === "tool_execution_update") {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch("tool_execution_update", bridged.event, ctx);
      } else if (event.type === "tool_execution_end") {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch("tool_execution_end", bridged.event, ctx);
      } else if (
        event.type === "message_start" ||
        event.type === "message_update" ||
        event.type === "message_end"
      ) {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch(event.type, bridged.event, ctx);
      }
    } finally {
      if (this.state === "dispatching") {
        this.state = prevState;
      }
    }
  }

  private async dispatch(event: string, ...args: unknown[]): Promise<void> {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;

    for (const handler of handlers) {
      await handler(...args);
    }
  }

  private makeExtensionContext(): HarnessExtensionContext {
    return {
      cwd: this.config.cwd,
      signal: this.currentAbortController?.signal,
      shutdown: () => this.shutdown(),
    };
  }
}
