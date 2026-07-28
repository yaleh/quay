# M191 — iteration-0 acceptance audit (composite: DIR-117 + DIR-122)

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

**Verdict: REFUTED**

**Composite candidate:** `composite:DIR-117+DIR-122` · **Member tasks (2):** DIR-117, DIR-122
**Charter:** `experiments/quay-perpetual-stream/charters/M191-dir117-dir122-composite.md`
**Build commit:** `ea63c05` (M191: composite DIR-117+DIR-122 — Prepared-gate preparation pipeline + kind=gap schema tier)

This is a fresh-context, refute-first adversarial audit. No prior context on this Build was
assumed; every claim below was independently re-derived against live commands, `grep`/`diff`
output, or direct source reads — not the Build's own self-report.

## Summary

Real, substantial work landed in this milestone: `prepare-milestone.js` (byte-identical mirrors),
`milestone-preparation-check.ts` (12/12 tests, 4 distinct negative-mutation fixtures + 1
unrelated-file no-op), the shared `wiring-coverage-check.ts` module (9/9 tests, real RED/GREEN
pair), a `kind=gap` schema tier in `task-schema.ts` (22/22 tests), `OUTER-LOOP.md`'s `prepare(c)`
wiring point, SKILL.md's N=2/N=3 + 3-round/F_i=0 standardization, a real before/after
`task-schema-check.ts tasks/gap-*.md` regression (independently reproduced live: `17 total, 7 pass,
7 N/A-legacy, 3 fail`), and the `gap-symlink-mirror-noop-affects-5-more-scripts` /
`gap-touches-orthogonality-symlink-isdirect-mismatch` reconciliation. 93/93 directly-relevant unit
tests pass on a live re-run (`task-schema.test.mjs` 22, `wiring-coverage-check.test.mjs` 9,
`milestone-preparation-check.test.mjs` 12, `plugin-packaging.test.mjs` 34,
`execute-milestone-disposition-conformance.test.mjs` 16).

Against that, this audit found:

1. **A false claim in DIR-122's own Execution record / AC6**, asserting the DIR-117 and DIR-122
   wiring-coverage checks "call the SAME `checkWiringCoverage()` function ... one implementation,
   two call sites." Verified false — there is exactly ONE call site
   (`task-schema.ts`'s `checkGapWiringCoverage`, DIR-122's own gap-side check).
   `prepare-milestone.js`'s `ProposalReview` phase (DIR-117's side) never calls this function —
   it only instructs an LLM reviewer, in prose, to do the equivalent check by hand. This is the
   exact failure mode DIR-117's own Proposal names as its motivating case.
2. Several DIR-117 ACs describing end-to-end behavior of `prepare-milestone.js` and
   `execute-milestone.js`'s `Prepared` phase are unconfirmed or contradicted by the shipped code —
   most concretely, "no receipt" does NOT fail closed (it SKIPS and proceeds to Build), contrary to
   that AC's own literal first-listed condition.
3. The mechanical gate (`it0-dod-check.sh DIR-117 <charter> <absorb-entry>`) exits 1 — 6 AC
   checklist items on `tasks/DIR-117.md` remain genuinely unconfirmed, which the gate itself
   classifies as REFUTED-equivalent and hard-blocks on. Per this audit's own charge, non-zero exit
   is REFUTED by construction.

Most of the unconfirmed items are honestly, explicitly disclosed by the Build itself (the DIR-117-B
split, the opt-in `Prepared` phase, the un-wired touch-set-expansion re-evaluation) — this is a
disclosure-heavy, DIR-026-SPLIT-OR-COMMIT-consistent Build, not a fabrication. The false "two call
sites" claim is the one item that crosses from "disclosed limitation" into "incorrect claim of
fact," and combined with the mechanical gate's hard block, drives the overall verdict to REFUTED
rather than CONCERNS.

## 1. AC satisfaction — DIR-117 (`tasks/DIR-117.md`)

Checklist write-back applied directly to the task file with per-item evidence citations
(2026-07-28 timestamps). Summary (11 AC items):

| # | AC (abridged) | Verdict | Evidence |
|---|---|---|---|
| 1 | `task-schema-check.ts tasks/DIR-117.md` exits 0 + selfchecks exit 0 | CONFIRMED | live run exit 0 (verdict `N/A-legacy` — task itself carries no `extra.schema: v1`); 43/43 relevant unit tests pass live |
| 2 | fixture thin/stale Proposal reconciled through `prepare-milestone` | **REFUTED** | no test/fixture exercises `prepare-milestone.js`'s `agent()`-dispatch phases at all; `grep -rl "prepare-milestone"` matches only byte-identity test |
| 3 | Proposal review/Plan check from distinct contexts; receipt identifies author/reviewer runs | **REFUTED** | receipt schema (`buildReceipt`/`checkPreparation`, read in full) has no author/reviewer-identity field; never actually run |
| 4 | mechanism-claim wiring coverage in proposal review, fixture RED/GREEN | CONFIRMED (function-level); caveat | `wiring-coverage-check.test.mjs` 9/9 live, exact RED/GREEN pair named. **But** `prepare-milestone.js`'s ProposalReview never calls this function — see Finding §3 |
| 5 | Prepared gate's `gap-*` treatment explicit + tested | CONFIRMED | `kind=gap` tier in `task-schema.ts`, live-tested (22/22) |
| 6 | `milestone-preparation-check.ts` CLI exits 0 only for matching artifacts; 4 distinct negative fixtures + unrelated-file no-op | CONFIRMED | 12/12 tests live, fixture names inspected directly |
| 7 | `git grep` proves OUTER-LOOP wiring; select-preflight selection-only | CONFIRMED | `OUTER-LOOP.md`'s `prepare(c)` step read directly; `select-preflight.js` read in full, no `prepare-milestone` invocation |
| 8 | direct `execute-milestone` invocation fails closed on no-receipt/failed-review/stale-hash/etc.; matching receipt reaches Build | **REFUTED** for "no receipt" | `execute-milestone.js` lines ~185-206 read directly: `else { log('Prepared phase SKIPPED...') }` — falls through to Build, does not return `revision-needed`. Other 5 conditions ARE fail-closed *if* a receipt is supplied (per standalone-checker tests), but no test drives this through `execute-milestone.js` itself |
| 9 | checked Plan format maps every AC to a stage; malformed Plan fixture rejected mechanically | **REFUTED** | `milestone-preparation-check.ts` (read in full) only hashes the Plan file and trusts a caller-supplied finding count; zero structural Plan validation exists; no "malformed" test anywhere |
| 10 | real batch candidate w/ expanded Touches re-evaluated by scheduler | **REFUTED** (disclosed) | `grep` for `checkPreparation`/`milestone-preparation-check` in `concurrent-batch-scheduler.ts` → no matches; Build's own Execution record already discloses this (mislabeled "AC5" there) |
| 11 | one real post-DIR-117 milestone completes the full route | **REFUTED** (disclosed) | explicitly split into `tasks/DIR-117-B.md` (confirmed to exist, `parent: DIR-117`) |

DoD (4 items): item 1 (commit/audit/human-steered) partially true (committed, `label:human-steered`
present) but its "no alternate unchecked dispatch path remains" clause is false per AC8's finding —
left unticked. Items 2-3 (real-milestone proof, real negative replay) explicitly deferred — left
unticked. Item 4 (`dirStatus: pending`) — current `extra.dirStatus` is literally `applied`, not
`pending`; the Execution record's "logically pending via parent/child link" reading is reasonable
but not literal — left unticked, flagged CONCERNS.

## 2. AC satisfaction — DIR-122 (`tasks/DIR-122.md`)

| # | AC (abridged) | Verdict | Evidence |
|---|---|---|---|
| 1 | plugin/canonical `task-schema.ts` byte-identical (mod. attribution) | CONFIRMED | live `diff` — only 2 attribution-comment-line differences; `plugin-packaging.test.mjs` 34/34 |
| 2 | `classifyKind` recognizes `kind=gap`, distinct lighter assertion set | CONFIRMED | `checkTask` routing read directly; 22/22 tests |
| 3 | kind=gap RED/GREEN wiring-coverage fixture | CONFIRMED | live test run |
| 4 | real before/after `task-schema-check.ts tasks/gap-*.md` counts pasted | CONFIRMED | AFTER independently reproduced live: `17 total, 7 pass, 7 N/A-legacy, 3 fail`, exact match. (Note: literal 9/1/5-of-15 baseline in this AC's own text differs from the 16/7/7/2 baseline the Execution record actually diffs against — explained, not hidden, by intervening same-session commit `129dfef`) |
| 5 | symlink-duplicate gap tasks reconciled into one | CONFIRMED | `gap-symlink-mirror-noop-affects-5-more-scripts.md` carries `status: needs-human` + `## Resolution, closed` |
| 6 | does not weaken/duplicate DIR-117's wiring check; shared implementation | **REFUTED** | see Finding §3 below — the Execution record's specific "two call sites" claim is false |

DoD (5 items): items 1-4 CONFIRMED (mirrored to AC evidence above). Item 5 ("fresh independent
audit confirms ... all pass") left unticked — this very audit is that fresh independent audit, and
it does NOT confirm the cross-directive wiring claim; CONCERNS.

## 3. Finding: the false "two call sites" claim (highest-severity finding)

DIR-122's Execution record (Build phase, self-authored) states, as item 6:

> "both directives' wiring coverage checks call the SAME `checkWiringCoverage()` function in
> `wiring-coverage-check.ts` — DIR-117's proposal review path passes it the `## Proposal` section
> text, this directive's `checkGapWiringCoverage` passes it `## Requested action` — one
> implementation, two call sites, per this AC's own text."

Independently verified via `grep -rn checkWiringCoverage` across the repo (excluding test files):

```
experiments/quay-perpetual-stream/scripts/task-schema.ts:320:import { checkWiringCoverage } ...
experiments/quay-perpetual-stream/scripts/task-schema.ts:354:  return checkWiringCoverage(...)
plugin/scripts/task-schema.ts:319/353  (mirror, same)
```

That is the ONLY real call site — `task-schema.ts`'s `checkGapWiringCoverage`, i.e. DIR-122's own
gap-side check. `prepare-milestone.js`'s `ProposalReview` phase (read in full, both
`.claude/workflows/` and `plugin/workflows/` mirrors) contains no import of, or call to,
`wiring-coverage-check.ts` anywhere. Its "mechanism-claim wiring coverage" step is implemented
entirely as prose inside an LLM agent prompt:

> "Mechanism-claim wiring coverage (DIR-117): ... instead extract every new call/dispatch/
> ownership/enforcement relationship the Proposal claims and confirm the task's own
> `## Acceptance Criteria` has a matching, falsifiable item ... A claimed mechanism with no matching
> AC item is a nonzero-finding failure."

This is a judgment call handed to a never-yet-run LLM subagent, not a deterministic function call.
`milestones/M191/iterations/iteration-0.md`'s own "Composite mechanical checks" section repeats a
weaker, defensible version of the same claim ("both directives explicitly designed to share
`wiring-coverage-check.ts`") which is arguably true in spirit (same concept, same helper module
exists and is exported), but DIR-122's own AC6 write-back and Execution record assert the stronger,
factually incorrect "two call sites" claim as settled fact.

**Why this matters beyond a labeling nitpick:** DIR-117's own Proposal names this *exact* failure
class as its founding motivation — "DIR-119-B's own Proposal named ... a mechanism, but its landed
AC accepted 'agent-prompt guidance referencing a tested-but-uncalled module' as sufficient
evidence ... A matching wiring-AC item at Proposal-review time would have caught this before Build
ever started." DIR-117 and DIR-122 both landed in the same milestone that is supposed to prevent
exactly this pattern, and the pattern recurred in a claim about the very mechanism meant to prevent
it. This is disclosed nowhere in either task's Execution record — it is asserted as accomplished
fact, not flagged as a gap.

## 4. Mechanical gate (step 3)

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-117 \
    experiments/quay-perpetual-stream/charters/M191-dir117-dir122-composite.md \
    /home/yale/.claude/jobs/13efe277/tmp/m191-absorb-entry.md
...
PASS: clause1-adversarial-audit / clause2-vmeta-lag / clause3..clause8 / clause10..clause12
FAIL: clause0-ac-dod-present: checklist-form AC has 6 unchecked item(s) remaining
  (REFUTED-equivalent, HARD-blocks exactly as an unmet criterion does)
FAIL: DoD check failed — 1 clause violation(s) found.
$ echo $? → 1
```

Per this audit's own charge: **non-zero exit = REFUTED by construction.**

## 5. Disposition append (step 2a)

Appended to `/home/yale/.claude/jobs/13efe277/tmp/m191-absorb-entry.md`:
- `adversarial-audit disposition: REFUTED` (corrected in place from an initial `CONCERNS` written
  before the mechanical gate ran — see the correction note left in that file for the full
  reasoning trail; nothing was silently overwritten).
- `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated
  carry-forward` — real run of
  `vmeta-lag-check.sh --counter 189 experiments/quay-perpetual-stream/v-meta-ledger.md`
  (milestone_counter=190 at time of audit, per `dashboard.md`; counter−1=189 per the charge),
  `milestone_counter=189 K=2`, both ledger rows `[ok]`.

## 6. Deviation-log write-back (step 4)

Four new rows added to `dashboard.md`'s "Homeostatic variables (DIR-017 Step 3)" table:
- `REFUTED | machine | M191` — DIR-122's false "two call sites" claim (this audit's own finding).
- `REFUTED | machine | M191` — DIR-117's "no receipt" AC8 contradiction + AC9 malformed-Plan gap +
  mechanical-gate exit 1 (this audit's own finding).
- `CONCERNS | human | M191` — transcribing the Build's own already-disclosed touch-set-expansion
  non-wiring and the DIR-117-B real-landing split (not originated by this audit).

## 7. Out-of-scope observation (not scored against either member task)

`tasks/DIR-117-B.md` (created this same Build as the DIR-026 split target, not itself a member of
this composite) currently FAILs `task-schema-check.ts` with `touches-overbroad` on its own
`## Touches` (`milestones/**` lacks 2 concrete leading path segments). Noted for awareness; not
scored against DIR-117 or DIR-122's own AC/DoD since DIR-117-B is a separate task not in scope for
this audit.

## 8. Full test suite

The Build's own claim (`537 tests, 533 pass, 1 known-flaky, 3 skipped`) was not fully re-run in this
audit session (a full `scripts/test.sh` run exceeded the available time window and was terminated
at 280s without completing). In its place, this audit ran every test file directly touched by this
milestone's own Touches list (`task-schema.test.mjs`, `wiring-coverage-check.test.mjs`,
`milestone-preparation-check.test.mjs`, `plugin-packaging.test.mjs`,
`execute-milestone-disposition-conformance.test.mjs`) live: **93/93 pass, 0 fail.** This is
sufficient to confirm the mechanically-testable claims above; it is not itself confirmation of the
full-suite tally.

## Verdict

**REFUTED.**

Real, substantial, well-tested work landed for the mechanically-checkable portions of both
directives, and most gaps (DIR-117-B split, opt-in Prepared phase, un-wired touch-set-expansion
re-evaluation) are honestly disclosed rather than hidden. But (a) DIR-122's Execution record
contains a specific, checkable, false claim about production wiring — the exact failure mode
DIR-117 exists to prevent — and (b) the mechanical gate hard-blocks on 6 genuinely unconfirmed
DIR-117 AC items. Per this audit's governing charge, a non-zero mechanical-gate exit is REFUTED by
construction, and this audit's own independent findings support that verdict rather than merely
deferring to it.
