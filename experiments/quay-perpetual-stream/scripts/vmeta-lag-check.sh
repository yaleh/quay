#!/usr/bin/env bash
# vmeta-lag-check.sh — V_meta consolidation-lag check (exp5-M-CRYST-D3 increment R5, Axis-2').
# Thin wrapper delegating to vmeta-lag-check.ts.
# Usage: vmeta-lag-check.sh [--counter <N>] [--threshold <K>] <v-meta-ledger.md>
# Exit: 0 = PASS or N/A; 1 = ALARM; 2 = usage/environment error.

source "$(dirname "$0")/gate-script-lib.sh"
gate_delegate_ts "vmeta-lag-check.ts" 1 "[--counter <N>] [--threshold <K>] <v-meta-ledger.md>" "$@"
