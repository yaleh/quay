#!/usr/bin/env bash
# build-dist.sh — M149 (DIR-094): thin wrapper that builds the bundled ESM
# `dist/quay-native.js` for packages/quay-native (the reference Provider CLI),
# mirroring packages/quay/scripts/build-dist.sh -> build-dist.mjs.
#
# The dist/ bundle is the runtime target of package.json's `bin` field, so the
# npm-pack tarball runs on the declared Node-20 floor (native `.ts` needs Node
# >=23). dist/ is gitignored (like dist-sea/) — generated, never committed.
#
# esbuild parses TS with its own bundled parser, so this build itself runs fine
# on Node 20.
#
# Usage:
#   bash packages/quay-native/scripts/build-dist.sh
#   # or from packages/quay-native/:
#   bash scripts/build-dist.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
cd "${PKG_DIR}"

echo "[build-dist] Bundling quay-native bin/quay-native.ts -> dist/quay-native.js (ESM, createRequire banner)..."
node scripts/build-dist.mjs
echo "[build-dist] done: ${PKG_DIR}/dist/quay-native.js"
