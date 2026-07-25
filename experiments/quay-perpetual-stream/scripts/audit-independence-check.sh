#!/usr/bin/env bash
# audit-independence-check.sh — DIR-032/DIR-034 audit-independence check.
# Thin wrapper delegating to audit-independence-check.ts.
# Usage: audit-independence-check.sh [--orchestrator-id <id>] [--orchestrator-env <name>]
#        [--dispatch-record <file>] [--allow-uncorroborated] <audit-artifact.md>
# Exit: 0 = PASS; 1 = FAIL; 2 = usage/environment error.

source "$(dirname "$0")/gate-script-lib.sh"
gate_delegate_ts "audit-independence-check.ts" 1 \
  "[--orchestrator-id <id>] [--orchestrator-env <name>] [--dispatch-record <file>] [--allow-uncorroborated] <audit-artifact.md>" \
  "$@"
