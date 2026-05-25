#!/bin/bash
set -euo pipefail

echo "=== Scope Migration Verification ==="
echo ""

# 1. Check for any remaining old scope references in code/config
echo "[1/5] Checking for residual @mariozechner references..."
RESIDUAL=$(grep -r "@mariozechner" \
  --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.md" \
  packages/ pnpm-workspace.yaml wiki/ docs/ 2>/dev/null | grep -v node_modules | grep -v dist | grep -v ".git/" || true)

if [ -n "$RESIDUAL" ]; then
  echo "FAIL: Found residual @mariozechner references:"
  echo "$RESIDUAL"
  exit 1
fi
echo "PASS: No residual @mariozechner references"
echo ""

# 2. Check that new scope is present in key files
echo "[2/5] Checking @earendil-works references..."
NEW_REFS=$(grep -r "@earendil-works" \
  --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" \
  packages/ pnpm-workspace.yaml 2>/dev/null | grep -v node_modules | grep -v dist | grep -v ".git/" || true)

if [ -z "$NEW_REFS" ]; then
  echo "FAIL: No @earendil-works references found"
  exit 1
fi
echo "PASS: Found @earendil-works references"
echo "$NEW_REFS"
echo ""

# 3. Verify pnpm install works
echo "[3/5] Verifying pnpm install..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo "PASS: pnpm install succeeded"
echo ""

# 4. Verify typecheck
echo "[4/5] Running typecheck..."
pnpm run typecheck
echo "PASS: typecheck succeeded"
echo ""

# 5. Verify lint
echo "[5/5] Running lint..."
pnpm run lint
echo "PASS: lint succeeded"
echo ""

echo "=== All checks passed ==="
