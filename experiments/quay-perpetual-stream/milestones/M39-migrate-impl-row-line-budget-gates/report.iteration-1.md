# M39-migrate-impl-row-line-budget-gates — iteration-1 report

**Worktree:** `experiments/quay-perpetual-stream/milestones/M39-migrate-impl-row-line-budget-gates/worktrees/iteration-1`
**Branch:** `exp5-m39-iteration-1` (base `exp5-outer-driver` @ `209faca`, charter authored at `4bbc7bc`)
**Commit produced this iteration:** `a89399a` — "M39 iteration-1: register impl-row + line-budget as named quay gates (DIR-022 Layer 2 phase 1)"

This report follows the independent-verification discipline: no iteration-0 materials were read.

## HARD GATES preamble

The charter's GATE-HASH-REF points at `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`
lines 100-131 (the manda-healthz / port-4173-reachability / worktree-isolation block). Re-verifying
directly:
- `sha256sum` of the full file: `f0b3e148875728e77739e2cced3c0a65c3379e775b332914119aef77d706c93c`
- `sed -n '100,131p' ... | sha256sum`: `ec6a28492620a3aebe1d031db12e1e2f67af3a6b0959b69f698a3d1847ecbb74`
- Neither matches the charter's literal `GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93`
  string verbatim (that string is also 65 hex characters, one more than a valid sha256 digest, so it
  looks like a transcription artifact in the charter rather than a byte-exact hash I could satisfy).
  Flagging this discrepancy explicitly rather than silently asserting a match.
- Per the charter's own text: **"The manda healthz gate and port-4173 reachability gate are N/A this
  milestone (no Web UI surface touched)"** — stated N/A explicitly, as instructed, not silently
  omitted.
- Worktree isolation: all edits this iteration were made under
  `experiments/quay-perpetual-stream/milestones/M39-migrate-impl-row-line-budget-gates/worktrees/iteration-1/`
  only; `git status`/`git diff --stat` (below) confirm the touched-file set stays inside this worktree
  checkout.

## AC1 — two new named gates, thin wrappers, `extra.*` convention

**Convention chosen (documented per the AC's own requirement):**

```
task.extra.implRow    = { milestoneId: string, backlogFile?: string }
task.extra.lineBudget = { charterFile: string, threshold?: number|string }
```

Rationale: the existing `acceptance` gate's convention is `task.extra.acceptance = "<one shell
command string>"` — a single opaque runnable. The two it0 scripts being wrapped here take
**positional** args (`<milestone-id> [backlog-file]` and `<charter-file> [item-count-threshold]`),
not one opaque command. Rather than inventing a new ad hoc string-templating mechanism, each gate
reads a small typed sub-object off `task.extra` (still round-tripping through the generic `extra`
path, no Provider ABI change — same mechanism `acceptance` already uses) and assembles the shell
command itself via `shQuote()` + `runAcceptance()` — the SAME pure `runAcceptance` runner QENG-2
already ships, not a second parallel "run a shell command" implementation. No script logic was
reimplemented: each gate is `cfg validation` -> `assemble a "bash <script> <args>" command string`
-> `runAcceptance()`. The it0 scripts' own exit code 2 (usage/file-not-found) is surfaced as
`ok:false` too (a usage error is not a PASS).

Code: `packages/quay/src/gate/registry.js`. No new helper file was needed — the existing
`acceptance-runner.js` was reused as-is (imported, not duplicated).

Key excerpt (see `git show a89399a -- packages/quay/src/gate/registry.js` for the full diff):

```js
"impl-row": async (task) => {
  const cfg = task.extra?.implRow;
  const milestoneId = cfg?.milestoneId;
  if (typeof milestoneId !== "string" || milestoneId.trim() === "") {
    return { ok: false, reason: "no impl-row config defined (set task.extra.implRow = { milestoneId, backlogFile? })" };
  }
  const args = [shQuote(milestoneId)];
  if (typeof cfg.backlogFile === "string" && cfg.backlogFile.trim() !== "") args.push(shQuote(cfg.backlogFile));
  const command = `bash ${shQuote(IMPL_ROW_SCRIPT)} ${args.join(" ")}`;
  const { ok, reason } = runAcceptance({ command, cwd: process.env.QUAY_ACCEPTANCE_CWD || REPO_ROOT, timeoutMs: Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS) || 60000 });
  return { ok, reason };
},
"line-budget": async (task) => {
  const cfg = task.extra?.lineBudget;
  const charterFile = cfg?.charterFile;
  if (typeof charterFile !== "string" || charterFile.trim() === "") {
    return { ok: false, reason: "no line-budget config defined (set task.extra.lineBudget = { charterFile, threshold? })" };
  }
  const args = [shQuote(charterFile)];
  if (cfg.threshold !== undefined && cfg.threshold !== null && String(cfg.threshold).trim() !== "") args.push(shQuote(cfg.threshold));
  const command = `bash ${shQuote(LINE_BUDGET_SCRIPT)} ${args.join(" ")}`;
  const { ok, reason } = runAcceptance({ command, cwd: process.env.QUAY_ACCEPTANCE_CWD || REPO_ROOT, timeoutMs: Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS) || 60000 });
  return { ok, reason };
},
```

**Self-assessment: fully met.** Both gates are ~15-line thin wrappers, no duplicated script logic,
documented convention, consistent-in-spirit with (though not byte-identical to, by necessity of the
positional-arg shape) the `acceptance` gate's own `task.extra.*` pattern.

## AC2 — `quay gate --list` surfaces the new gates

`quay gate --list` was already wired (`packages/quay/bin/quay.js` line 791: `if (cmd === "gate" &&
sub === "--list")` -> prints `listGates()`, one per line, exit 0). No new CLI wiring was required —
`listGates()` picking up the two new registry keys was sufficient. Real output:

```
$ node packages/quay/bin/quay.js gate --list
dod
acceptance
impl-row
line-budget
```

**Self-assessment: fully met.**

## AC3 — real invocation against a real (non-fixture) task, real GateEvents

Target: **this milestone's own real task**, `exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES` (already
present in `tasks/` at dispatch time, per the charter's self-referential-proof precedent from M38).
I seeded its `extra.implRow`/`extra.lineBudget` fields via `quay task edit --extra` pointing at:
- `implRow`: `milestoneId: exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE` (the real, already-ABSORBed M38
  task id) + `backlogFile: experiments/quay-perpetual-stream/backlog.md` (the real, live backlog).
- `lineBudget`: `charterFile: experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md`
  (the real, already-ABSORBed M38 charter).

Neither is a synthetic `QENG-5-DEMO-*`-style fixture — both point at real, already-landed exp5
artifacts.

Real command output:

```
$ node packages/quay/bin/quay.js gate exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES --gate impl-row
quay-native mcp: serving tasks from .../worktrees/iteration-1/tasks
PASS
EXIT=0

$ node packages/quay/bin/quay.js gate exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES --gate line-budget
quay-native mcp: serving tasks from .../worktrees/iteration-1/tasks
PASS
EXIT=0
```

Real GateEvent JSON, `quay gate-log exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES --json` (4 real
events across two invocation passes during this iteration's own work — no fabricated entries):

```json
[
  {
    "id": "01d6ef3f-59de-4cba-9be5-3c80ba149c7f",
    "item_id": "exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES",
    "pipeline_id": "exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES",
    "gate": "impl-row",
    "actor": "quay-cli",
    "verdict": "pass",
    "timestamp": "2026-07-19T08:29:22.959Z",
    "payload": { "reason": "acceptance passed (exit 0)" }
  },
  {
    "id": "4b290d2e-e514-41d9-9c53-806a43f78f54",
    "item_id": "exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES",
    "pipeline_id": "exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES",
    "gate": "line-budget",
    "actor": "quay-cli",
    "verdict": "pass",
    "timestamp": "2026-07-19T08:29:23.993Z",
    "payload": { "reason": "acceptance passed (exit 0)" }
  },
  {
    "id": "ee7cc9ff-0927-4ada-add2-fdd52a027770",
    "item_id": "exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES",
    "pipeline_id": "exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES",
    "gate": "impl-row",
    "actor": "quay-cli",
    "verdict": "pass",
    "timestamp": "2026-07-19T08:38:14.301Z",
    "payload": { "reason": "acceptance passed (exit 0)" }
  },
  {
    "id": "a626e523-ed45-431f-b74b-a5b0b2effc68",
    "item_id": "exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES",
    "pipeline_id": "exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES",
    "gate": "line-budget",
    "actor": "quay-cli",
    "verdict": "pass",
    "timestamp": "2026-07-19T08:38:15.067Z",
    "payload": { "reason": "acceptance passed (exit 0)" }
  }
]
```

I also verified real FAIL/usage-error paths directly against the it0 scripts, and through the test
suite's "B" (real-repo integration) and "C" (real-CLI FAIL case) phases — see AC4 — so both PASS
and FAIL/exit-2 paths are exercised against real, non-synthetic inputs, not just the PASS case shown
above.

**Self-assessment: fully met.** Real task, real backlog/charter files, real GateEvents recorded and
queryable.

## AC4 — >=80% coverage, real command output

New test file: `packages/quay/test/gate-impl-row-line-budget.test.mjs` (18 tests, 3 phases: A = pure
gate-fn unit tests against synthetic fixture files covering missing-config, PASS, FAIL, usage-error,
and threshold-override branches; B = real-repo integration against exp5's own real `backlog.md` and
the real M38 charter; C = real CLI `--list`/`--gate`/`gate-log --json` round-trips against a
disposable native-provider workspace).

Targeted coverage run (this new file + the two existing gate test files):

```
$ node --test --experimental-test-coverage packages/quay/test/gate-impl-row-line-budget.test.mjs packages/quay/test/gate.test.mjs packages/quay/test/acceptance.test.mjs
...
ℹ tests 60
ℹ pass 60
ℹ fail 0
...
ℹ     acceptance-runner.js | 100.00 |   100.00 |  100.00 |
ℹ     registry.js          | 100.00 |    96.30 |  100.00 |
```

Full-package coverage run, literally as the AC specifies (`node --test --experimental-test-coverage
packages/quay/test/*.mjs`):

```
$ node --test --experimental-test-coverage packages/quay/test/*.mjs
...
ℹ tests 141
ℹ pass 139
ℹ fail 2
...
ℹ     acceptance-runner.js | 100.00 |   100.00 |  100.00 |
ℹ     registry.js          | 100.00 |   100.00 |  100.00 |
...
ℹ all files                |  88.64 |    78.53 |   86.55 |
```

Both new-gate-touched files (`registry.js`, `acceptance-runner.js`, reused not modified) hit
**100% line / 100% branch / 100% function** coverage in the full-suite run — well above the >=80%
bar. (The targeted 3-file run shows `registry.js` at 96.30% branch because it omits
`acceptance.test.mjs`'s own dod-gate coverage of one branch outside my new code; the full-suite run
is the authoritative number and clears 100% on all three axes.)

**2 pre-existing, unrelated failures** in the full-suite run: `provider-abi-conformance.test.mjs`
(2 GitHub-live-API parent-add/reassign scenario failures) and `serve-github.test.mjs`. I confirmed
both fail identically on the pre-M39 base commit (`git stash` + re-run reproduces the same 2
failures before any of this iteration's changes), i.e. they are environmental/GitHub-API-dependent,
not caused by the registry.js changes.

**Self-assessment: fully met.** Real, pasted, re-run coverage output; >=80% cleared with margin
(100%) on both touched files.

## AC5 — `OUTER-LOOP.md` step 6 updated

Added a new subsection immediately after the existing DoD meta-enforcer paragraph's "Underlying
check details" text (before the "Driver -> master publish sub-step" heading), titled **"Named-gate
invocation for Clause 3 (line-budget) and Clause 4 (impl-row)"**. It states plainly:
- `impl-row`/`line-budget` are now ALSO independently invokable via `quay gate <task> --gate
  impl-row` / `--gate line-budget`, reading `task.extra.implRow`/`task.extra.lineBudget`.
- This is an ADDITIONAL, opt-in capability for a milestone that wants a separately-queryable
  GateEvent for just one of these two clauses.
- It explicitly does **NOT** replace the composite `quay gate <milestone-task>` invocation, which
  remains the PRIMARY, REQUIRED path for `milestone_counter++` — no mandate to migrate every
  milestone's ABSORB flow, matching the charter's explicit out-of-scope note.

`git diff --stat` for this file:

```
 experiments/quay-perpetual-stream/OUTER-LOOP.md | 20 ++++++++++++++++++++
```

**Self-assessment: fully met** — the AC's exact wording ("noted as ALSO invokable... does NOT
require migrating every milestone's ABSORB flow") is reflected near-verbatim in the added text.

## `git diff --stat` (this iteration's commit)

```
$ git show --stat HEAD
 experiments/quay-perpetual-stream/OUTER-LOOP.md          |  20 +++
 packages/quay/src/gate/registry.js                       |  90 +++++++++++
 packages/quay/test/gate-impl-row-line-budget.test.mjs    | 319 +++++++++++++++++++++++++
 tasks/exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES.md        |   5 +
 4 files changed, 433 insertions(+), 1 deletion(-)
```

(Clause 7 test-floor applies — this confirms the touched `packages/quay*` files: one product file,
`packages/quay/src/gate/registry.js`, plus its own new test file. No non-product surface was
touched beyond the OUTER-LOOP.md doc update and the task's own `extra` metadata, both expected.)

## Overall self-assessment

All 5 AC items: **fully met**, each demonstrated end-to-end (code written, tests written and run for
real, real gate invocations observed, real GateEvents recorded, docs updated) rather than only
designed on paper. The one open item worth flagging for reconciliation/ABSORB: the charter's
GATE-HASH-REF string doesn't byte-match either the whole-file or lines-100-131 sha256 I computed
(and is itself one character too long for a valid sha256 hex digest) — I've treated the two N/A
items (manda healthz, port-4173) as correctly N/A per the charter's own explicit text, but the hash
mismatch itself should be reconciled by a human or the ABSORB step rather than silently accepted.
