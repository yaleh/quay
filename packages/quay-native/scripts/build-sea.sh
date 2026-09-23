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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
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

# ── Build-runtime provenance (gap-sea-binary-embeds-build-time-node-version-ci-vs-local-diverge) ──
# Sibling of the same block in packages/quay/scripts/build-sea.sh — see that file for the full
# rationale. Step [4/5] below copies whatever `node` PATH resolves to as the executable's base, so
# the embedded Node version is a BUILD-MACHINE property; record it into `<exe-name>.build-node-version`
# so it travels inside the release archive, and check it against the declared floor
# (SEA_NODE_VERSION, single source: release.yml's workflow-level env) — warning by default,
# fail-closed under SEA_STRICT_NODE_FLOOR=1 (which CI sets).
BUILD_NODE_VERSION_SUFFIX=".build-node-version"

record_build_node_version() {
  local node_bin node_version declared
  node_bin="$(command -v node)"
  node_version="$(node --version)"
  printf '%s\n' "${node_version}" > "${OUT_DIR}/${EXE_NAME}${BUILD_NODE_VERSION_SUFFIX}"
  echo "Build-time node: ${node_version} (${node_bin}) -> recorded in ${EXE_NAME}${BUILD_NODE_VERSION_SUFFIX}"
  declared="${SEA_NODE_VERSION:-}"
  if [ -z "${declared}" ]; then
    echo "NOTE: SEA_NODE_VERSION is not set — the build-time Node version is recorded, but not" >&2
    echo "      checked against a declared floor (set it to the declared major, e.g. SEA_NODE_VERSION=20)." >&2
    return 0
  fi
  case "${node_version}" in
    "v${declared}."*) return 0 ;;
    *) ;;
  esac
  echo "ERROR: this SEA binary embeds ${node_version}, but the declared floor is Node ${declared}." >&2
  echo "       The embedded version is a property of the BUILD MACHINE (step [4/5] copies the node" >&2
  echo "       binary PATH resolves to), not of build-sea.sh itself — build on the declared floor." >&2
  if [ "${SEA_STRICT_NODE_FLOOR:-0}" = "1" ]; then
    echo "       SEA_STRICT_NODE_FLOOR=1 — failing closed." >&2
    exit 1
  fi
  echo "       Continuing (set SEA_STRICT_NODE_FLOOR=1 to fail closed instead)." >&2
  return 0
}

# `--record-build-node-version`: write the build-runtime provenance sidecar (and apply the declared
# floor check) and exit, skipping the heavy SEA build. Mirrors packages/quay's equivalent flag so the
# test suite exercises the REAL recording code fast and hermetically.
if [ "${1:-}" = "--record-build-node-version" ]; then
  record_build_node_version
  exit 0
fi

echo "[1/5] Bundling quay-native with esbuild (ESM -> CJS, manifest.js aliased to build-time embed)..."
node scripts/esbuild-sea.mjs

echo "[2/5] Writing SEA config..."
# M01-dist iteration-1 (Windows CI fix): mirrors the same fix in
# packages/quay/scripts/build-sea.sh — see that file's comment for the full
# root-cause explanation (Node's --experimental-sea-config parses "main"/
# "output" with native Windows path handling, which does not understand Git
# Bash's POSIX-style /d/... paths).
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
# Record (and floor-check) which Node this copy embedded — see record_build_node_version above.
record_build_node_version

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
