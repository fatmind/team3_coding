#!/bin/bash
set -euo pipefail

TOOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Building team3 from $TOOL_DIR"

# 1. Embed prompts into daemon
echo "--- Step 1: Embed prompts"
node "$TOOL_DIR/build/embed-prompts.js"

# 2. Bundle daemon with esbuild
echo "--- Step 2: Bundle daemon (esbuild)"
mkdir -p "$TOOL_DIR/dist"
npx esbuild "$TOOL_DIR/daemon/src/orchestrator-entry.js" \
  --bundle --platform=node --target=node20 \
  --outfile="$TOOL_DIR/dist/daemon.bundle.js"

# 3. Obfuscate daemon bundle
echo "--- Step 3: Obfuscate daemon"
npx javascript-obfuscator "$TOOL_DIR/dist/daemon.bundle.js" \
  --output "$TOOL_DIR/dist/daemon.min.js" \
  --string-array true \
  --string-array-encoding base64 \
  --control-flow-flattening true

# 4. Build Next.js standalone
echo "--- Step 4: Build Next.js (standalone)"
cd "$TOOL_DIR/web"
npm run build
cd "$TOOL_DIR"

# 5. Assemble npm package
echo "--- Step 5: Assemble package"
rm -rf "$TOOL_DIR/pkg"
mkdir -p "$TOOL_DIR/pkg/bin" \
         "$TOOL_DIR/pkg/server" \
         "$TOOL_DIR/pkg/assets/cli"

# CLI entry
cp "$TOOL_DIR/bin/team3.js" "$TOOL_DIR/pkg/bin/"
chmod +x "$TOOL_DIR/pkg/bin/team3.js"

# Next.js standalone output (use "." to include dotfiles like .next/)
cp -a "$TOOL_DIR/web/.next/standalone/." "$TOOL_DIR/pkg/server/"
if [ -d "$TOOL_DIR/web/.next/static" ]; then
  mkdir -p "$TOOL_DIR/pkg/server/.next/static"
  cp -a "$TOOL_DIR/web/.next/static/." "$TOOL_DIR/pkg/server/.next/static/"
fi
if [ -d "$TOOL_DIR/web/public" ]; then
  cp -r "$TOOL_DIR/web/public" "$TOOL_DIR/pkg/server/public"
fi

# Obfuscated daemon
cp "$TOOL_DIR/dist/daemon.min.js" "$TOOL_DIR/pkg/"

# CLI scaffold files
for f in "$TOOL_DIR/cli/"*.mjs; do
  [ -f "$f" ] && cp "$f" "$TOOL_DIR/pkg/assets/cli/"
done

# Remove dev-only files from server (CLAUDE.md, design docs, etc.)
find "$TOOL_DIR/pkg/server" -maxdepth 1 -name "*.md" -delete 2>/dev/null || true
rm -rf "$TOOL_DIR/pkg/server/templates" 2>/dev/null || true

# Generate package.json
node "$TOOL_DIR/build/gen-package-json.js" > "$TOOL_DIR/pkg/package.json"

# 6. Pack
echo "--- Step 6: npm pack"
cd "$TOOL_DIR/pkg"
npm pack

echo ""
echo "==> Done! Package:"
ls -lh "$TOOL_DIR/pkg/"*.tgz
