import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentToolCall } from "./types.js";

/**
 * Type-safe cast for test mocks.
 * Shorthand for `value as unknown as T`.
 */
export function cast<T>(value: unknown): T {
  return value as unknown as T;
}

/**
 * Access a property on an unknown-typed value.
 */
export function getProp<T = unknown>(obj: unknown, key: string): T {
  return (obj as Record<string, unknown>)[key] as T;
}

/** Create a mock Model for AgentLoopConfig. */
export function mockModel(id = "test-model"): Model<Api> {
  return cast<Model<Api>>({ provider: "test", id });
}

/** Create a mock AgentToolCall. */
export function mockToolCall(
  name: string,
  input?: Record<string, unknown>,
  id = "tc_1",
): AgentToolCall {
  return cast<AgentToolCall>({ id, name, type: "toolCall", input });
}
