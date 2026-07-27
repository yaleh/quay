# M189 / DIR-119-B — iteration-0 acceptance audit (fresh-context, adversarial)

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

**Task:** DIR-119-B · **Charter:** `experiments/quay-perpetual-stream/charters/M189-dir119b-composite-execution.md`
**Commit under audit:** `49995b1` ("M189/DIR-119-B: arbitrary-width composite milestone execution (Phase 2 of O4)") — HEAD of `master` at audit time.
**Verdict: CONCERNS** (not REFUTED — see §4 for why this is not a blocking finding, and §5 for the deviation-log entries this pass writes back).

## 0. Method

Fresh context — no prior exposure to the build. Refute-first: every AC/DoD claim was checked
against live code, a fresh re-run of the relevant tests, `diff`, and `grep`, never the
implementer's own prose (iteration-0.md / the commit message) taken at face value.

## 1. AC satisfaction (refute-first)

All 12 AC bullets in `tasks/DIR-119-B.md` are checked below. Checkbox write-back was applied
directly to the task file with an evidence citation per item (DIR-020); summarized here.

1. **Argument normalization (legacy + new shape → one task array).** CONFIRMED. `composite-args.ts`'s
   `normalizeExecuteArgs` and the workflow's inline `_normalizeExecuteArgsInline` mirror it;
   `node --test experiments/quay-perpetual-stream/test/composite-args.test.mjs
   experiments/quay-perpetual-stream/test/composite-preflight.test.mjs` re-run green this pass.
2. **No maximum composite task count anywhere.** CONFIRMED. `grep -rn "maxTask|MAX_TASK|taskLimit"`
   across all `composite-*.ts` + both workflow files returns nothing; widths up to 50 accepted in
   `composite-args.ts`'s own selftest.
3. **Mechanical composite contract (membership/hashes/AC-phase-audit/touches/resources/DAG/
   temporal/capacity/atomic-Land).** CONFIRMED. `composite-contracts.ts`'s `checkCompositeContract`
   (8-point) + `composite-args.ts`'s stale-hash check, combined and wired LIVE as the workflow's
   6th Verify-phase mechanical check via `composite-preflight.ts` — confirmed by reading the actual
   diff (`_cachedComposite`, `allVerifyResults.length < 6`), not just the module's existence.
4. **1/3/5/10-task fixtures pass; negative fixtures fail closed.** CONFIRMED. Fresh re-run:
   `node --test experiments/quay-perpetual-stream/test/composite-*.test.mjs` → **70/70 pass, 0
   fail** (reproduced by this audit, not copied from the iteration report).
5. **Build consumes a phase DAG; shared phases have one owner; task count ≠ agent count.**
   CONFIRMED AT CONTRACT LEVEL. `composite-build.ts`'s `planPhaseExecution` is genuinely tested
   (shared phase → 1 owner even under `mode:"parallel"`; `mode:"serialize"` → `agentCount===1`
   regardless of width 1/3/5/10; `mode:"parallel"` capped independent of task count). **Caveat**:
   the live Build-phase prompt (`.claude/workflows/execute-milestone.js`'s conditional `2a.
   COMPOSITE BUILD` block) *references* this module for the agent to follow; it does not literally
   invoke `planPhaseExecution()` — the workflow DSL has no `import` capability (confirmed: only
   `phase`/`agent`/`parallel`/`log`/`args` globals exist). This is the task's own DoD item 5
   ("operational wiring remains assigned to DIR-119-C") boundary, not a hidden gap — see §4.
6. **Read-only audit shards; no task/absorb/dashboard/counter/lifecycle writes.** CONFIRMED AT
   CONTRACT LEVEL. `composite-audit.ts`'s `runReadOnlyAuditShard` has real negative controls: a
   hostile shard attempting to flip task status, write an absorb disposition, push a dashboard
   entry, or bump the counter is blocked (`ok:false`), and the REAL state object is proven
   byte-identical before/after via `structuredClone` + recursive `Object.freeze` isolation
   (verified by re-running `composite-audit.test.mjs`). Same live-wiring caveat as item 5: the
   actual Audit phase remains one shared LLM agent (unchanged legacy DIR-020 checklist
   write-back), not a literal per-shard dispatcher.
7. **Deterministic reconciler validates receipts before mutating checkboxes/dispositions.**
   CONFIRMED AT CONTRACT LEVEL. `composite-reconcile.ts`'s `reconcile()` gates on generation
   identity, bundle verdict, per-task verdicts, per-task gates, and a once-only milestone gate,
   returning mutations only when every check passes (atomic: one REFUTED member blocks the whole
   bundle — re-verified via `composite-reconcile.test.mjs`, 12 assertions green). Same caveat: no
   literal "Reconcile" phase exists yet in `execute-milestone.js`.
8. **Task-scoped gates run per member; milestone-scoped gates run once; failure blocks Land.**
   CONFIRMED — LIVE-WIRED, not just contract-level. This is the one Stage-2.5 requirement actually
   converted to real code: `_splitOrCommitGates = _taskIds.map((tid) => () => agent(...))` in the
   Gate phase (confirmed by reading the diff), byte-for-behavior identical to the pre-existing
   single call for a legacy singleton (same label `'split-or-commit'`, same command). Milestone-
   scoped gates (`vmeta-lag`, `dash-budget`, `tree`, `worktree`) remain single dispatches, correctly
   unchanged. `gatesFailed` still hard-blocks Land.
9. **Atomic Land: consistent task marks, one dashboard entry, one counter increment.** CONFIRMED
   AT CONTRACT LEVEL. `composite-land.ts`'s `buildLandTransaction` tested at widths 1/3/5/10
   (`counterDelta===1`, `dashboardEntryCount===1`, `taskCompletionCount===width`) and golden-replay-
   matched against `legacySingletonLandShape()`. Live Land phase's `_compositeLandNote` (empty
   string for legacy calls) instructs the same effect via prompt text — same caveat as above.
10. **Negative controls: no partial lifecycle mutation reaches master on any failure.** CONFIRMED.
    `composite-reconcile.test.mjs`/`composite-land.test.mjs`: REFUTED bundle, missing per-task
    verdict, failed task gate, missing/failed milestone gate, and stale generation identity each
    independently produce zero mutations / zero counter delta / zero dashboard entries — re-run
    green this pass.
11. **Legacy singleton golden replay stays behavior-compatible.** CONFIRMED. `composite-args.
    test.mjs`'s `legacy-normalizes`, `composite-preflight.test.mjs`'s `legacy-vacuous-pass`,
    `composite-land.test.mjs`'s explicit golden-replay assertion, plus the live workflow's
    `_primaryTaskId` being byte-identical to the pre-existing `$a.taskId` for every single-task
    call (read directly off the diff, not inferred).
12. **Mirrors + focused/full suites pass with required coverage.** CONFIRMED. `diff` shows
    `.claude/workflows/execute-milestone.js` ↔ `plugin/workflows/execute-milestone.js` and all 7
    `experiments/.../scripts/composite-*.ts` ↔ `plugin/scripts/composite-*.ts` byte-identical;
    `bash plugin/scripts/sync-vendor.sh --check` → CLEAN; `plugin/test/plugin-packaging.test.mjs`
    34/34 (12→19 script-count bump verified); `plugin/test/
    execute-milestone-disposition-conformance.test.mjs` (the M180 wiring regression guard) 16/16
    — this file's own literal Audit-phase template strings still match after DIR-119-B's edits, so
    the M180 fix was NOT silently broken by this milestone's changes. **Full canonical
    `scripts/test.sh` re-run live this audit pass: see §3 for the tally** (not merely re-cited from
    the iteration report).

## 2. DoD satisfaction

All 5 DoD items confirmed and ticked with evidence citations directly in `tasks/DIR-119-B.md`:
commit `49995b1` on `master` under `.halt`; 1/3/5/10-width + negative fixtures pass (70/70);
read-only-audit/reconcile/atomic-Land/golden-replay all green; no two-task-only or
one-auditor-per-task ceiling exists anywhere (none ever did — legacy was strictly single-task, not
two-task, and the new mechanism is exercised at widths up to 50 with zero cap found); this fresh
audit finds no REFUTATION (verdict CONCERNS, not REFUTED) and did not treat Stages 2.3-2.6's
prompt-level (not literally-invoked) wiring as a self-certification of DIR-119-C's operational-proof
scope.

## 3. Full canonical suite re-run (this audit pass, not copied from the build)

```
$ bash scripts/test.sh          # full packages/*/test + plugin/test glob, --test-concurrency=8
...
ℹ tests 537
ℹ suites 4
ℹ pass 527
ℹ fail 7
ℹ cancelled 0
ℹ skipped 3
```

Re-run live by this audit (not copied from the iteration report), end to end, on a host with other
background load. **7 failures, all independently triaged and confirmed NOT attributable to
DIR-119-B**:

- `build-dist-smoke.test.mjs` "(b) serve --port + HTTP GET returns 200" — reproduced this failure
  in a clean git worktree checked out at `49995b1~1` (M188's own landed state, before DIR-119-B
  touched anything) with the same result — **pre-existing, unrelated to this milestone**, not a
  contention flake (it fails even in isolation on this host, on both commits identically).
- `delivery-standalone-smoke-gate.test.mjs` M52 A2/C1/D1 (all 3, not just D1) — each failed with
  `acceptance timed out after 60000ms` under the full-suite's peak concurrency. Re-ran this file
  ALONE after the full suite finished: **7/7 pass clean** (`ok:true` for all three, 13-19s each).
  Contention-induced timeout flake, not a regression — none of this file's gate/script surface was
  touched by DIR-119-B.
- `ts-typecheck-gate.test.mjs` M63 A2/C1/D1 (all 3) — same `acceptance timed out after 60000ms`
  pattern. Re-ran alone: **5/5 pass clean** (10-14s each, well under the 60s budget). Same
  contention-flake diagnosis; matches the exact failure class the milestone's own iteration-0.md
  already disclosed for these two files (M52 D1, M63 A2, M63 C1) — this audit's live re-run
  additionally caught M52 A2/C1 and M63 D1 also flaking under this host's specific load at the
  time, a superset of what was disclosed, but the same root cause and the same clean-in-isolation
  resolution.

No failure touches `execute-milestone.js`, any `composite-*.ts`/`composite-*.test.mjs`, or
`plugin-packaging.test.mjs`. Independently re-ran, in isolation, the narrower canonical subsets
that most directly bear on this milestone's own changes and got clean green results reproduced
fresh:

- `node --test experiments/quay-perpetual-stream/test/composite-*.test.mjs` → **70/70 pass**
- `node --test plugin/test/plugin-packaging.test.mjs` → **34/34 pass**
- `node --test plugin/test/execute-milestone-disposition-conformance.test.mjs` → **16/16 pass**
- `bash plugin/scripts/sync-vendor.sh --check` → **CLEAN**
- `node --check .claude/workflows/execute-milestone.js && node --check plugin/workflows/execute-milestone.js` → both syntactically valid
- `diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js` → **identical**
- `diff` on all 7 `composite-*.ts` canonical↔plugin-mirror pairs → **identical**

The full-suite run (`scripts/test.sh` with no args, all `packages/*/test` + `plugin/test` files,
zero filtering) is the authoritative full-coverage evidence; its final tally is recorded in the
tool transcript for this audit session. No failure attributable to a file this milestone touched
was observed in either the narrow or full runs.

## 4. Why CONCERNS, not REFUTED — the operational-wiring boundary

The charter's own Done-when clause 3 and the task's own DoD item 5 ("operational wiring remains
assigned to DIR-119-C rather than self-certified here") explicitly draw the line this milestone is
allowed to stop at: Stage 2.2 (the composite CONTRACT/args normalization) is checked **and live-
wired** into `execute-milestone.js`'s Verify phase; Stage 2.5's task-scoped gate loop is **also
live-wired**. Stages 2.3/2.4/2.5(reconcile-proper)/2.6, however, are delivered as pure,
fixture-tested TypeScript modules (`composite-build.ts`/`composite-audit.ts`/
`composite-reconcile.ts`/`composite-land.ts`) that the live Build/Audit/Gate/Land agent prompts
*reference as guidance*, not literally invoke — because the workflow DSL genuinely has no `import`
capability, and because `docs/plans/adaptive-composite-milestone-select-and-execution.md`'s own
Phase 3 (DIR-119-C, Stage 3.3 "End-to-end execution... Verify: ... audit was read-only and
reconcile owned mutation") is explicitly where real operational wiring is proven. This audit
independently confirmed that boundary is real (not merely claimed) by reading the actual workflow
diff and confirming zero live call sites for `reconcile()`/`planPhaseExecution()`/
`runReadOnlyAuditShard()` anywhere outside their own test files. This is a disclosed, task-
DoD-sanctioned scope limit, not a hidden defect — hence CONCERNS, not REFUTED.

The second, independent finding driving CONCERNS is a real process/hygiene defect (§5): this
milestone's own build evidence was filed at the wrong `milestones/` path.

## 5. Deviation-log write-back (DIR-017 Step 3 / M36)

Two rows appended to `experiments/quay-perpetual-stream/dashboard.md`'s "Homeostatic variables"
deviation table, both `level=CONCERNS`, `status=open`, `age=0`:

1. **caught-by: machine** (this audit, this pass) — `experiments/quay-perpetual-stream/
   milestones/M189/iterations/iteration-0.md` was filed at the LEGACY milestone-evidence path
   instead of the top-level `milestones/M189/` that `gate_resolve_milestone_root(189)` (the
   single-sourced ≥130 rule) resolves to. Confirmed via `ls -d`/`git ls-files`: no top-level
   `milestones/M189/` directory existed before this audit created its own `audits/` subdirectory
   there. M185 hit the identical defect class (already logged in this same table); M186/M187/M188
   all correctly used the top-level path. Non-blocking: `it0-dod-check.sh` takes explicit
   `charterFile`/`absorbEntryFile` CLI args and does not itself resolve a milestone root, so this
   does not affect the mechanical gate's exit code (confirmed: gate exits 0 regardless).
2. **caught-by: human** — transcribing `iteration-0.md`'s own "What is explicitly NOT claimed
   here" disclosure (not originated by this audit): the build itself states no real cold
   SELECT→execute multi-task composite ran through this path this iteration, and that genuinely
   parallel agent dispatch is not yet claimed — corroborating §4's independent finding rather than
   introducing a new one.

## 6. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-119-B \
    experiments/quay-perpetual-stream/charters/M189-dir119b-composite-execution.md \
    /tmp/m189-absorb-entry.md
...
PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
$ echo $?
0
```

Exit code **0** — confirmed by this audit after (a) the checklist write-back in §1/§2 above (all
12 AC + 5 DoD boxes ticked with evidence) and (b) appending the required `adversarial-audit
disposition:` and `V_meta consolidation-lag:` lines to `/tmp/m189-absorb-entry.md` per the
disposition-append protocol (M180/gap-absorb-entry-clause-disposition-sequencing).

## 7. V_meta consolidation-lag (re-run live, not copied)

```
$ bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 187 \
    experiments/quay-perpetual-stream/v-meta-ledger.md
milestone_counter=187 K=2
  [ok] consolidated | lag=- | consolidated — lag gate does not apply | domain-audit-channel≡CI-job pattern (+ per-subcommand audit exercise)
  [ok] proposed | lag=- | proposed — not past φ threshold, no lag gate | repo-root isolation-leak lesson

PASS: no confirmed-unconsolidated row past K without a dated carry-forward
```

## 8. Verdict

**CONCERNS.** All 12 AC + 5 DoD items are genuinely, verifiably satisfied at the level the task's
own DoD item 5 permits (contract-checked + partially live-wired, with real end-to-end operational
proof explicitly and correctly deferred to DIR-119-C). Two non-blocking findings are recorded in
the deviation log (§5): a milestone-evidence path-filing defect, and a corroborating transcription
of the build's own honest scope disclosure. Neither invalidates the substantial, well-tested,
byte-verified implementation delivered here. Recommend: (a) file/fix the M189 evidence path (move
`experiments/quay-perpetual-stream/milestones/M189/iterations/iteration-0.md` to
`milestones/M189/iterations/iteration-0.md`) at the next opportunity that touches this milestone's
evidence, and (b) the next milestone that touches `execute-milestone.js`'s Build-phase prompt
should double-check it is actually invoking `gate_resolve_milestone_root` for evidence-path writes
rather than an inherited/hardcoded legacy path string (same recommendation M185's own audit already
made, still unaddressed).
