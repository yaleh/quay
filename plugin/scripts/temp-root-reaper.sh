#!/usr/bin/env bash
# temp-root-reaper.sh — thin wrapper delegating to temp-root-reaper.ts (same `*-check.sh wraps
# *-check.ts` convention as every other pair in plugin/scripts/).
#
# It exists so the SUITE's exit path (plugin/scripts/suite-temp-root.sh, sourced by scripts/test.sh)
# can invoke the reaper WITHOUT carrying an embedded interpreter itself: sh-census-check counts the
# WHOLE file's code lines for every .sh that has node/python3/jq at a command position, so keeping
# the node call in this 4-line wrapper keeps that ratchet cost at +4 instead of +40.
#
# Usage and exit codes are temp-root-reaper.ts's own (0 = evaluated, 2 = usage/env, 3 = NOT-EVALUATED
# — nothing removed). This wrapper adds no behavior, no defaults and no error handling of its own.

set -u
exec node --no-warnings --experimental-strip-types "$(dirname "${BASH_SOURCE[0]}")/temp-root-reaper.ts" "$@"
