#!/usr/bin/env bash
# config-wiring-selfcheck.sh — regression entrypoint for config-wiring-check.ts (DIR-120 Phase 0).
# Delegates to the module's own embedded `--selftest` (same pattern select-preflight.ts uses):
# ~15 assertions covering all three issue codes (NO_READER / NOT_CONSUMED_BY_DRIVER /
# UNRESOLVABLE_VALUE), the generic vs bespoke driver split, and an end-to-end CLI smoke run.
#
# IMPORTANT: invokes the REAL file under plugin/scripts/ directly, never the experiments/ mirror
# symlink. `isDirect` detection compares `process.argv[1]` against `fileURLToPath(import.meta.url)`
# — Node resolves the latter through symlinks to the physical file, so invoking via the mirror path
# makes the two diverge and the script's CLI entrypoint silently no-ops (verified). The mirror
# exists so OTHER experiments/ scripts can `import` this module by relative path, not for direct
# CLI execution — the same convention OUTER-LOOP.md already follows for
# concurrent-batch-scheduler.ts (always invoked via its plugin/scripts/ path).
#
# Exit: 0 = all selftest assertions pass; 1 = >=1 assertion failed; 2 = usage/environment error.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_CHECK="$SCRIPT_DIR/../../../plugin/scripts/config-wiring-check.ts"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

if [ ! -f "$REAL_CHECK" ]; then
  echo "ERROR: config-wiring-check.ts not found at $REAL_CHECK" >&2
  exit 2
fi

exec node "$REAL_CHECK" --selftest
