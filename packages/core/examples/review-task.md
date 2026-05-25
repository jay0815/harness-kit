# Code Review Workflow

Execute the following phases **in order**. After each phase, report its result before moving on.

## Phase 1: Lint

Run: `pnpm run lint`
Report: PASS or FAIL with any output.

## Phase 2: Typecheck

Run: `pnpm run typecheck`
Report: PASS or FAIL with any output.

## Phase 3: Test

Run: `pnpm run test`
Report: PASS or FAIL, number of tests passed/failed.

## Phase 4: Stats

Run these and report the numbers:

```
find packages/harness-kit/src -name "*.ts" ! -name "*.test.ts" | wc -l
find packages/harness-kit/src -name "*.ts" ! -name "*.test.ts" -exec cat {} + | wc -l
find packages/harness-kit/src -name "*.test.ts" | wc -l
find packages/harness-kit/src -name "*.test.ts" -exec cat {} + | wc -l
```

## Phase 5: Code Review

Based on the code you've seen (NOT the test results), do a deep review of the harness-kit codebase:

1. Read all source files in `packages/harness-kit/src/` (skip .test.ts files)
2. Analyze the architecture, error handling, type safety, and security
3. Output your review in this format:

```
## Architecture Assessment
[overall evaluation]

## Issues Found
1. [Severity: High/Medium/Low] [description]
   - File: [path]
   - Impact: [impact]
   - Suggestion: [fix]

## Strengths
- [what's done well]

## Recommendations
- [priority improvements]
```

### Review Focus Areas

- Module responsibilities and dependency direction
- Error handling: boundary cases, silent failures, crash safety
- Type safety: unsafe assertions, runtime validation gaps
- Security: path traversal, injection, input validation
- Code quality: maintainability, consistency, over/under-engineering

### Important

- Do NOT judge code quality by test coverage
- Analyze actual code implementation, not test patterns
- Tests may be coupled to implementation — evaluate independently
