#!/usr/bin/env bash
# task-schema-check.sh — canonical task-schema check (canonical-task-schema unit B2).
# Thin wrapper delegating to task-schema-check.ts.
# Usage: task-schema-check.sh <task-file.md> [<task-file.md> ...]
# Exit: 0 = no FAILs; 1 = >=1 marked task FAILs; 2 = usage/environment error.

source "$(dirname "$0")/gate-script-lib.sh"
gate_delegate_ts "task-schema-check.ts" 1 "<task-file.md> [<task-file.md> ...]" "$@"
