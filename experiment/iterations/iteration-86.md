# Iteration 86

## Executive summary (read this first)

Iteration 85 recommended the experiment formally recognize "Practical
Convergence" and begin wind-down. Its independent G3 out-of-band audit
(`experiment/audits/iteration-85-independent-adjudicate.md`) returned
**PASS-WITH-CONCERNS**: every factual claim checked out, but the audit
found the recommendation premature on one specific, checkable ground —
`skeleton` (unlike `gate_correctness`, which has a genuine, argued,
65-iteration-old architectural ceiling) has **no comparable ceiling
argument** and moved as recently as iteration 76 (9-10 iterations before
85) via a repeatable, non-manufactured discovery pattern. The audit's own
recommendation: run one more, narrowly-scoped iteration specifically
attempting a fresh `skeleton`-focused search before treating V_instance
as a whole as equally ceilinged to V_meta — mirroring how this
experiment's one directly analogous historical fork (iteration 16) was
actually resolved (one more deliberately-authored increment, not
Practical Convergence declaration).

This iteration did exactly that, as directly and honestly as possible:
read `skeleton`'s exact rubric and re-read iterations 66, 69, and 76's
**full work** (not summaries) to understand precisely what kind of
increment has moved this factor. Found the pattern: a Core-`taskCheck()`-
passthrough-fidelity gap for a gate shape that already exists correctly
on a Provider's own `check()`/`checkGate()` function, closed via a
runtime-exercised, adversarially-verified (break/restore) regression
test, zero source-code change. Applying that understanding, genuinely
searched for — and found — a real, currently-open instance of it: **no
test anywhere in the repository exercises Core's `taskCheck()`
passthrough for a compound (epic) task**, on either Provider, despite
both `store.js#check()` (QN-012) and `github-client.js#checkGate()`
(QN-035) having compound-aware `childrenStatus`-rollup branches for
years of this experiment's own history. This is not a manufactured
finding — confirmed by direct grep across every `*.test.mjs` file before
writing any new code.

**QN-072** closed this gap: extended `task-check.test.mjs` (native) and
`task-check-passthrough.test.mjs` (GitHub) with new compound-rollup
passthrough cases, both positive (all children done) and negative (a
child regressed), through real stdio MCP connections on both packages,
with adversarial break/restore cycles proving real teeth on both sides.
Full regression suite: 28/28 clean. ABI symmetry unchanged. Zero
production-source diff (`git diff --stat -- 'packages/*/src/*.js'`
empty) — test-coverage-only, matching QN-069/QN-071's own established
bar exactly.

**Result: `skeleton` credited +0.01 (0.83 → 0.84). V_instance: 0.5813 →
0.5883. V_meta: unchanged (0.0973). σ_strict: 62/71 = 0.8732 (down from
62/70 = 0.8857 — honest mechanical denominator growth, same pattern as
iteration 76's own σ movement).** This breaks the 8-consecutive-flat-
iteration streak (78-85) for the first time since iteration 76 (10
iterations prior).

This directly, empirically confirms the G3 audit's specific objection was
correct: `skeleton`'s discovery pattern was not yet exhausted, only not
recently re-attempted. It does not, by itself, resolve the broader
Practical Convergence question the other way — the backlog remains
genuinely exhausted (same 4 adversarial fixtures) and `gate_correctness`/
V_meta's ceilings stand unchallenged — but it does falsify iteration 85's
specific claim that `skeleton` was "not obviously more open" than
`gate_correctness`. Per this task's own instruction and this
experiment's own iteration-16/17 precedent, the convergence decision
itself remains **surfaced for orchestrator/human sign-off, not
self-executed** here. See §11/Conclusion.

## 1. Context from prior iteration

Iteration 85 (commit `3b3df4d`) performed a whole-experiment convergence
reassessment and recommended declaring Practical Convergence, explicitly
surfacing (not self-executing) that recommendation. Its independent G3
audit (`experiment/audits/iteration-85-independent-adjudicate.md`)
returned PASS-WITH-CONCERNS, re-verifying every concrete factual claim
(σ/V arithmetic, backlog state, regression suite, ABI symmetry, git diff
scope, the `gate_correctness` 11-iteration/65-iteration claim, §7's
textual absence of "Practical Convergence" language, and DIR-025 3d's
substantive design content — all confirmed accurate) but finding the
recommendation's core generalization overstated: iteration 85 treated
`skeleton`, `abi_symmetry`, and `skill_convergence` as equally exhausted
as `gate_correctness`, but the primary-source record shows `skeleton`
specifically moved at iterations 66, 69, and 76 (most recent: 9 iterations
before 85), with no argued structural ceiling comparable to
`gate_correctness`'s explicit, 65-iteration-old architectural reasoning.

The audit also surfaced a directly relevant historical precedent this
audit itself traced: this exact "declare convergence vs. push one more
increment" fork was already reached once before, at iteration 16, and was
resolved by deliberately authoring one more targeted increment rather
than declaring convergence — which then produced `gate_correctness`'s own
last real movement at iteration 20. The audit's own recommendation: test
the `skeleton` objection directly with one narrowly-scoped search before
the human decides between declaring Practical Convergence, continuing,
or a narrower characterization.

This iteration's task, set directly from that audit's reasoning: conduct
one genuinely new, narrowly-scoped, evidence-driven search specifically
targeting `skeleton`, informed by exactly how it moved before — and to
report honestly, either way, rather than fabricate a finding to avoid a
9th flat iteration.

## 2. Preconditions checked (§0)

**§0 pending-directive check** — re-run directly:

```
$ ls -la /home/yale/work/quay/experiment/directives/pending/
DIR-021-iterations-must-themselves-run-a-fresh-manda-nested-subagent-trial.md
DIR-025-actively-explore-and-adopt-manda-nested-subagent-for-concurrent-work.md
```

Both remain pending, standing SOP (as in every iteration since their
respective filings). Neither is triggered by this iteration's work: this
was a narrowly-scoped test-coverage search for `skeleton`, not a manda
capability-borrowing or concurrent-dispatch trial. Both re-read in full
this iteration (content already reproduced/quoted in prior iterations'
reports; substance unchanged since iteration 85). Left `pending`.

**§0 G6 manda precondition** — mechanized check performed:

```
$ ps -ef | grep -i manda | grep -v grep
```

Multiple manda monitor/serve processes found (`cord`, `terminal` channels
under distinct process trees), consistent with prior iterations' findings.
Not relevant to this iteration's actual work (a source-code/test-coverage
search requires no manda action dispatch).

**Baseline verification**:

```
$ git status --short
(clean)
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -8
ℹ tests 28
ℹ pass 28
ℹ fail 0
$ node packages/quay-native/test/abi-symmetry.mjs
ALL FOUR SURFACES SYMMETRIC
```

## 3. Observe

**Step 1 — read `skeleton`'s exact definition/rubric.** From
`docs/proposal/quay-bootstrap-experiment.md` §5.1 (frozen protocol text):

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

with `skeleton` defined: "The v0 loop runs end-to-end (`config → mcp →
serve → action → Skill → done`)." No separate written numeric rubric
exists beyond this qualitative anchor plus per-iteration precedent-based
scoring (confirmed: grepped `docs/proposal/quay-bootstrap-experiment.md`
and `experiment/README.md` in full for any more granular `skeleton`
scoring table — none exists; scoring is precedent-anchored, same as this
experiment's other three V_instance factors).

**Step 2 — re-read iterations 66, 69, 76's actual work, not summaries.**
Read all three iteration reports' full `skeleton`-relevant sections
directly (not provenance.md's compact summaries):

- **Iteration 66** (`skeleton` 0.80→0.81): closed Core's `taskCheck()`
  passthrough gap for the needs-human/unrecognized-status shapes against
  the **native** Provider (QN-069) — a runtime-exercised regression test
  through a real stdio MCP connection, adversarially verified, zero
  source diff.
- **Iteration 69** (`skeleton` 0.81→0.82): ported a *direct gate-function*
  test (`checkGate()` called directly, not through Core) to the GitHub
  Provider for the same two shapes (QN-070/QN-068 lineage).
- **Iteration 76** (`skeleton` 0.82→0.83): closed the **GitHub-Provider
  sibling** of QN-069 — Core's `taskCheck()` passthrough for the same two
  shapes, but against the **GitHub** Provider specifically (QN-071),
  using a new fake-`gh` CLI fixture (`fake-gh.mjs`) to avoid touching the
  real, read-only `yaleh/quay` issue fixture. Adversarially verified via
  break/restore, same technique as 66.

**Pattern identified, precisely**: `skeleton` moves when a **genuinely
new, previously-uncovered gate-shape-fidelity gap between a Provider's
own gate function and Core's MCP-mediated passthrough of it** is closed
via a runtime-exercised, adversarially-verified regression test, with
zero production-source change. Each of the three movements is a distinct
combination of {gate shape} × {Provider} × {passthrough layer} not
previously tested.

**Step 3 — search for a real, currently-open instance of this pattern.**
Enumerated every branch/shape `store.js#check()` (native) and
`github-client.js#checkGate()` (GitHub) can return:
`author->ready` (todo), `execute->done` (ready), `done`-terminal,
`needs-human` soft-stop, unrecognized-status fallthrough, and the
**compound (epic) `childrenStatus` rollup** (QN-012, iteration 6, native;
QN-035, iteration 25/DIR-006, GitHub) — a `done`/`ready` compound task's
gate re-verifies every child is actually `done`, reporting
`stale-done`/`missing`-child detail via a `childrenStatus` array.

Grepped every `*.test.mjs` file in the repo for `compound`,
`childrenStatus`, `stale-done`, and cross-referenced against `task_check`/
`taskCheck`/`connectProvider`/`quay mcp` call sites:

```
$ grep -rln "childrenStatus\|stale-done\|compound" packages/*/test/*.test.mjs
packages/quay-github/test/gate-gameability.test.mjs
packages/quay-native/test/compound-gate.test.mjs
packages/quay-native/test/compound-gate-recursive.test.mjs
packages/quay-github/test/compound-gate.test.mjs
packages/quay-github/test/view-model.test.mjs
```

All five call the Provider's own `check()`/`checkGate()` function
**directly** (or the native `store.js` object). None connects a
compound-task fixture to `connectProvider()`, a real `quay-native mcp`/
`quay-github mcp` subprocess, or `quay mcp`'s aggregation layer — the
Core-passthrough layer QN-027/QN-069/QN-071 exist specifically to test.
Also confirmed `packages/quay/test/core-three-way-symmetry.test.mjs` and
`packages/quay/test/mcp-server.test.mjs` (the two files most likely to
carry such coverage incidentally) contain zero occurrences of
`compound`/`childrenStatus`. Also checked `provenance.md` for any prior
task with "compound"/"epic" in its title that might already cover this
— none does (QN-008/QN-012/QN-013/QN-035 all predate or are orthogonal to
the Core-passthrough-specific question).

**Confirmed genuine, previously-undiscovered gap.** Also confirmed both
MCP servers already wire compound support through with zero extra
production code needed: native's `task_check` tool calls `store.check(id)`
directly (already compound-aware since QN-012); GitHub's `task_check`
tool calls `client.check(id)`, which internally supplies its own `get()`
as the child-fetcher (already compound-aware since QN-035) — despite the
GitHub tool's own description text saying "primitive tasks only, v1" (a
stale doc comment, not an actual code restriction — read
`github-client.js#check()` directly to confirm).

## 4. Strategy

Prioritized objective: close this genuine, previously-undiscovered
Core-passthrough-fidelity gap for the compound `childrenStatus` shape, on
both Providers, following the identical OCA "Automate" pattern iterations
66/69/76 used (codifying a previously-unverified-but-correct code path
into a permanent regression test) — since it is concrete, evidence-backed,
and directly answers the G3 audit's specific, checkable objection about
`skeleton`'s discovery pattern.

No agent-insufficiency or capability-gap evidence was found that would
justify creating a new Skill/agent for this narrow test-infrastructure
task (same judgment every prior `skeleton`-only iteration reached — no
dedicated sub-agents exist in this experiment; all work performed
directly by the iteration-executor session).

## 5. Execution

### 5.1 Native-Provider compound-passthrough coverage (`task-check.test.mjs`)

Extended `packages/quay/test/task-check.test.mjs` (QN-027/QN-069's own
file) with two new cases through the existing `connectProvider()` client
(a real stdio MCP connection to `quay-native mcp`):

- Created `CHILD-DONE` (done), `CHILD-TODO` (todo), and `EPIC-STALE-DONE`
  (status `done`, `--children CHILD-DONE,CHILD-TODO` via `task edit`).
  Asserted Core's `taskCheck("EPIC-STALE-DONE")` returns
  `{gate:"none", ok:false, reason: "...CHILD-TODO (todo)...",
  childrenStatus:[...2 entries]}` unchanged.
- Created `EPIC-ALL-DONE` (status `done`, one child, genuinely `done`).
  Asserted `ok:true`, `childrenStatus` present with the correct per-child
  id/status.
- **Adversarial**: severed `EPIC-STALE-DONE`'s children (`--children ""`)
  and confirmed the passthrough correctly degrades to the plain-leaf
  `{ok:true, reason:"terminal"}` shape with no `childrenStatus` field —
  proving the prior assertions were genuinely exercising the rollup, not
  a coincidental pass.

Verbatim run:

```
$ node packages/quay/test/task-check.test.mjs
...
PASS: Core's taskCheck() passthrough surfaces the compound "done but a
  child regressed" shape unchanged, including the childrenStatus array
PASS: Core's taskCheck() passthrough surfaces the compound "all children
  done" positive shape unchanged, including per-child ids/statuses
PASS: adversarial check: severing EPIC-STALE-DONE's children makes Core's
  passthrough report the plain-leaf terminal shape, confirming the prior
  compound-shape assertions were genuinely exercising the childrenStatus
  rollup, not a coincidental pass

All QN-027/QN-069/QN-072 taskCheck passthrough tests passed.
```

### 5.2 GitHub-Provider compound-passthrough coverage (`task-check-passthrough.test.mjs`)

A compound GitHub-backed task's gate check fetches each child via a
**separate single-issue GET**, so the existing single-issue
`FAKE_GH_ISSUE_JSON` fixture mechanism (QN-071) could not directly serve
a parent+child pair. Extended `packages/quay-github/test/fixtures/
fake-gh.mjs` with a backward-compatible **multi-issue mode**
(`FAKE_GH_ISSUES_JSON`, a JSON map keyed by issue number) — existing
single-issue callers (Cases 1/2, QN-071) are entirely unaffected (verified
by re-running the full file: they still pass unchanged).

Added a `withGithubMcpForMulti()` helper and an `mkIssueObj()` builder
(renders GitHub's own lightweight parent/child convention — a
`- [ ] #<n>` checkbox line in the body — for the child reference). New
**Case 3**:

- A parent issue (closed, i.e. `done`) whose body references a child
  issue currently `open`/`status:todo`. Asserted both `quay-github mcp`'s
  own `task_check` tool and Core's `quay mcp` aggregation (`provider:
  "github"`) surface `{gate:"none", ok:false, reason:"...gh-601
  (todo)...", childrenStatus:[1 entry]}` unchanged.
- A parent issue (closed) whose child is also closed/genuinely done.
  Asserted `ok:true`, `childrenStatus` present with the correct
  `{id:"gh-<n>", status:"done"}` entry, through Core's aggregation layer.
- **Adversarial**: temporarily forced `github-client.js`'s `isCompound`
  guard to `false` in the `done` branch (the exact class of unconditional-
  rubber-stamp regression QN-012's own motivating audit finding was, on
  the native side) and confirmed the same "epic done but child todo"
  fixture now **wrongly** reports `ok:true` with no `childrenStatus` —
  proving Case 3's assertions have real teeth. Restored and confirmed
  byte-identical source.

Verbatim run (relevant excerpt):

```
$ node packages/quay-github/test/task-check-passthrough.test.mjs
...
PASS: task_check via quay-github mcp for a compound (epic) issue does not error
PASS: quay-github's own task_check tool surfaces the compound "done but a
  child not done" shape unchanged, including childrenStatus
PASS: task_check via quay mcp (provider=github) does not error for a
  compound epic with a genuinely-done child
PASS: Core's taskCheck() passthrough surfaces the compound "all children
  done" positive shape unchanged through the GitHub Provider, including
  per-child ids/statuses
PASS: adversarial check (QN-072): with isCompound forced false, the same
  "epic done but child todo" fixture now WRONGLY reports ok:true with no
  childrenStatus — confirms Case 3's ok:false/childrenStatus assertions
  above have real teeth, not merely checking passthrough plumbing
PASS: adversarial check (QN-072): github-client.js is byte-identical to
  its original content after the isCompound break/restore cycle
...
All QN-071/QN-072 GitHub-Provider taskCheck passthrough tests passed.
```

### 5.3 Full regression / ABI symmetry / source-diff verification

```
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -8
ℹ tests 28
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

$ node packages/quay-native/test/abi-symmetry.mjs
ALL FOUR SURFACES SYMMETRIC

$ git diff --stat -- 'packages/*/src/*.js'
(no output — confirmed zero production-source changes, test/fixture-only)

$ git status --short
 M packages/quay-github/test/fixtures/fake-gh.mjs
 M packages/quay-github/test/task-check-passthrough.test.mjs
 M packages/quay/test/task-check.test.mjs
?? tasks/QN-072.md
```

28/28 clean (assertion count increased inside existing files; the
`node --test`-discovered file count is unchanged from iteration 76's own
28, since these cases were added inside pre-existing test files rather
than a new one).

### 5.4 New task file

Created `tasks/QN-072.md` (`status: done`, full Proposal/Plan/AC/DoD, all
checkboxes checked), documenting this work using QN-071's own task file as
the direct structural template.

## 6. Provenance update

Appended a new entry to `experiment/provenance.md` for QN-072:
`{author_by: seed, execute_by: seed, gate_by: seed}` — performed directly
by the iteration-executor session, same as QN-069/QN-071 (no `quay:*`
Skill exists for this ad hoc test-infrastructure shape).

**σ_strict recomputation**: total tasks 70 → 71 (`ls tasks/*.md | wc -l`
= 71). The native-qualifying numerator (62) is unchanged, since QN-072
does not qualify (seed provenance, not native).

```
σ_strict = 62/71 = 0.8732  (down from 62/70 = 0.8857)
```

Honest, expected mechanical decrease — identical in kind to iteration
76's own σ movement (adding a seed-provenance task without a matching
native-provenance numerator increment). The permanent-exclusion set
(QN-003, QN-004, QN-006) is unaffected — none of the three is QN-072, and
their own status/provenance is re-confirmed unchanged this iteration.

## 7. V_instance

Exact §5.1 defining language: `V_instance = skeleton × abi_symmetry ×
gate_correctness × skill_convergence`.

**`skeleton` credited +0.01 (0.83 → 0.84)**, applying the identical
reasoning pattern iterations 55-76 used for their own new-angle-but-
same-factor-shape closures: a runtime-exercised, adversarially-verified
regression test closing a genuinely previously-uncovered branch, zero
production-source diff. Searched the closest precedent: QN-071
(iteration 76, `skeleton` 0.82→0.83) is the closest analog — same class
of gap (Core's `taskCheck()` passthrough fidelity for an existing Provider
gate shape) — but scoped to the needs-human/unrecognized-status branches.
This iteration's content is genuinely new relative to all six prior
`skeleton`-crediting iterations (55-76): a distinct branch shape entirely
(the compound `childrenStatus` rollup, never previously exercised through
Core's passthrough on either Provider) — a code path (Core's
structuredContent-forwarding logic composed with each Provider's own
recursive child-fetching gate logic) that no prior test touches or
regress-protects.

`abi_symmetry` explicitly considered and rejected: this is not a new
CLI-vs-MCP schema-equivalence claim (what `abi-symmetry.mjs` checks) — it
is a passthrough-fidelity claim for an existing gate shape against a
second, already-tested transport hop, the identical boundary QN-069/
QN-071 themselves drew for their own shapes. `gate_correctness`
explicitly considered and rejected, applying the iteration-25/62-84
precedent: zero gate-logic source changed (`git diff --stat -- 'packages/
*/src/*.js'` empty) — `store.js#check()` and
`github-client.js#checkGate()` were exercised by new tests, neither was
modified, and no new claim about gate *logic* correctness is made beyond
what QN-012/QN-035 already established years ago. `skill_convergence`
unchanged: no SKILL.md content touched, no new Skill branch exercised.

```
V_instance = 0.84 × 0.96 × 0.76 × 0.96 = 0.5883  (up from 0.5813)
```

## 8. V_meta

No methodology/Skill-content change occurred this iteration (test-
coverage/test-infrastructure work on existing production code, following
an already-established pattern — not new methodology). All three ceilinged
V_meta factors (iteration 84's standing-fact finding, re-confirmed by
iteration 85's own audit) remain unchallenged and unaffected by this
iteration's narrow scope.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973  (unchanged)
```

## 9. Out-of-band audit

Independent out-of-band audit: to be dispatched separately by the
top-level orchestrator via its own native Agent tool (not performed by
this session, per standing G3/DIR-016 discipline — this session does not
dispatch its own G3 audit).

## 10. Convergence check (§7)

Not converged under any of protocol §7's readings (dual threshold,
Meta-Focused, or the informal "Practical Convergence" pattern this
experiment has used since iteration 12/16): V_meta remains an order of
magnitude below 0.80 regardless of reading; σ_strict decreased this
iteration (0.8857 → 0.8732), a genuine, honest movement, not
diminishing-returns stasis. This iteration's own finding is that the
8-consecutive-flat-iteration plateau (78-85) is **broken** — the first
qualifying condition for "not yet in diminishing-returns territory" that
protocol §7's fifth criterion (diminishing returns) would require to be
satisfied before convergence could be declared under a strict reading.

## 11. Convergence question — direct test of the G3 audit's objection, result, and what it does/does not resolve

This iteration was explicitly tasked with testing one specific,
checkable claim from the iteration-85 audit: is `skeleton` genuinely not
yet ceiling-bound, unlike `gate_correctness`/V_meta's three factors? The
answer, established directly and empirically rather than by further
argument: **yes — the audit's objection is confirmed correct.**
`skeleton`'s discovery pattern (a fresh, previously-uncovered
Core-passthrough-fidelity gap for an existing Provider gate shape) was
not exhausted; it had simply not been re-attempted since iteration 76.
A genuine, real, non-manufactured instance of it existed and has now been
closed (QN-072).

**What this does resolve**: iteration 85's specific claim that `skeleton`
was "not obviously more open" than `gate_correctness` is now falsified by
direct evidence, not merely by argument. The honest count of "V_instance
factors with a demonstrated, currently-live discovery pattern" is not
zero — this iteration found and closed one.

**What this does not resolve**: the backlog remains genuinely, structurally
exhausted (re-confirmed: same 4 adversarial fixtures, QN-017/020/021/022,
unchanged this iteration). `gate_correctness`'s own 65+-iteration
structural ceiling (iteration 20's own architectural reasoning,
independently re-verified by iteration 85's own audit) is entirely
unaffected — this iteration made no claim about gate *logic*, only about
passthrough-fidelity test coverage of already-correct logic. V_meta's
three-factor ceiling (iteration 84's finding) likewise stands untouched.
Whether one more `skeleton`-shaped `+0.01` (and whether further instances
of this pattern remain findable — this iteration did not exhaustively
prove `skeleton` has no further headroom, only that it had at least one
more genuine instance available) constitutes enough residual V_instance
headroom to justify continued iterating, versus accepting a narrower
"V_meta-side Practical Convergence, V_instance genuinely (if narrowly)
still open" framing, is exactly the kind of judgment call this
experiment's own iteration-16/17 precedent reserves for explicit
orchestrator/human sign-off — **this iteration does not resolve that
question itself**, consistent with how iteration 85 (and the audit that
reviewed it) both explicitly declined to unilaterally resolve it.

**Recommendation to the orchestrator/human, stated plainly**: the
evidence now available is stronger and more balanced than at iteration
85's own writing. The case *against* declaring whole-experiment Practical
Convergence right now is measurably stronger than iteration 85 accounted
for (skeleton has genuine, demonstrated headroom, just tested directly).
The case *for* a narrower "V_meta-side Practical Convergence; V_instance's
`gate_correctness` factor independently ceilinged; `skeleton` genuinely
open but currently modest in scope" framing is now better evidenced than
either iteration 85's or the audit's own framing, since both were
necessarily working from argument/precedent rather than a fresh,
completed search. No unilateral wind-down or convergence action is taken
by this iteration.

## Reflection

**Learned**: the G3 audit's discipline of checking a specific, narrow,
falsifiable claim (rather than re-litigating the whole recommendation)
produced a genuinely actionable, evidence-backed follow-up task — this is
a good template for how future audits with concerns (not outright
failures) should be handled: test the specific objection directly, rather
than either accepting or re-arguing it in the abstract. It is also a
direct, positive confirmation of this experiment's own iteration-16
precedent: when a "declare convergence or push one more increment" fork
arises, actually attempting the increment is more informative than
arguing about whether it would succeed.

**Challenges**: the compound-gate gap was somewhat non-obvious to find —
it required first correctly reconstructing the *general pattern* from
iterations 66/69/76 (not just "test coverage gaps exist somewhere") and
then systematically enumerating every branch of two non-trivial gate
functions against every existing test file, rather than pattern-matching
on a superficially similar prior gap. A more shallow search (e.g., just
re-checking needs-human/unrecognized-status coverage again) would have
correctly found nothing new and risked concluding prematurely that
`skeleton` was in fact exhausted — the deeper branch-enumeration approach
is what surfaced the real gap.

**Next focus**: surfaced above (§11) — orchestrator/human sign-off on
which of the framings (A/B/C from iteration 85, refined by this
iteration's finding) to adopt. If continuing, a natural next-search
candidate (not yet verified as genuinely open, flagged honestly as
unexplored) would be whether any further gate-shape × Provider ×
passthrough-layer combination remains uncovered (e.g., `artifacts`-field
fidelity for the `author->ready` gate through Core's passthrough,
un-grepped this iteration) — this iteration deliberately stopped at the
one gap it found and rigorously verified, rather than attempting to
prove `skeleton` fully exhausted or fully open in either direction.

## Artifacts

- `tasks/QN-072.md` — new task file (compound-gate Core-passthrough
  coverage, both Providers).
- `packages/quay/test/task-check.test.mjs` — extended with native-Provider
  compound-passthrough cases + adversarial severed-children check.
- `packages/quay-github/test/task-check-passthrough.test.mjs` — extended
  with GitHub-Provider compound-passthrough cases (Case 3) + adversarial
  `isCompound`-forced-false check.
- `packages/quay-github/test/fixtures/fake-gh.mjs` — extended with a
  backward-compatible multi-issue fixture mode (`FAKE_GH_ISSUES_JSON`).
- `experiment/provenance.md` — new QN-072 entry, iteration-86 summary
  section, updated σ/V.
- `experiment/iterations/iteration-86.md` — this report.
