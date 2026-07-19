#!/usr/bin/env bash
# task-schema-selfcheck.sh — regression acceptance test for the canonical task-schema check (exp5 /
# canonical-task-schema unit B1+B2). This is the EXTERNAL acceptance predicate: it does NOT trust the
# check's self-report — it runs `task-schema-check.sh` against a fixed set of fixtures and asserts the
# EXPECTED exit code for each. "The schema check is correct" means: this script exits 0 (every fixture
# behaves as asserted).
#
# CRITICAL (DIR-019 discipline — do not rewrite the fixtures to make this pass, that is Goodhart on
# the test): each fail-fixture isolates ONE assertion violation and is RED-then-GREEN against the
# module. If a fixture behaves wrong, the fix belongs in task-schema.mjs, NOT in the fixture. The
# false-positive guard (ok-prose-mentions-source-stub.md) is the load-bearing case: it is MARKED and
# carries the DIR-009:231 / DIR-010:121 `Status mirror:` line-wrap shapes VERBATIM and MUST PASS —
# proving the scaffolding regexes are false-positive-safe (plan-check must-fix 1+2).
#
# Usage:  task-schema-selfcheck.sh
# Exit:   0 = all fixtures behaved as asserted; 1 = at least one mismatch; 2 = environment error.

set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }

CHECK="./scripts/task-schema-check.sh"
FIX="fixtures/schema"
[ -x "$CHECK" ] || { echo "ERROR: $CHECK not found/executable" >&2; exit 2; }

# id | fixture file | expected exit code (0 = PASS or N/A-legacy; 1 = >=1 marked assertion FAIL)
CASES=(
  # Grandfather boundary — unmarked legacy → N/A-legacy → exit 0 (never hard-failed, never silent).
  "legacy-unmarked|$FIX/legacy-unmarked-stub.md|0"
  # PASS cases (marked, conformant).
  "milestone-compliant|$FIX/milestone-compliant-stub.md|0"
  "directive-compliant|$FIX/directive-compliant-stub.md|0"
  "adr-compliant|$FIX/adr-compliant-stub.md|0"
  # One FAIL fixture per assertion (marked, isolates exactly one violation).
  "fail-A1-proposal-missing|$FIX/fail-proposal-missing-stub.md|1"
  "fail-A2-plan-missing-milestone|$FIX/fail-plan-missing-milestone-stub.md|1"
  "fail-A3-ac-prose|$FIX/fail-ac-prose-stub.md|1"
  "fail-A4-dod-prose|$FIX/fail-dod-prose-stub.md|1"
  "fail-A5-resolution-duplicate|$FIX/fail-resolution-duplicate-stub.md|1"
  "fail-A5-resolution-statusmirror|$FIX/fail-resolution-statusmirror-stub.md|1"
  "fail-A6-scaffolding-source|$FIX/fail-scaffolding-source-stub.md|1"
  "fail-A6-scaffolding-dirfile|$FIX/fail-scaffolding-dirfile-stub.md|1"
  "fail-adr-decision-missing|$FIX/fail-adr-decision-missing-stub.md|1"
  # CRITICAL false-positive guard — MARKED + conformant despite DIR-009/010 prose shapes → PASS.
  "ok-prose-mentions-source|$FIX/ok-prose-mentions-source-stub.md|0"
)

fail=0
for c in "${CASES[@]}"; do
  IFS='|' read -r id file want <<< "$c"
  "$CHECK" "$file" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$want" ]; then
    echo "PASS: $id — exit $got (expected $want) [$file]"
  else
    echo "FAIL: $id — exit $got but EXPECTED $want [$file]"
    fail=1
  fi
done

echo
if [ "$fail" = 0 ]; then
  echo "PASS: all ${#CASES[@]} task-schema fixtures behaved as asserted."
  exit 0
else
  echo "FAIL: at least one task-schema fixture did not behave as asserted (see above)."
  echo "      The fix belongs in task-schema.mjs, NOT in the fixtures (DIR-019 discipline)."
  exit 1
fi
