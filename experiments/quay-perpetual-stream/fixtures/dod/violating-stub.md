# Fixture: violating-stub.md — synthetic VIOLATING milestone (M25-dod-meta-enforcer Stage 2.3)

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone (`M99-fake-violating`), authored
to deliberately trip `scripts/it0-dod-check.sh` with a DOUBLE violation, per the charter's Stage 2.3
spec: an impl-row FAIL AND a separate, undeclared self-exemption FAIL — so the check has more than
one way to legitimately fire non-zero, making the fixture robust to either individual clause's exact
wording changing later.

This single file stands in for BOTH the "charter file" and the "absorb-entry file" arguments when
run against `it0-dod-check.sh M99-fake-violating fixtures/dod/violating-stub.md
fixtures/dod/violating-stub.md` — both halves are present below, clearly labeled.

## Charter — M99-fake-violating

**Milestone id:** M99-fake-violating · **type:** design

### Value hypothesis
This fake milestone ships a design doc only. Design delivered as a proposal document; a future
implementing milestone will consume its "Done-when clauses a future implementing milestone would
need" section below.

### Done-when clauses a future implementing milestone would need
1. `[ ]` Implement the fake widget described in this design.
2. `[ ]` Wire the fake widget into the fake pipeline.

(This section is present specifically to trip the design-only detector — per
`it0-impl-row-check.sh`'s / the text-based fallback's own design-only markers: "design delivered"
and "Done-when clauses a future implementing milestone would need" both appear above.)

### Explicitly OUT of scope
- This milestone is exempt from the adversarial-audit gate — no adversarial audit will be performed
  for this milestone, full stop. (Deliberately: this narrows away Clause 1 with no corresponding
  WAIVER line anywhere in this fixture file — see the ABSORB entry below, which has no `WAIVER:`
  line at all.)

## ABSORB entry — M99-fake-violating

ABSORB log for M99-fake-violating: work completed, Done-when clauses recorded. This milestone shipped
a design document. No follow-up implementation row was created anywhere in this fixture text
(deliberately omitted — this fixture intentionally has no backlog.md row at all, exercising the
text-based design-only fallback path in `it0-dod-check.mjs`, and this ABSORB entry contains no
reference to any implementation-row id for this milestone).

Note: this ABSORB entry text deliberately contains NO explicit disposition statement for the V_meta
consolidation-lag gate (no "clear"/"PASS"/"N/A"/"consolidated"/"carry-forward" language anywhere
near "V_meta" in this file) and NO `WAIVER:` line of any kind — both omissions are intentional,
reinforcing (not required for, since the impl-row + self-exemption violations already suffice) the
double-violation design this fixture targets per the charter's Stage 2.3 spec.
