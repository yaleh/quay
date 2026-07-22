#!/usr/bin/env bash
# touches-orthogonality-check.sh — milestone-`touches` disjointness check (DIR-044 increment 1). Thin
# wrapper delegating to touches-orthogonality-check.mjs — mirrors task-schema-check.sh / vmeta-lag-check.sh
# (usage/arg check, node availability check, delegate, propagate exit code). A future
# `quay gate --gate touches-orthogonality` WRAPS the same module (M39 registry precedent) — it must
# NEVER reimplement the logic; this wrapper and that gate are two invocation surfaces over ONE
# single-source module.
#
# Usage:
#   touches-orthogonality-check.sh [--root <dir>] <charterA.md> <charterB.md>
#
# Exit codes: 0 = DISJOINT (safe to batch); 1 = OVERLAP / conservative-serialize; 2 = usage/environment error.

set -u

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 [--root <dir>] <charterA.md> <charterB.md>" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/touches-orthogonality-check.ts" "$@"
exit $?
