# Iteration 66: QN-069 — close a Core-layer test-coverage gap in `taskCheck()`'s passthrough of the gate's needs-human/unrecognized-status shapes

**Date**: 2026-07-16
**Driver**: `quay:author` + `quay:execute` (native) — task authored, executed, and gated natively; standard leaf-task lifecycle, no directive processing this iteration.
**Stage**: 2+ (native and GitHub Providers both exist; unaffected in scope by this iteration, which targets Core + native only).

## 1. Context from prior iteration

Iteration 65 ended with: σ (strict) = 60/67 = 0.8955, V_instance = 0.5603
(0.80 × 0.96 × 0.76 × 0.96), V_meta = 0.0973 (0.74 × 0.26 × 0.79 × 0.64), all
5 convergence criteria scored NO. Iteration 65 was a directive-processing
iteration (DIR-012, DIR-013 applied) with no task work and explicitly zero
V-factor movement, following a streak of three clean, audited feature-
closure iterations (62, 63, 64) that each credited `skeleton +0.01` for a
genuinely new test-coverage angle while holding all other V_instance factors
and all four V_meta factors flat.

Iteration 65's problem list (§Problems identified for next iteration)
explicitly named: `completeness`, `reusability`, and `validation` remain
the most stalled V_meta factors; `effectiveness` at 44 consecutive flat
iterations; and — most directly load-bearing for this iteration's scoping —
DIR-013 (applied iteration 65) newly codified that G3's out-of-band-audit
discipline, and by direct extension per the pre-existing `experiments/quay-native-bootstrap/
ITERATION-PROMPTS.md` §Core-scope work item 4(b), the `gate_correctness`/
`skeleton` V-factor attribution rule, apply to Core exactly as they do to a
Provider. This iteration set out to find whether that newly-codified
Core-scope lens surfaces a genuinely new (not merely repeated) test-coverage
gap — per the dispatch instructions' explicit prompt to look for "a
Core-layer gap (per DIR-013's newly-codified G3-extends-to-Core
requirement)."

## 2. Preconditions checked

```
$ ls experiments/quay-native-bootstrap/directives/pending/
(empty)
```
Confirmed empty at the start of this iteration (re-verified per instructions,
not assumed from the dispatch prompt's own framing).

`docs/proposal/quay-bootstrap-experiment.md` (read in full this session — all
six guardrails G1-G6, §5.1/§5.2's value-function product formulas, §7's five
convergence criteria), `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` (read in full, 556
lines, including the iteration-65-amended §5 terminology/DEFERRED block and
the newly-added §Core-scope work item 5), `experiments/quay-native-bootstrap/provenance.md`'s tail
(post-hoc-corrections section and the full iterations 62-65 recap entries,
including the exact factor values and reasoning chains for each), and
`experiments/quay-native-bootstrap/iterations/iteration-63.md`, `iteration-64.md`, `iteration-65.md`
(all three read in full) were all read fresh this session before any edit.

manda/gh preconditions (§0/§Stage 2+) are unaffected by this iteration's
scope (no manda dispatch or GitHub-Provider work performed) — not
re-verified live this iteration since no step depends on either; this
matches iterations 62-64's own practice of only live-checking preconditions
that the iteration's actual work depends on.

## 3. Observe

Surveyed `packages/quay/test/` (Core's own test suite) for what QN-062
through QN-068's test-coverage sweep had — and had not — touched. QN-068
(iteration 64) closed the needs-human/unrecognized-status gate-dispatch
test-coverage gap, but confirmed via `git show --stat bd7f047 -- packages/`
that it touched only `packages/quay-native/test/gate-correctness.test.mjs`
and `packages/quay-github/test/gate.test.mjs` — zero files under
`packages/quay/` (Core).

Read `packages/quay/test/task-check.test.mjs` in full (the one existing
direct regression test for Core's `taskCheck()` passthrough,
`packages/quay/src/provider-client.js`, added QN-027/iteration 13): it
covers exactly two shapes, the AC/DoD `ok:true` case and the AC/DoD
`ok:false` case, both against `packages/quay-native`'s gate. Grepped for
existing `needs-human`/`unrecognized` coverage in Core's own test files:

```
$ grep -n "needs-human\|unrecognized" packages/quay/test/task-check.test.mjs
(no output)
$ grep -rn "needs-human\|unrecognized" packages/quay/src/*.js packages/quay/test/*.mjs
packages/quay/test/mcp-server.test.mjs:288:      arguments: { id: "MCP-A1", status: "needs-human", expectedStatus: "ready", provider: "native" },
```

Read the full surrounding block of that one hit (`mcp-server.test.mjs` lines
250-322) and confirmed it uses `"needs-human"` purely as an arbitrary status
value to trigger a CAS `expectedStatus`-mismatch error in a `task_write`
test — it never calls `task_check`/`taskCheck()` against a `needs-human`
task at all.

**Gap confirmed, genuinely new relative to QN-068**: Core's own
`taskCheck()` passthrough (`provider-client.js`) — the function Core's
CLI/MCP server/Web UI actually call — has never been tested end-to-end for
the `needs-human` soft-stop or unrecognized-status shapes, only for the
AC/DoD ok:true/ok:false shapes. Confirmed live, before writing any test,
that the passthrough already behaves correctly (both shapes forward
unchanged through a real MCP connection to `quay-native mcp`):

```
$ node --input-type=module -e '
import { connectProvider } from "/home/yale/work/quay/packages/quay/src/provider-client.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const nativeBin = "/home/yale/work/quay/packages/quay-native/bin/quay-native.js";
const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "qn069-core-check-"));

execFileSync("node", [nativeBin, "task", "create", "NH-1", "--title", "t",
  "--body", "## Proposal\nlong enough proposal text to pass the section-length check here.\n## Plan\nlong enough plan text to pass the section-length check here.\n## AC\n- [ ] item\n## DoD\n- [ ] item\n"],
  { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir } });

const client = await connectProvider({ command: "node", args: [nativeBin, "mcp"], cwd: path.dirname(nativeBin), env: { QUAY_NATIVE_TASKS_DIR: tasksDir } });

const file = path.join(tasksDir, "NH-1.md");
let raw = fs.readFileSync(file, "utf8");
raw = raw.replace("status: todo", "status: needs-human");
fs.writeFileSync(file, raw);

console.log(JSON.stringify(await client.taskCheck("NH-1")));

raw = raw.replace("status: needs-human", "status: bogus-status-value");
fs.writeFileSync(file, raw);
console.log(JSON.stringify(await client.taskCheck("NH-1")));

await client.close();
fs.rmSync(tasksDir, { recursive: true, force: true });
'
{"id":"NH-1","gate":"none","ok":false,"reason":"soft stop; human action required"}
{"id":"NH-1","gate":"unknown","ok":false,"reason":"unrecognized status bogus-status-value"}
```

Both shapes pass through unchanged today — but zero regression test
protects this specific passthrough path from a future accidental regression.

## 4. Strategy

One feature increment: add the two missing cases to `packages/quay/test/
task-check.test.mjs`, adversarially verify one of them (the `needs-human`
branch, mirroring QN-068's own adversarial-verification choice), and log
QN-069 as `{native, native, native}` in provenance.md. This is a single,
narrow, test-coverage-only closure — not two unrelated features, and not a
repeat of QN-068 (different code path: Core's passthrough, not the
Providers' gate functions directly).

Considered and rejected alternative framings before settling on this scope:
- A GitHub-Provider-side equivalent Core passthrough test was considered
  (Core → `quay-github mcp` → `checkGate()`) but rejected as out of scope
  for a single narrow increment — `task-check.test.mjs` today only exercises
  the native Provider; extending it to also drive GitHub through Core would
  be a second, unrelated feature increment (two Providers × Core passthrough
  is a larger scope than "one action, one proof" calls for). Left as a
  problem for a future iteration (see §Problems below).
- Manufacturing a fabricated V_meta-movement claim (e.g. asserting this
  closes a `completeness` gap because it documents Core's own passthrough
  behavior) was considered and rejected — the standing precedent (iteration-
  9/18/29/61/63/64/65) is unambiguous that test-coverage-only closures that
  prove already-correct, unmodified behavior true do not close a
  `completeness` gap; forcing it here would repeat the exact overreach
  pattern this experiment has already corrected 13 times.

## 5. Execution

Wrote `tasks/QN-069.md` (Proposal/Plan/AC/DoD, all four artifact sections
long enough to pass the gate's own `MIN_SECTION_CHARS` heuristic — verified
this task file itself gates `ok:true` via `quay-native task check`, though
this experiment's own task files are not literally run through quay-native's
store since they live in the repo-root `tasks/` directory, not a configured
`QUAY_NATIVE_TASKS_DIR`; the AC/DoD boxes are marked `[x]` reflecting the
actually-completed state below, consistent with every prior QN-0XX task
file's own convention in this experiment).

Added two new cases to `packages/quay/test/task-check.test.mjs`, after the
existing round-trip-keys assertion:

```js
execFileSync("node", [nativeBin, "task", "create", "NH-1", "--title", "Needs-human task",
  "--body", validSections + acDodUnchecked], {
  env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
});
const nhFile = path.join(tasksDir, "NH-1.md");
fs.writeFileSync(nhFile, fs.readFileSync(nhFile, "utf8").replace("status: todo", "status: needs-human"));

const needsHuman = await client.taskCheck("NH-1");
assert(
  needsHuman.gate === "none" && needsHuman.ok === false &&
    needsHuman.reason === "soft stop; human action required",
  `Core's taskCheck() passthrough surfaces the needs-human soft-stop shape unchanged ` +
    `(got: ${JSON.stringify(needsHuman)})`
);

execFileSync("node", [nativeBin, "task", "create", "BAD-1", "--title", "Bogus-status task",
  "--body", validSections + acDodUnchecked], {
  env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
});
const badFile = path.join(tasksDir, "BAD-1.md");
fs.writeFileSync(badFile, fs.readFileSync(badFile, "utf8").replace("status: todo", "status: bogus-status-value"));

const unrecognized = await client.taskCheck("BAD-1");
assert(
  unrecognized.gate === "unknown" && unrecognized.ok === false &&
    unrecognized.reason === "unrecognized status bogus-status-value",
  `Core's taskCheck() passthrough surfaces the unrecognized-status shape unchanged ` +
    `(got: ${JSON.stringify(unrecognized)})`
);
```

Ran the new test:

```
$ node packages/quay/test/task-check.test.mjs
quay-native mcp: serving tasks from /tmp/quay-task-check-8tMijp
PASS: connectProvider() exposes a taskCheck function
PASS: taskCheck returns a non-null result for an existing task
PASS: result.id matches the requested task id
PASS: fully-checked AC/DoD task gates ok:true (got ok:true, reason:all four artifacts present; eligible to move to ready)
PASS: result includes a non-empty reason string
PASS: unchecked-AC task gates ok:false (got ok:false)
PASS: failing result still includes a reason string
PASS: result carries at least id/ok/reason (got keys: ["artifacts","gate","id","ok","reason"])
PASS: Core's taskCheck() passthrough surfaces the needs-human soft-stop shape unchanged (got: {"id":"NH-1","gate":"none","ok":false,"reason":"soft stop; human action required"})
PASS: Core's taskCheck() passthrough surfaces the unrecognized-status shape unchanged (got: {"id":"BAD-1","gate":"unknown","ok":false,"reason":"unrecognized status bogus-status-value"})

All QN-027/QN-069 taskCheck passthrough tests passed.
```

**Adversarial verification** (per the standing discipline): temporarily
removed `store.js`'s `needs-human` branch entirely (the `if (t.status ===
"needs-human") { return ...; }` block), forcing that status to fall through
to the unrecognized-status branch:

```
$ node packages/quay/test/task-check.test.mjs
...
FAIL: Core's taskCheck() passthrough surfaces the needs-human soft-stop shape unchanged (got: {"id":"NH-1","gate":"unknown","ok":false,"reason":"unrecognized status needs-human"})
PASS: Core's taskCheck() passthrough surfaces the unrecognized-status shape unchanged (got: {"id":"BAD-1","gate":"unknown","ok":false,"reason":"unrecognized status bogus-status-value"})

1 test(s) FAILED
```

The new test correctly fails with the exact expected failure mode (falls
through to the `unrecognized status needs-human` shape). Restored
`store.js` and confirmed byte-identical:

```
$ git diff --stat -- packages/quay-native/src/store.js
(no output)
$ node packages/quay/test/task-check.test.mjs
...
All QN-027/QN-069 taskCheck passthrough tests passed.
```

Full regression suite and ABI symmetry re-run:

```
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -8
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22272.979019

$ node packages/quay-native/test/abi-symmetry.mjs 2>&1 | tail -1
ALL FOUR SURFACES SYMMETRIC
```

```
$ git diff --stat -- 'packages/*/src/*.js'
(no output — confirmed zero source changes this iteration)
```

## 6. Provenance update

New task `QN-069` created and logged `{native, native, native}` in
`experiments/quay-native-bootstrap/provenance.md`. Task count: **68** (`ls tasks/QN-*.md | wc -l` =
68, up from 67).

σ (strict) = 61/68 = **0.8971** — up from 60/67 = 0.8955.

## 7. V_instance

- **skeleton**: 0.81 — credited **+0.01 (0.80 → 0.81)**, applying the
  identical reasoning pattern iterations 55-64 used for their own
  new-angle-but-same-factor-shape closures: a runtime-exercised,
  adversarially-verified regression test closing a genuinely previously-
  uncovered branch, zero source diff. This iteration's content is genuinely
  new relative to QN-068's own closure — QN-068 exercised the two
  Providers' gate functions directly; this iteration exercises the same two
  response shapes one layer up, through Core's own `taskCheck()` passthrough
  (`provider-client.js`), a code path QN-068's tests do not touch and cannot
  regress-protect.
- **abi_symmetry**: 0.96 — unchanged, explicitly considered and rejected.
  This is not a new CLI-vs-MCP schema-equivalence claim (the kind
  `abi-symmetry.mjs` checks); it is a passthrough-fidelity claim for a
  single client function.
- **gate_correctness**: 0.76 — unchanged, explicitly considered and
  rejected, applying the same iteration-25/62-65 precedent: zero gate-logic
  source changed (`git diff --stat -- 'packages/*/src/*.js'` empty) —
  `provider-client.js#taskCheck()` was not modified, only exercised by new
  tests.
- **skill_convergence**: 0.96 — unchanged. No `SKILL.md` content touched, no
  new Skill branch exercised (QN-069 is an ordinary leaf task using the
  standard gated lifecycle).
- **Total**: `0.81 × 0.96 × 0.76 × 0.96 = 0.5673` — up from 0.5603.

## 8. V_meta

- **completeness**: 0.74 — unchanged, explicitly considered and rejected.
  No Method/Skill content was edited this iteration (the shipped change is
  one test file) — Core's passthrough logic already behaved correctly; this
  iteration proves it true at runtime, it does not close a gap in the
  Method's own self-containedness (§5.2's literal scope, per the
  iteration-9/18/29/61/63/64 precedent chain). Explicitly checked whether
  `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`'s §Core-scope work item 4(b) opens a
  `completeness` avenue for Core-layer work — it does not: that item maps
  Core-level *gate-logic changes* to `gate_correctness`/`skeleton`/
  `abi_symmetry`, and this iteration has zero gate-logic change.
- **effectiveness**: 0.26 — unchanged. No scope-matched timing comparator
  exists for this task's specific shape (a passthrough-fidelity unit test
  with an adversarial break/restore cycle, no live `gh api` call);
  manufacturing one would repeat the twelfth/thirteenth correction's exact
  category of error.
- **reusability**: 0.79 — unchanged. This iteration touches zero GitHub-
  Provider content at all (scope is Core + native only) — an even more
  clear-cut case for flat than QN-068's own cross-Provider-symmetric change,
  per the direct, on-point, repeatedly-applied precedent (QN-034, QN-048,
  QN-067, QN-068, and every negative/error-path/test-coverage closure since
  iteration 26 — 40 consecutive flat iterations before this one).
- **validation**: 0.64 — held flat, reserved for the top-level
  orchestrator's independent out-of-band audit of this iteration, per
  standing practice.
- **Total**: `0.74 × 0.26 × 0.79 × 0.64 = 0.0973` — unchanged.

**Why no further V_meta movement is claimed, explicitly reasoned rather
than defaulted:** this iteration is a genuine test-coverage-only closure —
it proves an already-correct, unmodified Core passthrough function true at
runtime for two previously-unexercised shapes. None of the four V_meta
factors' defining language (§5.2) is met by that description: no methodology
documentation was added or changed (`completeness`); no marginal *feature*
increment exists to time against the stage-0 baseline, only a test addition
(`effectiveness`); no GitHub-Provider transfer-target content changed
(`reusability`); and `validation` is reserved for the independent audit,
per standing practice across every prior iteration.

## 9. Out-of-band audit

Not run by this session — per standing practice, the top-level orchestrator
dispatches the independent G3 audit (native subagent, fresh context)
separately, out of band from this report, against
`experiments/quay-native-bootstrap/audits/iteration-66-independent-adjudicate.md`. This iteration's
own work is left in a clean, auditable state for that dispatch: `tasks/
QN-069.md` states the Proposal/Plan/AC/DoD with the verbatim pre-task and
post-adversarial-verification command outputs; `packages/quay/test/
task-check.test.mjs`'s diff is small and self-contained (42 insertions, one
file); `git diff --stat -- 'packages/*/src/*.js'` is empty; the adversarial
break/restore cycle's exact failure-mode output is reproduced verbatim in
§5 above for independent re-running.

## 10. Convergence Check

- [ ] 1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80) — **NO**.
      V_instance = 0.5673 < 0.80; V_meta = 0.0973 < 0.80.
- [ ] 2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set +
      gate) — **NO**. σ = 0.8971, not 1; no fixpoint-reproduction test has
      been run.
- [ ] 3. Contract proven (native + GitHub both run) — **NO** in the
      fixpoint-declaration sense (protocol §14's ABI-stability bar); both
      Providers exist and both pass their own regression suites (confirmed
      this iteration: 26/26), but ABI stability has not been formally
      declared.
- [ ] 4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
      sign-off) — **NO** for the human fixpoint sign-off (not triggered;
      this is not the fixpoint iteration). The mechanical co-sign for *this*
      iteration is pending the top-level orchestrator's separate dispatch
      (see §9); the clean-audit streak (iterations 62-65) stands unaffected
      by this iteration's own scoring.
- [ ] 5. Diminishing returns (ΔV < 0.02 for 2+ iterations) — **NO** in the
      sense the criterion is meant (V still far below threshold); ΔV_instance
      this iteration = 0.0070, small but nonzero, continuing the same
      incremental-closure pattern as iterations 55-64.

**Status**: NOT CONVERGED.

## Evolution Decisions

No Skill/gate/ABI content was created or modified this iteration (A_65 =
A_66, M_65 = M_66). Per the evolution guidance ("Evolve a Skill/capability
only on: retrospective evidence + a demonstrated gap + a documented
attempted alternative that failed"), no such demonstrated necessity arose —
this iteration's gap (Core-passthrough test coverage) was closed by adding
tests, not by changing the Skill roster, gate logic, or orchestration
Skills. No evolution is warranted or claimed.

## Artifacts Created

- `tasks/QN-069.md` (new task file, status `done`).
- `packages/quay/test/task-check.test.mjs` (extended: 2 new assertions plus
  fixture setup, 42 insertions).
- `experiments/quay-native-bootstrap/provenance.md` (new "Iteration 66" section).
- `experiments/quay-native-bootstrap/iterations/iteration-66.md` (this file).

## Reflections

This iteration deliberately looked for a genuinely new angle rather than
repeating QN-062 through QN-068's already-exhausted Provider-level sweep,
per the dispatch instructions' explicit steer toward "a Core-layer gap (per
DIR-013's newly-codified G3-extends-to-Core requirement)." The gap found —
Core's own `taskCheck()` passthrough never having direct test coverage for
two of the gate's five response shapes — is real and previously
undiscovered, confirmed by grepping and reading every existing use of the
strings `"needs-human"` and `"unrecognized"` in `packages/quay/`'s own test
suite before writing anything. The discipline that mattered most this
iteration was resisting the temptation to over-credit: it would have been
easy to reach for `completeness` or a Core-specific new factor, given
DIR-013's freshly-codified Core-scope language, but a careful re-read of
item 4(b)'s actual text (Core-level *gate-logic changes* map to
`gate_correctness`, not a new factor) and the fact that zero source changed
this iteration meant the honest answer was: `skeleton +0.01` only, same as
the entire streak, V_meta flat across all four factors.

A second discipline point: this iteration explicitly considered and
rejected extending scope to also drive the GitHub Provider through Core's
passthrough (a natural-seeming "while we're here" addition), correctly
identifying that as a second, unrelated feature increment rather than part
of "one action, one proof" for this task. That is left as an explicit,
named problem for a future iteration rather than silently absorbed or
silently dropped.

## Problems identified for next iteration

1. **Core → GitHub-Provider `taskCheck()` passthrough is untested for
   these same two shapes.** `packages/quay/test/task-check.test.mjs` only
   ever drives `quay-native mcp`; a future iteration could extend Core's
   own passthrough test coverage to also exercise `quay-github mcp`'s
   `needs-human`/unrecognized-status shapes through Core, completing the
   3-way (native-direct, GitHub-direct, Core-via-either) coverage matrix
   this iteration's own scoping decision explicitly deferred.
2. **`completeness`, `reusability`, and `validation` remain the most
   stalled V_meta factors** (57, 41, and ~56 consecutive flat iterations
   respectively); `effectiveness` at 45 consecutive flat iterations (23-66,
   net). A genuine `completeness` or `reusability` opportunity (methodology
   documentation work that is actually quay-native's own Skill/gate
   content, or a real GitHub-Provider transfer-target change) remains the
   standing open gap for whichever future iteration finds one.
3. **The test-coverage sweep is nearing full exhaustion at the unit-test
   granularity.** QN-062 through QN-069 have now covered: cross-Provider
   read-path, provider-startup-failure, malformed/null-body input,
   mid-session live-API-failure, CLI-subprocess exit-code propagation,
   fallback-ranking, gate-dispatch (needs-human/unrecognized-status) on
   both Providers directly, and now the same gate-dispatch shapes through
   Core's own passthrough. Future iterations should consider whether a
   qualitatively different kind of work (methodology/Skill documentation,
   an actual GitHub-Provider transfer-target increment, or fixpoint-test
   preparation) is now more likely to yield genuine V_meta movement than a
   further test-coverage angle, without forcing it if none is honestly
   available.
