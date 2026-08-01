#!/usr/bin/env bash
# sync-vendor.sh — DIR-040: single-source sync of the quay Claude Code plugin's
# vendored Core copy (plugin/vendor/quay/) from the ONE canonical source,
# packages/quay/{bin,src,package.json}. Run this after any change to
# packages/quay before releasing/testing the plugin; it never hand-edits
# plugin/vendor/quay directly — that tree is a generated mirror, not a second
# source of truth (ADR-004 single-source discipline, same discipline DIR-040
# item 3 requires).
#
# Why a vendored copy at all (not a runtime reference into packages/quay):
# Claude Code copies only the `plugin/` subtree into its install cache
# (plugins-reference: "plugins are copied to a cache, so paths referencing
# files outside the plugin directory won't work") — a path reaching outside
# plugin/ (e.g. ../../packages/quay) is NOT reliable across install scopes.
# So plugin/vendor/quay/{bin,src} MUST live inside plugin/, kept in sync by
# this script rather than drifting as a hand-maintained duplicate.
#
# Usage: bash plugin/scripts/sync-vendor.sh [--check]
#   (run from anywhere; resolves paths from its own location)
#
# --check: dry-run verification mode. Verifies that each file this script
#   normally copies is either byte-identical between source and destination,
#   a symlink (which guarantees identity), or an expected-different file
#   (task-schema group — attribution-only diffs). Exits 0 when clean,
#   non-zero when drift is detected. Does NOT copy anything.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PLUGIN_DIR}/.." && pwd)"

SRC="${REPO_ROOT}/packages/quay"
DEST="${PLUGIN_DIR}/vendor/quay"

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
CHECK_MODE=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_MODE=true ;;
    *) echo "ERROR: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# Track drift for --check exit code
DRIFT=0

# cmp-or-report: in --check mode, compare two files and report drift if they differ.
# Usage: cmp-or-report <label> <src> <dst> [expected-diff]
# If "expected-diff" is passed, differences are tolerated (e.g. task-schema).
cmp_or_report() {
  local label="$1" src="$2" dst="$3" expected="${4:-}"
  if [ ! -f "$src" ]; then
    echo "[sync-vendor --check] MISSING-SRC: $label ($src)" >&2
    DRIFT=1
    return
  fi
  if [ ! -f "$dst" ]; then
    echo "[sync-vendor --check] MISSING-DST: $label ($dst)" >&2
    DRIFT=1
    return
  fi
  if cmp -s "$src" "$dst"; then
    echo "[sync-vendor --check] OK (identical): $label"
  elif [ "$expected" = "expected-diff" ]; then
    echo "[sync-vendor --check] OK (expected-diff): $label"
  else
    echo "[sync-vendor --check] DRIFT: $label differs between source and destination" >&2
    echo "[sync-vendor --check]   src: $src" >&2
    echo "[sync-vendor --check]   dst: $dst" >&2
    DRIFT=1
  fi
}

# ---------------------------------------------------------------------------
# 1. Vendor dist bundle
# ---------------------------------------------------------------------------
if $CHECK_MODE; then
  echo "[sync-vendor --check] verifying vendor dist bundle ..."
  cmp_or_report "vendor/task-schema.ts" \
    "${SRC}/dist/quay.js" "${DEST}/dist/quay.js"
else
  if [ ! -d "$SRC" ]; then
    echo "ERROR: source not found: $SRC" >&2
    exit 2
  fi
  echo "[sync-vendor] building + mirroring packages/quay dist bundle -> plugin/vendor/quay/dist ..."
  mkdir -p "$DEST"
  rm -rf "${DEST}/bin" "${DEST}/src" "${DEST}/dist"
  bash "${SRC}/scripts/build-dist.sh"
  mkdir -p "${DEST}/dist"
  cp "${SRC}/dist/quay.js" "${DEST}/dist/quay.js"
fi

# ---------------------------------------------------------------------------
# 2. Author/execute skills
# ---------------------------------------------------------------------------
if $CHECK_MODE; then
  echo "[sync-vendor --check] verifying author/execute skills ..."
  for name in author execute; do
    cmp_or_report "skills/${name}" \
      "${REPO_ROOT}/packages/quay-native/skills/${name}/SKILL.md" \
      "${PLUGIN_DIR}/skills/${name}/SKILL.md"
  done
else
  echo "[sync-vendor] mirroring quay-native author/execute skills -> plugin/skills/{author,execute} ..."
  mkdir -p "${PLUGIN_DIR}/skills/author" "${PLUGIN_DIR}/skills/execute"
  cp "${REPO_ROOT}/packages/quay-native/skills/author/SKILL.md" "${PLUGIN_DIR}/skills/author/SKILL.md"
  cp "${REPO_ROOT}/packages/quay-native/skills/execute/SKILL.md" "${PLUGIN_DIR}/skills/execute/SKILL.md"
fi

# ---------------------------------------------------------------------------
# 3. Task-schema files (group 2 — expected-different)
# ---------------------------------------------------------------------------
EXPERIMENT_SCRIPTS="${REPO_ROOT}/experiments/quay-perpetual-stream/scripts"

if $CHECK_MODE; then
  echo "[sync-vendor --check] verifying task-schema files (expected-diff) ..."
  for name in task-schema.ts task-schema-check.ts task-schema-check.sh; do
    cmp_or_report "task-schema/${name}" \
      "${EXPERIMENT_SCRIPTS}/${name}" \
      "${PLUGIN_DIR}/scripts/${name}" \
      "expected-diff"
  done
  echo "[sync-vendor --check] verifying gate-script-lib.sh (task-schema-check.sh's shared dependency) ..."
  cmp_or_report "task-schema/gate-script-lib.sh" \
    "${EXPERIMENT_SCRIPTS}/gate-script-lib.sh" \
    "${PLUGIN_DIR}/scripts/gate-script-lib.sh"
else
  echo "[sync-vendor] mirroring the task-schema check -> plugin/scripts/{task-schema.ts,task-schema-check.ts,task-schema-check.sh} ..."
  cp "${EXPERIMENT_SCRIPTS}/task-schema.ts" "${PLUGIN_DIR}/scripts/task-schema.ts"
  cp "${EXPERIMENT_SCRIPTS}/task-schema-check.ts" "${PLUGIN_DIR}/scripts/task-schema-check.ts"
  cp "${EXPERIMENT_SCRIPTS}/task-schema-check.sh" "${PLUGIN_DIR}/scripts/task-schema-check.sh"
  chmod +x "${PLUGIN_DIR}/scripts/task-schema-check.sh"
  # M152 (DIR-091) refactored task-schema-check.sh (and 6 sibling gate scripts) to depend
  # on this shared lib. No exp5 attribution to sanitize (byte-identical copy, not group-2).
  echo "[sync-vendor] mirroring gate-script-lib.sh (task-schema-check.sh's shared dependency) ..."
  cp "${EXPERIMENT_SCRIPTS}/gate-script-lib.sh" "${PLUGIN_DIR}/scripts/gate-script-lib.sh"
  chmod +x "${PLUGIN_DIR}/scripts/gate-script-lib.sh"
fi

# ---------------------------------------------------------------------------
# 4. Concurrency / routine scripts (group 1 — must be identical; symlink-safe)
# ---------------------------------------------------------------------------
SYNC_SCRIPTS=(
  touches-orthogonality-check
  concurrent-batch-scheduler
  serial-fanin-absorb
  anti-drift-touches-check
  routine-scheduler
  routine-file-gate
  read-probe-spec
  candidate-contracts
  coupling-graph
  candidate-synthesis
  portfolio-choice
  preparation-feedback
  composite-args
  composite-contracts
  composite-build
  composite-audit
  composite-reconcile
  composite-land
  composite-preflight
  composite-manifest-synthesis
  gate-script-base
  wiring-coverage-check
  milestone-preparation-check
  proposal-convergence
  prepare-admission-check
)

if $CHECK_MODE; then
  echo "[sync-vendor --check] verifying concurrency/routine scripts ..."
  for s in "${SYNC_SCRIPTS[@]}"; do
    cmp_or_report "scripts/${s}.ts" \
      "${EXPERIMENT_SCRIPTS}/${s}.ts" \
      "${PLUGIN_DIR}/scripts/${s}.ts"
  done
else
  echo "[sync-vendor] mirroring the DIR-044 concurrency scripts + DIR-056 probe loader -> plugin/scripts/ ..."
  for s in "${SYNC_SCRIPTS[@]}"; do
    src_file="${EXPERIMENT_SCRIPTS}/${s}.ts"
    if [ -L "$src_file" ]; then
      echo "[sync-vendor] skipping symlink: ${s}.ts"
      continue
    fi
    cp "${src_file}" "${PLUGIN_DIR}/scripts/${s}.ts"
  done
fi

# ---------------------------------------------------------------------------
# 5. Attribution sanitization (task-schema only; skip in --check mode)
# ---------------------------------------------------------------------------
if ! $CHECK_MODE; then
  for f in "${PLUGIN_DIR}/scripts/task-schema.ts" "${PLUGIN_DIR}/scripts/task-schema-check.ts" "${PLUGIN_DIR}/scripts/task-schema-check.sh"; do
    perl -0pi -e 's/\(exp5 \/\s*\n(\/\/|#) canonical-task-schema/(canonical-task-schema/g; s/exp5-M-CRYST-B1\/DIR-028/DIR-028/g; s/\bexp5\b\s*\/\s*//g' "$f"
  done
fi

# ---------------------------------------------------------------------------
# 5.5. DIR-124-A2 golden replay corpus (workflow-event-schema, replay runner, test, fixtures)
# ---------------------------------------------------------------------------
A2_SCRIPTS=(
  workflow-event-schema.mjs
  workflow-replay.ts
)
A2_TEST_FILES=(
  workflow-replay.test.mjs
)
A2_FIXTURE_CASES=(
  legacy-singleton-success
  composite-success
  cache-resume
  verify-failure
  prepared-failure
  audit-refuted
  gate-failure
  concurrent-partial-survivor
  m192-null-build
  m195-stale-prepared
  legacy-singleton-success-tampered
  m192-defect-as-normative
)

if $CHECK_MODE; then
  echo "[sync-vendor --check] verifying DIR-124-A2 golden replay corpus ..."
  for s in "${A2_SCRIPTS[@]}"; do
    cmp_or_report "scripts/${s}" \
      "${EXPERIMENT_SCRIPTS}/${s}" \
      "${PLUGIN_DIR}/scripts/${s}"
  done
  for t in "${A2_TEST_FILES[@]}"; do
    cmp_or_report "test/${t}" \
      "${EXPERIMENT_DIR}/test/${t}" \
      "${PLUGIN_DIR}/test/${t}"
  done
  for c in "${A2_FIXTURE_CASES[@]}"; do
    for f in events.jsonl expectations.json; do
      cmp_or_report "fixtures/workflow-replay/${c}/${f}" \
        "${EXPERIMENT_DIR}/fixtures/workflow-replay/${c}/${f}" \
        "${PLUGIN_DIR}/fixtures/workflow-replay/${c}/${f}"
    done
    # README.md is optional (only for synthetic fixtures)
    if [ -f "${PLUGIN_DIR}/fixtures/workflow-replay/${c}/README.md" ]; then
      cmp_or_report "fixtures/workflow-replay/${c}/README.md" \
        "${EXPERIMENT_DIR}/fixtures/workflow-replay/${c}/README.md" \
        "${PLUGIN_DIR}/fixtures/workflow-replay/${c}/README.md"
    fi
  done
else
  echo "[sync-vendor] mirroring DIR-124-A2 golden replay corpus -> plugin/ ..."
  for s in "${A2_SCRIPTS[@]}"; do
    src_file="${EXPERIMENT_SCRIPTS}/${s}"
    if [ -L "$src_file" ]; then
      echo "[sync-vendor] skipping symlink: ${s}"
      continue
    fi
    cp "${src_file}" "${PLUGIN_DIR}/scripts/${s}"
  done
  for t in "${A2_TEST_FILES[@]}"; do
    src_file="${EXPERIMENT_DIR}/test/${t}"
    if [ -L "$src_file" ]; then
      echo "[sync-vendor] skipping symlink: ${t}"
      continue
    fi
    cp "${src_file}" "${PLUGIN_DIR}/test/${t}"
  done
  for c in "${A2_FIXTURE_CASES[@]}"; do
    mkdir -p "${PLUGIN_DIR}/fixtures/workflow-replay/${c}"
    cp "${EXPERIMENT_DIR}/fixtures/workflow-replay/${c}/events.jsonl" \
       "${PLUGIN_DIR}/fixtures/workflow-replay/${c}/events.jsonl"
    cp "${EXPERIMENT_DIR}/fixtures/workflow-replay/${c}/expectations.json" \
       "${PLUGIN_DIR}/fixtures/workflow-replay/${c}/expectations.json"
    if [ -f "${EXPERIMENT_DIR}/fixtures/workflow-replay/${c}/README.md" ]; then
      cp "${EXPERIMENT_DIR}/fixtures/workflow-replay/${c}/README.md" \
         "${PLUGIN_DIR}/fixtures/workflow-replay/${c}/README.md"
    fi
  done
fi

# ---------------------------------------------------------------------------
# 6. Vendor package.json
# ---------------------------------------------------------------------------
if $CHECK_MODE; then
  echo "[sync-vendor --check] verifying vendor package.json ..."
  VENDOR_PKG="${DEST}/package.json"
  if [ ! -f "$VENDOR_PKG" ]; then
    echo "[sync-vendor --check] MISSING-DST: vendor package.json ($VENDOR_PKG)" >&2
    DRIFT=1
  elif ! node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    if (p.name !== 'quay-plugin-vendor' || p.type !== 'module' || !p.version || 'dependencies' in p) process.exit(1);
  " "$VENDOR_PKG"; then
    echo "[sync-vendor --check] DRIFT: vendor package.json has wrong shape" >&2
    DRIFT=1
  else
    echo "[sync-vendor --check] OK (identical): vendor/package.json"
  fi
else
  node -e '
  const fs = require("fs");
  const path = require("path");
  const src = JSON.parse(fs.readFileSync(path.join(process.argv[1], "package.json"), "utf8"));
  const out = {
    name: "quay-plugin-vendor",
    version: src.version,
    private: true,
    type: src.type,
  };
  fs.writeFileSync(path.join(process.argv[2], "package.json"), JSON.stringify(out, null, 2) + "\n");
  ' "$SRC" "$DEST"
  rm -f "${DEST}/package-lock.json"
  echo "[sync-vendor] wrote ${DEST}/package.json (version $(node -p "require('${DEST}/package.json').version"))"
fi

# ---------------------------------------------------------------------------
# 7. Done / exit
# ---------------------------------------------------------------------------
if $CHECK_MODE; then
  if [ "$DRIFT" -eq 0 ]; then
    echo "[sync-vendor --check] CLEAN: all files verified, no drift detected."
    exit 0
  else
    echo "[sync-vendor --check] FAIL: drift detected (see DRIFT lines above)." >&2
    exit 1
  fi
else
  echo "[sync-vendor] done. The vendored dist/quay.js is fully self-contained (no npm install needed)."
fi
