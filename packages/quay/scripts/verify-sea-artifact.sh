#!/usr/bin/env bash
# verify-sea-artifact.sh — gap-release-artifact-missing-plugin-ac16 (AC3 产物层验证).
#
# The v0.4.0 SEA release archive (`quay-sea-0.4.0-linux-x64.tar.gz`) shipped only the two SEA
# binaries (`quay`, `quay-native`) plus tasks/ + a config template — NO plugin/. archguard report
# #13 (2026-08-06) double-confirmed it: `strings` of the 6 mechanism names
# (dead-loop-check/verify-delivery-surface/slot-refill/claim-task/self-report-vocab/
# laydown-set-check) found ZERO hits in the shipped binaries, so AC16 (artifact-level delivery)
# was unmet at the artifact layer and the upgrade channel was broken.
#
# The fix (gap-release-sea-bundle-excludes-plugin-tree, AC3 architecture decision): the plugin
# ships as a SIDECAR directory inside the same archive (a SEA single-file binary structurally
# cannot contain a directory tree; the plugin is a tree of .sh/.ts/markdown that needs Node+shell
# at runtime — embedding would force a runtime unpack with no benefit). The mechanism names live
# in the plugin/ files, NOT in the binaries — so this script's contract measure is:
#
#   release_tarball_has_plugin = plugin/ 非空  OR  机制名命中 ≥ 6 (6 机制名全在产物)
#
# This script is the mechanical artifact-level check for that measure: given an EXTRACTED release
# bundle directory, it verifies (a) plugin/ is present and non-empty, and (b) every one of the 6
# mechanism names is reverse-searchable in the bundle (the same `strings`/`tar tzf` search archguard
# ran and found failing for v0.4.0). Fail-closed: any check failing exits 1.
#
# Wired into release.yml (the sea-release job verifies the assembled bundle before upload; the
# node-free sea-verify-node-free job re-checks the DOWNLOADED consumer-facing asset) and exercised
# hermetically by packages/quay/test/verify-sea-artifact.test.mjs.
#
# gap-sea-binary-embeds-build-time-node-version-ci-vs-local-diverge (check (c) below): the SEA
# executables are byte-copies of the BUILD MACHINE's `node` (build-sea.sh step [4/6] / [4/5]), so
# "which Node is inside this binary" was an implicit build-environment fact — the same script on
# Node 25 produces a Node-25 binary while CI's sea-release job pins Node 20. Check (c) turns that
# into an explicit, mechanically re-checkable claim: it reads the version back FROM THE BINARY'S
# BYTES, cross-checks it against the version the build recorded (`<binary>.build-node-version`,
# written by build-sea.sh and shipped inside the archive), and fails closed if either disagrees
# with the declared floor.
#
# Usage:
#   SEA_NODE_VERSION=20 bash packages/quay/scripts/verify-sea-artifact.sh <extracted-bundle-dir>
#   bash packages/quay/scripts/verify-sea-artifact.sh --list-mechanisms
#   # (--list-mechanisms prints the 6 names, one per line, and exits 0)
#   bash packages/quay/scripts/verify-sea-artifact.sh --extract-node-version <node-or-sea-binary>
#   # (prints the Node version embedded in that binary's bytes; exit 1 if it cannot be read)
#
# SEA_NODE_VERSION (the declared Node floor for the SEA channel) is REQUIRED for the bundle form:
# without it check (c) cannot evaluate, and a gate that cannot evaluate must not print PASS. It is
# supplied by release.yml's workflow-level env; re-checking an older archive means passing the floor
# that release.yml declared at that tag, e.g. `SEA_NODE_VERSION=20 bash ... <bundle>`.

set -euo pipefail

# The 6 new mechanism names archguard searched for in the v0.4.0 SEA binary and found absent.
# SINGLE SOURCE for the artifact-level mechanism check (mirrored in the test file and the
# sea-verify-node-free inline check — keep them in sync when the mechanism set changes).
MECHANISM_NAMES=(
  "dead-loop-check"
  "verify-delivery-surface"
  "slot-refill"
  "claim-task"
  "self-report-vocab"
  "laydown-set-check"
)

if [ "${1:-}" = "--list-mechanisms" ]; then
  for m in "${MECHANISM_NAMES[@]}"; do echo "${m}"; done
  exit 0
fi

# ── Node-version extraction (bytes, not `--version`) ─────────────────────────────────────────────
# A SEA executable does NOT handle node's own CLI flags: with a SEA binary built from
# `console.log("hi")`, `--version`, `-v` and `-p process.version` ALL print "hi" and exit 0
# (measured 2026-09-16) — node's argument handling is bypassed and the embedded main runs instead.
# So the only mechanical reading of "which Node is inside this file" is the file's own bytes.
# Anchors, tried in order (both present in every official nodejs.org build; verified on
# v20.19.0-linux-x64 and v24.19.0-linux-x64):
#   1. the V8 inspector user-agent  "node.js/vX.Y.Z"
#   2. the source-tarball URL baked into config.gypi
#      "https://nodejs.org/download/release/vX.Y.Z/node-vX.Y.Z.tar.gz"
# Keep the anchor patterns in sync with the inline mirrors in release.yml's
# sea-verify-node-free / sea-verify-node-free-cross-platform jobs (same rule as the mechanism-name
# list above: this container-less jobs cannot call this script, so they mirror its checks).
# Both are in the node binary's .rodata and survive postject blob injection unchanged (the SEA
# executable is a byte-copy of node with a blob appended).
# Prints the version to stdout on success; prints nothing and returns 1 when it cannot be read
# (silent so callers own the diagnostic — a failed read must not look like a successful one).
extract_embedded_node_version() {
  local bin="$1" v=""
  if [ ! -f "${bin}" ]; then
    return 1
  fi
  v="$(grep -aoE 'node\.js/v[0-9]+\.[0-9]+\.[0-9]+' "${bin}" 2>/dev/null | head -1 | sed 's#^node\.js/##' || true)"
  if [ -z "${v}" ]; then
    v="$(grep -aoE 'https://nodejs\.org/download/release/v[0-9]+\.[0-9]+\.[0-9]+/node-v[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz' "${bin}" 2>/dev/null | head -1 | sed -E 's#.*/release/(v[0-9.]+)/.*#\1#' || true)"
  fi
  if [ -z "${v}" ]; then
    return 1
  fi
  printf '%s\n' "${v}"
}

if [ "${1:-}" = "--extract-node-version" ]; then
  TARGET="${2:?usage: verify-sea-artifact.sh --extract-node-version <node-or-sea-binary>}"
  if [ ! -f "${TARGET}" ]; then
    echo "ERROR: not a file: ${TARGET}" >&2
    exit 1
  fi
  if ! extract_embedded_node_version "${TARGET}"; then
    echo "ERROR: no embedded Node version found in ${TARGET} — not a Node-based binary, or the extraction anchors (node.js/vX.Y.Z, the config.gypi source-tarball URL) changed." >&2
    exit 1
  fi
  exit 0
fi

BUNDLE_DIR="${1:?usage: verify-sea-artifact.sh <extracted-bundle-dir>}"

if [ ! -d "${BUNDLE_DIR}" ]; then
  echo "ERROR: bundle dir not found: ${BUNDLE_DIR}" >&2
  exit 1
fi

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

PLUGIN_DIR="${BUNDLE_DIR}/plugin"

# ── (a) plugin sidecar present + non-empty ─────────────────────────────────────────────────────────
if [ -d "${PLUGIN_DIR}" ]; then
  FILE_COUNT="$(find "${PLUGIN_DIR}" -type f 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${FILE_COUNT}" -eq 0 ]; then
    fail "plugin/ is EMPTY (0 files) — the artifact would not carry the loop mechanisms"
  fi
  echo "OK: plugin sidecar present and non-empty (${FILE_COUNT} files)"
else
  echo "WARN: no plugin/ sidecar found — falling back to the binary-embed check (strings)" >&2
fi

# ── (b) 6 mechanism names reverse-searchable in the artifact ──────────────────────────────────────
# `grep -rlF` (recursive, literal, files-with-matches) scans the whole bundle including the SEA
# binaries (a binary match is reported as a matching file by -l). This is the artifact-level
# reverse-search archguard ran against v0.4.0 — the mechanism names must be reachable somewhere in
# the extracted artifact (for the sidecar form: the plugin/ files; for an embed form: the binary).
MISSING=0
MISSING_NAMES=()
for m in "${MECHANISM_NAMES[@]}"; do
  if ! grep -rlF -- "${m}" "${BUNDLE_DIR}" 2>/dev/null | grep -q .; then
    echo "  MISSING: '${m}' is not reverse-searchable in the artifact" >&2
    MISSING=$((MISSING + 1))
    MISSING_NAMES+=("${m}")
  fi
done

if [ "${MISSING}" -ne 0 ]; then
  fail "${MISSING} of ${#MECHANISM_NAMES[@]} mechanism names are NOT present in the artifact (${MISSING_NAMES[*]}) — AC16 artifact-level delivery unmet"
fi

echo "OK: all ${#MECHANISM_NAMES[@]} mechanism names reverse-searchable in the artifact"

# ── (c) the SEA binaries embed the declared Node version ─────────────────────────────────────────
# Three readings of the same quantity, cross-checked (a single self-reported file would be a
# tautology — this is what makes the criterion able to be FALSE):
#   1. the version read from the binary's own BYTES  (the artifact's physical content)
#   2. the version the build recorded next to it     (`<binary>.build-node-version`, build-sea.sh)
#   3. the declared floor                            (SEA_NODE_VERSION, from release.yml's env)
# Fail-closed on any disagreement, and on "cannot read" — a release gate must not pass by default.
DECLARED_NODE_VERSION="${SEA_NODE_VERSION:-}"
if [ -z "${DECLARED_NODE_VERSION}" ]; then
  fail "SEA_NODE_VERSION is not set — cannot evaluate whether the SEA binaries embed the declared Node floor (fail-closed: an unevaluated gate must not report PASS). Re-run with SEA_NODE_VERSION=<declared major>, e.g. SEA_NODE_VERSION=20"
fi

CHECKED_BINARIES=0
for base in quay quay-native; do
  for exe in "${base}" "${base}.exe"; do
    BIN_PATH="${BUNDLE_DIR}/${exe}"
    [ -f "${BIN_PATH}" ] || continue
    CHECKED_BINARIES=$((CHECKED_BINARIES + 1))

    EMBEDDED="$(extract_embedded_node_version "${BIN_PATH}")" || EMBEDDED=""
    if [ -z "${EMBEDDED}" ]; then
      fail "cannot read an embedded Node version from '${exe}' — it is not a Node-based SEA binary (or the extraction anchors changed). Refusing to pass a release artifact whose Node runtime cannot be identified"
    fi

    RECORD_FILE="${BIN_PATH}.build-node-version"
    if [ ! -f "${RECORD_FILE}" ]; then
      fail "'${exe}' has no recorded build-runtime provenance ('${exe}.build-node-version'). build-sea.sh writes it; a bundle assembled without it cannot be checked against the declared floor"
    fi
    RECORDED="$(tr -d '[:space:]' < "${RECORD_FILE}")"

    if [ "${EMBEDDED}" != "${RECORDED}" ]; then
      fail "'${exe}' embeds Node ${EMBEDDED} but the build recorded ${RECORDED} — the binary and its provenance disagree (substituted binary, stale provenance file, or a build-path change); cannot attribute the embedded runtime"
    fi

    case "${EMBEDDED}" in
      "v${DECLARED_NODE_VERSION}."*) ;;
      *) fail "'${exe}' embeds Node ${EMBEDDED}, but release.yml declares the SEA Node floor as ${DECLARED_NODE_VERSION} — the SEA channel would ship a runtime other than the declared one" ;;
    esac
    echo "OK: ${exe} embeds Node ${EMBEDDED} (recorded ${RECORDED}, declared floor ${DECLARED_NODE_VERSION})"
  done
done

if [ "${CHECKED_BINARIES}" -eq 0 ]; then
  fail "no SEA binary (quay / quay-native, or their .exe forms) found in ${BUNDLE_DIR} — a release bundle without the binaries it is named for cannot be verified"
fi

echo "OK: all ${CHECKED_BINARIES} SEA binaries embed the declared Node ${DECLARED_NODE_VERSION}"
echo "verify-sea-artifact: PASS (${BUNDLE_DIR})"
