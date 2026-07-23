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
# Usage: bash plugin/scripts/sync-vendor.sh
#   (run from anywhere; resolves paths from its own location)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PLUGIN_DIR}/.." && pwd)"

SRC="${REPO_ROOT}/packages/quay"
DEST="${PLUGIN_DIR}/vendor/quay"

if [ ! -d "$SRC" ]; then
  echo "ERROR: source not found: $SRC" >&2
  exit 2
fi

# M120 (DIR-060): mirror the BUNDLED ESM dist/quay.js, not the raw bin/src
# copies. The M116 .ts entrypoint only runs on Node >=23; the plugin must run on
# the declared Node-20 floor, so the vendored Core is the transpiled, fully
# self-contained bundle produced by build-dist.sh (zero external runtime deps —
# which is also why the vendor package.json no longer needs `dependencies` nor a
# package-lock.json / `npm install` step). plugin/.mcp.json points node at
# vendor/quay/dist/quay.js.
echo "[sync-vendor] building + mirroring packages/quay dist bundle -> plugin/vendor/quay/dist ..."
mkdir -p "$DEST"
rm -rf "${DEST}/bin" "${DEST}/src" "${DEST}/dist"
bash "${SRC}/scripts/build-dist.sh"
mkdir -p "${DEST}/dist"
cp "${SRC}/dist/quay.js" "${DEST}/dist/quay.js"

# Author/execute skills: mirror quay-native's npm-package-shipped skills
# (packages/quay-native/skills/{author,execute}/SKILL.md — the SAME files
# already shipped in the quay-native npm package's "files" list) into the
# plugin's own skills/ dir. Same non-drift discipline as the vendor/quay bin
# mirror above: this script is the only writer of plugin/skills/{author,execute}.
echo "[sync-vendor] mirroring quay-native author/execute skills -> plugin/skills/{author,execute} ..."
mkdir -p "${PLUGIN_DIR}/skills/author" "${PLUGIN_DIR}/skills/execute"
cp "${REPO_ROOT}/packages/quay-native/skills/author/SKILL.md" "${PLUGIN_DIR}/skills/author/SKILL.md"
cp "${REPO_ROOT}/packages/quay-native/skills/execute/SKILL.md" "${PLUGIN_DIR}/skills/execute/SKILL.md"

# Directive skill's schema-check: mirror the two PURE, portable modules from
# exp5's scripts/ (task-schema.mjs, task-schema-check.mjs/.sh — no exp5-path
# assumptions live IN these files; they operate on whatever task-file paths
# are passed as argv). Bundled so the directive skill never reaches into
# experiments/** at runtime (DIR-040 item 2) — exp5's own copies at
# experiments/quay-perpetual-stream/scripts/ are untouched and remain the
# source these are mirrored from.
echo "[sync-vendor] mirroring the task-schema check -> plugin/scripts/{task-schema.ts,task-schema-check.ts,task-schema-check.sh} ..."
cp "${REPO_ROOT}/experiments/quay-perpetual-stream/scripts/task-schema.ts" "${PLUGIN_DIR}/scripts/task-schema.ts"
cp "${REPO_ROOT}/experiments/quay-perpetual-stream/scripts/task-schema-check.ts" "${PLUGIN_DIR}/scripts/task-schema-check.ts"
cp "${REPO_ROOT}/experiments/quay-perpetual-stream/scripts/task-schema-check.sh" "${PLUGIN_DIR}/scripts/task-schema-check.sh"
chmod +x "${PLUGIN_DIR}/scripts/task-schema-check.sh"

# DIR-049: the concurrent-scheduler scripts the loop-driver skill calls at concurrency > 1 MUST ship
# with the plugin (a consumer workspace like archguard has no experiments/ dir). Self-contained (they
# only import each other, relative). Canonical source stays experiments/; these are vendored copies.
# DIR-056: read-probe-spec.mjs added — the probe spec loader, single-source in exp5/scripts/,
# referenced by the skill at dispatch time; also vendored so the plugin ships a complete runtime.
echo "[sync-vendor] mirroring the DIR-044 concurrency scripts + DIR-056 probe loader -> plugin/scripts/ ..."
for s in touches-orthogonality-check concurrent-batch-scheduler serial-fanin-absorb anti-drift-touches-check routine-scheduler routine-file-gate read-probe-spec; do
  cp "${REPO_ROOT}/experiments/quay-perpetual-stream/scripts/${s}.ts" "${PLUGIN_DIR}/scripts/${s}.ts"
done

# Sanitize plugin-specific project-internal attribution: the source files'
# header comments say "(exp5 / canonical-task-schema unit ...)" — an internal
# label meaningful only inside the quay repo's own experiments/ layer, not a
# path reference (the logic itself is already portable — verified: no
# functional experiments/** path exists anywhere in these 3 files' bodies).
# Strip that project-internal attribution fragment from the SHIPPED copies so
# a foreign install carries no reference to this repo's internal experiment
# naming, per DIR-040's single-source + no-leaked-internal-labels bar.
for f in "${PLUGIN_DIR}/scripts/task-schema.ts" "${PLUGIN_DIR}/scripts/task-schema-check.ts" "${PLUGIN_DIR}/scripts/task-schema-check.sh"; do
  # perl -0pe for a cross-line match: "(exp5 /\n// canonical-task-schema" -> "(canonical-task-schema"
  perl -0pi -e 's/\(exp5 \/\s*\n(\/\/|#) canonical-task-schema/(canonical-task-schema/g; s/exp5-M-CRYST-B1\/DIR-028/DIR-028/g; s/\bexp5\b\s*\/\s*//g' "$f"
done

# package.json: slimmed to name/version/type only (DIR-061 keeps the version).
# The vendored Core is a fully-bundled dist/quay.js with NO external runtime
# dependency to resolve, so it carries no `dependencies` and needs no
# package-lock.json / `npm install --omit=dev` step. Renamed so `npm ls` inside
# the plugin cache doesn't collide with the workspace package of the same name.
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
# A fully-bundled vendor copy never resolves node_modules — drop any stale
# package-lock.json a previous raw-source sync may have left behind.
rm -f "${DEST}/package-lock.json"

echo "[sync-vendor] wrote ${DEST}/package.json (version $(node -p "require('${DEST}/package.json').version"))"
echo "[sync-vendor] done. The vendored dist/quay.js is fully self-contained (no npm install needed)."
