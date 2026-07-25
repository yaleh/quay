#!/usr/bin/env bash
# vmeta-lag-check.sh — V_meta consolidation-lag check (exp5-M-CRYST-D3 increment R5, Axis-2′). Thin
# wrapper delegating to vmeta-lag-check.mjs — mirrors task-schema-check.sh's exact wrapper shape
# (usage/arg check, node availability check, delegate, propagate exit code), the same `*-check.sh`
# wraps `*-check.mjs` convention as every existing pair in `scripts/`. A future
# `quay gate --gate vmeta-lag` WRAPS the same vmeta-lag-check.mjs module (M39 registry precedent) —
# it must NEVER reimplement the arithmetic; this wrapper and that gate are two invocation surfaces
# over ONE single-source module.
#
# Usage:
#   vmeta-lag-check.sh [--counter <N>] <v-meta-ledger.md>
#
# Exit codes: 0 = PASS or N/A (explicit, printed); 1 = ALARM (a confirmed-unconsolidated row past
# K=2 with no dated carry-forward); 2 = usage/environment error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 [--counter <N>] <v-meta-ledger.md>" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/vmeta-lag-check.ts" "$@"
exit $?
