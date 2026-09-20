#!/usr/bin/env bash
# sync-vendor.sh — DIR-040: single-source sync of the quay Claude Code plugin's
# vendored Core copy (plugin/vendor/quay/) from the ONE canonical source,
# packages/quay/{bin,src,package.json}. Run this after any change to
# packages/quay before releasing/testing the plugin; it never hand-edits
# plugin/vendor/quay directly — that tree is a generated mirror, not a second
# source of truth (ADR-004 single-source discipline, same discipline DIR-040
# item 3 requires).
#
# SYNC TIMING of the vendored dist bundle (gap-sync-vendor-drift-mislabelled-as-
# task-schema, M136): the vendored plugin/vendor/quay/dist/quay.js is a gitignored
# GENERATED mirror, consumed live by the plugin's MCP server (plugin/.mcp.json ->
# ${CLAUDE_PLUGIN_ROOT}/vendor/quay/dist/quay.js). The chosen timing is
# "auto-sync with tests" (option (a)):
#   - `scripts/test.sh` rebuilds the SOURCE dist on every run (build_dist_once),
#     then re-mirrors it here via `--sync-dist` — so a fresh vendored copy is
#     guaranteed before every test run, and `sync-vendor.sh --check` in the M136
#     packaging test sees a consistent mirror (never a deterministic false DRIFT
#     caused by a newer source build alone).
#   - `npm install` still regenerates it via the root `postinstall` (fresh clone +
#     install is self-consistent), and the release publish
#     (.github/workflows/publish-plugin-dist.yml) does the same before building
#     the dist-plugin orphan branch.
# It is never hand-synced and never silently stale: --check is a HARD gate (a
# stale vendored mirror fails loudly, exit 1) — not advisory, not skippable.
# This script (no flags) still does a full rebuild+mirror at any time.
#
# Why a vendored copy at all (not a runtime reference into packages/quay):
# Claude Code copies only the `plugin/` subtree into its install cache
# (plugins-reference: "plugins are copied to a cache, so paths referencing
# files outside the plugin directory won't work") — a path reaching outside
# plugin/ (e.g. ../../packages/quay) is NOT reliable across install scopes.
# So plugin/vendor/quay/{bin,src} MUST live inside plugin/, kept in sync by
# this script rather than drifting as a hand-maintained duplicate.
#
# Usage: bash plugin/scripts/sync-vendor.sh [--check] [--sync-dist]
#   (run from anywhere; resolves paths from its own location)
#
# --check: dry-run verification mode. Verifies that each file this script
#   normally copies is either byte-identical between source and destination,
#   a symlink (which guarantees identity), or an expected-different file
#   (task-schema group — attribution-only diffs). Exits 0 when clean,
#   non-zero when drift is detected. Does NOT copy anything.
#
# --sync-dist: mirror an ALREADY-BUILT source dist bundle to the vendored copy
#   WITHOUT rebuilding. Used by scripts/test.sh after its build_dist_once step,
#   so the vendored mirror stays fresh before every test run (see SYNC TIMING
#   above). Fails loudly if the source bundle is missing — never silently
#   paper over a stale/missing vendored copy.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

# ---------------------------------------------------------------------------
# Postinstall soft-fail WARN (gap-release-postinstall-fallback-breaks-windows-sea-build)
# ---------------------------------------------------------------------------
# The root package.json postinstall used to wrap this script in a bash-only
# `(echo '...' >&2; exit 0)` subshell that cmd.exe (npm's Windows script shell)
# cannot parse ("re-run: was unexpected at this time.") — breaking `npm install`
# on windows-latest sea-release (v0.4.0 shipped WITHOUT the windows-x64 SEA
# binary). The WARN now lives HERE, in bash, where the failure actually happens;
# the postinstall is simply `bash plugin/scripts/sync-vendor.sh || true`, which
# cmd.exe parses fine (the `|| true` swallows the nonzero exit, so npm install
# never hard-fails on a build artifact that could not be regenerated).
#
# We print the WARN only in no-flag (postinstall) mode, and we KEEP the original
# nonzero exit code — strict callers that invoke this script directly
# (publish-dist-branch.sh, quay-init.sh, packages/quay/scripts/package.sh) must
# still fail loudly; only the postinstall's own `|| true` swallows it.
POSTINSTALL_MODE=false
if [ "$#" -eq 0 ]; then
  POSTINSTALL_MODE=true
fi

postinstall_fail() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$POSTINSTALL_MODE" = "true" ]; then
    echo '[postinstall] WARNING: sync-vendor.sh failed -- plugin/vendor/quay/dist/quay.js may be missing or stale. This repo runs its own MCP server from plugin/vendor/quay/dist/quay.js (see .mcp.json); re-run: bash plugin/scripts/sync-vendor.sh' >&2
  fi
  exit "$rc"
}
trap postinstall_fail EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PLUGIN_DIR}/.." && pwd)"

SRC="${REPO_ROOT}/packages/quay"
DEST="${PLUGIN_DIR}/vendor/quay"

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
CHECK_MODE=false
SYNC_DIST_MODE=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_MODE=true ;;
    --sync-dist) SYNC_DIST_MODE=true ;;
    *) echo "ERROR: unknown argument: $arg" >&2; exit 2 ;;
  esac
done
if $CHECK_MODE && $SYNC_DIST_MODE; then
  echo "ERROR: --check and --sync-dist are mutually exclusive" >&2
  exit 2
fi

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
    return
  fi
  if [ "$expected" = "expected-diff" ]; then
    echo "[sync-vendor --check] OK (expected-diff): $label"
    return
  fi
  # Files differ. In a parallel test suite (--test-concurrency=8) the source
  # dist bundle is rebuilt by OTHER test files (build-dist.test.mjs test (d),
  # npm-pack-e2e.test.mjs before-hook) while this check runs; esbuild writes
  # dist/quay.js IN-PLACE (truncate + write, verified: the file passes through
  # size 0 / partial sizes during the rebuild, which under full-suite load can
  # last several seconds), so a concurrent read can catch the file mid-write —
  # a false DRIFT that resolves when the rebuild completes. The build is
  # deterministic, so a GENUINE drift is a source file that is STABLE (not being
  # rewritten) and still differs. Distinguish the two: while the source's
  # size/mtime keep changing it is mid-rebuild — wait (bounded); only report
  # DRIFT once the source is stable across consecutive reads at a full size
  # (a stable tiny file is a partial write still landing, not drift). A settled
  # identical source (the norm) reports OK. Bounded at 200x50ms = 10s to cover
  # sustained rebuilds under load (gap-sync-vendor-drift-mislabelled-as-task-schema).
  local dst_size cur_size cur_mtime prev_size="" prev_mtime="" stable=0 i
  dst_size="$(stat -c %s "$dst" 2>/dev/null || echo 0)"
  for ((i = 0; i < 200; i++)); do
    sleep 0.05
    if cmp -s "$src" "$dst"; then
      echo "[sync-vendor --check] OK (identical): $label"
      return
    fi
    cur_size="$(stat -c %s "$src" 2>/dev/null || echo 0)"
    cur_mtime="$(stat -c %Y "$src" 2>/dev/null || echo 0)"
    if [ -n "$prev_size" ] && [ "$cur_size" = "$prev_size" ] && [ "$cur_mtime" = "$prev_mtime" ]; then
      stable=$((stable + 1))
    else
      stable=0
    fi
    prev_size="$cur_size"
    prev_mtime="$cur_mtime"
    if [ "$stable" -ge 3 ] && [ "$cur_size" -ge "$((dst_size / 2))" ]; then
      break  # source stable at a full size but still differs -> genuine drift
    fi
  done
  echo "[sync-vendor --check] DRIFT: $label differs between source and destination" >&2
  echo "[sync-vendor --check]   src: $src" >&2
  echo "[sync-vendor --check]   dst: $dst" >&2
  DRIFT=1
}

# ---------------------------------------------------------------------------
# 1. Vendor dist bundles (Core quay.js + native provider quay-native.js)
# ---------------------------------------------------------------------------
# gap-ac3b-prove-installed-quay-runs-without-dev-tree (AC1): the installed
# plugin must be able to lay down a FUNCTIONAL provider runtime into a target
# project (so the project's mcp_entry points at a project-local copy, never a
# PATH-resolved `quay-native` into a dev tree). The native provider's
# self-contained bundle (packages/quay-native/dist/quay-native.js, built by
# build-dist.mjs — bundles quay/yaml/zod/sdk, runs on plain node) is mirrored
# into plugin/vendor/quay-native/ alongside the Core bundle, exactly like the
# Core dist/quay.js. provider.yml travels with it (the bundle resolves it
# relative to its own location, so the laid-down pair must stay together).
NATIVE_SRC="${REPO_ROOT}/packages/quay-native"
NATIVE_DEST="${PLUGIN_DIR}/vendor/quay-native"

if $CHECK_MODE; then
  echo "[sync-vendor --check] verifying vendor dist bundle ..."
  cmp_or_report "vendor/quay/dist/quay.js" \
    "${SRC}/dist/quay.js" "${DEST}/dist/quay.js"
  echo "[sync-vendor --check] verifying vendor native-provider bundle ..."
  cmp_or_report "vendor/quay-native/dist/quay-native.js" \
    "${NATIVE_SRC}/dist/quay-native.js" "${NATIVE_DEST}/dist/quay-native.js"
  cmp_or_report "vendor/quay-native/provider.yml" \
    "${NATIVE_SRC}/provider.yml" "${NATIVE_DEST}/provider.yml"
elif $SYNC_DIST_MODE; then
  # --sync-dist: mirror already-built source bundles, no rebuild (see header
  # comment — used by scripts/test.sh so the vendored mirror stays fresh before
  # every test run). scripts/test.sh's build_dist_once builds BOTH source
  # bundles (quay.js + quay-native.js) before calling --sync-dist, so a missing
  # bundle here is a real failure (never silently papered over).
  if [ ! -f "${SRC}/dist/quay.js" ]; then
    echo "ERROR: --sync-dist requires a built Core bundle: ${SRC}/dist/quay.js (run the build first)" >&2
    exit 2
  fi
  if [ ! -f "${NATIVE_SRC}/dist/quay-native.js" ]; then
    echo "ERROR: --sync-dist requires a built native bundle: ${NATIVE_SRC}/dist/quay-native.js (run the build first)" >&2
    exit 2
  fi
  echo "[sync-vendor --sync-dist] mirroring packages/quay/dist/quay.js + packages/quay-native -> plugin/vendor/ (no rebuild)"
  mkdir -p "${DEST}/dist" "${NATIVE_DEST}/dist"
  cp "${SRC}/dist/quay.js" "${DEST}/dist/quay.js"
  cp "${NATIVE_SRC}/dist/quay-native.js" "${NATIVE_DEST}/dist/quay-native.js"
  cp "${NATIVE_SRC}/provider.yml" "${NATIVE_DEST}/provider.yml"
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
  echo "[sync-vendor] building + mirroring packages/quay-native dist bundle -> plugin/vendor/quay-native/dist ..."
  bash "${NATIVE_SRC}/scripts/build-dist.sh"
  mkdir -p "${NATIVE_DEST}/dist"
  cp "${NATIVE_SRC}/dist/quay-native.js" "${NATIVE_DEST}/dist/quay-native.js"
  cp "${NATIVE_SRC}/provider.yml" "${NATIVE_DEST}/provider.yml"
fi

# --sync-dist is dist-bundle-only: mirror the source bundle and stop. All other
# vendored assets (skills, scripts, A2 corpus, package.json) are TRACKED in git
# and kept in sync by the normal commit flow — this mode must never touch them.
if $SYNC_DIST_MODE; then
  echo "[sync-vendor --sync-dist] done."
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Execute skill (author skill retired — gap-retire-unused-quay-author-skill)
# ---------------------------------------------------------------------------
if $CHECK_MODE; then
  echo "[sync-vendor --check] verifying execute skill ..."
  for name in execute; do
    cmp_or_report "skills/${name}" \
      "${REPO_ROOT}/packages/quay-native/skills/${name}/SKILL.md" \
      "${PLUGIN_DIR}/skills/${name}/SKILL.md"
  done
else
  echo "[sync-vendor] mirroring quay-native execute skill -> plugin/skills/execute ..."
  mkdir -p "${PLUGIN_DIR}/skills/execute"
  cp "${REPO_ROOT}/packages/quay-native/skills/execute/SKILL.md" "${PLUGIN_DIR}/skills/execute/SKILL.md"
fi

# ---------------------------------------------------------------------------
# 3. Task-schema files (group 2 — expected-different)
# ---------------------------------------------------------------------------
EXPERIMENT_DIR="${REPO_ROOT}/experiments/quay-perpetual-stream"
EXPERIMENT_SCRIPTS="${EXPERIMENT_DIR}/scripts"

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
  # M152 (DIR-091) refactored task-schema-check.sh (and 6 sibling gate scripts) to depend on the shared
  # gate-script-lib.sh; it travels with them (see this section's header note above the list). No exp5
  # attribution to sanitize (byte-identical copy, not group-2).
  echo "[sync-vendor] mirroring the task-schema check + its shared gate-script-lib.sh -> plugin/scripts/ ..."
  # ⛔ Symlink guard, same as section 4's SYNC_SCRIPTS loop below — and for the same reason. These four
  # sources are SYMLINKS into plugin/scripts/ today (`experiments/.../scripts/task-schema.ts ->
  # ../../../plugin/scripts/task-schema.ts`, the single-source direction of the mirror policy), so a
  # plain `cp` is a copy of a file ONTO ITSELF: `cp: '…' and '…' are the same file`, exit 1, and
  # `set -e` aborts the whole script. Measured 2026-09-20 in a fresh worktree: the full (no-flag) path
  # died HERE and never reached the later sections — including the build-mode version stamp at the end
  # of section 7, whose ordering constraint (section 6 rewrites plugin/vendor/quay/package.json's
  # version) is why it cannot simply be moved earlier. The abort was pre-existing and invisible: the
  # only routine caller is the root `postinstall` (`bash plugin/scripts/sync-vendor.sh || true`), whose
  # `|| true` swallowed it. Fixing it here rather than deferring is not scope creep — without it the
  # wiring this task adds was unreachable code, and a release build would have shipped a `-dev` artifact.
  for s in task-schema.ts task-schema-check.ts task-schema-check.sh gate-script-lib.sh; do
    if [ -L "${EXPERIMENT_SCRIPTS}/${s}" ]; then echo "[sync-vendor] skipping symlink: ${s}"; continue; fi
    cp "${EXPERIMENT_SCRIPTS}/${s}" "${PLUGIN_DIR}/scripts/${s}"
    case "$s" in *.sh) chmod +x "${PLUGIN_DIR}/scripts/${s}" ;; esac
  done
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
  gate-script-base
  wiring-coverage-check
  proposal-convergence
  write-json-atomic
  prepare-admission-check
  # NOTE (gap-retire-the-prepare-execute-pipeline-cluster): composite-{args,contracts,build,audit,
  # reconcile,land,preflight,manifest-synthesis} and milestone-preparation-check were retired with
  # the prepare/execute pipeline (ADR-022) and removed from this vendored set.
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
  # ── Build-mode version stamp (gap-version-stamp-generator-and-build-wiring) ──────────────────────
  # The last write of a build, and it MUST be the last one: section 6 rewrites
  # plugin/vendor/quay/package.json's version from packages/quay/package.json, so a stamp placed
  # earlier would be undone. A built tree is an ARTIFACT, and an artifact's version is decided by the
  # BUILD, not by the commit — `resolveVersion(VERSION,'build')` is `X.Y.Z` on a `release/*` branch (or
  # at tag `vX.Y.Z`) and `X.Y.Z-dev` everywhere else (human ruling 2026-09-20:
  # 「可以在 build 过程中，监测分支并加后缀，如 -dev」). The committed carriers are ALWAYS `X.Y.Z-dev`
  # on every branch, so this is a NO-OP on develop/author and only bites on a release build.
  # ⚠️ On a `release/*` branch it therefore WRITES TRACKED FILES (plugin/VERSION,
  # plugin/.claude-plugin/{plugin,marketplace}.json, plugin/README.md, plugin/vendor/quay/package.json)
  # — deliberately: a release branch is a transient build surface, nothing here is committed (the tag
  # is cut on the `-dev` commit; the released version belongs to the artifact), and `git status` on
  # develop/author stays clean because build == tracked there.
  # ⛔ Reached through `stamp-version.mjs` (the Node-20-safe entry), never the `.ts` source: this
  # script is also the root `postinstall` (`engines: >=20`), where `--experimental-strip-types` does
  # not exist. A missing entry makes `node` itself exit non-zero ⇒ `set -e` fails closed.
  echo "[sync-vendor] stamping the built plugin tree (build-form, branch-aware)..." && node "${REPO_ROOT}/scripts/stamp-version.mjs" --mode build --root "${PLUGIN_DIR}" --git-root "${REPO_ROOT}"
  # gap-dist-runtime-not-self-contained-reads-external-package-json (AC3): the
  # completion claim is now ACCURATE — src/version.ts embeds the version at build
  # time (esbuild json loader inlines it into dist/quay.js), so the vendored
  # bundle never reads a sibling package.json at runtime. It is self-contained:
  # version inlined at build time, no runtime package.json read, no npm install.
  echo "[sync-vendor] done. The vendored dist/quay.js is self-contained: version inlined at build time (no runtime package.json read), no npm install needed."
fi
