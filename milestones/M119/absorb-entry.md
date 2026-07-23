# M119 ABSORB entry — exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH

**Milestone:** M119
**Task:** exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH
**Charter:** experiments/quay-perpetual-stream/charters/M119-clause8-hyphen-label-fix.md
**Class:** development / governance-integrity, instrument-correction
**Work commits:** `36d2a67` (regex fix + iteration report)

## Backlog row

| exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH | defect: it0-dod-check.ts clause8 regex doesn't match the repo's actual milestone:M-NN (hyphenated) label convention (M119) surface:method-infra | governance-integrity | Δv̂=0 (instrument-correction, not chart-0 VT-scored) | done | one-line regex fix, hyphen now optional, clause8 genuinely applies against real hyphenated-label tasks instead of silently N/A-passing; 17/17 fixture selfcheck golden-diff, 343/343 suite green |

## Test-floor disposition (Clause 7)

This milestone touches the `method-infra` surface (a fix to `it0-dod-check.ts`, an
`experiments/quay-perpetual-stream/scripts/` file) — per Clause 7's own NON_PRODUCT_SURFACES list,
`method-infra` is explicitly non-product-touching. N/A, does not require a coverage disposition.

## V_meta consolidation-lag disposition (Clause 2)

V_meta consolidation-lag: clear. Re-run this ABSORB:
```
$ bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 118 experiments/quay-perpetual-stream/v-meta-ledger.md
PASS: no confirmed-unconsolidated row past K without a dated carry-forward
```

## Outcome

DONE. All 3 Acceptance Criteria and both Definition-of-Done clauses satisfied — see the task's own
`## Resolution` section, written back by the dispatched adversarial audit after independently
re-verifying every claim, including 13 additional adversarial edge cases beyond the iteration
report's own testing.

## Adversarial-audit verdict

**CONCERNS** (non-blocking). The audit (dispatch id `a0411e30efff28964`) independently confirmed the
fix is exactly the claimed one-line regex change (verified via `git show 36d2a67`), re-tested the
regex against 13 additional adversarial cases (cutover boundary, malformed inputs, multi-label
strings, whitespace, case-insensitivity) beyond what the report tested and found no new false
positive introduced by making the hyphen optional, reproduced the cited real-task example
byte-for-byte, reproduced `dod-fixture-selfcheck.sh` 17/17 including both clause8-relevant fixtures
at their exact claimed exit codes, and reproduced the full regression suite (343/343 tests, 4/4
packages `tsc` clean).

**The CONCERNS finding**, real and disclosed rather than silently absorbed: while searching all of
`tasks/*.md` for `milestone:M` patterns (an adversarial step beyond what the report itself did), the
audit found 3 real `status: done` tasks (`exp5-M-GATE-CLI-ERROR-UX`, `exp5-M-GATE-HELP-SYNOPSIS-GAP`,
`exp5-M-GATE-MCP-PARITY-GAP`) each carrying TWO `milestone:M<N>` labels — a low-numbered discovery
label first, a real ≥cutover landed label second. Because the regex match is non-global (first-match-
wins), clause8 still incorrectly resolves to the LOW number and N/A-passes all 3, even after this
fix. Confirmed this is a genuinely SEPARATE, pre-existing defect: the pre-fix hyphenless regex
already matched the low-numbered hyphenless label identically, so these 3 tasks were N/A both before
and after M119 — not introduced or fixed by this milestone. This does mean the iteration report's
broader narrative ("clause8 now genuinely applies... used on every task since M111") overstates what
was actually verified: the literal, narrowly-scoped AC2 (one cited example, M118) holds true, but
clause8 does not yet correctly apply against every real milestone-labeled task in the repo.

**Filed as a follow-up defect** (not fixed by this milestone, per the audit's own recommendation):
`exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH` — multi-milestone-label ambiguity, first-match-wins
should become max-match or last-match. Small, bounded, good next exploit pick.

**Sandbox note:** the audit subagent's sandbox declined to write directly to the shared main-tree
path; both its audit artifact and its task write-back were produced in its own isolated worktree and
landed into the main tree by the orchestrator afterward, content unchanged — same pattern as
M117/M118's audits.

Full audit artifact: `milestones/M119/audits/iteration-0-adversarial-audit.md`.

## Audit-independence check

Artifact: milestones/M119/audits/iteration-0-adversarial-audit.md
Orchestrator id: 145cc0be-0e0e-4eb4-a1aa-9d47637114c0
Dispatch record: /tmp/m119-dispatch-record.txt

```
$ bash experiments/quay-perpetual-stream/scripts/audit-independence-check.sh --orchestrator-id 145cc0be-0e0e-4eb4-a1aa-9d47637114c0 --dispatch-record /tmp/m119-dispatch-record.txt milestones/M119/audits/iteration-0-adversarial-audit.md
PASS: audit artifact's session id ("a0411e30efff28964") is distinct from the orchestrator's own id
("145cc0be-0e0e-4eb4-a1aa-9d47637114c0") AND is corroborated by the independent dispatch-record —
genuinely independent (DIR-034 anti-forgery check satisfied)
```

## No-silent-drop note

A human commit (`b4cc3ed`, "DIR-060 + DIR-061 (quay-perpetual-stream): productized-delivery
directives") landed on `master` cleanly during this milestone's ABSORB — no conflict, no
reconciliation needed (a linear fast-forward, not a merge). Per DIR-027 human-steering hygiene, this
is exactly the async-input pattern DRAIN (step 0) exists to pick up — it will be dispositioned at the
next milestone boundary (M120's own step 0), not mid-ABSORB here.
