# M37-discover-post-qeng — iteration-1 report

Independent-verification discipline observed: this iteration did not read or reference any
"iteration-0" materials for this milestone.

## Section 0. Preconditions / HARD GATES

    $ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference \
        experiments/quay-perpetual-stream/charters/M37-discover-post-qeng.md
    PASS: experiments/quay-perpetual-stream/charters/M37-discover-post-qeng.md GATE-HASH-REF
    (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source
    (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.

manda healthz gate and port-4173 reachability gate: N/A this milestone, as explicitly stated in
the charter's HARD GATES section ("no Web UI surface touched"). Confirmed no `.manda/hub.addr` file
present in this worktree; port 4173 happened to return `200` (a stale server from another worktree /
prior session) but this is irrelevant to a discovery milestone that touches no Web UI code -- recorded
for completeness only, not treated as a live gate for this milestone's own work.

Worktree branch: `exp5-m37-iteration-1`, based on `exp5-outer-driver` HEAD at charter time (`e4c29f5`
per the charter's own citation; confirmed via the worktree's `git log`).

## Section 1. QENG surface survey -- what I ran, and what it showed

### 1.1 Module inventory (read + confirmed live)

`packages/quay/src/gate/` -- 7 files, 659 lines total (`wc -l`):

- `engine.js` (46 lines): `runGate({client, id, gate, logPath})` -- looks up `gateRegistry[gate]`,
  runs it against `client.taskGet(id)`, appends one GateEvent, returns `{ok, reason, event}`. Unknown
  gate / missing task both `throw`.
- `registry.js` (51 lines): `gateRegistry = { dod, acceptance }`. `dod` is a thin adapter over
  `client.taskCheck(id)` (no duplicated gate logic, reuses `store.js#check()`). `acceptance` reads
  `task.extra.acceptance`, fails closed if unset/empty, else runs it via `runAcceptance`.
- `acceptance-runner.js` (66 lines): `runAcceptance({command, cwd, timeoutMs})` -- pure `spawnSync`
  wrapper, maps exit code / timeout / spawn-error to `{ok, reason, code, signal, timedOut}`.
- `lifecycle.js` (216 lines): `TRANSITIONS` state machine (`todo->ready->done`, `needs-human`
  isolated) + `runComplete`/`runAdjudicate`/`runPromote`/`runRetreat`. `runComplete` is the one
  gate-guarded path to `done` (precondition `status==="ready"`, runs the `acceptance` gate, CAS write
  via `expectedStatus`).
- `driver.js` (130 lines): `isActionable` (pure predicate: `status==="ready"` AND non-empty
  `extra.acceptance`), `scanActionable` (sorted, `seen`-subtracted scan), `runOnce` (one observation),
  `runLoop` (bounded loop to fixpoint/sentinel/cap=1000).
- `gate-event-store.js` (88 lines): Append-only JSONL `GateEvent` log (`appendGateEvent`/
  `queryGateEvents`), ported from epicd.
- `gate-log.js` (62 lines): Read-only CLI query wrapper over `gate-event-store.js`.

CLI wiring confirmed by reading `packages/quay/bin/quay.js`: 6 verb-less top-level commands (`gate`,
`gate-log`, `complete`, `adjudicate`, `promote`, `retreat`) plus `run` (`--once` / bounded loop).

### 1.2 Direct exercise (not just reading code)

    $ node packages/quay/bin/quay.js gate --list
    dod
    acceptance

    $ rm -f .quay/gate-events.jsonl
    $ node packages/quay/bin/quay.js gate QENG-5-DEMO-PASS
    PASS
    $ echo $?
    0
    $ node packages/quay/bin/quay.js gate QENG-5-DEMO-FAIL
    FAIL -- acceptance failed (exit 1)
    $ echo $?
    1
    $ cat .quay/gate-events.jsonl
    {"id":"cc8a5a1e-...","item_id":"QENG-5-DEMO-PASS","pipeline_id":"QENG-5-DEMO-PASS","gate":"acceptance","actor":"quay-cli","verdict":"pass","timestamp":"2026-07-19T07:33:51.659Z","payload":{"reason":"acceptance passed (exit 0)"}}
    {"id":"8733e7ab-...","item_id":"QENG-5-DEMO-FAIL","pipeline_id":"QENG-5-DEMO-FAIL","gate":"acceptance","actor":"quay-cli","verdict":"fail","timestamp":"2026-07-19T07:33:52.534Z","payload":{"reason":"acceptance failed (exit 1)"}}

Both fixture tasks' `extra.acceptance` commands (`bash .../it0-dod-check.sh M98-fake-compliant ...` /
`M99-fake-violating ...`) actually ran through the real `runAcceptance` `spawnSync` path -- the
AC-as-runnable-meter mechanism genuinely executes `task.extra.acceptance`, confirmed by direct
observation of the process exit codes and the resulting GateEvent verdicts, not just by reading the
registry code.

**Self-hosting fixpoint claim, re-checked:** QENG-0's epic body claims "Self-hosting fixpoint:
`quay gate QENG-1` runs quay's own gate on quay's own porting task and goes green (verified)." I
re-ran this exact command:

    $ node packages/quay/bin/quay.js gate QENG-1
    FAIL -- no acceptance command defined (set with `quay task edit <id> --acceptance '<cmd>'`)

This is NOT a contradiction once the CLI's default-gate behavior is understood: QENG-2 changed
`quay gate`'s CLI-layer default gate from `dod` to `acceptance` (confirmed at `bin/quay.js`, comment
"default gate is `acceptance` at the CLI layer only"). `QENG-1` (the task) carries no
`extra.acceptance` field -- it is a `dod`-gated task, not an acceptance-metered one. Running with the
gate QENG-0's own claim actually refers to:

    $ node packages/quay/bin/quay.js gate QENG-1 --gate dod
    PASS

confirms the claim is TRUE as originally scoped (the `dod` gate, QENG-1's own AC2 test). However,
while probing this I found the flag-ordering form of the same invocation is broken:

    $ node packages/quay/bin/quay.js gate --gate dod QENG-1
    Error: no such task: --gate
        at runGate (.../packages/quay/src/gate/engine.js:32:20)
        ...

This is a real, reproducible defect -- see section 1.4 and the new candidate task
`exp5-M-GATE-CLI-ARG-ORDER`.

**Driver (`quay run`) exercised directly:**

    $ node packages/quay/bin/quay.js run
    FAIL -- acceptance failed (exit 1)
    PASS -- status=done
    run: 1 completed in 2 iters (stop=fixpoint)

`QENG-5-DEMO-PASS` advanced `ready->done`; `QENG-5-DEMO-FAIL` was attempted once, recorded a fail
GateEvent, and correctly stayed `ready` (anti-spin `seen` mechanism, confirmed live). I reverted this
task-state mutation afterward (`git checkout -- tasks/QENG-5-DEMO-PASS.md`; `.quay/gate-events.jsonl`
is gitignored and was cleared) since the charter scopes this milestone as survey-only -- see
`git diff --stat` in section 4, which shows zero product/fixture-file diffs from this survey activity.

### 1.3 Independent test-coverage verification (not taken on faith)

    $ node --test test/gate.test.mjs test/driver.test.mjs test/lifecycle.test.mjs test/acceptance.test.mjs
    ...
    tests 89
    pass 89
    fail 0
    cancelled 0
    skipped 0
    duration_ms 29755.087175

(The one "Error: illegal transition: done cannot forward" stack trace visible in the raw output is
EXPECTED test output from a deliberate illegal-transition test case, not a failure -- confirmed by the
adjacent pass line for that same test and the final 89/89/0-fail summary.)

    $ node --test --experimental-test-coverage test/gate.test.mjs test/driver.test.mjs \
        test/lifecycle.test.mjs test/acceptance.test.mjs
    ...
     gate
      acceptance-runner.js  | 100.00 | 100.00 | 100.00
      driver.js             | 100.00 | 100.00 | 100.00
      engine.js             | 100.00 | 100.00 | 100.00
      gate-event-store.js   | 100.00 | 100.00 | 100.00
      gate-log.js           | 100.00 |  75.00 | 100.00
      lifecycle.js          | 100.00 |  97.44 | 100.00
      registry.js           | 100.00 | 100.00 | 100.00

Verdict: the "TDD, cov 100%" commit-message claims are TRUE for line coverage -- all 7 files in
`packages/quay/src/gate/` show 100.00% line coverage, independently re-run by me on this worktree, not
copied from any commit message or prior report. Branch coverage is slightly below 100% on two files
(`gate-log.js` 75%, `lifecycle.js` 97.44%) -- this is consistent with "cov 100%" commonly meaning line
coverage in this repo's own convention (confirmed by QENG-1's own acceptance-audit note, which
explicitly separates "100% line" from "75% branch" for `gate-log.js` and still calls the AC met), not
a discrepancy with the claim as actually made.

Also ran `test/gap-cli-gate-enforcement.test.mjs` (5/5 pass) for completeness (the pre-existing
`--enforce-gate` gap this whole initiative builds on top of).

### 1.4 Genuine defect found: flag-before-positional-id crash (6 commands)

Root cause, confirmed by reading `bin/quay.js` line 287:
`const [, , cmd, sub, ...rest] = process.argv;` -- `sub` is the raw `process.argv[3]` token, used
directly as the task id by all 6 verb-less commands (`gate`/`gate-log`/`complete`/`adjudicate`/
`promote`/`retreat`), with NO flag-awareness. By contrast, `task view`/`edit`/`create` read the id
from `positional[0]`, a value `parseFlags()` produces AFTER stripping recognized `--flag value`
pairs -- those commands do not have this bug. `run` also avoids it (no positional id; it deliberately
re-parses `[sub, ...rest]` through `parseFlags`).

Live reproductions (all against this worktree, `exp5-outer-driver` HEAD `e4c29f5`):

    $ node packages/quay/bin/quay.js gate --gate dod QENG-1
    Error: no such task: --gate
        at runGate (.../engine.js:32:20) ...

    $ node packages/quay/bin/quay.js retreat --reason "test" QENG-1
    quay retreat: --reason <r> is required (the reason is the deliverable of a retreat)
        [reversed order silently fails the wrong precondition check]

    $ node packages/quay/bin/quay.js adjudicate --file /tmp/g2.jsonl QENG-1
    Error: no such task: --file
        at runAdjudicate (.../lifecycle.js:129:20) ...

    $ node packages/quay/bin/quay.js gate-log --gate acceptance
    [silent empty output, exit 0 -- no error at all, a distinct and arguably worse failure mode]

I checked the one existing regression test that exercises `--gate dod`
(`test/acceptance.test.mjs`, "C1 [regression]: `--gate dod` still routes to QENG-1's dod gate")
and confirmed by reading it that it only invokes the documented id-first order
(`runQuay(["gate", "COMPLIANT", "--gate", "dod", "--file", logFile], ...)`) -- the reversed order is
genuinely untested. This is a real, previously-unexamined gap, not a manufactured one -- filed as
`exp5-M-GATE-CLI-ARG-ORDER`.

While investigating this I also found (and then had to CORRECT my own initial mis-reading of) an
exit-code question: piping `node ... | tail -5; echo "exit=$?"` reports `exit=0` because `$?` reflects
`tail`'s exit code, not `node`'s, in a pipeline -- a shell artifact, not a real bug. Re-running the
same missing-task case as a standalone command:

    $ node packages/quay/bin/quay.js gate NONEXISTENT-TASK-XYZ; echo "exit=$?"
    Error: no such task: NONEXISTENT-TASK-XYZ
        at runGate (.../engine.js:32:20) ...
    exit=1

confirms the exit code is correctly 1 -- `main().catch()`'s top-level handler does set
`process.exitCode = 1` on any uncaught error. The genuine remaining defect here is purely
presentational (a 5-line stack trace instead of the clean one-line message the `Error(...)` text was
clearly authored to be, inconsistent with the SAME file's own `console.log(reason); process.exitCode
= 1` pattern used elsewhere, e.g. `runComplete`'s not-ready precondition) -- filed as
`exp5-M-GATE-ERROR-UX`, explicitly scoped as presentation-only after I confirmed the exit-code side
was already correct (I initially over-claimed a false exit-code-0 defect in an early draft of that
task file, based on the pipeline artifact above, and corrected it before finalizing -- see the task
file's own provenance note for the corrected claim).

## Section 2. Genuine gap found: QENG-5's DoD-via-quay-gate wiring is demo-only

`OUTER-LOOP.md` step 6's DoD meta-enforcer gate paragraph (lines 296-334) still instructs the loop to
run `scripts/it0-dod-check.sh <milestone-id> <charter-file> <absorb-entry-text-or-file>` DIRECTLY as
the actual per-real-milestone HARD BLOCK mechanism -- the "Engine route" sub-note is additive and
demonstrates the pass/fail behavior only via two static, committed fixture tasks
(`QENG-5-DEMO-PASS`/`QENG-5-DEMO-FAIL`), not via any real milestone's own ABSORB. QENG-0's own
"Progress" note self-discloses this as "Remaining forward work (a separate future initiative, not this
epic)." This is a real, self-disclosed-but-unselected gap -- worth making concrete and selectable
rather than leaving as a dangling epic-progress-note aside -- filed as `exp5-M-QENG-DOD-DEMO-ONLY`,
which explicitly asks for a DECISION (extend the wiring to a real milestone, OR reasoned deferral),
not a mandated implementation, since the ABSORB-entry-file chicken/egg ordering problem (the file
doesn't exist yet at gate-invocation time for a REAL, not-yet-drafted ABSORB) is a genuinely open
design question this survey did not attempt to resolve on its own authority.

I checked one candidate risk I did NOT file a task for: `task.extra.acceptance` is arbitrary shell
text executed via `spawnSync(..., {shell:true})` -- a real "untrusted code execution" surface in
principle. This is already explicitly named and mitigated-by-design in
`docs/proposals/proposal-quay-acceptance-meter.md` line 188 ("untrusted task's gate executes untrusted
code. Mitigation for v0: cwd is pinned to..."), i.e. a known, already-documented, deliberately-scoped
v0 tradeoff for a single-tenant local tool, not an unaddressed gap -- so I did not manufacture a
candidate task for it.

## Section 3. STALE-row re-triage

### `exp5-M-CLI-UX` (UQ-042..046 CLI usability closeout)
Disposition: CONFIRMED STALE, current-state reason (not a re-assertion of the backfill-era text):
independently re-checked `experiments/quay-continuous-bootstrap/gap-list.md` lines 42-46/195-199 --
UQ-042..046 are recorded CLOSED at exp4 iteration 15 (grammar fix, synopsis update, format-flag
case-normalization, scripting example, regression-guard tightening), each with a specific commit
citation (QX-058/QX-059) and file:line evidence in the gap-list itself. No new CLI-surface gap
resembling UQ-042..046's scope has resurfaced since. (The new `exp5-M-GATE-CLI-ARG-ORDER` /
`exp5-M-GATE-ERROR-UX` candidates this iteration files ARE new, distinct, genuinely fresh CLI gaps on
the QENG surface -- they do not revive UQ-042..046, which were about search-result grammar and
`--format` flag handling on the pre-existing `task list` surface, unrelated to the new gate/lifecycle
commands.)

### `exp5-M-DIRTASK` (Directives-as-quay-tasks single-source-of-truth cutover)
Disposition: CONFIRMED STALE, current-state reason: the row's own text cites "DIR-006 REOPENED"
as its rationale for existing, but independently re-checked
`experiments/quay-continuous-bootstrap/directives/archive/DIR-006-directives-as-quay-tasks...md` --
that DIR-006 (exp4's directive, a DIFFERENT directive from exp5's OWN DIR-006, a Web-UI-verification
finding -- confirmed both exist as distinct files under different experiment directories, ordinary
cross-experiment id reuse) shows a formal "APPLIED iteration 11" resolution with explicit
"Status-to-lifecycle mapping (adopted)" -- i.e. genuinely closed with "Option B: files canonical" as
`dashboard.md` line 432 already states. No live reopening of this specific decision was found in any
directive, task, or dashboard entry as of this survey. Dispatching this row would re-litigate an
already-settled decision.

### `exp5-M-DOCS` (Docs surface hardening, docs_quality)
Disposition: CONFIRMED STALE, current-state reason (stronger grounding than the original
backfill-era text, which only cited "closed iteration 19"): independently re-checked
`experiments/quay-continuous-bootstrap/gap-list.md` -- DOC-001..005 were not only closed at exp4
iteration 19, but were REOPENED and RE-CLOSED again during exp5's own M08-merge-recover
(iteration-1, 2026-07-18), each with a fresh, independently-captured live re-verification citation
(e.g. DOC-001: `packages/quay/README.md` line 117, `--provider <id>` flag documented; DOC-004: config
key ordering diffed by eye against the live `.quay/config.yml`). This is a STRONGER current-state
confirmation than the STALE row's original text anticipated (the row didn't know about
M08-merge-recover's later re-verification when it was backfilled) -- the disposition is unchanged
(still STALE) but the evidence base re-triaging it is now more current and more solid.

## Section 4. `packages/quay*` product-file diff check (survey-only confirmation)

    $ git diff --stat
    (empty)
    $ git status --short
    ?? tasks/exp5-M-GATE-CLI-ARG-ORDER.md
    ?? tasks/exp5-M-GATE-ERROR-UX.md
    ?? tasks/exp5-M-QENG-DOD-DEMO-ONLY.md
    ?? experiments/quay-perpetual-stream/milestones/M37-discover-post-qeng/report.iteration-1.md

Confirms: zero `packages/quay*` (or any other tracked) product file was modified by this milestone's
own work. All new artifacts are new task files (the 3 candidates) plus this report. The task-state
mutations made while exercising `quay run`/`quay gate` live (`QENG-5-DEMO-PASS` status flip,
`.quay/gate-events.jsonl` log entries) were reverted/cleared before this diff check --
`.quay/gate-events.jsonl` is itself gitignored (`.gitignore` line 16), so it was never at risk of
being committed regardless.

## Section 5. Recommendation: `it0-dod-check.sh`/`it0-*` vs the new `quay gate` engine route

Recommendation: remain independent-and-parallel for now, with the demo-only gap (section 2,
`exp5-M-QENG-DOD-DEMO-ONLY`) tracked as an explicit, selectable forward-work item -- do NOT unify by
mandate in this milestone, and do not silently let the QENG-5 "Engine route" note be read as more
than it currently is.

Reasoning, with tradeoffs stated:

- Current actual state (re-confirmed, not assumed): `it0-dod-check.sh` is the underlying check for
  BOTH invocation paths -- the bare-shell-call path (used for every real milestone today) and the
  `quay gate` path (demonstrated only via 2 static fixture tasks). They are not two competing
  implementations of the same logic; they are one implementation (`it0-dod-check.mjs`) with two
  different callers. This materially lowers the risk of "unify vs. keep parallel" being a real
  drift risk in the sense DIR-002/DIR-006 (files-canonical-without-enforcement) worried about -- there
  is only one source of truth for the DoD logic itself either way.
- Argument for keeping them parallel (status quo), not forcing unification now: the chicken/egg
  ordering problem named in section 2/`exp5-M-QENG-DOD-DEMO-ONLY` is real -- a real milestone's
  `<absorb-entry-text-or-file>` argument does not exist as a file until the ABSORB narrative is
  actually drafted during that same step. The two fixture tasks sidestep this by using static,
  pre-committed stub content. Wiring a REAL milestone through `quay gate <task>` would require either
  (a) writing the ABSORB entry to a file BEFORE running the gate (a process reordering, not just a
  wiring change), or (b) some other resolution not yet designed. Forcing unification without solving
  this first would either break the real ordering constraint or produce a `quay gate` call that is
  itself just a thin wrapper invoked at the same point the bare shell call already runs today -- a
  wiring change with no functional benefit until the ordering question is actually resolved.
- Argument for NOT leaving it as-is indefinitely: the QENG-0 epic's own "all 4 ACs met" / "CLOSED"
  framing, read uncritically, could be mistaken for "the exp5 loop now runs its real DoD gates through
  the engine" -- it does not, yet, for anything but the 2 fixture tasks. `OUTER-LOOP.md`'s own text is
  careful and accurate here ("it0-dod-check.sh remains the underlying check; quay gate/quay complete is
  the wired invocation path" -- worded as "a path," not "the path used for every milestone"), but a
  future skim-reader could still over-credit the wiring's actual current reach. This is exactly why
  `exp5-M-QENG-DOD-DEMO-ONLY` asks for an explicit DECISION (extend or reasoned-defer), not a mandate
  either way -- the goal is closing the ambiguity, not pre-judging which branch is correct.
- Tradeoff of full unification (if later chosen): a real benefit (every ABSORB's DoD verdict
  becomes a machine-logged, queryable `GateEvent` rather than a prose "PASS" claim in `dashboard.md` --
  directly strengthens the DIR-017/DoD-meta-enforcer program's own "the meter is runnable, not
  asserted" discipline) against a real cost (a process-ordering change to when/how the ABSORB entry
  text is materialized, touching `OUTER-LOOP.md` step 6/7 itself, a HARD-BLOCK-bearing section that
  should not be modified lightly or as an incidental side effect of a CLI-wiring task).
- Tradeoff of staying parallel indefinitely (if (b) is eventually chosen deliberately): simpler,
  lower-risk, no process-ordering change required -- but forgoes the machine-logged-verdict benefit
  above, and leaves the QENG-5 "engine route" framing permanently demo-scoped, which should then be
  stated explicitly in `OUTER-LOOP.md`'s own text (per `exp5-M-QENG-DOD-DEMO-ONLY`'s AC3) rather than
  left ambiguous.

## Section 6. New candidate tasks authored (3, within the 2-6 target range)

1. `exp5-M-GATE-CLI-ARG-ORDER` -- Fix flag-before-positional-id crash across the 6 QENG verb-less
   commands (`gate`/`gate-log`/`complete`/`adjudicate`/`promote`/`retreat`); a leading flag is
   currently misread as the task id, producing a raw stack trace (5 of the 6 commands) or a silent
   empty result (`gate-log`) instead of correct behavior or a clean usage error. Live-reproduced this
   iteration, root-caused to `bin/quay.js`'s raw `sub = process.argv[3]` extraction (vs. the
   already-correct `positional[0]` pattern `task view`/`edit`/`create` use), confirmed genuinely
   untested by inspecting the one existing `--gate dod` regression test.

2. `exp5-M-GATE-ERROR-UX` -- Replace raw JS stack traces with the already-established
   clean-one-line-message pattern (used elsewhere in the SAME files, e.g. `runComplete`'s not-ready
   check) for the `throw new Error(...)` paths in `engine.js`/`lifecycle.js` (missing task, unknown
   gate, illegal transition). Explicitly scoped as presentation-only after I confirmed (and corrected
   an earlier over-claim in my own drafting process) that the exit-code behavior is already correct.

3. `exp5-M-QENG-DOD-DEMO-ONLY` -- The QENG-5 "exp5 DoD via `quay gate`" wiring is demonstrated only
   via 2 static fixture tasks; the real per-milestone DoD meta-enforcer gate at `OUTER-LOOP.md` step
   6/7 still runs `it0-dod-check.sh` as a bare shell call for every actual milestone. Asks for an
   explicit decision (extend the wiring to a real milestone, addressing the ABSORB-entry-file
   chicken/egg ordering problem, OR a reasoned deferral) rather than mandating a specific
   implementation -- makes QENG-0's own self-disclosed "remaining forward work" note concrete and
   selectable.

I did not find a 4th-6th genuine gap worth filing as busywork. In particular I checked (and rejected
as not-genuine-gaps): `driver.test.mjs`'s negative-path coverage (already thorough -- fail-path,
empty-board, sentinel, cap, anti-spin all covered); the `task.extra.acceptance` arbitrary-shell-exec
surface (already explicitly documented and deliberately scoped as a known v0 tradeoff in
`docs/proposals/proposal-quay-acceptance-meter.md`, not an unaddressed gap).

## Section 7. Reflection

- The single most valuable finding this iteration was NOT from reading code -- it was from literally
  running `quay gate QENG-1` and getting a FAIL where the epic's own "verified" claim implied a PASS.
  Investigating that discrepancy surfaced BOTH the correct resolution (the claim is true under
  `--gate dod`, the CLI's default changed to `acceptance` in QENG-2) AND a genuine new defect (the
  `--gate dod` flag-first invocation form crashes) that reading the code alone would not have
  surfaced as clearly as actually trying multiple invocation orderings did.
- I made and then caught my own error mid-investigation: an initial pipeline-artifact reading
  (`| tail -5; echo $?`) made it look like a missing-task error exits 0; re-running as a standalone
  command showed the real exit code is 1. I corrected the corresponding task file
  (`exp5-M-GATE-ERROR-UX`) before finalizing rather than shipping the over-claim -- this is exactly
  the "do not take claims on faith, verify directly" discipline the charter asks of the survey itself,
  applied reflexively to my own draft findings.
