#!/usr/bin/env bash
# Mock coding agent for harness-kit E2E testing.
# Simulates a coding agent that outputs <HK_RESULT> blocks.
#
# Usage:
#   ./mock-agent.sh --pass   # outputs facts matching real files
#   ./mock-agent.sh --fail   # outputs facts with wrong line numbers
#   ./mock-agent.sh          # defaults to --pass

set -euo pipefail

MODE="${1:---pass}"
MOCK_DIR="$(cd "$(dirname "$0")/mock-workspace" && pwd)"

read -r _

sleep 1

if [[ "$MODE" == "--fail" ]]; then
  cat <<'BLOCK'
<HK_RESULT>
{
  "currentWork": "Modified src/hello.ts to add farewell function",
  "facts": [
    {
      "file": "src/hello.ts",
      "startLine": 100,
      "endLine": 105,
      "exactText": "export function farewell(name: string): string { return `Goodbye, ${name}!`; }"
    }
  ],
  "reasoning": "Added farewell function after greet"
}
</HK_RESULT>
BLOCK
else
  cat <<'BLOCK'
<HK_RESULT>
{
  "currentWork": "Analyzed src/hello.ts and docs/requirements.md",
  "facts": [
    {
      "file": "src/hello.ts",
      "startLine": 1,
      "endLine": 3,
      "exactText": "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}"
    },
    {
      "file": "docs/requirements.md",
      "startLine": 1,
      "endLine": 3,
      "exactText": "# Requirements\n\nBuild a simple greeting function that takes a name and returns a greeting string."
    }
  ],
  "reasoning": "Both files match the requirements specification"
}
</HK_RESULT>
BLOCK
fi
