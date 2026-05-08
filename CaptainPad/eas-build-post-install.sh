#!/bin/bash
# EAS Build Hook: Post-install diagnostics
# This runs after npm ci on the EAS builder so we can debug module resolution issues.

set -e

echo "══════════════════════════════════════════════════════════"
echo "  🔍 EAS Build Debug: Post-Install Diagnostics"
echo "══════════════════════════════════════════════════════════"

echo ""
echo "── Node / npm versions ──"
node --version
npm --version

echo ""
echo "── whatwg-fetch check ──"
WHATWG_DIR="node_modules/whatwg-fetch"
if [ -d "$WHATWG_DIR" ]; then
  echo "✅ whatwg-fetch directory exists"
  WHATWG_VER=$(node -e "console.log(require('./node_modules/whatwg-fetch/package.json').version)")
  echo "   Version: $WHATWG_VER"
  WHATWG_MAIN=$(node -e "console.log(require('./node_modules/whatwg-fetch/package.json').main)")
  echo "   Main field: $WHATWG_MAIN"
  
  if [ -f "$WHATWG_DIR/dist/fetch.umd.js" ]; then
    echo "✅ dist/fetch.umd.js EXISTS ($(wc -c < "$WHATWG_DIR/dist/fetch.umd.js") bytes)"
  else
    echo "❌ dist/fetch.umd.js MISSING — this will cause Metro to fail!"
    echo "   Contents of whatwg-fetch:"
    ls -la "$WHATWG_DIR/"
    if [ -d "$WHATWG_DIR/dist" ]; then
      echo "   Contents of dist/:"
      ls -la "$WHATWG_DIR/dist/"
    else
      echo "   ❌ dist/ directory does not exist at all"
    fi
  fi
else
  echo "❌ whatwg-fetch not installed!"
fi

echo ""
echo "── @expo/metro-runtime check ──"
MR_DIR="node_modules/@expo/metro-runtime"
if [ -d "$MR_DIR" ]; then
  MR_VER=$(node -e "console.log(require('./$MR_DIR/package.json').version)")
  echo "✅ @expo/metro-runtime $MR_VER installed"
else
  echo "⚠️  @expo/metro-runtime not found"
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  🔍 Diagnostics complete"
echo "══════════════════════════════════════════════════════════"
