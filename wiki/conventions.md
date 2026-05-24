# Code Conventions

## Module System

ESM only. `import`/`export`, never `require()`.

## TypeScript

- `strict: true`
- TypeBox for runtime schemas (`@sinclair/typebox`)
- Explicit types on function parameters (no implicit `any`)

## Naming

- Files: `kebab-case.ts`
- Interfaces: `PascalCase` (e.g., `Fact`, `ResultBlock`, `VerifyReport`)
- Functions: `camelCase` (e.g., `verifyFacts`, `extractResultBlock`)
- Constants: `camelCase` for module-level values

## I/O

- Synchronous inside tool `execute` functions (`execFileSync`, `readFileSync`)
- PI tools are `async` but internals are sync (tmux operations block)

## Comments

No comments unless the WHY is non-obvious. Code should be self-documenting.

## Tests

- vitest, colocated with source (`foo.ts` → `foo.test.ts`)
- Use `describe`/`it`/`expect` from vitest
- Temp directories for file system tests (`mkdtempSync`)
