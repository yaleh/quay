---
id: exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH
title: "defect: it0-dod-check.ts clause8 uses first-match-wins on
  multi-milestone-labeled tasks, misreports N/A on 3 real done tasks"
status: done
labels:
  - milestone-candidate
  - defect
  - milestone:M-124
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH
    experiments/quay-perpetual-stream/charters/M124-clause8-multi-label-fix.md
    /tmp/m124-absorb-entry.md
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
- [x] `dod-fixture-selfcheck.sh` still passes (golden-diff evidence); a new fixture pair (multi-label task, low-then-high vs high-then-low label order) added to cover this case going forward. — `dod-fixture-selfcheck.sh` → `PASS: all 17 DoD fixtures behaved as asserted` (unchanged golden-diff). **POST-AUDIT CORRECTION, INDEPENDENTLY RE-VERIFIED BY THE SAME AUDIT (2nd pass)**: iteration-0's original 3 fixture tests were REFUTED as tautological (asserted only a substring shared by both the "applies" and "N/A" pass messages, passing against the pre-fix buggy code too — the audit proved this by reverting the source and re-running). Fixed same-ABSORB: the 2 "applies" tests now assert the specific applies-path message text + absence of the N/A message; a 4th test added with a real temp task file (frontmatter label below cutover + decoy higher milestone-shaped string in body prose). The audit independently re-verified BOTH boundaries: (a) the low-then-high test genuinely FAILS against the true pre-M124 original code and PASSES against the final code; (b) the new frontmatter-scope test FAILS against the initially-shipped-but-flawed fix and PASSES against the final frontmatter-scoped fix. Both findings logged as `DEV-14` in `inherited-core.md`.
- [x] No other clause's verdict changes as a side effect. — full experiments suite: 476/476 pass (was 472/472 + 4 new fixture tests, exact match). Independently re-run and confirmed by the audit.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [x] All 4 AC items above verified true with pasted command output. — all 4 AC boxes independently confirmed and ticked by the adversarial audit (multiple passes: initial REFUTED findings, then same-ABSORB fixes independently re-verified).
- [x] it0 DoD meta-enforcer passes all clauses. — independently re-run from the shared checkout: `it0-dod-check.sh` → exit 0, all 12 clauses PASS/N/A. `quay gate exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH` → PASS, exit 0. Two independent real GateEvents recorded (`2026-07-23T11:15:03.229Z` orchestrator + `2026-07-23T11:15:35.225Z` audit re-run).

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

## Execution record (M124 ABSORB, 2026-07-23)

**Milestone:** M124 · **Iterations:** 1 (single-pass development-class fix, then a same-ABSORB
correction cycle triggered by the milestone's own audit) · **Realized Δv:** 0
(governance-integrity/instrument-correction, no chart-2 surface touched). **Merge commits:**
`ab8b6c8` (initial matchAll+max fix), `477ac81` (audit-driven correction: fixed 2 tautological
tests + scoped the scan to frontmatter, added a 4th regression test). **Adversarial-audit verdict:**
REFUTED on the initial delivery (first REFUTED verdict this restart window, m121-m124) — genuinely
found 2 real defects (tautological test assertions; whole-text-scan body-prose pollution), both
fixed same-ABSORB and independently re-verified across 3 audit passes; logged as `DEV-14` in
`inherited-core.md`. **DoD meta-enforcer:** PASS (two independent real GateEvents). One-line
outcome: fixes the multi-label first-match-wins defect (deferred 3 times, M121-M123) with genuine
regression coverage this time — the milestone's own audit caught and forced a correction of its
first, insufficiently-tested delivery before it could land.