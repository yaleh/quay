#!/usr/bin/env bash
# it0-dod-check.sh — DoD meta-enforcer (inherited-core.md clauses 0-12).
# Thin wrapper delegating to it0-dod-check.ts.
# Usage: it0-dod-check.sh <milestone-id> <charter-file> <absorb-entry-file>
# Exit: 0 = PASS; 1 = >=1 clause FAILs; 2 = usage/environment error.

source "$(dirname "$0")/gate-script-lib.sh"
gate_delegate_ts "it0-dod-check.ts" 3 "<milestone-id> <charter-file> <absorb-entry-file>" "$@"
