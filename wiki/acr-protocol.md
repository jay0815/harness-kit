# ACP Protocol (tmux-bridge)

## Primitives

| Operation | Command | Effect |
|-----------|---------|--------|
| read | `bridge(["read", paneId, "5"])` | Read last N lines, satisfy read guard |
| type | `bridge(["type", paneId, text])` | Type text into pane (no Enter) |
| keys | `bridge(["keys", paneId, "Enter"])` | Send special key |

## Read Guard (Critical)

tmux-bridge enforces: **must `read` before `type`/`keys`**.

Each `type` or `keys` call **clears** the read guard. So:

```
read  → type → read → keys → read → type → ...
```

The `startAgentInPane` function in `pane.ts` handles this:
```typescript
bridge(["read", paneId, "5"]);
bridge(["type", paneId, command]);
bridge(["read", paneId, "5"]);   // re-read before keys
bridge(["keys", paneId, "Enter"]);
```

## Message Format

Harness-kit sends tasks as plain text with a `<HK_RESULT>` template. Agents respond with:

```
<HK_RESULT>
{ "currentWork": "...", "facts": [...], "reasoning": "..." }
</HK_RESULT>
```

## Polling

`acp_read` returns one of three statuses:
- **COMPLETE** — valid `<HK_RESULT>` block extracted
- **MALFORMED** — block exists but JSON invalid
- **PENDING** — no block found yet, agent still working
