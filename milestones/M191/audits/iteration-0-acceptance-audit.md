# M191 — adversarial acceptance audit (composite: DIR-117 + DIR-122), iteration-2 re-audit

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

Fresh-context re-audit of the M191 composite (member tasks DIR-117, DIR-122) after the Build's
"iteration-2" pass, which closed 5 of the 6 real gaps this same audit found in its own iteration-0
pass (`git log`: `ea63c05` iteration-0 → `dba8905`/`193d700` audit-response fixes → `43eb549`
charter iteration-2 scope → `a0a1d20` iteration-2 Build). This audit independently re-verifies
every AC/DoD item on both task files from scratch — citing live command output and direct source
reads, not the Build's own self-report — and re-runs the mechanical gate.

## 1. AC satisfaction — DIR-117 (`tasks/DIR-117.md`)

Per-item verdicts (full evidence citations written back onto the task file itself, per DIR-020 —
see `tasks/DIR-117.md`'s own `**AUDIT (2026-07-28, iteration-2 re-audit): ...**` annotations):

| # | AC (abridged) | iteration-0 verdict | iteration-2 re-audit verdict |
|---|---|---|---|
| 1 | `task-schema-check.ts`/selfchecks exit 0 | confirmed | unchanged, confirmed |
| 2 | fixture reconciliation end-to-end via `prepare-milestone` | REFUTED (no test exercises real phases) | **confirmed** — `plugin/test/prepare-milestone-preparation-e2e.test.mjs` (new, both mirrors) loads the REAL, unmodified `prepare-milestone.js` as an `AsyncFunction`, drives every phase; live re-run 2/2 pass; real fixture task file ends with a reconciled Proposal + `## Plan` pointing at a real `docs/plans/*.md`, independently re-verified via a direct `checkPreparation()` call |
| 3 | Proposal review/Plan check from distinct contexts, receipt records author/reviewer identity | REFUTED (no provenance field at all) | **confirmed** — `checkProvenanceDistinctness()` (new) mechanically verifies real, distinct `$CLAUDE_CODE_SESSION_ID` values per role and FAILs closed on missing/incomplete/non-distinct provenance; `prepare-milestone.js`'s every phase now captures and threads its own session id; live re-run of `milestone-preparation-check.test.mjs` → 61/61 pass, including 5 new provenance tests |
| 4 | wiring-coverage mechanism-claim check (RED/GREEN) | confirmed | unchanged, confirmed (9/9 `wiring-coverage-check.test.mjs`, live) |
| 5 | schema-marker-less `gap-*` tasks — explicit decision | confirmed (via DIR-122's `kind=gap`) | unchanged, confirmed |
| 6 | `milestone-preparation-check.ts` CLI negative-fixture behavior | confirmed | unchanged, confirmed (12/12 base + new tests, 61/61 total live) |
| 7 | `git grep` proves OUTER-LOOP wiring, `select-preflight` selection-only | confirmed | unchanged, confirmed |
| 8 (revised) | with-receipt: 5 conditions fail closed before Build; valid receipt reaches Build | REFUTED (no `execute-milestone.js` integration test) | **confirmed for the with-receipt scope this AC's own revised wording defines** — `plugin/test/execute-milestone-preparation-gate.test.mjs` (new, both mirrors) loads the REAL, unmodified `execute-milestone.js` as an `AsyncFunction`, drives Verify→Prepared for each of the 5 conditions; live re-run 14/14 pass; each condition returns `{outcome:'revision-needed', phase:'Prepared', reason:<code>}` before Build's `agent()` is ever invoked (mock throws if reached), and a fully-valid receipt reaches Build. The "no receipt → SKIPPED, falls through to Build" branch is explicitly out of THIS AC's revised scope (tracked as [[DIR-117-B]]'s own scope) — not a residual gap in this AC as now worded |
| 9 | checked Plan format: AC↔stage mapping, malformed-Plan rejection | REFUTED (zero structural validation) | **confirmed** — `parsePlanStages`/`validatePlanStructure` (new) parse the `### Stage N:`/`- AC:`/`- Files:`/`- Command:` convention (matching `PlanAuthor`'s prompt, confirmed by reading it) and reject missing-stage/incomplete-stage/AC-not-mapped Plans; live re-run: 7 new unit tests + 1 integration test pass, against a real checked-in malformed fixture (`experiments/quay-perpetual-stream/fixtures/preparation/fixture-plan-malformed.md`, confirmed present) |
| 10 | touch-set expansion re-evaluated by the batch scheduler | REFUTED (nothing wires the result in) | **confirmed** — `computeTouchesExpansion` (single-sourced) is imported and reused (`grep` confirms the import) by a new `applyPreparationExpansion` + `main()`'s `--receipts id=file,...` flag in `concurrent-batch-scheduler.ts`; live re-run of `concurrent-batch-scheduler.test.mjs` passes, including the specific test proving a stale-narrower-Touches candidate that WOULD batch is DEFERRED once its checked-Plan receipt's real touch set is merged in — genuine re-evaluation |
| 11 | one real post-DIR-117 milestone proves the whole route | REFUTED — explicitly, honestly deferred | **still REFUTED, by construction, unchanged** — DIR-117 cannot go through its own not-yet-built Prepared gate; split via DIR-026 SPLIT-OR-COMMIT into `tasks/DIR-117-B.md` (confirmed exists, `parent: DIR-117`, `status: todo`, carries exactly this scope) |

**Net: 10/11 AC items now confirmed** (up from 6/11 at iteration-0); the 1 remaining item is the
by-construction bootstrap-paradox item this directive's own Plan text anticipated and DIR-026
SPLIT-OR-COMMIT already resolved into a named child task.

## 2. DoD satisfaction — DIR-117

The 4 DoD checklist items remain **unticked**, unchanged by iteration-2 (iteration-2's real scope
was exactly the 5 AC items above, per the charter's own item-by-item mapping — none of the 4 DoD
clauses were in iteration-2's stated scope):

1. "no alternate unchecked dispatch path remains" — **still false as literally written.** Omitting
   `preparationReceiptFile` still SKIPs the Prepared phase and falls through to Build unconditionally
   (confirmed by re-reading `execute-milestone.js` directly; unchanged by iteration-2, which only
   added `declaredTouches` wiring to the WITH-receipt branch). Deliberate, disclosed back-compat
   design per `OUTER-LOOP.md`'s own STATUS note — not a hidden regression — but the DoD's literal
   claim does not hold. Tracked as [[DIR-117-B]]'s own scope (flip default to enforced).
2. Real subsequent-milestone landing — REFUTED, by construction, same as AC11 above.
3. Same real run demonstrating stale-input/negative-replay behavior — REFUTED, same reason (only
   synthetic-fixture evidence exists; the task's own DoD preamble already names that as necessary
   but insufficient).
4. `dirStatus: pending` until real landing — CONCERNS, unchanged: `extra.dirStatus` is literally
   `applied` (set at DRAIN time); the task's Execution record reinterprets this as "logically
   pending, tracked via the parent/child link" — a reasonable but non-literal reading. The DIR-026
   SPLIT-OR-COMMIT half (creating [[DIR-117-B]]) is independently confirmed real.

**DoD is NOT satisfied** — all 4 items require the real subsequent-milestone landing that is, by
this directive's own design, [[DIR-117-B]]'s scope.

## 3. DIR-122 (`tasks/DIR-122.md`) — re-audit

DIR-122 needed no further Build work in iteration-2 (confirmed via `git show a0a1d20 --stat`: zero
DIR-122-owned files touched). Its two iteration-0 findings were addressed by a direct task-file
edit **before** this charter's iteration-2 (commit `dba8905`), not by new code:

- AC "does not weaken or duplicate DIR-117's wiring coverage check": the false "two call sites"
  claim in DIR-122's own Execution record item 6 is now **corrected** (re-read live) to accurately
  state one real call site (`task-schema.ts`'s `checkGapWiringCoverage`) and one prompt-only side
  (`prepare-milestone.js`'s `ProposalReview`). Independently re-confirmed via `grep -rn
  checkWiringCoverage` (excluding tests): still exactly one real call site. So the **false-claim
  defect is fixed**, but the AC's own literal condition ("duplicate implementation approach") still
  does not hold — left unticked, now for the honest underlying reason (tracked as [[DIR-117-B]]'s
  added scope), not because of a false claim. Verdict: **CONCERNS, not REFUTED** (the specific thing
  the iteration-0 audit found false is now true; the AC as literally worded remains unmet).
- Matching DoD clause: same status — CONCERNS, not a full pass, for the same honest reason.

All other DIR-122 AC/DoD items are unchanged from iteration-0's confirmed state, independently
re-verified live this pass:
- Byte-identity (`sync-vendor.sh --check` → CLEAN, all files including `task-schema.ts` OK).
- `classifyKind`'s `gap` case + assertion set (`task-schema.test.mjs`, read directly).
- RED/GREEN wiring-coverage fixture (`wiring-coverage-check.test.mjs`).
- Before/after `task-schema-check.ts tasks/gap-*.md`: **independently re-run live this pass** →
  `17 total, 7 pass, 7 N/A-legacy, 3 fail` — exact match to the Execution record's claimed AFTER.
- Symlink-duplicate reconciliation (`gap-symlink-mirror-noop-affects-5-more-scripts.md`'s
  `## Resolution, closed` section, read directly).

## 4. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-117 \
    experiments/quay-perpetual-stream/charters/M191-dir117-dir122-composite.md \
    /home/yale/.claude/jobs/13efe277/tmp/m191-absorb-entry.md
...
FAIL: clause0-ac-dod-present: checklist-form AC has 1 unchecked item(s) remaining
  (REFUTED-equivalent, HARD-blocks exactly as an unmet criterion does):
  "One real post-DIR-117 milestone completes the entire preparation→Prepared gate→Build route."
  [tasks/DIR-117.md]
FAIL: DoD check failed — 1 clause violation(s) found (see above).
EXIT:1
```

All other 11 clauses (1,2,3,4,5,6,7,8,10,11,12) PASS or N/A; clause0 is the sole failure, down from
6 unchecked items at iteration-0 to 1. Per this audit's own charge, **any non-zero exit is REFUTED
by construction** — this is unchanged from iteration-0's own rule, applied consistently here even
though the single remaining item is a deliberate, already-split, by-construction deferral rather
than an unaddressed defect.

## 5. Real evidence independently re-run this pass (not trusting the Build's self-report)

- `node --experimental-strip-types --test plugin/test/prepare-milestone-preparation-e2e.test.mjs
  plugin/test/execute-milestone-preparation-gate.test.mjs` → **16/16 pass** (both `.claude`/`plugin`
  mirrors of each new test file).
- `node --experimental-strip-types --test
  experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs
  experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs` → **61/61 pass**.
- `bash plugin/scripts/sync-vendor.sh --check` → **CLEAN**, all files including
  `milestone-preparation-check.ts`/`wiring-coverage-check.ts`/`task-schema.ts` byte-identical.
- `node experiments/quay-perpetual-stream/scripts/task-schema-check.ts tasks/gap-*.md` → **17 total,
  7 pass, 7 N/A-legacy, 3 fail**, matching the claimed AFTER exactly.
- `git log --oneline`, `git show a0a1d20 --stat`, `ls tasks/DIR-117-B.md`, `git worktree list`,
  `git status --short` — all independently confirm the claimed commits, file set, split child task,
  and clean tree (only this audit's own task-file edits + pre-existing untracked `.halt` sentinels).
- `bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 189
  experiments/quay-perpetual-stream/v-meta-ledger.md` → PASS (see §6).
- **Full suite `bash scripts/test.sh`: attempted twice this pass (up to ~550s each), both runs did
  not complete/were terminated** — this environment has heavy concurrent load from other
  simultaneous milestone/loop activity (`ps aux` during the attempt showed multiple other
  `node --test`/workflow processes competing for CPU). This is an environment-capacity limitation
  of this audit pass, not a finding about the code. Mitigation: every specific test file this
  milestone's own Touches list names was run directly and independently (§ above, all pass), and
  the mechanical gate marks `clause7-test-floor: N/A` for this milestone's surface
  (`method-infra`, non-product-touching), so a full-suite tally is not itself gate-blocking here.
  The iteration-2 Build's own commit message additionally reports `553 tests, 548 pass, 2 fail
  (pre-existing gap-cli-serve-port-test-flaky-ci-timeout-class flake, confirmed unrelated, 11/11 in
  isolation), 3 skipped` — consistent with, but not independently reproduced by, this audit pass; a
  human or a subsequent pass with more available headroom should reproduce it before treating it as
  independently confirmed.

## 6. V_meta consolidation-lag

```
$ bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 189 \
    experiments/quay-perpetual-stream/v-meta-ledger.md
milestone_counter=189 K=2
  [ok] consolidated | lag=- | consolidated — lag gate does not apply | domain-audit-channel≡CI-job pattern (+ per-subcommand audit exercise)
  [ok] proposed | lag=- | proposed — not past φ threshold, no lag gate | repo-root isolation-leak lesson

PASS: no confirmed-unconsolidated row past K without a dated carry-forward
```

## 7. Verdict

**REFUTED** (mechanically forced by clause0's non-zero exit — 1 unchecked AC item on
`tasks/DIR-117.md`, the by-construction real-subsequent-milestone-landing item this directive's own
Plan text anticipated and DIR-026 SPLIT-OR-COMMIT already resolved into `tasks/DIR-117-B.md`).

This is a materially different REFUTED than iteration-0's: iteration-0 had 6 unconfirmed AC items
and a false cross-directive claim; iteration-2 closed 5 of those 6 with real, independently
re-verified evidence (end-to-end `prepare-milestone.js` fixture, provenance distinctness, real
structural Plan validation, real touch-expansion re-evaluation wired into the batch scheduler, and
a real `execute-milestone.js` Prepared-phase integration test), and the false claim was already
corrected by direct edit. The single remaining item is not a defect Build failed to address — it is
the one item this directive's own Proposal/Plan text identifies as unable to be self-certified
within its own milestone (DIR-117 cannot pass through its own not-yet-built Prepared gate), already
split into a named, scoped child task per DIR-026. The mechanical gate does not distinguish
"legitimately deferred via split" from "unaddressed defect" — both HARD-block identically — so per
this audit's own stated charge, the verdict is REFUTED by construction regardless.

**needs-human legitimacy check (DIR-026/ADR-014 Clause 9):** consistent with the already-established
convention for [[DIR-070]]/[[DIR-087]]/[[DIR-109]]/[[DIR-115]]/[[DIR-070-F]] — a build that fails
the mechanical gate or is REFUTED by audit is marked `needs-human`, not left `todo`/`ready`. `status`
should remain (or be set to) `needs-human` for DIR-117; the disposition is now concrete, evidenced,
and requires only the human call already flagged at iteration-0 (confirm DIR-117-B is the correct
vehicle for the remaining item, per DIR-026). DIR-122's own status is not itself gate-blocked by
this run (the gate call names only DIR-117), but its own CONCERNS item (§3) remains open pending
[[DIR-117-B]]'s wiring-coverage-callsite work.

## 8. Composite audit-boundary discipline (DIR-119-B/M189)

This audit performed the standard per-task AC/DoD checklist write-back on `tasks/DIR-117.md` and
`tasks/DIR-122.md` (DIR-020) and appended the disposition lines to the ABSORB-entry file (see §4/§6
above, gap-absorb-entry-clause-disposition-sequencing/M180). It did **not** write any absorb
disposition beyond that append, dashboard entry, milestone counter, or lifecycle `status` field for
either member task — those remain Land's job.
