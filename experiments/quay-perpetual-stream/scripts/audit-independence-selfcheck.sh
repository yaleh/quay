#!/usr/bin/env bash
# audit-independence-selfcheck.sh — regression acceptance test for the DIR-032/DIR-034
# audit-independence check. EXTERNAL acceptance predicate: runs `audit-independence-check.sh`
# against fixed fixtures and asserts expected exit codes. The rule is defined SOLELY by
# audit-independence-check.ts; this only asserts exit codes. DIR-019 discipline.
# Exit: 0 = all fixtures behaved as asserted; 1 = >=1 mismatch; 2 = environment error.

source "$(dirname "$0")/gate-script-lib.sh"

CHECK="./scripts/audit-independence-check.sh"
ORCH_ID="orchestrator-session-abc123"
RECORD="fixtures/audit-independence/dispatch-record.txt"

# id | fixture file | extra check args | expected exit code
# 0 = PASS; 1 = FAIL; 2 = env error
CASES=(
  "absent-id-m43-style|fixtures/audit-independence/absent-id-m43-style.md|--orchestrator-id $ORCH_ID|1"
  "self-audit-matching-id|fixtures/audit-independence/self-audit-matching-id.md|--orchestrator-id $ORCH_ID|1"
  "genuinely-independent-no-record|fixtures/audit-independence/genuinely-independent.md|--orchestrator-id $ORCH_ID|1"
  "no-orchestrator-id-supplied|fixtures/audit-independence/genuinely-independent.md||1"
  "genuinely-independent-allow-uncorroborated|fixtures/audit-independence/genuinely-independent.md|--orchestrator-id $ORCH_ID --allow-uncorroborated|0"
  "fabricated-distinct-id-no-corroboration|fixtures/audit-independence/fabricated-distinct-id-no-corroboration.md|--orchestrator-id $ORCH_ID --dispatch-record $RECORD|1"
  "corroborated-independent|fixtures/audit-independence/corroborated-independent.md|--orchestrator-id $ORCH_ID --dispatch-record $RECORD|0"
)

gate_run_selfcheck "$CHECK"
