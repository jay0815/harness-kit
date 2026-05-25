# CLAUDE.md — harness-kit

harness-kit: PI Extension that orchestrates coding agents through structured workflows with hard fact verification.

## Principles

Every change, ask Linus's three questions:
1. Is this a real problem?
2. Is there a simpler way?
3. Will it break anything?

Think and act based on facts. Don't be sycophantic — challenge ideas when the evidence says otherwise.

## Commands

```bash
pnpm install              # install all
pnpm run build            # build all packages
pnpm run test             # vitest
pnpm run lint             # oxlint all packages
pnpm run lint:fix         # oxlint --fix all packages
pnpm run fmt              # oxfmt all packages
pnpm run fmt:check        # oxfmt --check all packages
pnpm run typecheck        # tsc --noEmit
```

## Wiki

Knowledge base. **Always consult wiki before making changes or running commands.** If unsure about build/test commands, conventions, architecture, or tool usage — check wiki first, not memory or assumptions.

- [index](wiki/index.md) — full catalog
- [architecture](wiki/architecture.md) — system design, data flow
- [tech-stack](wiki/tech-stack.md) — deps, tools, versions
- [acp-protocol](wiki/acp-protocol.md) — tmux-bridge IPC, read guard
- [pi-integration](wiki/pi-integration.md) — Extension API, events
- [design-decisions](wiki/design-decisions.md) — key decisions + rationale
- [conventions](wiki/conventions.md) — code style, naming, patterns
- [log](wiki/log.md) — activity log

## Rules

- ESM only. No `require()`.
- `strict: true`. TypeBox for runtime schemas.
- No comments unless the WHY is non-obvious.
- Sync I/O inside tool `execute` functions.
- Tests colocated: `foo.ts` → `foo.test.ts` (vitest).
- Fail-stop. No auto-retry.
- `<HK_RESULT>` is the only agent output boundary.
- **Lint/Format: Always use `pnpm run lint` and `pnpm run fmt`. Do not use `npx` or globally installed tools.**
