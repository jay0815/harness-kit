# Tech Stack

## Runtime

- Node.js >= 20
- TypeScript 6.x, ESM (`"type": "module"`)
- pnpm workspace

## Dev Tools

| Tool | Version | Purpose |
|------|---------|---------|
| tsc | 6.x | Build + typecheck |
| vitest | 4.x | Test runner (runs .ts directly) |
| oxlint | 1.x | Linting |
| tsx | 4.x | Run .ts scripts without build |

## Dependencies

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-coding-agent` | PI Extension API types |
| `@mariozechner/pi-agent-core` | Agent loop |
| `@mariozechner/pi-ai` | AI provider abstraction |
| `@sinclair/typebox` | JSON Schema for tool parameters |
| `yaml` | YAML parsing (workflow config) |

PI packages are local file dependencies from `github-repo/pi-mono/`.

## Commands

```bash
pnpm install          # install all deps
pnpm run build        # tsc
pnpm run test         # vitest run
pnpm run lint         # oxlint src/
pnpm run typecheck    # tsc --noEmit
pnpm run test:e2e     # E2E (requires tmux)
```
