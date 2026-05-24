import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
} from "../core/types.js";
import { IterationBudget } from "../core/types.js";
import { MiddlewarePipeline } from "../core/middleware.js";
import { runAgentLoop } from "../core/agent-loop.js";
import type {
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
  private readonly eventHandlers = new Map<string, Set<(...args: any[]) => any>>();
  private readonly registeredTools = new Map<string, ToolDefinition<any, any, any>>();
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
        if (userText !== null && userText.trim().length > 0) {
          this.messages.push({ role: "user", content: [{ type: "text", text: userText }] } as any);
        }

        while (this.userMessageQueue.length > 0) {
          const feedback = this.userMessageQueue.shift()!;
          this.messages.push({ role: "user", content: [{ type: "text", text: feedback }] } as any);
        }

        const baseTools: AgentTool<any>[] = this.config.tools ?? [];
        const ctxFactory = () => this.makeExtensionContext();
        const tools = mergeTools(baseTools, this.registeredTools, ctxFactory);

        let systemPrompt = this.config.systemPrompt;
        const basHandlers = this.eventHandlers.get("before_agent_start");
        if (basHandlers) {
          for (const handler of basHandlers) {
            const result = await handler({ type: "before_agent_start", systemPrompt });
            if (result && typeof result.systemPrompt === "string") {
              systemPrompt = result.systemPrompt;
            }
          }
        }

        const budget = new IterationBudget(this.config.maxIterations ?? 50);
        const pipeline = new MiddlewarePipeline();
        const emit = (event: AgentEvent) => this.handleEmit(event);

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

    await this.dispatch("agent_end", { type: "agent_end", messages: this.messages });
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
    await this.dispatch("session_shutdown");
    this.persistence?.close();
  }

  // ─── Internal ────────────────────────────────────────────────────

  private addEventHandler(event: string, handler: (...args: any[]) => any): void {
    const handlers = this.eventHandlers.get(event) ?? new Set();
    handlers.add(handler);
    this.eventHandlers.set(event, handlers);
  }

  private async handleEmit(event: AgentEvent): Promise<void> {
    const prevState = this.state;
    this.state = "dispatching";

    try {
      if (event.type === "turn_start") {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch("turn_start", bridged.event);
      } else if (event.type === "turn_end") {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch("turn_end", bridged.event);
        this.turnIndex++;
      } else if (event.type === "tool_execution_start") {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch("tool_execution_start", bridged.event);
      } else if (event.type === "tool_execution_end") {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch("tool_execution_end", bridged.event);
      } else if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
        const bridged = bridgeAgentEvent(event, this.turnIndex);
        if (bridged) await this.dispatch(event.type, bridged.event);
      }
    } finally {
      if (this.state === "dispatching") {
        this.state = prevState;
      }
    }
  }

  private async dispatch(event: string, ...args: any[]): Promise<void> {
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
