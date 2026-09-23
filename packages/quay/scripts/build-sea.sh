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
#
# gap-release-sea-bundle-excludes-plugin-tree: this build also stages the plugin
# SIDECAR (repo-root plugin/ minus plugin/test/) into dist-sea/plugin/, so the SEA
# release archive — the RECOMMENDED distribution — carries the agent surface that IS
# the self-evolving loop, not just the CLI binaries. Architecture decision (AC3):
# sidecar, not embed — see the stage_plugin_sidecar() comment below.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
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

# ── Build-runtime provenance (gap-sea-binary-embeds-build-time-node-version-ci-vs-local-diverge) ──
# Step [4/6] below does `cp "$(command -v node)" "${EXE}"`: the executable's BASE is a byte-copy of
# whatever `node` PATH resolves to, so the SEA binary's runtime Node version is a property of the
# BUILD MACHINE, not of this script. The same script on Node 25 produces a Node-25 binary; CI's
# sea-release job pins Node 20 via actions/setup-node. That fact used to be implicit and unrecorded
# (no mechanism pinned "the SEA artifact embeds the Node floor release.yml declares" — the
# dist-verify-node-floor job checks the npm TARBALL, a different artifact). Now:
#   - the build-time `node --version` is written next to the executable as
#     `<exe-name>.build-node-version`, so the claim travels INSIDE the release archive; and
#   - if SEA_NODE_VERSION (the declared floor — single source: release.yml's workflow-level env) is
#     set and disagrees, we warn loudly, or fail closed when SEA_STRICT_NODE_FLOOR=1 (CI sets it).
# verify-sea-artifact.sh re-derives the version from the binary's own BYTES and cross-checks all
# three readings (bytes vs recorded vs declared floor) — a self-reported file alone would be a
# tautology; the cross-check is what makes the criterion able to be false.
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
  echo "       The embedded version is a property of the BUILD MACHINE (step [4/6] copies the node" >&2
  echo "       binary PATH resolves to), not of build-sea.sh itself — build on the declared floor." >&2
  if [ "${SEA_STRICT_NODE_FLOOR:-0}" = "1" ]; then
    echo "       SEA_STRICT_NODE_FLOOR=1 — failing closed." >&2
    exit 1
  fi
  echo "       Continuing (set SEA_STRICT_NODE_FLOOR=1 to fail closed instead)." >&2
  return 0
}

# ── Plugin sidecar staging (gap-release-sea-bundle-excludes-plugin-tree) ──────────
# The SEA release archive (quay-sea-<ver>-<platform>.tar.gz/zip) is the RECOMMENDED
# distribution; it must carry the plugin dir-tree (the agent surface that IS the
# self-evolving loop) alongside the two SEA binaries — not just the CLI. A SEA
# single-file binary structurally cannot contain a directory tree, so the plugin ships
# as a SIDECAR directory inside the same archive (architecture decision AC3 — sidecar,
# not embed: the plugin is a tree of .sh/.ts/markdown that needs Node+shell at runtime,
# so embedding into the Node-free CLI binary would force a runtime unpack with no
# benefit). Mirrors package.sh's staging: repo-root plugin/ minus plugin/test/ (the
# delivery-form ruling — a user installs quay to run its loop, not to run quay's own
# test suite).
stage_plugin_sidecar() {
  local PLUGIN_SRC="${PKG_DIR}/../../plugin"
  local PLUGIN_DEST="${OUT_DIR}/plugin"
  if [ ! -d "${PLUGIN_SRC}" ]; then
    echo "ERROR: plugin bundle source not found: ${PLUGIN_SRC}" >&2
    exit 1
  fi
  rm -rf "${PLUGIN_DEST}"
  mkdir -p "${PLUGIN_DEST}"
  cp -R "${PLUGIN_SRC}/." "${PLUGIN_DEST}/"
  rm -rf "${PLUGIN_DEST}/test"
  echo "Plugin sidecar staged: ${PLUGIN_DEST} ($(find "${PLUGIN_DEST}" -type f | wc -l | tr -d ' ') files)"
}

# `--stage-plugin-only`: run the plugin-sidecar staging step and exit, skipping the
# heavy SEA build (esbuild/node-copy/postject). The test suite uses this to exercise
# the REAL staging code fast and hermetically; it is also a dev convenience for a
# no-build sidecar refresh.
if [ "${1:-}" = "--stage-plugin-only" ]; then
  stage_plugin_sidecar
  exit 0
fi

# `--record-build-node-version`: write the build-runtime provenance sidecar (and apply the declared
# floor check) and exit, skipping the heavy SEA build. Mirrors `--stage-plugin-only` above — the test
# suite exercises the REAL recording code fast and hermetically instead of re-implementing it.
if [ "${1:-}" = "--record-build-node-version" ]; then
  record_build_node_version
  exit 0
fi

echo "[1/6] Bundling quay (Core) with esbuild (ESM -> CJS, version.js aliased to build-time embed)..."
node scripts/esbuild-sea.mjs

echo "[2/6] Writing SEA config..."
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

echo "[3/6] Generating SEA prep blob..."
node --experimental-sea-config "${OUT_DIR}/sea-config.json"

echo "[4/6] Copying node binary as the executable base..."
NODE_BIN="$(command -v node)"
cp "${NODE_BIN}" "${EXE}"
chmod +w "${EXE}"
# Record (and floor-check) which Node this copy embedded — see record_build_node_version above.
record_build_node_version

echo "[5/6] Injecting blob via postject..."
if [ "$(uname -s)" = "Darwin" ]; then
  codesign --remove-signature "${EXE}" 2>/dev/null || true
fi
npx --yes postject "${EXE}" NODE_SEA_BLOB "${BLOB}" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  $( [ "$(uname -s)" = "Darwin" ] && echo "--macho-segment-name NODE_SEA" )
if [ "$(uname -s)" = "Darwin" ]; then
  codesign --sign - "${EXE}" 2>/dev/null || true
fi

echo "[6/6] Staging the plugin sidecar into the release bundle..."
stage_plugin_sidecar

chmod +x "${EXE}"
echo "Built: ${EXE}"
