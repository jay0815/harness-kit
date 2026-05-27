export function turnStart(event: { turnIndex: number }): void {
  process.stdout.write(`\n── Turn ${event.turnIndex} ──\n`);
}

export function turnEnd(event: {
  message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
  toolResults?: Array<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }>;
}): void {
  const content = event.message?.content;
  if (!content || content.length === 0) {
    process.stdout.write("[empty response]\n");
    return;
  }

  for (const block of content) {
    if (block.type === "text") {
      process.stdout.write(`${block.text}\n`);
    } else if (block.type === "thinking") {
      process.stdout.write(`[thinking]\n`);
    } else if (block.type === "tool_use") {
      const args = block.input ? JSON.stringify(block.input) : "";
      process.stdout.write(`[tool: ${block.name}] ${args}\n`);
    }
  }
}

export function toolStart(event: { toolName: string; args?: unknown }): void {
  const args = event.args ? JSON.stringify(event.args) : "";
  process.stdout.write(`  ⟶ ${event.toolName} ${args}\n`);
}

export function toolEnd(event: {
  toolName: string;
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  isError?: boolean;
}): void {
  const isError = event.isError || event.result?.isError;
  const prefix = isError ? "  ✗ Error" : "  ✓";

  const text =
    event.result?.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n") ?? "";

  if (text) {
    const truncated = text.length > 500 ? text.slice(0, 500) + "…" : text;
    process.stdout.write(`${prefix} ${event.toolName}: ${truncated}\n`);
  } else {
    process.stdout.write(`${prefix} ${event.toolName}\n`);
  }
}

export function agentEnd(_event: { messages?: Array<{ role: string; content: unknown }> }): void {
  process.stdout.write("\n[conversation complete]\n");
}
