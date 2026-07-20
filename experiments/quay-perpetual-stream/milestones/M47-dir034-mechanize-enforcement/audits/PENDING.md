# ABSORB m47 — M47-dir034-mechanize-enforcement — DRAFT (2026-07-20)

**Task:** [[DIR-034]] (`tasks/DIR-034.md`). **Worktree:**
`experiments/quay-perpetual-stream/milestones/M47-dir034-mechanize-enforcement/worktrees/iteration-0`,
branch `m47-dir034-mechanize-enforcement-iteration-0`, built off `master` HEAD `aec994f`.
**UNMERGED — master is untouched by this work.**

This file is a DRAFT ABSORB entry. Per DIR-032, the inner worker that built this milestone (this
session, a nested background subagent) is FORBIDDEN from dispatching or performing the adversarial
audit itself. Everything independent of the audit verdict is filled in below; the verdict itself is
marked PENDING. The TOP-LEVEL orchestrator session must dispatch a genuinely independent,
fresh-context `Explore`/`general-purpose` subagent to perform the audit, then replace this file with
`audits/iteration-0-acceptance-audit.md` (per the M41–M46 naming convention) carrying the real
verdict.

**Adversarial-audit verdict: PENDING — top-level dispatch.**
**V_meta consolidation-lag gate: not yet re-checked by this draft (defer to the audit / top-level ABSORB pass).**

## SELECT reasoning (re-DRAINED this pass)

Open candidates considered: the crystallization backlog (INV/B4/E2/C1 etc — schema-clean work,
largely already absorbed per M46/ba1edb8), cp-45's 10-milestone zero-exploit streak (m36–45)
recommending an EXPLORE-typed pick at m46/m47, and DIR-034 (human-steered, dirStatus:pending,
diagnosing that DIR-031/032/033's three checks are only prose-wired, not mechanically gated).

**DIR-034 selected.** Reasoning:
- It closes a LIVE enforcement gap, verified against real M46 history (the exact "prose close-out
  skipped, mechanical gate stayed silent" pattern this same experiment tripped on at M46 before this
  session's correction). Governance-integrity value-type, highest-priority class per the value
  ledger when a live gap is open and reproducible.
- It is EXPLORE-typed in substance (new mechanism: dispatch-record corroboration did not exist
  before) even though its surface is "harden an existing gate" — it satisfies cp-45's recommendation
  in spirit: this is not another crystallization-backlog exploit pick.
- **Human-steered-label judgment call:** DIR-034 carries `label:human-steered`. Per DIR-032/DIR-033
  precedent (both also human-steered, both autonomously SELECTed under the same fence's own
  documented exception — see their own `## Resolution` sections), a human-steered label does not by
  itself require flagging back for label-removal: the fence's exception applies when the directive's
  scope is a bounded, mechanically-checkable hardening of an EXISTING gate (not a rewrite of
  OUTER-LOOP.md's loop-control prose, not a change to who/what the loop is allowed to do). DIR-034's
  scope — wrap 3 existing scripts into an existing gate, add one anti-forgery check to an existing
  module — fits that same bounded shape. Judgment: autonomously selectable, consistent with
  DIR-032/033 precedent; documenting this reasoning here rather than silently proceeding.

## Delivered (built by this worker, worktree-isolated, TDD RED→GREEN)

- `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` — three new clauses:
  - **Clause 10 (tree-hygiene)** — wraps `tree-hygiene-check.sh`, mechanically unconditional.
  - **Clause 11 (worktree-branch-hygiene)** — wraps `worktree-branch-hygiene-check.sh`, mechanically
    unconditional.
  - **Clause 12 (audit-independence)** — wraps `audit-independence-check.sh`; conditional on a new
    `## Audit-independence check` ABSORB-entry convention (`Artifact:`/`Orchestrator id:`/
    `Dispatch record:` lines); documented no-op when the section is absent.
  - `MECHANICALLY_UNCONDITIONAL_CLAUSES` and the clause-5 no-self-exemption name list both extended
    for tree-hygiene/worktree-branch-hygiene.
- `experiments/quay-perpetual-stream/scripts/audit-independence-check.mjs` — new
  `parseDispatchRecord`/`isCorroborated` + `evaluateIndependence`/`checkArtifact` extended with a
  `dispatchRecordIds`/`allowUncorroborated` option; a bare distinct id is now FAIL-by-default unless
  corroborated by a dispatch-record (closes the forgeable-string hole DIR-034 diagnosed);
  `allowUncorroborated` escape hatch preserves pre-DIR-034 behavior, never the default, never passed
  by the it0-dod-check.mjs wiring.
- `experiments/quay-perpetual-stream/scripts/audit-independence-check.sh` — usage comment updated
  (`--dispatch-record`, `--allow-uncorroborated`, `QUAY_DISPATCH_RECORD_FILE`); no logic change.
- `experiments/quay-perpetual-stream/scripts/audit-independence-selfcheck.sh` — restructured with an
  `extra`-args field; 4 new DIR-034 cases; **all 7 fixtures pass.**
- New fixtures: `fixtures/audit-independence/{fabricated-distinct-id-no-corroboration.md,
  corroborated-independent.md, dispatch-record.txt}`.
- `experiments/quay-perpetual-stream/test/audit-independence-check.test.mjs` — **39/39 pass.**
- `experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs` — **40 new/updated cases, 79/79
  total pass** (full file, both suites combined).
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` — states clauses 10/11/12 now mechanically
  enforce the three checks; the existing prose close-out sub-steps (capture-then-prune,
  tree-clean-between-steps, audit-independence narrative) are demoted to operator guidance for HOW
  to fix a failure, cross-referenced at each of the three original prose locations (DIR-034 AC4).

## Gates already run (by this worker) and results

- `node --test experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs
  experiments/quay-perpetual-stream/test/audit-independence-check.test.mjs` → **79/79 PASS.**
- `bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh` → **17/17 PASS**, no
  regression.
- `bash experiments/quay-perpetual-stream/scripts/audit-independence-selfcheck.sh` → **7/7 PASS.**
- Coverage (`node --test --experimental-test-coverage`): `audit-independence-check.mjs` 100.00%
  line / 98.48% branch / 100.00% funcs; `it0-dod-check.mjs` 88.53% line / 73.18% branch / 91.30%
  funcs; overall **80.33% line / 80.48% branch** — clears the ≥80% DIR-014/5a dev-class floor.
- **REAL synthetic-failure demonstrations (AC1/DoD-1), all against this worktree's own real tree —
  not fixtures:**

  **Clause 10 (tree-hygiene) RED:**
  ```
  === RED: create un-ignored scratch file (scratch-test-scratch~ — *.bak is already gitignored repo-
      wide, so a genuinely un-ignored suffix was required), run real check ===
  FAIL: clause10-tree-hygiene: FAIL — tree-hygiene: FAIL — un-gitignored scratch left in the main tree
  FAIL: DoD check failed — 1 clause violation(s) found (see above).
  REAL-EXIT=1
  ```
  **Clause 10 GREEN** (scratch file removed): `PASS: clause10-tree-hygiene: PASS — tree-hygiene:
  clean`; `PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed)`;
  `REAL-EXIT=0`.

  **Clause 11 (worktree-branch-hygiene) RED** (a real un-merged `m99-demo-orphan-iteration-0` branch
  created off master, holding a real committed orphaned `milestones/M99-demo/report.md` absent from
  master):
  ```
  FAIL: clause11-worktree-branch-hygiene: FAIL — worktree-branch-hygiene: FAIL — un-merged iteration
  branch(es) hold milestone evidence absent
  FAIL: DoD check failed — 1 clause violation(s) found (see above).
  REAL-EXIT=1
  ```
  **Clause 11 GREEN** (demo worktree/branch removed via `git worktree remove --force` +
  `git branch -D`): `worktree-branch-hygiene: clean`; full check `PASS: DoD check passed — all
  clauses satisfied`; `GREEN-EXIT=0`. Confirmed no residual demo branch/worktree remains.

  **Clause 12 (audit-independence) RED** (real `## Audit-independence check` section naming the real
  `fabricated-distinct-id-no-corroboration.md` fixture + real `dispatch-record.txt` that does NOT
  contain its id):
  ```
  FAIL: clause12-audit-independence: FAIL — FAIL: audit artifact's session id
  ("top-level-orchestrator-explore-agent-fabricated-9f9f") ... NOT found in the supplied
  dispatch-record ... treated as a FABRICATED distinct string, fail-closed per DIR-034's anti-forgery
  requirement
  REAL-EXIT=1
  ```
  **Clause 12 GREEN** (same section naming `corroborated-independent.md`, whose id IS in the same
  dispatch-record): `PASS: clause12-audit-independence: PASS — ... corroborated by the independent
  dispatch-record — genuinely independent (DIR-034 anti-forgery check satisfied)`; `REAL-EXIT=0`.

- `bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` /
  `worktree-branch-hygiene-check.sh` (post-cleanup, on this worktree's real state): both **clean**,
  `git status --porcelain` shows only the intended modified/new files.

## Exact AC / DoD checklist (NOT self-ticked — reserved for the independent audit, DIR-020)

Acceptance Criteria:
- [ ] grep confirms real invocation of all three checks in `it0-dod-check.mjs`; RED/GREEN
      demonstrated per check — **evidence above; audit should re-verify independently.**
- [ ] `audit-independence-check.mjs` FAILs fabricated-distinct-uncorroborated, PASSes
      corroborated; RED+GREEN fixtures pin both — **evidence above (fixtures +
      selfcheck + unit tests); audit should re-run selfcheck itself.**
- [ ] Single-source preserved (grep, no duplicated logic) — **evidence above.**
- [ ] `OUTER-LOOP.md` states mechanical enforcement, prose demoted to guidance — **edited, see diff.**

Definition of Done:
- [ ] Real milestone's ABSORB gated by all three through the mechanical enforcer, demonstrated by a
      real failing case BLOCKING the counter increment, HARD-FAIL then GREEN pasted — **this IS that
      real milestone; evidence above is against THIS worktree, not a fixture. Audit should confirm
      the RED/GREEN transcripts above are genuine (re-run if in doubt) and that `milestone_counter`
      has NOT yet incremented (still 46 in `dashboard.md` — this ABSORB has not run step 7).**
- [ ] Audit-independence gate consumes a dispatch-side corroborated id on a REAL milestone (not a
      fixture) — **NOTE: the corroborated/fabricated artifacts used above ARE fixture files
      (`fixtures/audit-independence/*.md`), reused for the demonstration; the mechanism itself
      (`## Audit-independence check` section + dispatch-record convention) is new and has not yet
      been exercised against a REAL adversarial-audit artifact from an actual dispatched subagent.
      This is the one DoD item this draft does NOT yet fully close — recommend the top-level audit
      itself becomes that real exercise: when it runs, it should be issued a real session id, a real
      dispatch-record entry should be written by the top-level orchestrator BEFORE dispatch, and its
      own resulting audit artifact should be fed through clause 12 for real, replacing this
      still-partial demonstration.**
- [ ] Single-source; DIR-031/032/033/027 preserved, not reversed — **evidence above; no OUTER-LOOP
      loop-control prose (DIR-027 master-only, no driver branch) was touched, only the three
      close-out sub-steps' cross-references were added.**

## What the independent audit needs to verify

1. Re-run `node --test` on both modified test files (79/79 expected) and both selfcheck/fixture
   scripts (17/7 expected) from the worktree — confirm no drift since this draft.
2. Independently re-run the clause 10/11/12 RED→GREEN demonstrations (or spot-check at least one) to
   confirm the transcripts above are genuine, not paraphrased.
3. **Close the one open DoD item above**: exercise clause 12 against ITS OWN real audit artifact +
   a real dispatch-record entry written by the top-level orchestrator at dispatch time, proving the
   corroboration mechanism against a real dispatched session, not just fixtures.
4. Confirm `master` is untouched (`git log master` still at `aec994f`; `git status` on the main
   working tree clean) and that this worktree/branch is the only place carrying this milestone's
   diff.
5. Re-verify the human-steered-label judgment call above against DIR-032/033's own precedent text.
6. Only if all clear: replace this file with `audits/iteration-0-acceptance-audit.md`, record the
   verdict, perform the AC/DoD checklist write-back (DIR-020, ticking only what it independently
   confirms), then the top-level session (not this nested worker) proceeds with `master` merge +
   `milestone_counter++` per OUTER-LOOP.md step 6/7.
