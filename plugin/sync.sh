#!/usr/bin/env bash
# plugin/sync.sh — sync canonical assets into the plugin distribution directory.
# Run from repo root. Idempotent (overwrites on each run).
#
# This keeps plugin/ assets in sync with their canonical sources:
#   .claude/workflows/                      → plugin/workflows/
#   (agents vendoring handled separately — see Phase 3)
#
# NOTE (2026-08-05 retirement): plugin/gate-scripts/ is NO LONGER synced. Those classic-pipeline
# era gates were laid into target projects but nothing called them — dead weight (layered
# retirement; the files stay in the plugin tree as a historical artifact, not in the distribution).
# The live fast-mode gate scripts live under plugin/scripts/ and are laid down by quay-init --loop.
#
# CI: sync.sh && git diff --exit-code plugin/  — fails if plugin is stale.

set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$PLUGIN_DIR/.." && pwd)"

echo "=== Syncing workflows ==="
cp "$REPO_ROOT/.claude/workflows/drain-directives.js"   "$PLUGIN_DIR/workflows/"
cp "$REPO_ROOT/.claude/workflows/run-routines.js"       "$PLUGIN_DIR/workflows/"
# NOTE (gap-retire-the-prepare-execute-pipeline-cluster): execute-milestone.js and
# prepare-milestone.js were retired with the classic milestone loop (ADR-022).
echo "  workflows: 2 synced"

echo "Sync complete."
