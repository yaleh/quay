---
id: exp5-M-DISCOVER-POST-QENG
title: "Discovery pass: survey the new QENG gate/lifecycle engine surface
  (packages/quay/src/gate/*.js), re-triage the 3 STALE backlog rows, and
  recommend how exp5's own it0-* checks relate to the new quay gate route"
status: done
labels:
  - milestone-candidate
  - surface:cross-cutting
  - milestone:M37-discover-post-qeng
extra: {}
---
## Provenance
Materialized at m36→m37 DRAIN/SELECT boundary (2026-07-19). `directives/pending/` is empty (DIR-017
archived this DRAIN step) and `backlog.md` has zero open (non-DONE, non-STALE) candidates — the m36
ABSORB entry explicitly required m37 SELECT to choose, not default, between re-triaging the 3 STALE
rows or running a fresh discovery milestone. This task folds both paths in, with discovery as
primary, because a large async human-authored initiative (QENG-0..5, `packages/quay/src/gate/*.js`)
landed on `master` since m35 and has never been examined by any exp5 milestone.

## Source
`experiments/quay-perpetual-stream/charters/M37-discover-post-qeng.md`; see charter for full SELECT
reasoning.

## Value type / cadence
explore / discovery (primary) — mirrors M04/M26/M27/M28's discovery-channel precedent. Δv̂ ≈ 0
(no VT chart cell, same lineage precedent). Value accrues later, when candidate tasks this milestone
produces are themselves SELECTed and delivered.

## Acceptance Criteria
- [x] The new `packages/quay/src/gate/*.js` surface (QENG-0..5) is functionally surveyed: what each
  module does, what `quay gate <task>` / `quay complete` actually do end-to-end (read the code AND
  exercise it directly — do not just read commit messages), and what test coverage exists (QENG
  commit messages claim "TDD, cov 100%" for several — independently verify this claim against the
  actual test files/coverage output, do not take it on faith). (Confirmed by adversarial audit,
  2026-07-19: independently ran `node packages/quay/bin/quay.js gate QENG-5-DEMO-PASS` → `PASS`
  exit 0, and `gate QENG-5-DEMO-FAIL` → `FAIL — acceptance failed (exit 1)` exit 1, in this repo's
  own worktree, matching both iterations' reports exactly. Independently re-ran
  `node --test --experimental-test-coverage packages/quay/test/{lifecycle,driver,gate,acceptance}.test.mjs`
  myself: 89/89 tests pass, and coverage output matches both reports verbatim — line/func 100.00% on
  all 7 `gate/*.js` files, branch 100.00% on 5 files, 75.00% on `gate-log.js`, 97.44% on
  `lifecycle.js`. The apparent line/branch "tension" flagged in the audit brief is not a real
  contradiction: iteration-1's "100% across the board" claim is explicitly scoped to line coverage
  in its own text, and iteration-1 reports the identical 75%/97.44% branch figures as iteration-0.)
- [x] At least 2, and no more than 6, new `milestone-candidate` tasks are authored (unchecked AC/DoD
  checklists per DIR-020/M34 convention) capturing genuine, concrete gaps or opportunities found in
  the QENG surface survey. Do NOT manufacture busywork candidates merely to hit a count — if the
  survey finds fewer than 2 genuine gaps, say so explicitly and author fewer. (Confirmed by
  adversarial audit, 2026-07-19: 6 candidate tasks exist in `tasks/` — `exp5-M-GATE-CLI-ARG-ORDER`,
  `exp5-M-GATE-CLI-ERROR-UX`, `exp5-M-GATE-HELP-SYNOPSIS-GAP`, `exp5-M-GATE-README-DOCS`,
  `exp5-M-GATE-MCP-PARITY-GAP`, `exp5-M-QENG-DOD-DEMO-ONLY` — within the 2-6 range, each with its own
  unchecked AC/DoD checklist. Independently reproduced the concrete underlying finding for 4 of the 6
  with my own commands: the `--gate dod QENG-1` flag-before-id crash (`Error: no such task: --gate`
  at `engine.js:32:20`), the `retreat --reason x QENG-1` reversed-order silent-wrong-precondition, the
  `gate-log --gate acceptance` silent-empty-exit-0, the `quay run` exit-code leak (mixed-fail board →
  exit 1, all-pass board → exit 0, both reaching "fixpoint"), the `--help` synopsis gap (`grep -c
  "^  quay gate" <(quay --help)` → `0`), the README gap (`grep -c ... packages/quay/README.md` → `0`
  over 276 lines), and the MCP tool-registration gap (`grep -c "server.registerTool("
  packages/quay/src/mcp-server.js` → `6`, none QENG-related). Confirmed the 6 tasks are non-duplicative:
  `GATE-CLI-ARG-ORDER` (positional/flag parsing bug) and `GATE-CLI-ERROR-UX` (error presentation +
  exit-code leak) are genuinely distinct root causes on the same command family, not restatements of
  each other. Iteration-1's near-duplicate `exp5-M-GATE-ERROR-UX` candidate was correctly folded into
  iteration-0's `exp5-M-GATE-CLI-ERROR-UX` at reconciliation (commit `fd6add3`) rather than kept as a
  7th row — the two covered materially the same findings (stack traces + exit-code leak).)
- [x] Each of the 3 STALE rows (`exp5-M-CLI-UX`, `exp5-M-DIRTASK`, `exp5-M-DOCS`) is explicitly
  re-examined against current state and re-dispositioned: either confirmed still STALE (with a
  current-state reason) or un-staled back to an open candidate. (Confirmed by adversarial audit,
  2026-07-19: independently re-verified all 3 current-state reasons cited in the tasks' own
  re-triage append notes. `grep -n "UQ-04[2-6]" experiments/quay-continuous-bootstrap/gap-list.md`
  confirms UQ-042..046 closed at exp4 iteration 15 as claimed. `grep -n "DOC-00[1-5]"
  experiments/quay-continuous-bootstrap/gap-list.md` confirms DOC-001..005's closed→reopened→
  re-closed-at-M08-merge-recover history exactly as iteration-1's stronger claim states.
  `head -10 tasks/DIR-006.md` confirms exp5's own DIR-006 is genuinely the Web-UI
  browser-verification-regression directive (title starts "Web UI verification regression"), a
  DIFFERENT directive from the exp4-lineage
  `experiments/quay-continuous-bootstrap/directives/archive/DIR-006-directives-as-quay-tasks-...md`
  the STALE row originally mis-cited — confirming the citation-correction claim in
  `exp5-M-DIRTASK`'s re-triage note is accurate, not asserted. `grep -n "DIR-006" tasks/DIR-004.md`
  confirms DIR-004's own text states "Per DIR-006 resolution (Option B: files canonical)". All 3
  dispositions are grounded in fresh, current-state evidence, not re-assertions of the backfill-era
  text — none were un-staled, which is the correct outcome given the evidence.)
- [x] A specific, reasoned recommendation is given on whether/how exp5's own `it0-dod-check.sh` /
  `it0-*` mechanical gates should relate to the new `quay gate` engine route, with tradeoffs stated.
  (Confirmed by adversarial audit, 2026-07-19: both iterations independently arrive at
  "remain independent-and-parallel, do not unify" with tradeoffs stated for 3 options considered
  (status quo / unify-into-Core / full-deprecate). Independently verified the grounding claim via
  `grep -n "it0-dod-check.sh\|Engine route" experiments/quay-perpetual-stream/OUTER-LOOP.md`: line 316
  confirms step 6 still instructs `scripts/it0-dod-check.sh <milestone-id> <charter-file>
  <absorb-entry-text-or-file>` as a direct prose/shell call for every real milestone; the "Engine
  route" sub-note (lines 323-334) is additive, describing the QENG-5 fixture-task demo only. Confirmed
  via `grep -l "acceptance:" tasks/*.md` that only `QENG-5-DEMO-PASS`/`QENG-5-DEMO-FAIL` (plus
  unrelated `QENG-4.md`) carry an `it0-dod-check.sh`-routed `extra.acceptance` meter — no real
  milestone task currently routes its DoD check through `quay gate`, confirming iteration-1's
  "demo-only" characterization (and its resulting `exp5-M-QENG-DOD-DEMO-ONLY` candidate task) is
  accurate, not overstated.)

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware], 1 per-milestone acceptance audit [unconditional], 2 V_meta-lag, 3 line-budget, 4
impl-row — N/A, 5 no-self-exemption, 6 escrow-Δv — N/A [discovery output, not a design-only
implementation], 7 test-floor — N/A [no `packages/quay*` files modified by this milestone itself]).
No task-specific exemption from any clause.
- [x] All standard clauses satisfied or explicitly N/A per their own trigger condition (re-verified at
  ABSORB, not assumed). (Confirmed by adversarial audit, 2026-07-19: Clause 7 test-floor N/A claim
  independently verified via `git diff --stat b9c1b44~1 HEAD -- packages/quay` → empty, and
  `git diff --stat b9c1b44 HEAD` over the full milestone commit range → touches only
  `experiments/quay-perpetual-stream/backlog.md`, `.../report.iteration-{0,1}.md`, and 9 files under
  `tasks/` (6 new candidates + 3 STALE re-triage appends) — zero `packages/quay*` files modified,
  confirming discovery-only scope. Clause 1 adversarial-audit is this very audit. Clause 3 line-budget:
  charter's own it0-ceiling check recorded PASS pre-dispatch. Clause 2 V_meta-lag and Clause 5
  no-self-exemption are procedural/textual clauses not independently re-derivable by this audit beyond
  confirming the charter/task/reports state them — no contradicting evidence found.)
- [x] N/A confirmed for escrow-Δv and impl-row clauses (this milestone's own output is new backlog
  rows, not a design doc awaiting a future `-IMPL`). (Confirmed by adversarial audit, 2026-07-19: the
  milestone's diff (`git diff --stat b9c1b44 HEAD`) shows its only outputs are 6 new candidate task
  files, 3 STALE-row appends, 2 reports, and a regenerated `backlog.md` — no design doc was produced
  that would require a future `-IMPL` follow-up row, and Δv̂ is stated as ≈0 per the charter/task's own
  "Value type / cadence" section, consistent with the discovery-channel precedent this milestone
  explicitly mirrors (M04/M26/M27/M28).)

## Status mirror
SELECTed @m37 DRAIN/SELECT boundary, 2026-07-19. Chosen over the STALE-row-only path because a large,
previously-unexamined product surface (QENG-0..5) landed since m35; see charter for full reasoning.
