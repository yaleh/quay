#!/usr/bin/env bash
# task-schema-selfcheck.sh — regression acceptance test for the canonical task-schema check (exp5 /
# canonical-task-schema unit B1+B2). EXTERNAL acceptance predicate: runs `task-schema-check.sh`
# against fixed fixtures and asserts expected exit codes. The rule is defined SOLELY by
# task-schema.ts; this only asserts exit codes. DIR-019 discipline.
# CRITICAL: do not rewrite fixtures to make this pass — fix belongs in task-schema.ts, NOT in the
# fixtures. The `ok-prose-mentions-source-stub.md` fixture is the load-bearing false-positive guard.
# Exit: 0 = all fixtures behaved as asserted; 1 = >=1 mismatch; 2 = environment error.

source "$(dirname "$0")/gate-script-lib.sh"

CHECK="./scripts/task-schema-check.sh"

# id | fixture file | expected exit code (0 = PASS or N/A-legacy; 1 = >=1 assertion FAIL)
CASES=(
  "legacy-unmarked|fixtures/schema/legacy-unmarked-stub.md|0"
  "milestone-compliant|fixtures/schema/milestone-compliant-stub.md|0"
  "directive-compliant|fixtures/schema/directive-compliant-stub.md|0"
  "fail-A1-proposal-missing|fixtures/schema/fail-proposal-missing-stub.md|1"
  "fail-A2-plan-missing-milestone|fixtures/schema/fail-plan-missing-milestone-stub.md|1"
  "fail-A3-ac-prose|fixtures/schema/fail-ac-prose-stub.md|1"
  "fail-A4-dod-prose|fixtures/schema/fail-dod-prose-stub.md|1"
  "fail-A5-resolution-duplicate|fixtures/schema/fail-resolution-duplicate-stub.md|1"
  "fail-A5-resolution-statusmirror|fixtures/schema/fail-resolution-statusmirror-stub.md|1"
  "fail-A6-scaffolding-source|fixtures/schema/fail-scaffolding-source-stub.md|1"
  "fail-A6-scaffolding-dirfile|fixtures/schema/fail-scaffolding-dirfile-stub.md|1"
  "fail-A7-directive-missing-finding|fixtures/schema/fail-directive-missing-finding-stub.md|1"
  "fail-A7-directive-missing-requested-action|fixtures/schema/fail-directive-missing-requested-action-stub.md|1"
  "ok-prose-mentions-source|fixtures/schema/ok-prose-mentions-source-stub.md|0"
)

gate_run_selfcheck "$CHECK"
