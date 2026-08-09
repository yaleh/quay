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
# Usage:
#   bash packages/quay/scripts/verify-sea-artifact.sh <extracted-bundle-dir>
#   bash packages/quay/scripts/verify-sea-artifact.sh --list-mechanisms
#   # (--list-mechanisms prints the 6 names, one per line, and exits 0)

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
echo "verify-sea-artifact: PASS (${BUNDLE_DIR})"
