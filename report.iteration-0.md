# M37-discover-post-qeng — iteration-0 report

**Branch:** `exp5-m37-iteration-0` · **Base:** `exp5-outer-driver` @ `e4c29f5` · **Date:** 2026-07-19

## §0/§1 Preconditions and HARD GATES

- `it0-gate-hash-check.sh --by-reference` against this milestone's charter:
  ```
  PASS: experiments/quay-perpetual-stream/charters/M37-discover-post-qeng.md GATE-HASH-REF
  (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source
  (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
  ```
- manda healthz gate: **N/A this milestone** (no Web UI surface touched). Confirmed no `.manda/hub.addr`
  present in this worktree (`cat .manda/hub.addr` -> exit 1, file not found) - consistent with the
  charter's explicit N/A statement.
- Port-4173 reachability gate: **N/A this milestone** (no Web UI surface touched), per the charter.
- `it0-ceiling-line-budget-check.sh` against the charter:
  ```
  PASS: ... scope within the small-milestone norm (no declared line budget > 2000, in-scope item
  count at or under threshold 8). No phase/stage plan required.
  ```
- Worktree isolation: all edits below were made under
  `experiments/quay-perpetual-stream/milestones/M37-discover-post-qeng/worktrees/iteration-0/` only.
  `git status --short` (pasted at the end of this report) confirms zero `packages/quay*` files
  touched - survey-only, as required.

## §2. QENG gate/lifecycle engine surface - functional survey

### Method
Built a real, throwaway `.quay/config.yml` workspace at `/tmp/quay-gate-survey` pointed at this
worktree's `packages/quay-native` and `packages/quay/bin/quay.js`, then drove the CLI directly (not
just read the source) through the full lifecycle: create -> dod-gate fail -> dod-gate pass -> promote
(todo->ready) -> acceptance-gate fail-closed (no meter) -> set `--acceptance` -> `complete`
(ready->done) -> `adjudicate` -> `retreat` (done->ready->todo) -> illegal-transition probes ->
`quay run --once` / `quay run` (full driver loop, anti-spin/fixpoint behavior) -> `gate-log` query.
Also ran the two committed real fixture tasks `QENG-5-DEMO-PASS`/`QENG-5-DEMO-FAIL` directly in THIS
worktree's own `tasks/` store (not the throwaway sandbox) to independently verify `OUTER-LOOP.md`'s
own claim about the "Engine route" DoD-check invocation path. (Sandbox cleaned up before commit;
nothing under `/tmp` is part of this milestone's artifacts.)

### Module-by-module summary (what each of the 7 files does)
- `engine.js` (QENG-1) - `runGate({client,id,gate,logPath,actor})`: looks up `gate` in the registry,
  runs it against the task, appends one `GateEvent`, returns `{ok, reason, event}`. Throws on unknown
  gate / missing task (see Finding 1 below).
- `registry.js` (QENG-1/2) - `gateRegistry = {dod, acceptance}`. `dod` is a thin adapter over
  `client.taskCheck` (no duplicated gate logic - reuses `quay-native/src/store.js#check()`).
  `acceptance` reads `task.extra.acceptance`, fails CLOSED with an explicit error message if unset
  (verified live: `gate SURVEY-1 --gate acceptance` on a meter-less ready task -> `FAIL - no
  acceptance command defined...`), else runs it via `acceptance-runner.js`.
- `acceptance-runner.js` (QENG-2) - pure `runAcceptance({command,cwd,timeoutMs})` over
  `child_process.spawnSync`, mapping exit 0 -> pass, nonzero -> fail, `ETIMEDOUT` -> a distinct
  timed-out-and-killed verdict (checked FIRST, before the generic spawn-error branch).
- `gate-event-store.js` (QENG-1) - append-only JSONL `appendGateEvent`/`queryGateEvents` (AND-filter
  on pipeline_id/gate/actor/since/until, offset+limit pagination). Verified live: `.quay/
  gate-events.jsonl` accumulated one line per gate/lifecycle call across the whole survey session,
  exactly as documented, e.g.:
  ```
  {"id":"...","item_id":"SURVEY-1","pipeline_id":"SURVEY-1","gate":"dod","actor":"quay-cli",
   "verdict":"pass","timestamp":"2026-07-19T07:34:22.021Z","payload":{"reason":"all four artifacts
   present; eligible to move to ready"}}
  ```
- `gate-log.js` (QENG-1) - read-only CLI-shaped query wrapper (`resolveGateLogPath`,
  `runGateLogQuery`); default log path `<workspaceRoot>/.quay/gate-events.jsonl`.
- `lifecycle.js` (QENG-3) - `TRANSITIONS` table over `{todo,ready,done,needs-human}`
  (`needs-human` has NO automated edge in or out, verified live: both `promote` and `retreat` on a
  `needs-human` task throw `illegal transition`). `runComplete` (precondition `status==="ready"`,
  else clean exit-1 reject with NO gate run - verified live), `runAdjudicate` (read-only, always
  exit 0, logs an `audit` GateEvent - verified live, `AUDIT pass - terminal` on a done task),
  `runPromote` (todo->ready via `dod` gate; ready->done delegates to `runComplete`),
  `runRetreat` (`--reason` required, verified live: missing reason -> clean usage-error exit 1, no
  gate, no write).
- `driver.js` (QENG-4) - `isActionable` (pure predicate: `status==="ready"` AND non-empty
  `extra.acceptance` - the anti-spin gate), `scanActionable` (subtracts `seen`, sorts ascending),
  `runOnce` (single observation, resets exit code to 0 always per `bin/quay.js`'s own inline
  comment), `runLoop` (sentinel-file / fixpoint / cap(1000) stops). **Anti-spin behavior verified
  live**: a 2-task board (one `ready` task with a real FAILING acceptance meter `false`, one `ready`
  task with NO meter at all) run through `quay run` (full loop) reached a clean `fixpoint` after
  exactly 1 iteration - the meter-less task was correctly skipped (never selected) and the failing
  task was attempted exactly once (added to `seen`), NOT spun on forever. Real output:
  ```
  $ node bin/quay.js run
  FAIL - acceptance failed (exit 1)
  run: 0 completed in 1 iters (stop=fixpoint)
  ```

### End-to-end `quay gate <task>` / `quay complete` verification (charter's primary AC)
Full real command transcript (abridged, full JSONL log inspected too):
```
$ node bin/quay.js task create SURVEY-1 --title "survey task" --status todo --body-file <proposal/plan/AC/DoD>
$ node bin/quay.js task check SURVEY-1
SURVEY-1: PASS - all four artifacts present; eligible to move to ready
$ node bin/quay.js promote SURVEY-1
PROMOTE todo -> ready
$ node bin/quay.js gate SURVEY-1 --gate acceptance      # no meter set yet
FAIL - no acceptance command defined (set with `quay task edit <id> --acceptance '<cmd>'`)
$ node bin/quay.js task edit SURVEY-1 --acceptance "true"
$ node bin/quay.js complete SURVEY-1
PASS - status=done
$ node bin/quay.js task view SURVEY-1 | head -1
SURVEY-1: survey task [done]
```
And the real committed demo fixtures, run directly in THIS worktree's own tasks store (not the
sandbox), independently corroborating `OUTER-LOOP.md`'s "Engine route" sub-note:
```
$ node packages/quay/bin/quay.js gate QENG-5-DEMO-PASS
PASS
$ echo $?
0
$ node packages/quay/bin/quay.js gate QENG-5-DEMO-FAIL
FAIL - acceptance failed (exit 1)
$ echo $?
1
```
Both match `OUTER-LOOP.md`'s claimed behavior exactly ("`quay gate QENG-5-DEMO-PASS` -> exit 0;
`quay gate QENG-5-DEMO-FAIL` -> exit 1"), independently reproduced, not taken on faith.

### Independent coverage verification (charter's "do not take TDD/cov 100% on faith" AC)
Only 2 of the 4 QENG commits explicitly claim "cov 100%" in their subject line
(`git log --oneline -- packages/quay/src/gate`):
```
e2e6726 QENG-4: quay run driver - autonomous loop as code (TDD, cov 100%)
f0decb4 QENG-3: complete/adjudicate/promote/retreat lifecycle (TDD, cov 100%)
d33a834 QENG-2: AC-as-runnable-meter - quay gate runs task.extra.acceptance
7a9474e QENG-1: gate engine + GateEvent log (port epicd engine layer to quay JS)
```
Ran the real test files with Node's built-in coverage instrumentation, not a restatement:
```
$ node --test --experimental-test-coverage packages/quay/test/lifecycle.test.mjs \
    packages/quay/test/driver.test.mjs packages/quay/test/gate.test.mjs \
    packages/quay/test/acceptance.test.mjs
tests 89 | pass 89 | fail 0
...
file                       | line %  | branch % | funcs %
 gate/acceptance-runner.js | 100.00  | 100.00   | 100.00
 gate/driver.js            | 100.00  | 100.00   | 100.00
 gate/engine.js            | 100.00  | 100.00   | 100.00
 gate/gate-event-store.js  | 100.00  | 100.00   | 100.00
 gate/gate-log.js          | 100.00  |  75.00   | 100.00
 gate/lifecycle.js         | 100.00  |  97.44   | 100.00
 gate/registry.js          | 100.00  | 100.00   | 100.00
```
**Verdict: the "cov 100%" claim is confirmed for LINE and FUNCTION coverage on all 7 files (real
independent measurement, not restated).** BRANCH coverage is NOT 100% on 2 files (`gate-log.js`
75%, `lifecycle.js` 97.44%) - the commit messages say "cov 100%" without specifying which metric;
taken literally against branch coverage this is a minor overstatement, though line/func coverage
(the more commonly implied meaning of a bare "cov 100%" claim, and what QENG-3's own commit message
explicitly spells out as "100% line / 97.44% branch / 100% funcs") is genuinely 100%. Not flagged as
a new candidate task (too minor, self-disclosed accurately in QENG-3's own longer commit body) but
noted here per the charter's "independently verify, don't take on faith" instruction.

Ran the full regression suite (`node --test packages/quay/test/*.test.mjs`, 123 tests total across
all files): 121 pass, 2 fail - both in `provider-abi-conformance.test.mjs` and `serve-github.test.mjs`,
confirmed via isolated re-run to be live-GitHub-network-dependent tests unrelated to the `gate/`
surface (both pass cleanly when run alone/not in a large parallel batch - a pre-existing environmental
flakiness class, not a QENG regression). No `gate`/`lifecycle`/`driver`/`acceptance` test failures at
any point.

### New findings from live exercise (feeding the candidate tasks below)
1. **Guarded-error UX inconsistency**: `promote`/`retreat`'s illegal-transition throws and `gate`'s
   unknown-gate/missing-task throws surface a raw multi-line Node stack trace to the user (verified
   live for all 4 cases: `retreat <todo-task>`, `promote <done-task>`, `gate --gate bogus`,
   `gate <nonexistent-id>`), unlike `complete`'s clean one-line message on its analogous
   not-ready-precondition-reject path. Deliberate per `bin/quay.js`'s own comment, but inconsistent
   UX. -> `exp5-M-GATE-CLI-ERROR-UX`.
2. **`quay run` (non-`--once`) exit-code leak**: a `fixpoint` stop that included ANY failed task along
   the way inherits exit 1 (leaked from the last `runComplete` failure inside `runLoop`), even though
   the handler's own inline comment says only the `cap` ceiling should be nonzero. Verified live with
   a controlled before/after (mixed-fail board -> exit 1; all-pass board -> exit 0, same code path).
   -> same task, `exp5-M-GATE-CLI-ERROR-UX`.
3. **`--help` synopsis omission**: `quay gate <id>` and `quay gate-log <id>` are entirely absent from
   the top-level `Usage:` block (`grep -c "^  quay gate" <(quay --help)` -> `0`), unlike every other
   QENG-era command, which all get an explicit synopsis line. -> `exp5-M-GATE-HELP-SYNOPSIS-GAP`.
4. **README.md has zero QENG-surface documentation**: `grep -n "quay gate\|quay complete\|quay
   promote\|quay retreat\|quay adjudicate\|quay run\b\|gate-log" packages/quay/README.md` -> 0 matches
   over 276 lines. Distinct from the already-closed exp4-era DOC-001..005 (none of which covered this
   surface - that work postdates DOC-001..005's closure). -> `exp5-M-GATE-README-DOCS`.
5. **MCP tool-surface gap**: `packages/quay/src/mcp-server.js` registers exactly 6 tools
   (`task_list/get/write/check`, `action_list/run` - confirmed via `grep -n
   "server.registerTool("`, 6 call sites), none of the 7 QENG commands. Independently corroborated by
   this very session's own available `mcp__quay__*` tool set (`action_list, action_run, task_check,
   task_get, task_list, task_write` - exactly the 6 pre-QENG tools). An AI agent driving quay through
   MCP (the primary mode this whole BAIME apparatus runs in) cannot reach the gate/lifecycle/driver
   engine at all. -> `exp5-M-GATE-MCP-PARITY-GAP`.

## §3. STALE-row re-triage

All 3 STALE rows re-examined against CURRENT state (not just re-reading the backfill-era text), each
disposition written directly into the task file itself as a new timestamped append (see
`tasks/exp5-M-CLI-UX.md`, `tasks/exp5-M-DIRTASK.md`, `tasks/exp5-M-DOCS.md` diffs).

| Row | Disposition | Current-state reason |
|---|---|---|
| `exp5-M-CLI-UX` | **CONFIRMED STILL STALE** | UQ-042..046 (this row's own named scope) independently re-verified closed (`gap-list.md`, exp4 it15, QX-058/059), zero reopening. No live CLI-UX scope remains under this row's own title. (New, unrelated CLI-UX gaps found in the QENG surface this milestone are captured as their own fresh tasks, not folded into this dead row.) |
| `exp5-M-DIRTASK` | **CONFIRMED STILL STALE, with a citation correction** | The row's own "Source" field mis-cites exp5's `DIR-006` (which is actually about Web-UI browser-verification, confirmed via `git log -- tasks/DIR-006.md`) - the real "Option B: files canonical" resolution lives in exp4-lineage `tasks/DIR-004.md`, citing EXPERIMENT-4's own differently-numbered DIR-006. Underlying policy question is doubly resolved regardless: (a) `DIR-004`'s own text confirms files-canonical, and (b) exp5's own `DIR-009` directive independently confirms the file-canonical projection mechanism is not just decided but ALREADY LIVE and self-hosting (`tasks/DIR-*.md` are today's machine-regenerated projections, drift-checked by `it0-dir-projection-check.{sh,mjs}`). Disposition unchanged but now more strongly grounded. |
| `exp5-M-DOCS` | **CONFIRMED STILL STALE** | DOC-001..005 (this row's own named scope) independently re-verified closed (`gap-list.md`, exp4 it19, QX-066), zero reopening. No live docs scope remains under this row's own title. (A fresh, genuine, currently-live docs gap - the QENG surface's total absence from README.md - is captured as its own new task, `exp5-M-GATE-README-DOCS`, not folded into this dead row.) |

No row was un-staled - all 3 rows' own named scopes are genuinely, verifiably dead. The charter's
concern (folding in a cheap re-triage alongside the QENG survey) surfaced one real correction (the
DIR-006/DIR-004 citation mix-up in `exp5-M-DIRTASK`) that would otherwise have propagated forward
uncorrected.

## §4. `it0-*` vs. `quay gate` recommendation

**Recommendation: remain independent-and-parallel (the current state), NOT unified, for now - with
the following reasoning and tradeoffs stated explicitly.**

The two systems check fundamentally different THINGS at different GRANULARITIES, not the same thing
through two doors:
- **`it0-dod-check.sh`/`.mjs`** (DIR-017/M25/M32) is a **milestone-level, ABSORB-time** prose-
  discipline checker. It asks: "does THIS milestone's ABSORB-entry text contain an explicit
  disposition statement for each of 8 named DoD clauses (adversarial-audit, V_meta-lag, line-budget,
  impl-row, no-self-exemption, escrow-Delta-v, test-floor)?" Several of its clauses are explicitly
  documentation-discipline checks BY DESIGN (per its own header comment) - it does NOT recompute
  `v-meta-ledger.md` math, does NOT re-run the adversarial-audit subagent, does NOT independently
  verify a claimed test-coverage percentage. It operates over the EXPERIMENT's own governance
  artifacts (`charters/*.md`, `dashboard.md` ABSORB entries), not over a `quay` task's body.
- **`quay gate dod`** (QENG-1, thin wrapper over `quay-native/src/store.js#check()`) is a
  **per-task, any-time** mechanical artifact-presence + AC-checkbox-state checker. It asks: "does
  THIS task's markdown body have `## Proposal`/`## Plan`/`## AC`/`## DoD` sections with >=40
  non-whitespace chars each, and (status-dependent) are the AC checkboxes present/all-checked?" It
  knows nothing about V_meta-lag, line-budgets, escrow-Delta-v, or adversarial-audit dispositions -
  those concepts don't exist at the `quay` task-schema level at all.

**The one place they DO already meet is exactly the "Engine route" sub-note `OUTER-LOOP.md` already
carries** (independently re-verified this milestone via the `QENG-5-DEMO-PASS`/`-FAIL` fixtures): a
milestone's own tracking task can set `extra.acceptance` = the literal `it0-dod-check.sh <id>
<charter> <absorb>` shell invocation, making `quay gate <milestone-task>` / `quay complete
<milestone-task>` an EXECUTABLE, machine-logged (GateEvent-backed) wrapper AROUND the existing
`it0-dod-check.sh` check - not a replacement or a competing reimplementation of its logic.
`it0-dod-check.sh` remains the authority on WHAT the 8 DoD clauses are and how they're evaluated;
`quay gate`/`quay complete` is simply a more legible, auditable, GateEvent-logged INVOCATION path for
running that same script and recording the verdict, alongside the equally-valid bare-shell-call path.

Tradeoffs of the three options considered:
- **(chosen) Remain independent-and-parallel**: zero migration risk to the existing, working,
  already-battle-tested `it0-dod-check.mjs` (561 lines, 8 clauses, exercised at every milestone's
  ABSORB for many milestones running); the QENG engine route is available OPPORTUNISTICALLY (any
  milestone's tracking task CAN set `extra.acceptance` to route its own DoD check through `quay
  gate`, as `OUTER-LOOP.md` already documents) without forcing every milestone to adopt it, and
  without the it0-scripts family needing to be rewritten as `quay` gate functions. Cost: two
  documented but textually separate places a future reader needs to know about (`it0-dod-check.sh`'s
  own header, `OUTER-LOOP.md`'s Engine-route sub-note) to understand the full picture - a real but
  modest documentation-discoverability cost, not a correctness risk (the underlying check is the
  SAME script either way, so there is no risk of the two paths drifting apart in what they verify).
- **Unify (migrate `it0-dod-check.mjs`'s 8-clause logic INTO `packages/quay/src/gate/registry.js` as
  a new named gate)**: would give every milestone's DoD check a first-class `quay gate dod-clauses
  <milestone-task>` invocation with no `extra.acceptance` shell-out indirection, and a real
  `GateEvent` per clause rather than one aggregate acceptance-command verdict. But it would require
  porting 561 lines of experiment-specific (exp5-only) governance logic into `packages/quay`'s
  general-purpose, provider-agnostic Core package - a real architectural layering violation (`quay`
  Core has no concept of "milestones", "ABSORB entries", or "V_meta ledgers"; those are entirely
  exp5-experiment-specific concepts that do not belong in a package meant to serve arbitrary quay
  users/providers). This option is NOT recommended for that reason - it would couple a
  general-purpose tool to one specific experiment's governance model.
- **Fully deprecate `it0-dod-check.sh` in favor of `extra.acceptance` shell-outs everywhere**: this is
  effectively what the Engine route ALREADY does opportunistically - there is no additional
  "unification" step available beyond what's already documented, since the acceptance meter's whole
  design point (QENG-2) is exactly "wrap an arbitrary existing shell check, don't reimplement it."
  Not a distinct third option in practice, just a restatement of the chosen path taken to its logical
  conclusion (which is already where things stand).

**Net: no action recommended.** The current state (independent-and-parallel with the existing
opportunistic Engine-route bridge) is architecturally correct, not merely inertia - the alternative
(porting DoD-clause logic into Core) would be a real coupling regression. This is stated as a
reasoned confirmation of the status quo, not a bare opinion.

## §5. New candidate tasks authored (4 - within the 2-6 range; no busywork manufactured)

1. **`exp5-M-GATE-CLI-ERROR-UX`** - raw stack traces on `promote`/`retreat`/`gate`'s guarded-error
   paths (vs. `complete`'s clean messages), plus `quay run`'s exit-code leak on a fixpoint stop that
   included a failed task. Both findings live-reproduced with before/after transcripts.
2. **`exp5-M-GATE-HELP-SYNOPSIS-GAP`** - `quay gate`/`quay gate-log` entirely missing from the
   top-level `--help` Usage synopsis block, unlike every sibling QENG-era command.
3. **`exp5-M-GATE-README-DOCS`** - `packages/quay/README.md` has zero mentions of the entire
   QENG-1..4 CLI surface; a real, currently-shipped command family invisible to a README-only reader.
4. **`exp5-M-GATE-MCP-PARITY-GAP`** - none of the 7 QENG commands are exposed as MCP tools; only the
   6 pre-QENG tools exist, independently corroborated via this session's own live MCP tool
   inventory. An architectural gap, not a 1-line fix - the task asks for a reasoned scoping decision,
   not a blanket port.

Did NOT author a 5th/6th task for: the `gate --list`/`gate-log <id>` positional-vs-flag documentation
micro-gap (folded into finding 3's task as part of the synopsis fix, not separately significant
enough to be its own row); the branch-coverage-vs-line-coverage "cov 100%" phrasing looseness noted
in Section 2 (self-disclosed accurately in QENG-3's own longer commit body - a real but too-minor
finding to warrant a milestone-candidate row on its own). The survey found exactly 4 genuinely
distinct, independently-justified gaps, not manufactured to hit a target count.

## §6. Reflection

- What worked: exercising the CLI directly in a real (if throwaway) workspace surfaced 2 genuine
  runtime findings (error-UX inconsistency, exit-code leak) that reading the source code alone would
  not have surfaced with the same confidence - both required actually running multi-step CLI
  sequences and observing real exit codes/output, not just reading `runComplete`/`runLoop`'s bodies.
- The STALE-row re-triage surfaced one real, non-trivial correction (the `exp5-M-DIRTASK` row's
  DIR-006/DIR-004 citation mix-up) that a pure "still looks stale, move on" pass would have missed -
  worth the cheap cost the charter predicted.
- Coverage-claim verification was straightforward with Node's built-in `--experimental-test-coverage`
  flag; confirms the QENG commits' claims hold at the line/func level, with one minor,
  self-disclosed-elsewhere branch-coverage nuance.

## Artifacts / evidence trail
- `git status --short` (this worktree, vs. base `e4c29f5`) at report-authoring time:
  ```
   M tasks/exp5-M-CLI-UX.md
   M tasks/exp5-M-DIRTASK.md
   M tasks/exp5-M-DOCS.md
  ?? tasks/exp5-M-GATE-CLI-ERROR-UX.md
  ?? tasks/exp5-M-GATE-HELP-SYNOPSIS-GAP.md
  ?? tasks/exp5-M-GATE-MCP-PARITY-GAP.md
  ?? tasks/exp5-M-GATE-README-DOCS.md
  ?? report.iteration-0.md
  ```
  Zero `packages/quay*` files touched (confirmed via `git status --short`, discovery/survey-only, no
  product-file modification, matching the charter's explicit scope constraint).
