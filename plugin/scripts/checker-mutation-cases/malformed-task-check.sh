#!/usr/bin/env bash
# Mutation case for malformed-task-check (gap-malformed-task-silent-vanish-no-alert): a task file
# whose frontmatter fails to parse is SILENTLY removed from the store — the defect. Its --selftest
# asserts BOTH directions: a clean task file stays GREEN, and the live-sample shape
# (`title: [封存] …` — YAML flow sequence with a trailing scalar, the exact 2026-08-13 sample)
# MUST go RED. Injecting the defect back in must flip the checker red; restoring clean must go
# green — a masking fix (or a checker that never reads malformed) stays green forever and fails.
set -u
name="malformed-task-check"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node --no-warnings --experimental-strip-types "${checker_dir}/malformed-task-check.ts" --selftest
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
else
  echo "case FAILED: checker --selftest exited $code" >&2
  exit 2
fi
