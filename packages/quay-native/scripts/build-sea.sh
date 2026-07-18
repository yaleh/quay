#!/usr/bin/env bash
# build-sea.sh — build a Node SEA (Single Executable Application) binary for
# quay-native (the reference Provider's `mcp` entrypoint).
#
# M01-dist (exp5, iteration 0): closes the remaining half of DIR-004
# (experiments/quay-continuous-bootstrap/directives/archive/DIR-004-*.md) —
# a single-file executable requiring no separately-installed Node.js runtime.
#
# Why quay-native needs its OWN SEA build, not just packages/quay's:
# `quay serve` / `quay mcp` both work by spawning a child process for the
# active Provider's `mcp_entry` command (src/provider-client.js connectProvider,
# via .quay/config.yml's `mcp_entry: ["node", "./bin/quay-native.js", "mcp"]`).
# A SEA build of packages/quay alone still shells out to a bare `node` binary
# for the Provider half — genuinely NOT Node-free end-to-end. Compiling
# quay-native to its own SEA executable and pointing mcp_entry at that binary
# (instead of "node ./bin/quay-native.js") closes this gap without any
# Core/Provider ABI change — mcp_entry was already an arbitrary command list.
#
# esbuild note: esbuild bundles ESM -> CJS for SEA (Node SEA does not support
# ESM main modules as of Node 20/22/24; see Node docs "Single executable
# applications" limitations). CJS output makes `import.meta.url` empty
# (esbuild warning), which breaks manifest.js's `__dirname`-relative read of
# provider.yml at module-init time — doubly so because the SEA binary isn't
# even located at the source tree path at runtime. Fixed via
# --alias:./src/manifest.js=./scripts/manifest.sea-shim.js, which embeds
# provider.yml's contents at BUILD time via esbuild's `text` loader instead
# of reading it from disk at runtime. src/manifest.js itself is unchanged;
# the alias only applies to this SEA build, not the normal `node
# bin/quay-native.js` path.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PKG_DIR}"

OUT_DIR="${PKG_DIR}/dist-sea"
mkdir -p "${OUT_DIR}"

BUNDLE="${OUT_DIR}/quay-native-bundle.cjs"
BLOB="${OUT_DIR}/quay-native-sea-prep.blob"
EXE_NAME="quay-native"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) EXE_NAME="quay-native.exe" ;;
esac
if [ "${OS:-}" = "Windows_NT" ]; then
  EXE_NAME="quay-native.exe"
fi
EXE="${OUT_DIR}/${EXE_NAME}"

echo "[1/5] Bundling quay-native with esbuild (ESM -> CJS, manifest.js aliased to build-time embed)..."
node scripts/esbuild-sea.mjs

echo "[2/5] Writing SEA config..."
cat > "${OUT_DIR}/sea-config.json" <<EOF
{
  "main": "${BUNDLE}",
  "output": "${BLOB}",
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
