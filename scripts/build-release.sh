#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RELEASE_DIR="$ROOT_DIR/release"
LOGS_DIR="$RELEASE_DIR/logs"
mkdir -p "$LOGS_DIR"

echo "==> PKG build starting from $ROOT_DIR"

pushd server >/dev/null
if [[ ! -f package-lock.json ]]; then
  echo "==> Creating server/package-lock.json"
  npm install --package-lock-only --no-audit --no-fund
fi
echo "==> Running server npm ci + tests"
npm ci --no-audit --no-fund
npm test | tee "$LOGS_DIR/server-test.log"
popd >/dev/null

pushd web_interface >/dev/null
echo "==> Running web_interface npm ci + build"
npm ci --no-audit --no-fund
npm run build | tee "$LOGS_DIR/web-build.log"
popd >/dev/null

if command -v blender >/dev/null 2>&1; then
  echo "==> Running Blender headless harness"
  blender -b -P test_harness.py -- scaffold | tee "$LOGS_DIR/blender-harness.log"
else
  echo "SKIPPED: blender executable not found in PATH." >"$LOGS_DIR/blender-harness.log"
  echo "WARNING: Blender not found in PATH. Skipping headless harness."
fi

echo "==> Packaging deterministic release archive"
python3 scripts/package_release.py

echo "==> Generating release provenance/signing artifacts"
python3 scripts/sign_release.py

echo "==> Build complete. Artifacts in $RELEASE_DIR"

