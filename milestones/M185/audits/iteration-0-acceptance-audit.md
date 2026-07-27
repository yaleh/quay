# M185 iteration-0 acceptance audit — DIR-116 (concurrent-batch eligibility value-type check)

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

**Task:** `DIR-116` · **Charter:** `experiments/quay-perpetual-stream/charters/M185-dir116-concurrent-batch-value-type.md`
**Build commit:** `adeee62` (on `master` HEAD at audit time) · **Stance:** adversarial / refute-first, fresh context (no prior visibility into the build).

## Verdict

**CONCERNS** — every Acceptance Criterion and every Definition-of-Done clause is independently
confirmed true by this audit against real artifacts/command output (not the implementer's
self-report). One process/tree-hygiene-adjacent deviation was found and logged: this milestone's
own build evidence was filed under the wrong `milestones/` path.

## 1. AC satisfaction (refute-first)

Source: `tasks/DIR-116.md` `## Acceptance Criteria`, 5 checklist items.

1. **value-type check exists, non-`capability-growth` deferred with a distinguishable reason.**
   Attempted refutation: read `plugin/scripts/concurrent-batch-scheduler.ts` directly (via
   `git show adeee62 -- plugin/scripts/concurrent-batch-scheduler.ts`). Confirmed: `parseCandidate`
   extracts `valueType` (regex tolerates kebab/camelCase/older prose forms, defaults
   `"capability-growth"` when unstated); new exported `isCapabilityGrowth()` normalizes
   hyphen/case; `assembleBatch` defers any non-capability-growth candidate with reason
   `value-type ("<vt>") is not capability-growth — non-capability-growth work must serialize
   (deferred to fan-in ABSORB)`, textually disjoint from the pre-existing `learning-type (...)` /
   `touches shared exp5 state` / `... is not disjoint from ...` reasons (confirmed no substring
   overlap). **Could not refute — CONFIRMED.**

2. **RED (pre-change gap real) / GREEN (post-change blocked), both states shown as real output,
   not just GREEN.** Attempted refutation: this audit independently reproduced RED from scratch,
   not trusting the iteration report's pasted output — extracted the pre-change file via
   `git show adeee62^:plugin/scripts/concurrent-batch-scheduler.ts`, ran it standalone against the
   exact fixture pair (`cap-growth-explicit.md` + `governance-integrity-clean.md`):
   ```
   { "batch": ["cap-growth-explicit", "governance-integrity-clean"], "deferred": [] }
   ```
   Both candidates batch 2-wide pre-change — the gap is real, not asserted. GREEN independently
   confirmed via a live run of the current (post-change) scheduler against the same fixtures:
   ```
   BATCH (1-wide, concurrent): cap-growth-explicit
     deferred: governance-integrity-clean — value-type ("governance-integrity") is not
     capability-growth — non-capability-growth work must serialize (deferred to fan-in ABSORB)
   ```
   and via the sibling test suite (`experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs`),
   23/23 passing, including the new `main: real governance-integrity clean candidate is excluded;
   real capability-growth candidate still batches (DIR-116 GREEN, real fs)` test. **Could not
   refute — CONFIRMED**, both states independently reproduced by this audit, not merely re-read
   from the iteration report.

3. **A real capability-growth candidate (clean touches) is unaffected.** Attempted refutation: the
   `cap-growth-explicit` fixture (`**Value type:** capability-growth`) is present in the batch in
   both the independently-reproduced RED and GREEN runs above; the new test
   `assembleBatch: a real capability-growth candidate (clean touches) is unaffected by the
   value-type check` also asserts `r.batch = ["A","B"]`, `r.deferred = []` for two candidates
   where value-type is capability-growth/unstated. **Could not refute — CONFIRMED.**

4. **Mirror files stay in sync (or symlinked).** Attempted refutation: `ls -la
   experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts` shows it is a symlink
   (`-> ../../../plugin/scripts/concurrent-batch-scheduler.ts`), predating this milestone (DIR-070,
   2026-07-25 per file mtime) — only one file needed editing, and the diff (`adeee62`) touches only
   `plugin/scripts/concurrent-batch-scheduler.ts`. **Could not refute — CONFIRMED.**

5. **Sibling test suite passes, ≥2 new test cases cover RED/GREEN.** Attempted refutation: ran
   `scripts/test.sh experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs`
   live: `tests 23 / pass 23 / fail 0`. Counted 5 new DIR-116-tagged test cases (more than the
   required 2): value-type default, value-type parsing forms, `isCapabilityGrowth` normalization,
   governance-integrity-deferred (GREEN unit), capability-growth-unaffected, plus a 6th real-fs
   end-to-end test. **Could not refute — CONFIRMED** (exceeds the stated minimum).

All 5 AC items: **CONFIRMED**, checklist write-back already present in `tasks/DIR-116.md` (all
`- [x]`, each with an evidence citation) — verified those citations point to real artifacts, not
placeholders.

## 2. DoD satisfaction

Source: `tasks/DIR-116.md` `## Definition of Done`, 3 checklist items (ticked by this audit with
evidence, see task file diff):

1. **Real commit to `master`, not fixture-only.** `git log --oneline -1` on the current branch =
   `adeee62 M185/DIR-116: ...`; `git branch --contains adeee62` = `* master`;
   `git show adeee62 --numstat` shows `plugin/scripts/concurrent-batch-scheduler.ts` +38/-2 (real
   code, not just fixtures/task file). **CONFIRMED.**
2. **RED/GREEN both real, not asserted.** See AC-2 above — this audit independently reproduced
   both states from the pre-change and post-change code, not merely re-read the pasted transcript.
   **CONFIRMED.**
3. **Human-steered discipline (halt/golden-replay/independent audit), no autonomous SELECT.**
   Root-level `/home/yale/work/quay/.halt` exists with mtime 2026-07-27 05:51:09 UTC, predating the
   build commit's author timestamp (2026-07-27 07:57:18 UTC) — the sentinel was in place before and
   during the build. Golden-replay = the RED/GREEN pair above. This adversarial audit itself is the
   independent-audit component. **CONFIRMED.**

## 2a. Disposition append (gap-absorb-entry-clause-disposition-sequencing / M180)

Before running the mechanical gate, appended real (non-fabricated) disposition lines to
`/tmp/m185-absorb-entry.md`:
- `adversarial-audit disposition: CONCERNS` (written after reaching this verdict, not before).
- `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated
  carry-forward (milestone_counter=184 K=2, both ledger rows [ok] consolidated / [ok] proposed)` —
  verbatim reason text from a live run of
  `vmeta-lag-check.sh --counter 184 experiments/quay-perpetual-stream/v-meta-ledger.md`
  (`milestone_counter` 185 − 1 = 184, per dashboard.md's own `milestone_counter: 185`).

## 3. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-116 \
    experiments/quay-perpetual-stream/charters/M185-dir116-concurrent-batch-value-type.md \
    /tmp/m185-absorb-entry.md
...
PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared
self-exemption.
EXIT:0
```

Exit 0. (First run, before the step-2a append, correctly FAILed on clause1/clause2 with "NO
disposition statement found" — confirming the gate is live, not a rubber stamp; re-run after the
append passed.)

## 4. Deviation found (CONCERNS, not REFUTED)

**Machine-caught, this same audit pass:** this milestone's own build evidence — the newly-created
`experiments/quay-perpetual-stream/milestones/M185/iterations/iteration-0.md` (added in the same
commit `adeee62`, confirmed via `git log --diff-filter=A`) — was filed under the **legacy**
`experiments/quay-perpetual-stream/milestones/` path prefix, not the top-level `milestones/M185/`
path that `gate_resolve_milestone_root(185)` (the single-sourced >=130 rule from
gap-absorb-charter-audit-not-committed/M176) resolves to. Cross-checked against the last three
milestones that actually produced evidence directories (M177, M180, M181): all three correctly
used the top-level `milestones/M1xx/{iterations,audits}/` path. This audit's own artifact is filed
at the *correct* path (`milestones/M185/audits/iteration-0-acceptance-audit.md`, this file) per the
charge's explicit instruction to resolve via the function rather than re-deriving the boundary.

This does not change the AC/DoD verdict above — the code change and its tests are real, correct,
and committed to `master`; the deviation is about which evidence directory the build's own report
landed in, a tree-hygiene/single-sourcing concern parallel to (not a recurrence of) the M176 gap
it should have avoided. Logged as a dashboard deviation row (see below) rather than treated as a
REFUTED AC/DoD item, since no AC/DoD text names the milestones/ path explicitly.

## 4a. Deviation-log write-back (DIR-017 Step 3 / M36)

Added one row to `dashboard.md`'s "Homeostatic variables (DIR-017 Step 3)" table:
`CONCERNS | machine | M185 | DIR-116 ... | open | 0` (caught-by machine, this same audit pass).

## Scope discipline

Confirmed no change to build-concurrent/fan-in-serial architecture (`git show adeee62 --stat` —
only the scheduler file, its test, two new fixtures, the task file, and the iteration report were
touched); no golden-replay proof of serial==concurrent ABSORB equivalence attempted (explicitly
out of scope per DIR-116's own Finding section, deferred to DIR-113).
