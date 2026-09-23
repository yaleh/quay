#!/usr/bin/env bash
# build-dist.sh — M120 (DIR-060): thin wrapper that builds the bundled ESM
# `dist/quay.js` for packages/quay (the Core CLI), mirroring build-sea.sh ->
# esbuild-sea.mjs. Invoked as an explicit step by package.sh (before `npm pack`)
# and by CI, the same way release.yml already calls build-sea.sh explicitly
# (no npm lifecycle hook exists anywhere in this repo).
#
# The dist/ bundle is the runtime target of package.json's `bin` field, so the
# npm-pack tarball runs on the declared Node-20 floor (native `.ts` needs Node
# >=23). dist/ is gitignored (like dist-sea/) — generated, never committed.
#
# esbuild parses TS with its own bundled parser, so this build itself runs fine
# on Node 20 (the sea-release job already runs esbuild-sea.mjs under Node 20).
#
# Usage:
#   bash packages/quay/scripts/build-dist.sh
#   # or from packages/quay/:
#   bash scripts/build-dist.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
cd "${PKG_DIR}"

echo "[build-dist] Bundling quay (Core) bin/quay.ts -> dist/quay.js (ESM, createRequire banner)..."
node scripts/build-dist.mjs
echo "[build-dist] done: ${PKG_DIR}/dist/quay.js"
