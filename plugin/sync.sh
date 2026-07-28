#!/usr/bin/env bash
# plugin/sync.sh — sync canonical assets into the plugin distribution directory.
# Run from repo root. Idempotent (overwrites on each run).
#
# This keeps plugin/ assets in sync with their canonical sources:
#   .claude/workflows/                      → plugin/workflows/
#   experiments/quay-perpetual-stream/scripts/ → plugin/gate-scripts/
#   (agents vendoring handled separately — see Phase 3)
#
# CI: sync.sh && git diff --exit-code plugin/  — fails if plugin is stale.

set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$PLUGIN_DIR/.." && pwd)"

echo "=== Syncing workflows ==="
cp "$REPO_ROOT/.claude/workflows/drain-directives.js"   "$PLUGIN_DIR/workflows/"
cp "$REPO_ROOT/.claude/workflows/execute-milestone.js"  "$PLUGIN_DIR/workflows/"
cp "$REPO_ROOT/.claude/workflows/run-routines.js"       "$PLUGIN_DIR/workflows/"
cp "$REPO_ROOT/.claude/workflows/prepare-milestone.js"  "$PLUGIN_DIR/workflows/"
echo "  workflows: 4 synced"

echo "=== Syncing gate scripts ==="
GATE_DIR="$REPO_ROOT/experiments/quay-perpetual-stream/scripts"

# it0-*.sh gate scripts
cp "$GATE_DIR/it0-backlog-projection-check.sh"     "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-ceiling-check.sh"                "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-ceiling-line-budget-check.sh"    "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-dashboard-line-budget-check.sh"  "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-dod-check.sh"                    "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-dogfood-evidence-gate.sh"        "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-gate-hash-check.sh"              "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/it0-impl-row-check.sh"               "$PLUGIN_DIR/gate-scripts/"

# Named gate scripts
cp "$GATE_DIR/vmeta-lag-check.sh"                  "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/tree-hygiene-check.sh"               "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/worktree-branch-hygiene-check.sh"    "$PLUGIN_DIR/gate-scripts/"
cp "$GATE_DIR/audit-independence-check.sh"         "$PLUGIN_DIR/gate-scripts/"

# drain-scheduler.ts
cp "$GATE_DIR/drain-scheduler.ts"                  "$PLUGIN_DIR/gate-scripts/"

echo "  gate-scripts: 13 synced"

echo "Sync complete."
