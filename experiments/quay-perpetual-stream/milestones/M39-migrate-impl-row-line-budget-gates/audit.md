# M39-migrate-impl-row-line-budget-gates — Adversarial Audit

**Auditor:** independent out-of-band subagent, fresh context, refute-first stance.
**Date:** 2026-07-19.
**Scope:** re-verify all 5 task ACs + all 8 `inherited-core.md` DoD clauses against the MERGED
state (`exp5-outer-driver` HEAD, commit `1517b8f` merge + `837ff12` iteration-1 report). No prior
conversation about this milestone was read; every finding below is from my own commands, run fresh.

## Overall verdict: **FAIL — one blocking gap found (ABSORB never happened)**

The 5 Acceptance Criteria (the actual code/test/demo deliverable) are all genuinely met — I
independently re-ran every one of them and confirm the implementer's claims. **However, the
milestone as a whole has NOT completed ABSORB**: `dashboard.md` has no M39 log entry,
`milestone_counter` was never incremented past 38, `backlog.md` has no M39 row, and the task's own
`status:` frontmatter is still `in-progress`, not `done`. Per `inherited-core.md`, step 7's
`milestone_counter++` is gated on the DoD clauses being **evaluated and logged**, not merely
satisfied in the abstract — that log entry does not exist. This is a real, structural gap, not a
nitpick: without it, DIR-022 Layer 2 phase 1's own record-keeping (which of its 4 remaining gates
are done, what the VT disposition was, whether the m40 checkpoint-due flag was actually
transferred) is missing, and the standing "no silent-omission" discipline (Clause 1, Clause 7) is
itself violated by omission of the entire ABSORB step.

I am ticking the 5 AC items (they are genuinely met) but marking this milestone's *completion*
FAILED pending the ABSORB write-back — see "Blocking gap" below.

---

## AC-by-AC findings (own commands, fresh)

### AC1 — two new named gates, thin wrappers, `extra.*` convention
**CONFIRMED.** Read `packages/quay/src/gate/registry.js` in full. `makeIt0Gate(scriptPath, argsKey,
label)` is a single factory used for both `impl-row` and `line-budget`; it only (a) reads
`task.extra[argsKey]`, (b) fail-closes if unset/empty/malformed, (c) shell-quotes the args and
assembles `[scriptPath, ...args].join(" ")`, (d) delegates to the SAME `runAcceptance()` (from
`acceptance-runner.js`, unchanged, already shipped by QENG-2) that the pre-existing `acceptance`
gate uses. `runAcceptance` (read in full) is the sole place that calls `spawnSync`, interprets
`ETIMEDOUT`/exit codes, and builds the `{ok, reason}` shape — `registry.js` does not reimplement
any of that. I also read the first ~15 lines of both `it0-impl-row-check.sh` and
`it0-ceiling-line-budget-check.sh`: the design-only-detection and phase/stage-plan-detection logic
lives entirely inside the shell scripts, not duplicated in JS. **No duplicated process-spawn/
timeout/exit-code logic found.** The `extra.*` convention (`implRowArgs`/`lineBudgetArgs`, arrays
of positional args) is a minimal, documented extension of the existing `task.extra.acceptance`
string convention, exactly as the AC requires.

### AC2 — `quay gate --list` surfaces both new gates
**CONFIRMED**, own command:
```
$ node packages/quay/bin/quay.js gate --list
dod
acceptance
impl-row
line-budget
```
`--list` required zero new CLI plumbing (already wired at M38/QENG-1 to `Object.keys(gateRegistry)`).

### AC3 — real invocation against a REAL (non-fixture) task, real GateEvents
**CONFIRMED**, own commands, run independently against the real repo tasks (not a
`QENG-5-DEMO-*`-style fixture):
```
$ node packages/quay/bin/quay.js gate exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --gate impl-row --file /tmp/audit-m39-gatelog.jsonl
PASS   (exit 0)

$ node packages/quay/bin/quay.js gate exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES --gate line-budget --file /tmp/audit-m39-gatelog.jsonl
PASS   (exit 0)

$ node packages/quay/bin/quay.js gate-log exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --json --file /tmp/audit-m39-gatelog.jsonl
[{"gate":"impl-row","verdict":"pass","pipeline_id":"exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE", ...}]

$ node packages/quay/bin/quay.js gate-log exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES --json --file /tmp/audit-m39-gatelog.jsonl
[{"gate":"line-budget","verdict":"pass","pipeline_id":"exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES", ...}]
```
`implRowArgs` was already seeded (by M38's own report, confirmed in `tasks/
exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE.md` frontmatter, `extra.implRowArgs:
["exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE", "experiments/quay-perpetual-stream/backlog.md"]`) on
a real, already-ABSORBed milestone task — not something I had to seed myself. `lineBudgetArgs` was
already seeded on M39's own task. Both are real exp5 tasks, not disguised fixtures. The
`it0-gates.test.mjs` suite (read in full) additionally exercises the exact same real-file CLI path
end-to-end (Stage 3/4 tests) plus a fail-closed branch (exit 1, verdict `fail`) — also independently
re-run by me (see AC4 below), all pass.

### AC4 — ≥80% line/branch coverage on new gate code
**CONFIRMED**, own command, full suite as the AC literally specifies:
```
$ node --test --experimental-test-coverage packages/quay/test/*.mjs
...
ℹ     acceptance-runner.js | 100.00 |   100.00 |  100.00 |
ℹ     registry.js          | 100.00 |   100.00 |  100.00 |
...
ℹ all files                |  88.93 |    78.47 |   86.55 |
```
`registry.js` (the only file changed by M39) and `acceptance-runner.js` (untouched, but part of the
gate/ dir) are BOTH 100/100/100 — well over the 80% bar. Overall suite exit code was 1, but the
ONLY failing test is `packages/quay/test/serve-github.test.mjs` (2 assertions comparing rendered
HTML against LIVE GitHub issue data — `FAIL: GET / body contains the real GitHub-backed task id
gh-3`), a pre-existing, network-data-dependent flake entirely unrelated to `gate/registry.js` or
this milestone's diff (`git diff --stat` for the merge touches only `registry.js`,
`it0-gates.test.mjs`, `OUTER-LOOP.md`, and 2 task files — `serve-github.test.mjs` is untouched).
All 20 of the M39-specific tests in `it0-gates.test.mjs` pass (re-run standalone too, 20/20 pass).
**AC4 is genuinely met**; the report's pasted 100/100/100 figures for the two gate files are real,
not fabricated.

### AC5 — `OUTER-LOOP.md` updated to note the new invocation capability
**CONFIRMED**, own command:
```
$ grep -n "quay gate.*--gate impl-row\|quay gate.*--gate line-budget" experiments/quay-perpetual-stream/OUTER-LOOP.md
358:     `quay gate <task> --gate impl-row` and `quay gate <task> --gate line-budget` — for any real
```
Read the surrounding paragraph (OUTER-LOOP.md lines 354-368): it correctly frames the new gates as
an ADDITIONAL opt-in invocation surface, not a replacement for the standing bare `it0-*.sh`
invocations — matches the charter's explicit AC5 scope limit (does not mandate migrating every
milestone's ABSORB flow).

---

## DoD clause-by-clause disposition (`inherited-core.md`)

- **Clause 0 (AC/DoD present, checklist-aware, unchecked-box HARD-block):** task file has a
  well-formed `## Acceptance Criteria` (5 checklist items) and `## Definition of Done` referencing
  the standard clauses. All 5 boxes are `[x]`, and (per this audit) genuinely justified. PASS.
- **Clause 1 (per-milestone acceptance audit, unconditional):** this document IS that audit.
  Verdict: **NO REFUTATION FOUND on the 5 AC items themselves**, but see "Blocking gap" below —
  the audit clause also requires `it0-dod-check.sh` to have exited 0 as part of a completed ABSORB;
  that check was never run to completion for M39 (no absorb-entry file, no dashboard log). Net:
  CONCERNS escalating to a blocking gap at the ABSORB-completeness level, not at the AC-content
  level.
- **Clause 2 (V_meta consolidation-lag):** not applicable to this audit directly (no new
  confirmed-but-unconsolidated v-meta-ledger row created by M39's own work); deferred to the actual
  ABSORB step, which has not run.
- **Clause 3 (line-budget, plan-time):** charter's own it0 section states this was run before
  dispatch (small-to-moderate, 5 in-scope items) — plan-time clause, not re-verifiable
  retroactively in the same way; no evidence of a bypass.
- **Clause 4 (design-only impl-row):** N/A — this milestone is NOT design-only (it ships real code +
  tests + a real demonstration, not a design doc awaiting a future `-IMPL`), exactly as the charter
  states. Confirmed by reading the charter and task; no design-only markers in `backlog.md`/task
  frontmatter for this milestone (no M39 backlog row exists at all yet — see Blocking gap).
- **Clause 5 (no-self-exemption):** no scope-exemption language found in the charter's "Explicitly
  OUT of scope" section that isn't a legitimate non-firing trigger (Clauses 4/6 correctly N/A
  rather than narrated away). PASS.
- **Clause 6 (escrow-Δv):** N/A — not design-only (Clause 4 N/A propagates). PASS.
- **Clause 7 (test-floor, APPLIES):** `surface:cli` label confirmed present
  (`tasks/exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES.md` line 10). Independently re-ran the coverage
  command myself (not trusting the report's pasted number) — genuinely ≥80% (100/100/100 on the
  touched files). **PASS, and the bar is genuinely met, not merely claimed.**

## Blocking gap: ABSORB never completed for M39

Independent findings, own commands:
- `grep -n "M39" experiments/quay-perpetual-stream/dashboard.md` → **no hits**. The dashboard's last
  real ABSORB log entry is `## ABSORB m38: M38-dod-gate-operative-real-milestone` (`milestone_counter
  → **38**`, confirmed via `git log -p -1 -- dashboard.md` → commit `ce9874b "ABSORB m38: ...
  milestone_counter=38"`). No M39 entry follows it.
- `grep -n "M39" experiments/quay-perpetual-stream/backlog.md` → **no hits**. No M39 backlog row
  exists (DONE or otherwise).
- `git show 1517b8f --stat` (the M39 merge commit) confirms the files touched:
  `OUTER-LOOP.md`, `report.iteration-0.md`, `registry.js`, `it0-gates.test.mjs`,
  `tasks/exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE.md`, `tasks/
  exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES.md`. **`dashboard.md` and `backlog.md` are absent from
  this diff.**
- The task's own frontmatter still reads `status: in-progress`, not `done`.
- `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES
  experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md
  /tmp/m39-absorb-entry.md` → `ERROR: absorb-entry-file not found` (exit 2) — the ephemeral
  absorb-entry artifact referenced by the charter's own `extra.acceptance` command was never
  produced, i.e. the ABSORB-time acceptance meter for THIS milestone's own composite DoD gate has
  never been run to a PASS/FAIL verdict.

**Conclusion:** the code-level work (registry gates, tests, CLI demonstration, docs update) is
real, complete, and independently verified. But "the milestone" in the BAIME-loop sense — the thing
that gates `milestone_counter++`, backlog-row DONE-marking, and the m40-due checkpoint flag the
charter itself warns about — has not happened. This is the one thing this audit refutes: **do not
treat M39 as ABSORBed/complete until the outer loop runs its own `quay gate
exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES` (or equivalent `it0-dod-check.sh`-backed) ABSORB step,
appends the dashboard.md log entry, sets task status to done, adds/updates the backlog.md row, and
increments `milestone_counter` to 39** (and remembers the m40-checkpoint-due flag the charter
itself calls out).

## CONCERNS (non-blocking, worth flagging for future milestones)

1. **Stale dashboard header.** `dashboard.md` line 4 reads `**milestone_counter: 30**` while the
   log body's last entry says `milestone_counter → **38**`. This predates M39 (already stale at
   m38's own merge) — not something M39 caused, but it is a live footgun: a naive reader/script
   trusting the header field alone would be off by 8. Worth a follow-up fix whenever the outer loop
   next touches the dashboard header, independent of M39.
2. **iteration-1's independent convention diverged from iteration-0's** (`task.extra.implRow =
   {milestoneId, backlogFile}` object shape vs. iteration-0's `task.extra.implRowArgs` array shape).
   This is expected and fine per the charter's independent-verification design (iteration-1's report
   is explicitly "kept as an independent-verification record, not merged") — flagging only so a
   future reader does not confuse the two conventions if they skim iteration-1's report expecting it
   to match the merged code.
3. **GATE-HASH-REF mismatch noted by iteration-1** (a 65-hex-char string where a valid sha256 is 64)
   — iteration-1's report flags this as a probable transcription artifact in the charter and does not
   block on it since the by-reference script check on iteration-0's side passed. Not independently
   re-verified by this audit (out of this audit's AC/DoD scope) but worth a human glance given it
   touches the HARD GATE preamble text future charters copy verbatim.

## Task file checklist write-back

All 5 AC checkboxes were independently confirmed and left `- [x]` with a fresh evidence citation
appended (see `tasks/exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES.md`). No AC item was found
unjustified. The blocking gap identified above is an ABSORB-completeness issue, not an AC-content
issue, so it is recorded here (and should HARD-block `milestone_counter++` until resolved) rather
than by unchecking any AC box.
