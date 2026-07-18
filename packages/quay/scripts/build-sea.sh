#!/usr/bin/env bash
# build-sea.sh — build a Node SEA (Single Executable Application) binary for
# packages/quay (the Core CLI: `quay task ...`, `quay serve`, `quay mcp`).
#
# M01-dist (exp5, iteration 0). See packages/quay-native/scripts/build-sea.sh
# for the sibling build (the native Provider) and its header comment for why
# BOTH packages need their own SEA binary for a genuinely Node-free `quay
# serve` (Core spawns the active Provider's mcp_entry as a child process).
#
# esbuild bundles ESM -> CJS (Node SEA does not support ESM main modules as
# of Node 20/22/24). This makes `import.meta.url` empty in src/version.js's
# top-level __dirname/package.json-version read (used by mcp-server.js, QX-035
# ENV-001 mitigation). Fixed via scripts/esbuild-sea.mjs, which aliases
# src/version.js -> scripts/version-sea-shim.js (build-time-embedded version
# string, no runtime FS read) for this build only — src/version.js itself is
# unchanged and still used by the normal `node bin/quay.js` path. See
# version-sea-shim.js's header comment for details.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PKG_DIR}"

OUT_DIR="${PKG_DIR}/dist-sea"
mkdir -p "${OUT_DIR}"

BUNDLE="${OUT_DIR}/quay-bundle.cjs"
BLOB="${OUT_DIR}/quay-sea-prep.blob"
EXE_NAME="quay"
if [ "${OS:-}" = "Windows_NT" ]; then
  EXE_NAME="quay.exe"
fi
EXE="${OUT_DIR}/${EXE_NAME}"

echo "[1/5] Bundling quay (Core) with esbuild (ESM -> CJS, version.js aliased to build-time embed)..."
node scripts/esbuild-sea.mjs

echo "[2/5] Writing SEA config..."
# M01-dist iteration-1 (Windows CI fix): `node --experimental-sea-config`
# parses the "main"/"output" JSON values with the *native* Node.js fs path
# resolver, not through the shell. On Windows under Git Bash, ${BUNDLE}/
# ${BLOB} are POSIX-style MSYS paths (e.g. /d/a/quay/quay/packages/quay/
# dist-sea/quay-bundle.cjs), which bash/cp/npx all handle transparently but
# which Node's native Windows path handling does NOT understand — it looked
# for a literal, nonexistent path and failed with "Cannot read main script
# ...: no such file or directory" even though esbuild had genuinely written
# the file. Convert to Windows-native (D:\...) paths for the JSON only, via
# `cygpath -w` when available (Git Bash/MSYS provides it; no-op elsewhere).
if command -v cygpath >/dev/null 2>&1; then
  BUNDLE_JSON="$(cygpath -w "${BUNDLE}")"
  BLOB_JSON="$(cygpath -w "${BLOB}")"
else
  BUNDLE_JSON="${BUNDLE}"
  BLOB_JSON="${BLOB}"
fi
cat > "${OUT_DIR}/sea-config.json" <<EOF
{
  "main": "${BUNDLE_JSON//\\/\\\\}",
  "output": "${BLOB_JSON//\\/\\\\}",
  "disableExperimentalSEAWarning": true
}
EOF

echo "[3/5] Generating SEA prep blob..."
node --experimental-sea-config "${OUT_DIR}/sea-config.json"

echo "[4/5] Copying node binary as the executable base..."
NODE_BIN="$(command -v node)"
cp "${NODE_BIN}" "${EXE}"
chmod +w "${EXE}"

echo "[5/5] Injecting blob via postject..."
if [ "$(uname -s)" = "Darwin" ]; then
  codesign --remove-signature "${EXE}" 2>/dev/null || true
fi
npx --yes postject "${EXE}" NODE_SEA_BLOB "${BLOB}" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  $( [ "$(uname -s)" = "Darwin" ] && echo "--macho-segment-name NODE_SEA" )
if [ "$(uname -s)" = "Darwin" ]; then
  codesign --sign - "${EXE}" 2>/dev/null || true
fi

chmod +x "${EXE}"
echo "Built: ${EXE}"
