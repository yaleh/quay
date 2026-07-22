#!/usr/bin/env bash
# dod-fixture-selfcheck.sh — regression acceptance test for the DoD meta-enforcer (DIR-019, extended
# by M32-dod-escrow-testfloor / DIR-017 Step 2 for Clauses 6-7, and by
# M40-dir014-task-canonical-lifecycle-record / DIR-014 item 6 for Clause 8).
#
# This is the EXTERNAL, human-authored acceptance predicate for DIR-019 (and, transitively, for
# DIR-017's human-verification gate step #2/#5). It does NOT trust the DoD enforcer's self-report:
# it runs `it0-dod-check.sh` against a fixed set of fixtures and asserts the EXPECTED exit code for
# each. "DIR-019 done" means: this script exits 0 (every fixture behaves as asserted).
#
# CRITICAL (do not rewrite the fixtures to make this pass — that is Goodhart on the test): the two
# `self-exempt-*-stub.md` fixtures are RED against the pre-DIR-019 enforcer. They currently FAIL this
# script (the enforcer wrongly exits 0 where 1 is asserted). The fix belongs in
# `it0-dod-check.ts` clause 5, NOT in these fixtures. When the fix lands, this script must go green
# with the fixtures UNCHANGED.
#
# M32 extension (DIR-017 Step 2): 5 new fixtures added below — 4 (2 clauses × violating/compliant
# pair each) for Clause 6 (escrow-Δv) and Clause 7 (product-work test-floor), plus a 5th
# (self-exempt-escrow-stub.md) added during the two-iteration reconciliation ABSORB pinning the
# MECHANICALLY_UNCONDITIONAL_CLAUSES decision (see inherited-core.md's Clause 6/7 reconciliation
# note) — the original 5 CASES above are unchanged, same discipline as DIR-019's own "fixtures
# unchanged" rule for a fix to the enforcer's own code.
#
# Usage:  dod-fixture-selfcheck.sh
# Exit:   0 = all fixtures behaved as asserted; 1 = at least one mismatch; 2 = environment error.

set -u
cd "$(dirname "$0")/.." || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }

CHECK="./scripts/it0-dod-check.sh"
FIX="fixtures/dod"
[ -x "$CHECK" ] || { echo "ERROR: $CHECK not found/executable" >&2; exit 2; }

# id | charter+absorb fixture file | expected exit code
CASES=(
  "M98-fake-compliant|$FIX/compliant-stub.md|0"
  "M99-fake-violating|$FIX/violating-stub.md|1"
  "M96-fake-linebudget-self-exempt|$FIX/self-exempt-linebudget-stub.md|1"
  "M95-fake-implrow-self-exempt|$FIX/self-exempt-implrow-stub.md|1"
  "M94-fake-missing-ac|$FIX/missing-ac-stub.md|1"
  # M32-dod-escrow-testfloor (DIR-017 Step 2) additions — Clause 6 (escrow-Δv) and Clause 7
  # (product-work test-floor). Existing 5 cases above UNCHANGED.
  "M97-fake-escrow-violating|$FIX/escrow-deltav-violating-stub.md|1"
  "M97B-fake-escrow-compliant|$FIX/escrow-deltav-compliant-stub.md|0"
  "M93-fake-testfloor-violating|$FIX/test-floor-violating-stub.md|1"
  "M93B-fake-testfloor-compliant|$FIX/test-floor-compliant-stub.md|0"
  # Reconciliation-ABSORB addition (both M32 iteration branches merged) — pins the
  # MECHANICALLY_UNCONDITIONAL_CLAUSES decision: Clause 6 (escrow-Δv) must be in that set (same
  # DIR-019 shape as Clauses 3/4 — dispositionedClauses.add() fires on every branch including N/A),
  # or an undeclared self-exemption of Clause 6 while its own trigger legitimately doesn't fire goes
  # uncaught. See fixtures/dod/self-exempt-escrow-stub.md's own header for the live before/after
  # repro this fixture pins.
  "M92-fake-escrow-self-exempt|$FIX/self-exempt-escrow-stub.md|1"
  # Acceptance-audit finding (post-merge, pre-ABSORB) — Clause 7's coverage-disposition regex was
  # negation-blind; pins the sentence-scoped negation-window fix (mirrors Clause 6's own technique).
  # See fixtures/dod/test-floor-negation-poison-stub.md's own header for the live before/after repro.
  "M91-fake-testfloor-negation|$FIX/test-floor-negation-poison-stub.md|1"
  # DIR-020/M34-ac-dod-checklist-writeback (2026-07-19) additions — checklist-form AC/DoD, the new
  # unchecked-box-HARD-blocks-at-ABSORB semantics (Clause 0). Existing 11 cases above UNCHANGED.
  "M90-fake-checklist-unchecked|$FIX/checklist-unchecked-box-stub.md|1"
  "M90B-fake-checklist-checked|$FIX/checklist-all-checked-compliant-stub.md|0"
  # M40-dir014-task-canonical-lifecycle-record (DIR-014 item 6, 2026-07-19) additions — Clause 8
  # (task canonical-lifecycle-record: `## Proposal` embedded + `## Plan` referenced-or-N/A).
  # Existing 13 cases above UNCHANGED. Both fixtures carry a `milestone:M4x-...` label (>= the M40
  # cutover) so Clause 8 actually fires rather than N/A-passing as grandfathered/legacy.
  "M40C-fake-canonical-violating|$FIX/task-canonical-record-violating-stub.md|1"
  "M40B-fake-canonical-compliant|$FIX/task-canonical-record-compliant-stub.md|0"

  # DIR-026 SPLIT-OR-COMMIT (Clause 9, 2026-07-19) — `needs-human` is a legitimate terminal outcome
  # ONLY for a factor OUTSIDE project control; an in-project reason (architecture/algorithm/change-
  # volume/"too hard") is a DoD violation that must be split-and-completed instead. Both fixtures have
  # INTENTIONALLY-unchecked checklist AC (a needs-human milestone did not complete) — proving clause
  # 0's unchecked-box block is correctly WAIVED for a declared needs-human, and clause 9 then decides.
  # The "partial vs full" pair DIR-026 also names is already covered above by the checklist
  # unchecked→FAIL (M90) / all-checked→PASS (M90B) fixtures (a partial ABSORB = an unchecked box).
  "M42D-fake-needs-human-external|$FIX/needs-human-external-stub.md|0"
  "M42C-fake-needs-human-internal|$FIX/needs-human-internal-stub.md|1"
)

fail=0
for c in "${CASES[@]}"; do
  IFS='|' read -r id file want <<< "$c"
  out="$("$CHECK" "$id" "$file" "$file" 2>&1)"
  got=$?
  # M47/DIR-034 note (test-design fix, same class as the it0-dod-check.test.mjs "clean milestone"
  # fix): clauses 10/11 (tree-hygiene, worktree-branch-hygiene) were folded into the mechanical gate
  # as UNCONDITIONAL checks against the REAL ambient repo's tree/branches/worktrees — that is
  # correct, intentional behavior (DIR-034's whole point). These 17 CASES fixtures were authored
  # (M25/M32/M40/M42, pre-DIR-034) to exercise clauses 0-9 only via synthetic charter/absorb text and
  # assert the CLI's OVERALL exit code; they have no way to control the ambient repo's real git state
  # (e.g. this selfcheck correctly gets a real clause-11 FAIL whenever an unmerged milestone-iteration
  # branch genuinely exists — clause 11 working, not a bug). So: if the ONLY reason actual exit
  # diverges from expected is a clause10/11 FAIL line (never a clause 0-9 mismatch), don't fail this
  # fixture — clauses 10/11's own real-repo-shelling-out behavior has its own dedicated coverage
  # (dod-fixture-selfcheck's job here is clauses 0-9; clause10/11 real-state coverage lives in
  # it0-dod-check.test.mjs's "clause10:"/"clause11:" tests, which accept either PASS or FAIL as valid).
  only_hygiene_diff=0
  if [ "$got" != "$want" ] && [ "$want" = "0" ] && [ "$got" = "1" ]; then
    non_hygiene_fail="$(printf '%s\n' "$out" | grep '^FAIL: clause' | grep -v -E '^FAIL: clause1[01]-(tree-hygiene|worktree-branch-hygiene)' || true)"
    if [ -z "$non_hygiene_fail" ]; then
      only_hygiene_diff=1
    fi
  fi
  if [ "$got" = "$want" ]; then
    echo "PASS: $id — exit $got (expected $want) [$file]"
  elif [ "$only_hygiene_diff" = 1 ]; then
    echo "PASS (clauses 0-9 only; clause10/11 real-ambient-repo state diverged, not this fixture's concern): $id — exit $got, expected $want [$file]"
  else
    echo "FAIL: $id — exit $got but EXPECTED $want [$file]"
    fail=1
  fi
done

echo
if [ "$fail" = 0 ]; then
  echo "PASS: all ${#CASES[@]} DoD fixtures behaved as asserted."
  exit 0
else
  echo "FAIL: at least one DoD fixture did not behave as asserted (see above)."
  echo "      If a self-exempt-* fixture wrongly exited 0, the DIR-019 clause-5 bug is still present."
  exit 1
fi
