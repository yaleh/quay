# M193 / DIR-125 — iteration-0 adversarial acceptance audit

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

**Task:** DIR-125 · **Charter:**
`experiments/quay-perpetual-stream/charters/M193-dir125-bound-prepare-milestone-convergence.md`
**Build commit:** `89f40af0b2036315552955fad47bdfeff01627f4` (on `master`)
**Verdict: CONCERNS**

Fresh-context adversarial audit — this session had not seen the build before this pass. Stance:
refute-first; every AC/DoD claim below was independently re-run against the real, unmodified
workflow/module sources, not accepted from the implementer's own summary
(`milestones/M193/iterations/iteration-0.md`).

## 1. Acceptance Criteria — attempted refutation, per item

All 11 AC bullets were checked by independently re-running the cited test file(s) in this session
(not trusting the implementer's reported pass/fail) and, where the claim was structural (e.g.
"never mutates a task", "byte-identical mirrors"), by reading the actual source/diffing the actual
files.

| # | AC (paraphrased) | Refutation attempt | Result |
|---|---|---|---|
| 1 | 2→1→0 fixture: exactly 2 authors/1 adjudicator/2 revisions/3 reviews | Re-ran `plugin/test/prepare-milestone-convergence.test.mjs`; asserts real dispatch counts against the unmodified workflow source (loaded as `AsyncFunction`) | Not refuted — PASS, both mirrors |
| 2 | Persistent-blocker cap: needs-human, no 4th dispatch | Same file, dedicated test | Not refuted — PASS |
| 3 | highRisk: exactly 1 extra delta round, hard cap, no caller override above ceiling | Same file + `proposal-convergence.test.mjs`'s `validateConvergenceCounters` cross-check | Not refuted — PASS |
| 4 | Mixed blocker+plan/backlog/accepted-risk: blocks only on blocker, retains all dispositions | Same file, dedicated test | Not refuted — PASS |
| 5 | Split-cluster: explicit split rec/needs-human, no task mutation | Test asserts `onRevise`/`onDeltaReview` throw if called; code inspection of `.claude/workflows/prepare-milestone.js` confirms the split branch `break`s out of the loop and returns `needs-human` before any `task_write`-issuing phase (revise/delta-review/PlanAuthor) is reached | Not refuted — PASS + code confirms no mutation path |
| 6 | Soft-budget: injected clock, never kills in-flight phase, records elapsed/terminal metrics | Same file + `proposal-convergence.test.mjs`'s `budgetStatus` unit tests | Not refuted — PASS |
| 7 | Stable IDs across wording-only revisions; Proposal before/after hashes; hash-bound into receipt; tamper/pairing fails the check | `proposal-convergence.test.mjs`'s `fingerprintFinding`/`hashLedger` tests + `milestone-preparation-check.test.mjs`'s `ledger-stale`/`ledger-missing`/`ledger-blocking-findings-open` FAIL cases | Not refuted — PASS (42/42 in file) |
| 8 | Zero-finding fixture: backward-compatible, one synthesis, no revision agent | `prepare-milestone-preparation-e2e.test.mjs` (2/2) + `milestone-preparation-check.test.mjs`'s pre-DIR-125-shape backward-compat test | Not refuted — PASS |
| 9 | DIR-120-shaped replay: 6 real finding classes, typed dispositions, not 10 syntheses | `dir120-replay-findings.json` inspected directly (all 6 classes present: scope/split, production-behavior/blocking, acceptance-wiring/blocking, test-coverage/plan, docs/backlog, risk/accepted-risk); replay test re-run, asserts `calls.authors.length===2`, `calls.revises.length===1`, and each finding's final disposition | Not refuted — PASS |
| 10 | Metrics (`prepareWallTime`, `fullSynthesisCount`, `proposalReviewRounds`, `blockingFindingYield`, `proposalChurnRatio`, `reachedPlanAuthor`) mechanically queryable per candidate | `computeMetricsForReceipt`/`computeConvergenceMetrics` unit tests re-run; CLI `--metrics` flag confirmed present by code inspection | Not refuted — PASS |
| 11 | `.claude`/`plugin` mirrors byte-identical; focused/packaging tests + `sync-vendor.sh --check` pass | `diff` on `prepare-milestone.js`, `proposal-convergence.ts`, `quay-task-to-plan/SKILL.md` (all exit 0); `sync-vendor.sh --check` → `CLEAN`; `plugin-packaging.test.mjs` re-run → 34/34 (confirms the `SYNC_SCRIPTS` 21→22 fix) | Not refuted — PASS |

**All 11 Acceptance Criteria confirmed** with independently-reproduced evidence, not the
implementer's self-report. Checkboxes ticked in `tasks/DIR-125.md` with inline evidence citations
(see that file's `## Acceptance Criteria` section).

## 1a. Test evidence actually reproduced this audit session

```
node --test plugin/test/prepare-milestone-convergence.test.mjs           → 18/18 pass
node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs → 32/32 pass
node --test experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs → 42/42 pass
node --test plugin/test/prepare-milestone-preparation-e2e.test.mjs       → 2/2 pass
node --test plugin/test/execute-milestone-preparation-gate.test.mjs      → 14/14 pass
node --test plugin/test/plugin-packaging.test.mjs                        → 34/34 pass
bash plugin/scripts/sync-vendor.sh --check                               → CLEAN
diff .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js → identical
diff .../scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts   → identical
diff .claude/skills/quay-task-to-plan/SKILL.md plugin/skills/quay-task-to-plan/SKILL.md → identical
```

A full `scripts/test.sh --test-concurrency=8` run was attempted and did NOT complete within a
580s budget under this session's real machine contention (killed by `timeout`, exit 143) — this
independently reproduces the SAME environment-contention symptom the implementer's own
`iteration-0.md` disclosed ("three attempted full-suite runs either take >30m or produce spurious
... failures ... purely from CPU starvation"). Every individual file this milestone touches or
could plausibly affect was instead run in isolation (above), all green. This is offered as
substitute evidence, not silently presented as equivalent to one clean full-suite run — same
disclosure stance the implementer used, independently corroborated rather than merely trusted.

## 2. Definition of Done

| DoD clause (paraphrased) | Result |
|---|---|
| Landed on `master`, independently audited against real dispatch counts | **Confirmed** — commit `89f40af` on `master`; this audit re-ran the dispatch-count assertions itself |
| ≤1 full synthesis per generation, every reset reason recorded | **Confirmed** — `maxFullSynthesis=1` fail-closed, receipt-side re-verification, tested |
| ProposalReview has a finite cap + terminal disposition, equivalent in strength to PlanCheck's | **Confirmed** — structurally mirrors `MAX_PLANCHECK_ROUNDS`; `nextAction()`'s terminal actions tested |
| Non-blocking findings durable/queryable; not silently dropped | **Confirmed** — `upsertFindings` defaults to `backlog`, never discards; tested |
| DIR-120-shaped replay reaches bounded split/Plan decision | **Confirmed** — 1 full synthesis + 1 delta round, not 10; tested |
| Zero-finding/PlanCheck/Receipt behavior compatible and green | **Confirmed** — e2e (2/2) + preparation-gate (14/14) tests green |
| **Milestone records a rollout baseline (p50 20–25m, p90 ≤60m, wall-ratio ≤35%, attempts/task ≤1.10)** | **NOT confirmed — left unchecked.** See below. |

### 2.1 The one open DoD item: "records a baseline"

The target numbers themselves already existed as prose in this task's own DoD text before this
milestone built anything, and `computeMetricsForReceipt`/`--metrics` makes the underlying
per-candidate metrics mechanically queryable once real dispatches happen. But no actual baseline
**measurement** has been recorded anywhere durable (not in `dashboard.md`, not in `OUTER-LOOP.md`,
not in any tracked metrics log) — there is no real post-DIR-125 `prepare-milestone` dispatch yet
to measure, which the implementer's own `iteration-0.md` explicitly discloses rather than hides
("this iteration lands the mechanism and its instrumentation surface; it does not itself
constitute the baseline measurement"). Read literally, "the milestone records a baseline" is not
yet true — the milestone records the *capacity* to measure a baseline, not a baseline. This is a
disclosed, non-blocking gap (there is no way to produce a real baseline before real dispatches
exist), not a defect in the mechanism itself — hence **CONCERNS**, not **REFUTED**.

## 3. Mechanical gate

See the `it0-dod-check.sh` invocation result recorded by the workflow that dispatched this audit
(clause 1/2 disposition lines were appended to
`/home/yale/.claude/jobs/13efe277/tmp/m193-absorb-entry.md` before the gate ran, per the
gap-absorb-entry-clause-disposition-sequencing / M180 sequencing rule).

## 4. Deviation-log write-back

One CONCERNS-level finding this same pass (machine-caught, this audit): DoD clause "the milestone
records a baseline for later evaluation" is not literally satisfied yet (no real baseline
measurement exists). A homeostatic-variables row was appended to `dashboard.md` per DIR-017 Step 3
(caught-by: machine, this audit, level: minor, status: open, age: 0). This does not block landing
the mechanism — it flags that the specific rollout-metrics DoD bullet remains open pending a real
`prepare-milestone` dispatch after this lands.

## 5. Session id

`13efe277-45ff-4563-bcfe-fd2c3db3e2a5` (from `$CLAUDE_CODE_SESSION_ID`, discovered before writing
this artifact, per DIR-093).
