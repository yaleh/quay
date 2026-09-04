#!/usr/bin/env bash
# audit-independence-check.sh — DIR-032 audit-independence check. Thin wrapper delegating to
# audit-independence-check.mjs — mirrors vmeta-lag-check.sh's exact wrapper shape (usage/arg check,
# node availability check, delegate, propagate exit code), the same `*-check.sh` wraps `*-check.mjs`
# convention as every existing pair in `scripts/`. A future `quay gate --gate audit-independence`
# WRAPS the same audit-independence-check.mjs module (M39/E3/M43 registry precedent) — it must NEVER
# reimplement the independence logic; this wrapper and that gate are two invocation surfaces over
# ONE single-source module.
#
# Usage:
#   audit-independence-check.sh [--orchestrator-id <id>] [--dispatch-record <file>]
#                                [--allow-uncorroborated] <audit-artifact.md>
#
# DIR-034: a distinct session id alone is no longer sufficient — it must be corroborated by an
# independent dispatch-record file (see audit-independence-check.mjs's header) or the check
# fails closed (BLOCKING). `--allow-uncorroborated` reverts to the pre-DIR-034 distinct-string-only
# behavior and must never be the default caller path.
#
# Exit codes: 0 = PASS (genuinely independent, corroborated audit); 1 = FAIL (self-audit, absent id,
# or an uncorroborated/fabricated distinct id); 2 = usage/environment error.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 [--orchestrator-id <id>] [--orchestrator-env <name>] [--dispatch-record <file>] [--allow-uncorroborated] <audit-artifact.md>" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/audit-independence-check.ts" "$@"
exit $?
