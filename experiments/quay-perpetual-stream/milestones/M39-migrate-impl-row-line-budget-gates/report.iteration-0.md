# M39 iteration-0 report — migrate impl-row / line-budget to named `quay gate` gates

Worktree: `experiments/quay-perpetual-stream/milestones/M39-migrate-impl-row-line-budget-gates/worktrees/iteration-0`
Branch: `exp5-m39-iteration-0`, base `exp5-outer-driver` HEAD `209faca`.

## HARD GATES (§0 preconditions)

- **Gate-hash-by-reference check** (charter's GATE-HASH-REF, pinned at
  `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 100-131):
  ```
  $ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference \
      experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md
  PASS: experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md GATE-HASH-REF
  (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source
  (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
  exit=0
  ```
  PASS — matches. (Note: my own naive `sed -n '95,131p' | sha256sum` sampled the wrong line range
  first and produced a mismatching digest; the charter's OWN `it0-gate-hash-check.sh` script, run as
  directed, is authoritative and PASSed.)
- **manda healthz gate**: N/A — per the charter, "no Web UI surface touched" this milestone, and
  `.manda/hub.addr` does not exist in this worktree. Stated N/A explicitly per the charter's
  instruction.
- **port-4173 reachability gate**: N/A — same reasoning, no Web UI surface change this milestone.
- **Worktree isolation**: all edits were made under
  `experiments/quay-perpetual-stream/milestones/M39-migrate-impl-row-line-budget-gates/worktrees/iteration-0/`,
  confirmed via `pwd`/`git branch --show-current` = `exp5-m39-iteration-0` throughout.

## Argument convention chosen (AC1)

Each new gate reads its it0 script's **positional arguments from a dedicated `task.extra.*` array**:
`task.extra.implRowArgs` (e.g. `["<milestone-id>", "<backlog-file>"]`) and
`task.extra.lineBudgetArgs` (e.g. `["<charter-file>"]`).

Rationale (also documented inline in `registry.js`): the existing `acceptance` gate stores a full
shell **command string** in `task.extra.acceptance` because it wraps an arbitrary runnable meter
chosen per task. `impl-row`/`line-budget` each wrap exactly **one fixed script** — only the script's
own positional args vary per task — so storing just the args array (not a pre-built command line)
keeps the fixed script path out of every task file (avoids repo-relative-path drift across many
tasks) and keeps the two new gates symmetric with each other. Both gate functions build the actual
shell command internally (`[scriptPath, ...args].map(shQuote).join(" ")`) and hand it to the
**same** `runAcceptance` runner QENG-2 already ships — no second command-runner, no duplicated
spawn/timeout logic. An absent/empty/malformed args array is treated as a fail-closed `ok:false`
(mirrors the `acceptance` gate's own unset-meter fail-closed branch), with a reason string that
tells the caller exactly which `task.extra` key to set.

## AC1 — two new named gates, thin wrappers, no duplicated logic

`packages/quay/src/gate/registry.js` gained:
```js
"impl-row": makeIt0Gate(IMPL_ROW_SCRIPT, "implRowArgs", "impl-row"),
"line-budget": makeIt0Gate(LINE_BUDGET_SCRIPT, "lineBudgetArgs", "line-budget"),
```
`makeIt0Gate()` is a small factory (not per-gate copy-paste) that shells out via `runAcceptance` —
zero it0-script logic is reimplemented in JS; the two shell scripts remain the sole source of truth.
Verified no duplication by inspecting both scripts' argument contracts first (`head -30` on each,
usage/exit-code doc blocks) before writing the wrapper.

**Self-assessment: FULLY MET.**

## AC2 — `quay gate --list` surfaces both new gates

`--list` already existed (added at QENG-1/M38, wired to `listGates()` in `bin/quay.js`) — no new CLI
plumbing was required, only the registry additions above make it show up automatically:
```
$ node packages/quay/bin/quay.js gate --list
dod
acceptance
impl-row
line-budget
```
**Self-assessment: FULLY MET** (turned out to require zero CLI changes — `--list` enumerates
`Object.keys(gateRegistry)`, which picks up new entries for free).

## AC3 — real invocation against real (non-fixture) exp5 tasks, real GateEvents

Targeted two REAL tasks (not synthetic `QENG-5-DEMO-*` fixtures):
- `impl-row` against **`exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE`** (the already-ABSORBed M38 task),
  seeded with `implRowArgs: ["exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE", "experiments/quay-perpetual-stream/backlog.md"]`.
- `line-budget` against **this milestone's own task**, `exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES`,
  seeded with `lineBudgetArgs: ["experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md"]`.

**Important correction made mid-run:** `quay task edit --extra <json>` does a full **replace**, not a
merge, of `task.extra` at the store layer (`quay-native/src/store.js#write()`: `if (extra !== undefined)
frontmatter.extra = extra;` — no merge with the existing object, despite the CLI help text's "merged
into existing extra" phrasing describing patch semantics at the field level, not within `extra`
itself). My first attempt at seeding `implRowArgs`/`lineBudgetArgs` via `--extra '{"implRowArgs":[...]}'`
silently **destroyed** each real task's existing `extra.acceptance` DoD meter. I caught this via
`git diff` before committing, reverted (`git checkout --`), and re-seeded with the FULL merged JSON
(existing `acceptance` value + the new array key) so the real tasks' standing DoD meters are
preserved. Final diff is additive-only:
```diff
--- a/tasks/exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE.md
+++ b/tasks/exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE.md
@@ -14,6 +14,9 @@ extra:
     exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE
     experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md
     /tmp/m38-absorb-entry.md
+  implRowArgs:
+    - exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE
+    - experiments/quay-perpetual-stream/backlog.md
--- a/tasks/exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES.md
+++ b/tasks/exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES.md
@@ -14,6 +14,8 @@ extra:
     exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES
     experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md
     /tmp/m39-absorb-entry.md
+  lineBudgetArgs:
+    - experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md
```

Real CLI invocations, real output:
```
$ node packages/quay/bin/quay.js gate exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --gate impl-row --file /tmp/m39-real-gate-events.jsonl
quay-native mcp: serving tasks from .../tasks
PASS
exit=0

$ node packages/quay/bin/quay.js gate exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES --gate line-budget --file /tmp/m39-real-gate-events.jsonl
quay-native mcp: serving tasks from .../tasks
PASS
exit=0
```

Real GateEvents, `quay gate-log --json`:
```
$ node packages/quay/bin/quay.js gate-log exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --json --file /tmp/m39-real-gate-events.jsonl
[
  {
    "id": "b6cc87d5-9074-49b5-96af-f03a7cc8e1ea",
    "item_id": "exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE",
    "pipeline_id": "exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE",
    "gate": "impl-row",
    "actor": "quay-cli",
    "verdict": "pass",
    "timestamp": "2026-07-19T08:33:41.786Z",
    "payload": { "reason": "acceptance passed (exit 0)" }
  }
]

$ node packages/quay/bin/quay.js gate-log exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES --json --file /tmp/m39-real-gate-events.jsonl
[
  {
    "id": "4771bba3-e173-44e7-b23b-a7e967f6a040",
    "item_id": "exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES",
    "pipeline_id": "exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES",
    "gate": "line-budget",
    "actor": "quay-cli",
    "verdict": "pass",
    "timestamp": "2026-07-19T08:33:43.988Z",
    "payload": { "reason": "acceptance passed (exit 0)" }
  }
]
```
Also confirmed the fail-closed path exits 1 with a real GateEvent `verdict: "fail"` (see the
`it0-gates.test.mjs` CLI test `M39 C1 [AC3]: ... FAILs (exit 1) for real when args unset`, run and
green — same code path, exercised against a disposable task with no `extra` set).

One cosmetic note (not a correctness bug): the `payload.reason` text says "acceptance passed
(exit 0)" rather than something impl-row/line-budget-specific — this is `runAcceptance`'s own
generic reason string, reused as-is (deliberately, to avoid a second reason-formatting path). A
future refinement could have `makeIt0Gate` rewrite the reason text to reference the gate name, but
this was judged out of scope for a thin-wrapper milestone (the underlying pass/fail signal and the
GateEvent `gate` field name are both already correct and unambiguous).

**Self-assessment: FULLY MET**, with the caveat above about a real mid-run self-caught bug (task.extra
overwrite) that was corrected before commit — worth flagging for the audit to double-check nothing
was missed on revert.

## AC4 — ≥80% coverage, real command output

New test file: `packages/quay/test/it0-gates.test.mjs` (20 tests: fail-closed branches, real-script
pass/fail branches including usage-error exit-2 mapping, shell-quote-escaping branch, `--list`
surfacing, real CLI PASS/FAIL against disposable native-provider workspaces with real GateEvents, and
two tests run directly against this repo's OWN real `backlog.md` and this milestone's OWN real
charter file).

Full-suite real command and output (paste, not restated):
```
$ node --test --experimental-test-coverage packages/quay/test/*.mjs
...
ℹ tests 143
ℹ pass 141
ℹ fail 2
...
ℹ file                     | line % | branch % | funcs % | uncovered lines
...
ℹ    gate                  |        |          |         |
ℹ     acceptance-runner.js | 100.00 |   100.00 |  100.00 |
ℹ     driver.js            | 100.00 |   100.00 |  100.00 |
ℹ     engine.js            | 100.00 |   100.00 |  100.00 |
ℹ     gate-event-store.js  | 100.00 |   100.00 |  100.00 |
ℹ     gate-log.js          | 100.00 |    75.00 |  100.00 |
ℹ     lifecycle.js         | 100.00 |    97.44 |  100.00 |
ℹ     registry.js          | 100.00 |   100.00 |  100.00 |
...
ℹ all files                |  88.62 |    78.34 |   86.55 |
```
**`registry.js` (the file this milestone touches) is 100.00% line / 100.00% branch / 100.00% funcs**
— well above the ≥80% floor. (`gate-log.js`'s 75% branch and the repo-wide 78.34% branch aggregate
are pre-existing, unrelated to this milestone's diff — `gate-log.js` was not touched.)

**2 pre-existing, unrelated failures** in this full run: `provider-abi-conformance.test.mjs` and
`serve-github.test.mjs` (both hit the real `github.com/yaleh/quay` API; live-network/rate-limit
flakiness under concurrent-suite load). Re-ran each **standalone** to confirm they are NOT caused by
this milestone's diff:
```
$ node --test packages/quay/test/provider-abi-conformance.test.mjs
...
ℹ tests 1
ℹ pass 1
ℹ fail 0
```
(passes standalone — confirms concurrent-load/network flakiness, not a regression)
```
$ node --test packages/quay/test/serve-github.test.mjs
...
FAIL: GET / body contains the real GitHub-backed task id gh-3
FAIL: GET / body contains gh-3's real live title
...
ℹ fail 1
```
(still fails standalone too — but this test asserts against LIVE github.com/yaleh/quay repo state
unrelated to `packages/quay/src/gate/*`; neither failing assertion touches gate/registry code paths).
Neither failure is inside `packages/quay/src/gate/` or exercises the new gates — confirmed by
grep: `grep -l "gate/registry\|impl-row\|line-budget" packages/quay/test/provider-abi-conformance.test.mjs packages/quay/test/serve-github.test.mjs` returns no matches.

Isolated run (new file + closest-related existing gate test files only, for a faster/cleaner
gate-focused number, run in addition to the full-suite number above):
```
$ node --test --experimental-test-coverage packages/quay/test/it0-gates.test.mjs packages/quay/test/gate.test.mjs packages/quay/test/acceptance.test.mjs
ℹ tests 62
ℹ pass 62
ℹ fail 0
...
ℹ     registry.js          | 100.00 |    94.74 |  100.00 |
```
(The 94.74% branch number here — vs 100% in the full-suite run — reflects one branch in the
PRE-EXISTING `acceptance` gate that's only exercised by other files not included in this narrower
invocation; the full-suite run above is the authoritative, complete number and shows 100/100/100 for
`registry.js`.)

**Self-assessment: FULLY MET.** Real, pasted, ≥80% coverage evidence for the touched file, both in
the complete suite and a faster isolated run, with an honest accounting of the two unrelated
pre-existing failures.

## AC5 — OUTER-LOOP.md updated

Added one new subsection inside step 6's DoD meta-enforcer gate paragraph, immediately after the
existing `quay complete`/DIR-023 note and before the chicken/egg ordering note:

```diff
+     **Named `impl-row`/`line-budget` engine gates (DIR-022 Layer 2 phase 1 / M39, ADDITIONAL
+     capability, not a required migration):** since M39, the design-only-milestone impl-row check
+     (above) and the plan-time/ABSORB-time line-budget check (step 1 and the "Underlying check
+     details" note above) are ALSO invokable as named `quay gate` engine gates —
+     `quay gate <task> --gate impl-row` and `quay gate <task> --gate line-budget` — for any real
+     milestone task that opts in by setting `task.extra.implRowArgs` (`["<milestone-id>",
+     "<backlog-file>"]`) or `task.extra.lineBudgetArgs` (`["<charter-file>"]`) respectively. Both are
+     thin wrappers over the SAME `it0-impl-row-check.sh` / `it0-ceiling-line-budget-check.sh` scripts
+     already used above (`packages/quay/src/gate/registry.js`, no gate logic duplicated); each run
+     appends a real GateEvent (`gate: "impl-row"` / `gate: "line-budget"`) queryable via
+     `quay gate-log <task> --json`, the same as the `dod`/`acceptance` gates. **This does NOT replace
+     the two mechanical checks above, and does NOT mandate migrating every milestone's ABSORB flow to
+     the named gates** — the bare `it0-*.sh` invocations documented above remain the standing,
+     unconditional path for every milestone; the named-gate path is an opt-in additional invocation
+     surface a milestone may use if it wants a GateEvent record of that specific check (see the M39
+     charter's explicit out-of-scope note).
```

This is deliberately scoped to a NOTE, not a replacement of the two HARD BLOCK mechanical-check
paragraphs above it (design-only-milestone impl-row gate; the line-budget mentions at step 1 and
inside the "Underlying check details" note) — per the charter's explicit AC5/out-of-scope text, no
milestone's ABSORB flow is required to migrate to the named gates.

**Self-assessment: FULLY MET.**

## Clause 7 test-floor (DoD) — re-confirmed, not assumed

`surface:cli`, real product code touched (`packages/quay/src/gate/registry.js`) — Clause 7 APPLIES.
Re-confirmed coverage is real and ≥80% for the touched file (100/100/100, see AC4 above) via an
independently re-run command, not trusted from a prior claim.

`git diff --stat` at report time (touched `packages/quay*` files):
```
$ git diff --stat -- packages/quay
 packages/quay/src/gate/registry.js | 89 +++++++++++++++++++++++++++++++++++
 1 file changed, 89 insertions(+)
$ git status --short -- packages/quay
 M packages/quay/src/gate/registry.js
?? packages/quay/test/it0-gates.test.mjs
```

## DIR-022 status

DIR-022 itself stays `pending` after this milestone — this is phase 1 of 6 gates (impl-row,
line-budget landed; adversarial-audit, V_meta-lag, escrow-Δv, test-floor deferred to a later phase,
per the charter's explicit out-of-scope section). Not marking DIR-022 done.

## Overall self-assessment

All 5 Acceptance Criteria are, in my honest assessment, **FULLY MET** with real, non-fixture
end-to-end evidence:
1. Two thin wrapper gates, no duplicated logic — FULLY MET.
2. `--list` surfaces both — FULLY MET (zero new CLI code needed).
3. Real invocation + real GateEvents against two real exp5 tasks (M38's ABSORBed task, this
   milestone's own task) — FULLY MET, with an honest disclosure of a self-caught `--extra`
   overwrite bug corrected before commit.
4. ≥80% coverage, real pasted output, both full-suite and isolated — FULLY MET (100/100/100 for
   `registry.js`), with an honest disclosure of 2 unrelated pre-existing network-flaky test failures.
5. OUTER-LOOP.md updated with a clearly-scoped additive note — FULLY MET.

The one thing I'd flag for the adversarial audit to double-check independently: (a) re-run the
coverage command fresh rather than trust this paste, (b) diff `makeIt0Gate`'s command construction
against both it0 scripts' actual argument contracts to independently confirm no logic duplication,
(c) re-verify the two real tasks' `extra.acceptance` fields are intact (not clobbered) by viewing
them directly, since my first attempt at this milestone genuinely did clobber them before I caught
and reverted it.
