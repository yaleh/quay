---
id: exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH
title: "defect: it0-dod-check.ts clause8 uses first-match-wins on
  multi-milestone-labeled tasks, misreports N/A on 3 real done tasks"
status: todo
labels:
  - milestone-candidate
  - defect
  - milestone:M-124
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Found by the M119 adversarial audit (`milestones/M119/audits/iteration-0-adversarial-audit.md`) while
independently verifying the clause8 hyphen-label regex fix (M119, commit `36d2a67`): 3 real,
`status: done` tasks — `exp5-M-GATE-CLI-ERROR-UX`, `exp5-M-GATE-HELP-SYNOPSIS-GAP`,
`exp5-M-GATE-MCP-PARITY-GAP` — each carry TWO `milestone:M<N>` labels: a low-numbered
`milestone:M37-discover-post-qeng` discovery label (added early, before the task was actually
scoped/landed) plus a real, later, ≥cutover landed label (`milestone:M51`/`M53`/`M56`
respectively). `it0-dod-check.ts`'s clause8 label scan (`taskText.match(/milestone:M-?(\d+)/i)`,
no `/g` flag) returns only the FIRST match in file order, which resolves to `37` — itself below the
`CLAUSE8_CUTOVER_MILESTONE_NUM = 40` threshold — so clause8 incorrectly N/A-passes all 3 tasks even
though their real landing milestone (51/53/56) is well past the cutover and the task's own body
genuinely does carry `## Proposal`/`## Plan` sections that clause8 should be checking.

**Confirmed pre-existing, NOT introduced or fixed by M119:** the pre-fix hyphenless regex
(`/milestone:M(\d+)/i`) already matched the hyphenless `milestone:M37-discover-post-qeng` label
identically — these 3 tasks were N/A both before and after M119's hyphen fix. This is a genuinely
separate defect (multi-label ambiguity), not a regression from M119.

## Plan
N/A — small, bounded fix (`experiments/quay-perpetual-stream/charters/M124-clause8-multi-label-fix.md`):
change the label scan to consider ALL `milestone:M<N>` matches in the task text (`matchAll` with the
`/g` flag) and take the MAXIMUM matched number (the real/final landing label, since a task only ever
gains higher-numbered milestone labels over time as it's re-selected/re-scoped, never a lower one
after landing) rather than the first.

## Acceptance Criteria
- [x] Clause8's label scan considers all `milestone:M<N>` labels present in a task's text, not just the first. — `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts` line ~615: `taskText.match(...)` (single) replaced with `[...taskText.matchAll(/milestone:M-?(\d+)/gi)]` + `Math.max(...)`, scoped to the frontmatter block when real frontmatter is present (post-audit correction, see below).
- [x] `exp5-M-GATE-CLI-ERROR-UX`, `exp5-M-GATE-HELP-SYNOPSIS-GAP`, `exp5-M-GATE-MCP-PARITY-GAP` each show clause8 genuinely APPLYING (not N/A) when re-run — pasted output for all 3. — labels found: CLI-ERROR-UX=[37,56]→max 56; HELP-SYNOPSIS-GAP=[37,51]→max 51; MCP-PARITY-GAP=[37,53]→max 53. All ≥40 cutover → clause8 now applies to all 3.
- [ ] `dod-fixture-selfcheck.sh` still passes (golden-diff evidence); a new fixture pair (multi-label task, low-then-high vs high-then-low label order) added to cover this case going forward. — `dod-fixture-selfcheck.sh` → `PASS: all 17 DoD fixtures behaved as asserted` (unchanged golden-diff). **POST-AUDIT CORRECTION**: iteration-0's original 3 fixture tests were REFUTED by this milestone's own audit as tautological (asserted only a substring shared by both the "applies" and "N/A" pass messages, so they passed against the pre-fix buggy code too). Fixed: the 2 "applies" tests now assert the specific applies-path message text + absence of the N/A message; independently re-verified (mirroring the audit's own revert-and-rerun method) that the low-then-high test now genuinely FAILS against the true pre-M124 original code (`git show f2c08a7:.../it0-dod-check.ts`). Also added a 4th new test (a real temp task file with a frontmatter label below cutover + a decoy higher milestone-shaped string in body prose) covering the audit's 2nd finding (whole-text-scan pollution) — independently re-verified it fails against the pre-audit-fix code and passes against the final code. `node --test experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs` → 44/44 pass (was 40/40 + 4 new, corrected from the audit's initial 43/43 count). Both findings logged as `DEV-14` in `inherited-core.md`.
- [x] No other clause's verdict changes as a side effect. — full experiments suite: 476/476 pass (was 472/472 + 4 new fixture tests, exact match).

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [ ] All 4 AC items above verified true with pasted command output.
- [ ] it0 DoD meta-enforcer passes all clauses.

## Not selected (M121)

Not selected — `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` selected instead: higher DIR-004-urgency
priority and an explicit chart-2 Δv mover named by DIR-064-B. This candidate is small, cleanly bounded,
and a good next exploit pick.

## Not selected (M122)

Not selected — `exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY` selected instead: direct continuation of
M121's own chart-2 S1 work, higher immediate value this pass. Still a good next exploit pick.

## Not selected (M123)

Not selected — M123 is a mandatory explore pick, not a slot this exploit candidate competed for. Good
next exploit pick once M123 clears.

## Selected (M124)

Selected — direct exploit pick. Small, cleanly bounded (one-function fix with an established
golden-diff verify pattern), and had already been deferred 3 times (M121/M122/M123). See
`experiments/quay-perpetual-stream/charters/M124-clause8-multi-label-fix.md`.