#!/bin/bash
# Team3 Web App - Dev Environment Init Script
# Usage: ./init.sh
# Idempotent - safe to re-run

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Team3 Web App - Init ==="

# 1. Install dependencies
echo "[1/3] Installing dependencies..."
if [ ! -d "node_modules" ]; then
  npm install
else
  echo "  node_modules/ exists, skipping install (run 'npm install' manually if needed)"
fi

# 2. TypeScript check
echo "[2/3] Checking TypeScript compilation..."
npx tsc --noEmit --skipLibCheck 2>/dev/null || echo "  (TypeScript warnings - non-blocking)"

# 3. Run tests to verify environment
echo "[3/3] Running unit tests..."
npx vitest run --reporter=dot 2>&1 | tail -5

echo ""
echo "=== Environment Ready ==="
echo "  Project: $SCRIPT_DIR"
echo "  Dev server: npm run dev (port 3000)"
echo "  Unit tests: npm test"
echo "  E2E tests:  npm run test:e2e"
echo "  Stop: Ctrl+C"
echo ""
