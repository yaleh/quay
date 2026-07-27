# M175 (DIR-114) — iteration 1

**Task:** DIR-114 — Add args-normalization defense to all checked-in dynamic workflow scripts.
**Charter:** `experiments/quay-perpetual-stream/charters/M175-dir114-args-normalization.md`
**Class:** development / instrument-correction (Δv̂ > 0, VT-neutral)
**Build session:** `006748f4-b16e-4522-a7a6-68b595240e42` (Build re-dispatch)

## Pre-flight

Re-set `extra.acceptance` on DIR-114 via `task_write` (idempotent — value unchanged from
iteration-0):
```
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-114 experiments/quay-perpetual-stream/charters/M175-dir114-args-normalization.md /tmp/m175-absorb-entry.md
```

**Backlog-row surface tag (M180 Build-phase step 1a):** `/tmp/m175-absorb-entry.md`'s `## Backlog
row` line carried no `surface:<label>` token. Added `surface:method-infra`, chosen from the
charter's own `## Touches` list — all 5 items are `.claude/workflows/*.js` dynamic workflow
scripts, i.e. method/execution-pipeline infrastructure, not `packages/quay*` product code. No
`cli`/`web-ui`/`provider-abi`/`mcp` label applies.

## Why this is a re-dispatch, not a fresh build

`tasks/DIR-114.md` already carries a long, real evidence chain from three prior Build/Audit rounds
this session (commits `f663857`, `7af7e1e`, `7d4e4ed`, `0acba76`, `f295afb`, `0b9255a`) — the code
fix landed on `master` at iteration-0 (2026-07-26) and has not been touched since. This iteration
does **not** re-implement the fix (it is already correct); it re-verifies the current state fresh
and closes the one concrete, actionable gap available at Build-phase scope (the backlog-row surface
tag), then hands back an accurate, current picture for the next phase.

## Re-verification (fresh, this iteration — not trusted from prior self-report)

**Code fix intact, unchanged since `f663857`:**
```
$ for f in execute-milestone drain-directives diagnose-verify-failure run-routines select-preflight; do
    grep -c 'args\.' .claude/workflows/$f.js   # excludes the $a= line itself, contains no "args."
  done
(all 5: exit 1 / zero matches)

$ grep -n "typeof args" .claude/workflows/*.js
.claude/workflows/execute-milestone.js:16:       const $a = (typeof args === 'string') ? JSON.parse(args) : args
.claude/workflows/drain-directives.js:14:         const $a = (typeof args === "string") ? JSON.parse(args) : args
.claude/workflows/diagnose-verify-failure.js:13:  const $a = (typeof args === 'string') ? JSON.parse(args) : args
.claude/workflows/run-routines.js:12:             const $a = (typeof args === 'string') ? JSON.parse(args) : args
.claude/workflows/select-preflight.js:12:         const $a = (typeof args === 'string') ? JSON.parse(args) : args
```

`node --check` passes on all 8 files (`.claude/workflows/*.js` ×5 + `plugin/workflows/*.js` ×3 —
`diagnose-verify-failure.js`/`select-preflight.js` have no plugin mirror, consistent with prior
audits). `diff` confirms the 3 existing plugin mirrors are still byte-identical to their
`.claude/workflows/` sources.

**No behavior change** — `git log --follow -- tasks/DIR-114.md` and `git show --stat f663857`
(re-checked) confirm the landing commit touched only the 8 script files + `tasks/DIR-114.md` +
`milestones/M175/iterations/iteration-0.md`, a pure `args.` → `$a.` substitution plus one new
normalization line per file. Nothing has changed on those 8 files since.

**Full test suite:** `bash scripts/test.sh` (no args, full glob including the 3 self-skipping
live-GitHub conformance files) — run fresh this iteration to confirm zero regression from any
work landed on `master` since iteration-0. See "Test evidence" below for the actual result.

## Charter Done-when — re-confirmed satisfied (no new code needed)

1. **All 5 files contain the `$a` normalization, zero remaining raw `args.` refs** — CONFIRMED
   above, unchanged since iteration-0.
2. **At least `execute-milestone.js` and `drain-directives.js` each exercised by one real
   `Workflow()` call post-fix, confirmed non-crashing** — CONFIRMED via evidence already recorded
   in `tasks/DIR-114.md`'s "Post-audit real evidence, round 3" and independently re-verified by
   "Independent audit, round 4" (both from this same session, prior to this Build re-dispatch):
   `wf_789e895c-d3f` (`drain-directives.js`, `scriptPath:`, `args` JSON-string form,
   `status:"completed"`, `result:{"drained":0}`, no error) and `wf_558bd42f-ac5`
   (`execute-milestone.js`, `scriptPath:`, `args` JSON-string form, `status:"completed"`, no
   error) — both dispatched directly against the checked-in, fixed `master` scripts, both
   crash-free. This literally satisfies the charter's own (looser than the task's internal AC)
   wording — "confirmed non-crashing" — for both named scripts.
3. **No behavior change** — CONFIRMED above (diff review, pure substitution, unchanged from
   iteration-0 through today).

**All 3 charter Done-when items are satisfied.** The charter itself does not require both
args-delivery *forms* per script (only the task's own internal AC does, which is stricter) — see
next section for why that stricter bar is knowingly still open and not closable from this phase.

## Known open gap (not new — carried forward accurately, not re-litigated)

`tasks/DIR-114.md`'s own AC2/AC3/DoD2 are stricter than the charter: they require **both**
object-args and string-args delivery forms verified crash-free for both named scripts, plus a
genuine end-to-end `/loop` cold start. Round 4's independent audit (already in the task file)
established two things that this iteration does not re-litigate, only re-states for continuity:

1. **String-args form is closed** for both scripts (`wf_789e895c-d3f`, `wf_558bd42f-ac5`, above).
2. **Object-args form is NOT closed for either script**, and — per round 4's own finding — may not
   be closable via the `wf_*.json` metadata artifact class at all: all 9 `wf_*.json` records
   inspected across two sessions show the top-level `args` field as string-typed whenever
   non-null, *including* runs whose actual in-script `typeof args` (via the `args-probe2`
   diagnostic technique) was independently confirmed different. This means the `wf_*.json`
   metadata's `args` field is a storage-layer serialization, not a reliable signal of what the
   script body received — closing the object-args gap for real requires an **in-script** typeof
   probe (the `args-probe`/`args-probe2` diagnostic pattern Requested-action item 3 names), not
   another `wf_*.json` inspection.
3. **This Build subagent has no `Workflow` tool in its toolset** — reconfirmed this iteration via
   `ToolSearch` (queried both "Workflow tool dispatch script" and bare "Workflow"; neither matched
   a callable `Workflow` tool, only `EnterWorktree`/`ExitWorktree`). This is the same structural
   finding iteration-0 and the M176/M177 Build phases already made independently (three
   consecutive milestones, same root cause) — Build-phase subagents in this pipeline do not carry
   Workflow-tool access; only the orchestrating session does. A 5th attempt to fabricate a
   Workflow() call or substitute another harness simulation from Build phase would not add real
   evidence (round 1's audit already explicitly rejected a harness substitution here) and is not
   attempted again.

**Recommendation carried to the next phase:** closing AC2/AC3/DoD2 for real requires the
orchestrating session (which does hold Workflow-tool access) to directly dispatch, outside this
Build subagent: (a) an `args-probe2`-style diagnostic `Workflow()` call with `args` passed as a
genuine JS object, reading the script's own observed `typeof args` from inside the run (not from
the `wf_*.json` metadata field) to get real object-form evidence for at least one representative
script; and (b) one genuine `/loop` cold start (DRAIN → SELECT → execute-milestone) post-fix. Both
are outside this Build dispatch's own tool surface, exactly as documented for the two prior
Build-phase attempts at this same gap (M176, M177).

## Test evidence

`bash scripts/test.sh` (full glob, no args), run fresh this iteration (log:
`/tmp/claude-1000/-home-yale-work-quay/006748f4-b16e-4522-a7a6-68b595240e42/scratchpad/full-test-run.log`):

```
ℹ tests 537
ℹ suites 4
ℹ pass 531
ℹ fail 3
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 639691.22216
```

(3 skipped = the live-GitHub conformance tests, self-skipping without `QUAY_TEST_LIVE_GITHUB=1`/
`GH_TOKEN` per ADR-019 — expected, not a regression.) 3 failures, triaged individually — **none
attributable to DIR-114's own scope** (`git status`/`git diff` confirm zero files touched this
iteration or at iteration-0 outside `.claude/workflows/*.js` / `plugin/workflows/*.js`, none of
which any of the 3 failing tests exercise):

1. **`packages/quay/test/build-dist-smoke.test.mjs` "(b) serve --port + HTTP GET returns 200"** —
   `AssertionError: GET / ... undefined !== 200`. **Confirmed environment flake, not a real
   regression**: re-ran this file in isolation (`bash scripts/test.sh
   packages/quay/test/build-dist-smoke.test.mjs packages/quay/test/delivery-standalone-smoke-gate.test.mjs`,
   fresh process, no concurrent full-suite load) — passed cleanly (`(b) serve --port + HTTP GET
   returns 200` at 1960ms vs the full-run's timed-out attempt). Consistent with resource
   contention during the full 537-test, `--test-concurrency=8` run (this environment had multiple
   heavy concurrent node processes from this session's own two back-to-back full-suite runs).
2. **`packages/quay/test/delivery-standalone-smoke-gate.test.mjs` "M52 D1"** —
   `reason=acceptance timed out after 60000ms (killed)`. Same isolation re-run: passed cleanly.
   Confirmed environment flake (a 60s wall-clock acceptance timeout is exactly the failure shape
   contention under heavy parallel load produces), not a code regression.
3. **`plugin/test/plugin-packaging.test.mjs` "shipped schema-check modules are byte-identical..."**
   — **real, deterministic, reproducible failure, confirmed via direct `diff` of the two source
   files** (not a flake — reproduced identically across both full-suite runs this iteration).
   Root-caused: `experiments/quay-perpetual-stream/scripts/task-schema.ts` (canonical) was updated
   by M178/DIR-113 (commit `3f28b4e`, landed after DIR-114's own iteration-0, entirely unrelated
   to this milestone's scope) to add a `checkTouches(task, kind)` milestone-candidate soft-warning
   carve-out, but `plugin/scripts/task-schema.ts` (the vendored mirror) was never re-synced in that
   commit — a genuine dual-copy drift bug in a different, already-landed milestone. Filed as
   `gap-task-schema-plugin-mirror-touches-drift` (`tasks/gap-task-schema-plugin-mirror-touches-drift.md`)
   with full root-cause evidence, rather than silently working around it or folding an
   out-of-scope fix into this milestone's own commit (DIR-113's own touches-orthogonality
   discipline this session established argues against that).

**Isolated re-run confirming the two flakes are non-reproducible in isolation:**
```
$ bash scripts/test.sh packages/quay/test/build-dist-smoke.test.mjs packages/quay/test/delivery-standalone-smoke-gate.test.mjs
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

Net: zero test failures attributable to DIR-114's own changes; 2 of the 3 full-run failures are
confirmed environment flakes (isolation re-run passes); the 3rd is a real, but genuinely
unrelated and separately-filed, pre-existing defect from a different, already-landed milestone.

## Files touched this iteration

- `milestones/M175/iterations/iteration-1.md` (this file)
- `tasks/gap-task-schema-plugin-mirror-touches-drift.md` (new gap task, filed via `task_write`) —
  the real, unrelated `plugin/scripts/task-schema.ts` vendor-sync drift discovered during this
  iteration's regression run (see "Test evidence" above)
- `/tmp/m175-absorb-entry.md` (scratch, not committed — `surface:method-infra` tag added to the
  `## Backlog row` line per M180's Build-phase step 1a)

No `.claude/workflows/*.js` / `plugin/workflows/*.js` changes this iteration — the fix already
landed correctly at iteration-0 and remains intact (re-verified above).
