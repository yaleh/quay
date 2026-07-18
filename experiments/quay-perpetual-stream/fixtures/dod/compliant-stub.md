# Fixture: compliant-stub.md — synthetic COMPLIANT milestone (M25-dod-meta-enforcer Stage 2.3)

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone (`M98-fake-compliant`), authored
to exercise every DoD clause on the PASS path, per the charter's Stage 2.3 spec: NOT design-only
(ships operational work, mirroring this very milestone's own self-check), explicit dispositions for
all 4 gate clauses, and no undeclared self-exemption language anywhere.

This single file stands in for BOTH the "charter file" and the "absorb-entry file" arguments when
run against `it0-dod-check.sh M98-fake-compliant fixtures/dod/compliant-stub.md
fixtures/dod/compliant-stub.md` — both halves are present below, clearly labeled.

## Charter — M98-fake-compliant

**Milestone id:** M98-fake-compliant · **type:** explore (operational work, NOT design-only)

### Value hypothesis
This fake milestone ships a small, standing operational script — real working code wired as a
check, not a design proposal. It ships a working artifact directly; there is no future-consumer
checklist section anywhere in this charter, and its own backlog row simply says "operational script
shipped, wired as a standing check" — plain shipped-work language, not a deferred-design marker.

### In-scope work
1. Build the fake operational script.
2. Wire it into the fake pipeline as a standing check.

### Explicitly OUT of scope
- Nothing about this milestone's scope narrows or exempts any of the 4 DoD gate clauses — all four
  are evaluated normally at ABSORB, with explicit dispositions recorded below.
- This milestone does not touch any unrelated product code.

## ABSORB entry — M98-fake-compliant

ABSORB log for M98-fake-compliant, 2026-07-18:

- **Adversarial-audit gate:** documented no-op — this milestone is methodology-infra/governance with
  no VT weight, and its own iteration-0 did not recommend skipping iteration-1, so neither cadence
  condition (a) nor (b) fired; stating that explicitly per the non-blanket cadence rule.
- **V_meta consolidation-lag gate:** clear — every `v-meta-ledger.md` row checked at this ABSORB is
  either not yet `confirmed`, or `confirmed` with `milestones-since-confirmed` under the K=2 alarm
  threshold; no row required consolidation or a carry-forward disposition this pass.
- **Line-budget gate:** PASS — small-scope charter, well under the small-milestone norm, no
  phase/stage plan required.
- **Design-only impl-row gate:** N/A — this milestone ships operational work directly (a working
  script wired as a standing check), carrying neither of the two design-only trigger markers this
  gate looks for, so the row-creation requirement is not applicable here.

Work completed, Done-when clauses recorded, no unrelated product code touched.
