# PI Integration

## Extension API

harness-kit registers as a PI Extension via `ExtensionAPI`:

```typescript
export default function harnessKitExtension(pi: ExtensionAPI) {
  pi.on("session_start", ...);       // capture cwd, init telemetry
  pi.on("session_shutdown", ...);    // close telemetry
  pi.on("before_agent_start", ...);  // inject workflow prompt
  for (const tool of harnessKitTools) {
    pi.registerTool(tool);           // register 4 tools
  }
}
```

## Key Events

| Event | When | Usage |
|-------|------|-------|
| `session_start` | Session begins | Capture workspace dir, init telemetry |
| `session_shutdown` | Session ends | Flush and close telemetry |
| `before_agent_start` | Before LLM call | Inject workflow instructions into system prompt |

## Available Events (not yet used)

| Event | Potential use |
|-------|---------------|
| `tool_execution_start/end` | Auto-track tool call timing |
| `turn_start/end` | Track conversation turns |
| `before_provider_request` | Intercept/modify LLM requests |
| `context` | Modify message context |

## System Prompt Injection

`before_agent_start` receives `event.systemPrompt` and returns modified version. harness-kit appends workflow instructions that tell the PI agent how to drive phases using the 4 tools.
