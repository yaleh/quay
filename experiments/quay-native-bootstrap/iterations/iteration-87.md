# Iteration 87

## Executive summary (read this first)

Iteration 86 broke an 8-consecutive-flat-iteration streak (78-85) by
finding and closing a genuine, previously-undiscovered gap in `skeleton`:
Core's `taskCheck()` passthrough had never been exercised, on either
Provider, for a compound (epic) task's `status: done` `childrenStatus`
rollup. Its independent G3 audit
(`experiments/quay-native-bootstrap/audits/iteration-86-independent-adjudicate.md`) returned
**PASS**, including its own first-party adversarial re-verification of
the load-bearing "no prior test exercises this" claim. The audit left one
question explicitly open: whether iteration 86's find was an isolated
pocket, or the edge of a larger uncovered vein — recommending "one more,
narrowly-scoped iteration specifically attempting a fresh skeleton-focused
search."

This iteration did exactly that, applying iteration 86's own validated
methodology: read `skeleton`'s rubric, then **exhaustively** enumerate
every branch of `store.js#check()` (native) and
`github-client.js#checkGate()` (GitHub) — not just the compound-shaped
branch iteration 86 touched, but every branch — and cross-reference each
against the full test suite's *actual* exercised code paths (reading what
each test really calls, not just filenames).

**Enumeration result**: `todo` (author->ready) has zero compound-specific
logic on either Provider — closed off as a non-candidate. `needs-human`
and unrecognized-status are fully covered (QN-068/069/071). `done`-terminal
is exactly what QN-072 (iteration 86) closed. That leaves exactly one
remaining branch with its own, separate compound-rollup guard never
exercised through Core's passthrough: the **`status: ready`**
(`execute->done`) branch. This is genuinely distinct from QN-072's case —
a separate `if` block in both `store.js` and `github-client.js`, with its
own `childrenOk` computation that is **directly ANDed into the gate's own
`ok` value** (`ok = acOk && childrenOk`), unlike the `done` branch's purely
informational, after-the-fact rollup. Confirmed via direct grep across
every `*.test.mjs` file: no existing test connects a `status: ready`
compound fixture to `connectProvider()`, a real MCP subprocess, or `quay
mcp`'s aggregation layer — `compound-gate.test.mjs`'s own ready-branch
cases call `store.check()` directly, in-process, never through the MCP
transport.

**QN-073** closed this gap: extended both `task-check.test.mjs` (native)
and `task-check-passthrough.test.mjs` (GitHub) with new ready-compound
passthrough cases (negative: AC complete but a child still `todo`;
positive: AC complete and all children genuinely done), through real
stdio MCP connections, with adversarial break/restore verification on
both sides (native: severing the epic's children; GitHub: forcing
`isCompound` false specifically in the **`ready`** branch — a distinct
source location from QN-072's `done`-branch edit). Full regression suite:
28/28 clean. ABI symmetry unchanged. Zero production-source diff.

A second, thinner candidate (the `artifacts`-field, flagged by iteration
86 as an unexplored "next focus") was also checked and explicitly
**declined** — judged already indirectly exercised and too thin to
justify a finding, honoring this iteration's explicit instruction not to
manufacture one.

**Result: `skeleton` credited +0.01 (0.84 → 0.85). V_instance: 0.5883 →
0.5954. V_meta: unchanged (0.0973). σ_strict: 62/72 = 0.8611 (down from
62/71 = 0.8732 — honest mechanical denominator growth, same pattern as
iterations 76/86's own σ movement).** This is the second consecutive
`skeleton` movement.

Unlike iteration 86, however, this iteration's search was **exhaustive**,
not merely a fresh attempt: every branch of both gate functions was
enumerated and checked, and exactly one genuine gap was found — the
`ready`-branch case. With that closed, the check()/checkGate()-branch
discovery vein that has produced every `skeleton` movement since iteration
55 (through 55, 66, 69, 76, 86, and now 87) is now **demonstrated
exhausted** by direct enumeration, not merely "not recently re-attempted"
(iteration 86's own weaker caveat). This is new information the
orchestrator/human did not have at iteration 86's writing: it narrows,
rather than reopens, the case for continued `skeleton`-side iterating.
The convergence decision itself remains **surfaced for orchestrator/human
sign-off, not self-executed** here, per this experiment's standing
iteration-16/85/86 precedent. See §11/Conclusion.

## 1. Context from prior iteration

Iteration 86 (commit to be confirmed via `git log`) found and closed
QN-072, moving `skeleton` 0.83→0.84 and V_instance 0.5813→0.5883, breaking
the 8-flat-iteration streak (78-85). Its independent G3 audit
(`experiments/quay-native-bootstrap/audits/iteration-86-independent-adjudicate.md`) returned
**PASS** — re-verifying every concrete claim (the exhaustive-grep claim
that no prior test exercised Core's passthrough for the compound rollup,
the σ/V arithmetic, the 28/28 regression count, ABI symmetry, zero
production diff) and additionally performing its own first-party
adversarial revert of `store.js`'s done-branch guard to independently
confirm genuine test teeth (not merely trusting iteration 86's own
break/restore log).

The audit's own explicit, unresolved question: was QN-072's find an
isolated pocket in an otherwise-exhausted `skeleton` factor, or evidence
of a still-live discovery vein with further headroom? It recommended "one
more, narrowly-scoped iteration specifically attempting a fresh
skeleton-focused search" before treating the matter as settled either
way. This iteration's task, set directly from that recommendation: conduct
that search — systematically, not just plausibly — and report honestly
whichever way it comes out, without manufacturing a finding to avoid a
flat iteration or, symmetrically, without stopping short of a genuine one
out of excess caution.

## 2. Preconditions checked (§0)

**§0 pending-directive check** — re-run directly:

```
$ ls -la /home/yale/work/quay/experiments/quay-native-bootstrap/directives/pending/
DIR-021-iterations-must-themselves-run-a-fresh-manda-nested-subagent-trial.md
DIR-025-actively-explore-and-adopt-manda-nested-subagent-for-concurrent-work.md
```

Both re-read in full. Both remain pending, standing SOP. Neither is
triggered by this iteration's work: this is a narrowly-scoped source-
enumeration and test-coverage task, not a manda capability-borrowing or
concurrent-dispatch trial — the identical judgment iteration 86 (and every
prior `skeleton`-only iteration) reached for the same reason. Left
`pending`.

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

**Step 1 — re-read `skeleton`'s rubric.** Same frozen §5.1 anchor as
iteration 86 found: `V_instance = skeleton × abi_symmetry ×
gate_correctness × skill_convergence`, with `skeleton` defined
qualitatively ("the v0 loop runs end-to-end"), scored precedent-anchored,
no separate numeric table (re-confirmed: no such table exists in either
`docs/proposal/quay-bootstrap-experiment.md` or `experiments/quay-native-bootstrap/README.md`).

**Step 2 — full, branch-by-branch read of both gate functions**, not just
the compound-shaped one iteration 86 touched.

`packages/quay-native/src/store.js#check(id)` (lines 341-476):

- `todo` branch (author->ready): computes AC/DoD/artifacts checks only.
  **No compound-specific logic at all** — read directly, confirmed no
  reference to `children`, `childrenStatus`, or `isCompound` anywhere in
  this branch.
- `ready` branch (execute->done): computes `acOk` from AC checkboxes, then
  (new finding this iteration) a **separate, distinct** block:
  `const childrenOk = kids.every((c) => c.status === "done");` when the
  task is compound, with `const ok = acOk && childrenOk` — i.e.
  `childrenOk` is **directly gating the actual `ok` result**, not merely
  annotating it.
- `done`-terminal branch: has its own, separate compound-rollup guard —
  this is exactly QN-072's (iteration 86's) case: informational/
  corrective (`ok:false` specifically because a `done` task's child
  regressed), not gate-blocking in the same sense.
- `needs-human`: soft-stop, no compound logic, covered (QN-068/069/071).
- unrecognized-status: fallthrough, no compound logic, covered.

`packages/quay-github/src/github-client.js#checkGate(task, getChildTask)`
(lines 356-470): confirmed structurally identical branch shape — its own
separate `isCompound`/`childrenOk` guard in the `ready` branch (~lines
410-413), distinct from its own separate guard in the `done` branch
(QN-072's case).

**This exhaustive branch-by-branch read is the key methodological
difference from iteration 86's own search**: rather than pattern-matching
against the general "gate-shape-fidelity gap" template and searching for
any instance of it, every single branch of both functions was read and
classified this iteration, closing off `todo` explicitly as a
non-candidate (previously left implicit/unstated) and identifying the
`ready` branch as the one remaining genuinely-distinct candidate.

**Step 3 — cross-reference against actual test coverage**, reading what
each test really calls (not filenames):

```
$ grep -rln "childrenStatus\|stale-done\|compound\|childrenOk" packages/*/test/*.test.mjs
packages/quay-github/test/gate-gameability.test.mjs
packages/quay-native/test/compound-gate.test.mjs
packages/quay-native/test/compound-gate-recursive.test.mjs
packages/quay-github/test/compound-gate.test.mjs
packages/quay-github/test/view-model.test.mjs
packages/quay/test/task-check.test.mjs
packages/quay-github/test/task-check-passthrough.test.mjs
```

The last two are QN-072's own additions (iteration 86) — read in full to
confirm precisely what they cover: **only the `done`-branch compound
rollup**, through Core's passthrough. The other five all call
`store.check()`/`client.checkGate()` **directly**, in-process — confirmed
by reading `compound-gate.test.mjs`'s (native) own Cases 4/5, which *do*
exercise the `ready`-branch compound rollup, but exclusively via a direct
`store.check(id)` call, never through `connectProvider()`, a real
`quay-native mcp`/`quay-github mcp` subprocess, or `quay mcp`'s
aggregation layer. Also re-confirmed `core-three-way-symmetry.test.mjs`
and `mcp-server.test.mjs` contain zero occurrences of
`compound`/`childrenStatus`/`childrenOk`.

**Confirmed genuine, previously-undiscovered gap**: the `status: ready`
compound rollup, specifically through Core's `taskCheck()` passthrough, on
both Providers. Both MCP servers already wire it through correctly with
zero extra production code needed (same finding pattern as QN-069/071/072:
`store.check()` and `client.check()` already handle this; only test
coverage of the passthrough itself is missing).

**Step 4 — the declined `artifacts`-field candidate.** Iteration 86
flagged, as an unexplored "next focus," whether `artifacts`-field fidelity
for the `author->ready` gate through Core's passthrough might be a further
gap. Checked directly this iteration: `task-check.test.mjs`'s own existing
(pre-iteration-86) assertions already exercise the `artifacts` field
through Core's passthrough for the plain-leaf `todo` case (`"result
carries at least id/ok/reason (got keys: [...,"artifacts",...])"` — see
iteration 86's own verbatim test output, §5.1). The remaining question
would be whether a *compound* task's `artifacts` field specifically
differs in shape through the passthrough — but the `todo` branch has no
compound-specific logic at all (confirmed Step 2 above), so a compound
task's `artifacts` field is computed identically to a primitive task's;
there is no distinct code path to test. Judged this candidate too thin —
already indirectly exercised, no distinct branch behind it — and
deliberately **not** manufactured into a finding, honoring this
iteration's explicit instruction.

## 4. Strategy

Prioritized objective: close the one genuine, previously-undiscovered gap
found (the `ready`-branch compound rollup through Core's passthrough, both
Providers), using the identical OCA "Automate" pattern iterations
66/69/76/86 established — codifying an already-correct-but-unverified code
path into a permanent, adversarially-verified regression test.

No agent-insufficiency or capability-gap evidence was found that would
justify creating a new Skill/agent for this narrow test-infrastructure
task — same judgment every prior `skeleton`-only iteration reached.

## 5. Execution

### 5.1 Native-Provider ready-compound-passthrough coverage (`task-check.test.mjs`)

Extended `packages/quay/test/task-check.test.mjs` (QN-027/069/072's own
file) with new cases through the existing `connectProvider()` client (a
real stdio MCP connection to `quay-native mcp`):

- Created `EPIC-READY-CHILD-TODO` (status `ready`, AC fully checked,
  `--children CHILD-DONE,CHILD-TODO`). Asserted Core's
  `taskCheck("EPIC-READY-CHILD-TODO")` returns `{gate:"execute->done",
  ok:false, reason: "...not all children are done: CHILD-TODO
  (todo)...", childrenStatus:[...2 entries]}` unchanged.
- Created `EPIC-READY-ALL-DONE` (status `ready`, AC fully checked, one
  genuinely-`done` child). Asserted `ok:true`, `childrenStatus` present
  with the correct per-child id/status.
- **Adversarial**: severed `EPIC-READY-CHILD-TODO`'s children
  (`--children ""`) and confirmed the passthrough now reports `ok:true`
  with no `childrenStatus` field (the epic's own AC is fully checked, so
  this proves the prior `ok:false` was genuinely gated on the children
  check, not AC state).

Verbatim run:

```
$ node packages/quay/test/task-check.test.mjs
...
PASS: Core's taskCheck() passthrough surfaces the ready-compound "AC
  complete but a child still todo" shape unchanged, including the
  childrenStatus array (got: {"id":"EPIC-READY-CHILD-TODO",
  "gate":"execute->done","ok":false,"acTotal":1,"acChecked":1,
  "reason":"AC checkboxes complete, but not all children are done:
  CHILD-TODO (todo)","childrenStatus":[{"id":"CHILD-DONE",
  "status":"done"},{"id":"CHILD-TODO","status":"todo"}]})
PASS: Core's taskCheck() passthrough surfaces the ready-compound "AC
  complete and all children done" positive shape unchanged, including
  per-child ids/statuses (got: {"id":"EPIC-READY-ALL-DONE",
  "gate":"execute->done","ok":true,"acTotal":1,"acChecked":1,
  "reason":"all AC checkboxes checked; eligible to move to done",
  "childrenStatus":[{"id":"CHILD-DONE","status":"done"}]})
PASS: adversarial check (QN-073): severing EPIC-READY-CHILD-TODO's
  children makes Core's passthrough report ok:true with no
  childrenStatus (got: {"id":"EPIC-READY-CHILD-TODO",
  "gate":"execute->done","ok":true,"acTotal":1,"acChecked":1,
  "reason":"all AC checkboxes checked; eligible to move to done"}),
  confirming the prior ok:false assertion was genuinely gated on the
  children check, not AC state

All QN-027/QN-069/QN-072 taskCheck passthrough tests passed.
```

(Console banner text unchanged from iteration 86's file — no update was
made to this specific log line, since it predates individual task-id
citation conventions used elsewhere; the QN-073 cases are cited inline in
each PASS message instead, consistent with how QN-072's own cases were
labeled in this same file.)

### 5.2 GitHub-Provider ready-compound-passthrough coverage (`task-check-passthrough.test.mjs`)

Extended `packages/quay-github/test/task-check-passthrough.test.mjs`
(QN-071/072's own file) reusing the existing `FAKE_GH_ISSUES_JSON`
multi-issue fixture mode (added in QN-072) and its `withGithubMcpForMulti`/
`mkIssueObj` helpers. Added **Case 4** (QN-073):

- A parent issue labeled `status:ready` (open) whose body references a
  child issue currently `open`/`status:todo`. Asserted both
  `quay-github mcp`'s own `task_check` tool and Core's `quay mcp`
  aggregation (`provider: "github"`) surface `{gate:"execute->done",
  ok:false, reason:"...gh-611...", childrenStatus:[1 entry]}` unchanged.
- A parent issue labeled `status:ready` whose child is genuinely closed/
  done. Asserted `ok:true`, `childrenStatus` present with the correct
  `{id:"gh-<n>", status:"done"}` entry, through Core's aggregation layer.
- **Adversarial**: temporarily forced `github-client.js`'s `isCompound`
  guard to `false` specifically in the **`ready`** branch — a distinct
  source location/needle text from QN-072's own `done`-branch adversarial
  edit — and confirmed the same fixture now **wrongly** reports `ok:true`
  with no `childrenStatus`. Restored and confirmed byte-identical source
  via the test's own `assert(restored === original, ...)` check.

Verbatim run (relevant excerpt):

```
$ node packages/quay-github/test/task-check-passthrough.test.mjs
...
PASS: task_check via quay-github mcp for a ready compound (epic) issue
  does not error
PASS: quay-github's own task_check tool surfaces the ready-compound "AC
  complete but a child not done" shape unchanged, including
  childrenStatus
PASS: task_check via quay mcp (provider=github) does not error for a
  ready compound epic with a genuinely-done child
PASS: Core's taskCheck() passthrough surfaces the ready-compound "all
  children done" positive shape unchanged through the GitHub Provider,
  including per-child ids/statuses
PASS: adversarial check (QN-073): with isCompound forced false in the
  READY branch, the same "ready epic, AC complete, child still todo"
  fixture now WRONGLY reports ok:true with no childrenStatus — confirms
  Case 4's ok:false/childrenStatus assertions above have real teeth, and
  exercise a distinct code path from QN-072's own done-branch adversarial
  edit
PASS: adversarial check (QN-073): github-client.js is byte-identical to
  its original content after the ready-branch isCompound break/restore
  cycle
...
All QN-071/QN-072/QN-073 GitHub-Provider taskCheck passthrough tests
passed.
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
(no output — confirmed zero production-source changes, test-file-only)

$ git status --short
 M experiments/quay-native-bootstrap/provenance.md
 M packages/quay-github/test/task-check-passthrough.test.mjs
 M packages/quay/test/task-check.test.mjs
?? tasks/QN-073.md
```

28/28 clean (assertion count increased inside existing files; file count
unchanged from iteration 86's own 28, since new cases were added inside
pre-existing test files, not new `node --test`-discovered ones).

### 5.4 New task file

Created `tasks/QN-073.md` (`status: done`, full Proposal/Plan/AC/DoD, all
checkboxes checked), using `tasks/QN-072.md` as the direct structural
template, explicitly documenting why this is a distinct gap (not a
duplicate) — the `ready`-branch's `childrenOk` directly gates `ok`, vs.
the `done`-branch's purely informational rollup.

## 6. Provenance update

Appended a new entry to `experiments/quay-native-bootstrap/provenance.md` for QN-073:
`{author_by: seed, execute_by: seed, gate_by: seed}` — performed directly
by the iteration-executor session, same as QN-069/QN-071/QN-072 (no
`quay:*` Skill exists for this ad hoc test-infrastructure shape).

**σ_strict recomputation**: total tasks 71 → 72
(`ls tasks/QN-*.md | wc -l` = 72). The native-qualifying numerator (62) is
unchanged, since QN-073 does not qualify (seed provenance, not native).

```
$ ls tasks/QN-*.md | wc -l
72
$ grep -h "^status:" tasks/QN-*.md | sort | uniq -c
     68 status: done
      3 status: needs-human
      1 status: todo

σ_strict = 62/72 = 0.8611  (down from 62/71 = 0.8732)
```

Honest, expected mechanical decrease — identical in kind to iterations
76/86's own σ movement (adding a seed-provenance task without a matching
native-provenance numerator increment). The permanent-exclusion set
(QN-003, QN-004, QN-006) is unaffected — none of the three is QN-073, and
their own status/provenance is re-confirmed unchanged this iteration.

## 7. V_instance

Exact §5.1 defining language: `V_instance = skeleton × abi_symmetry ×
gate_correctness × skill_convergence`.

**`skeleton` credited +0.01 (0.84 → 0.85)**, applying the identical
reasoning pattern iterations 55-86 used: a runtime-exercised,
adversarially-verified regression test closing a genuinely
previously-uncovered branch, zero production-source diff. This iteration's
content is genuinely distinct from iteration 86's own QN-072: a separate
`if` block in both gate functions, with `childrenOk` playing a
structurally different role (directly gating `ok` in the `ready` branch,
vs. purely informational in the `done` branch) — not a re-application of
the same finding under a different label.

`abi_symmetry` explicitly considered and rejected: same reasoning as
iteration 86 — this is a passthrough-fidelity claim for an existing gate
shape against an already-tested transport hop, not a new CLI-vs-MCP
schema-equivalence claim. `gate_correctness` explicitly considered and
rejected: zero gate-logic source changed (`git diff --stat -- 'packages/
*/src/*.js'` empty); `store.js#check()` and
`github-client.js#checkGate()` were exercised by new tests, neither was
modified. `skill_convergence` unchanged: no SKILL.md content touched.

```
V_instance = 0.85 × 0.96 × 0.76 × 0.96 = 0.5954  (up from 0.5883)
```

## 8. V_meta

No methodology/Skill-content change occurred this iteration (test-
coverage/test-infrastructure work on existing production code, following
an already-established pattern — not new methodology). All three ceilinged
V_meta factors (iteration 84's standing-fact finding, re-confirmed by
iterations 85/86's own audits) remain unchallenged and unaffected by this
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
iteration (0.8732 → 0.8611), a genuine, honest movement, not
diminishing-returns stasis. This is the second consecutive iteration with
a genuine `skeleton`/V_instance movement (86, 87) — the diminishing-
returns criterion (protocol §7's fifth) is, if anything, further from
being satisfied than at iteration 86's own writing, on a strict reading of
"has V_instance stopped moving."

## 11. Convergence question — was iteration 86's find an isolated pocket, or a live vein? Result, and what it does/does not resolve

This iteration was explicitly tasked with resolving the specific,
checkable question the iteration-86 audit left open: is there further
genuine `skeleton` headroom beyond QN-072, in the same discovery pattern?
The answer, established directly and empirically via **exhaustive**
branch enumeration (every branch of both gate functions, not just a fresh
pattern-matching attempt): **yes, exactly one more genuine instance
existed** — the `ready`-branch compound rollup (QN-073) — and it has now
been closed.

**What this does resolve**: iteration 86's find (QN-072) was not an
isolated pocket; the compound-rollup passthrough-fidelity gap had (at
least) two genuine instances, not one. It also resolves, for the first
time with genuinely exhaustive evidence rather than a fresh-but-partial
search, whether the check()/checkGate()-branch discovery vein itself is
now exhausted: having enumerated **every** branch of both gate functions
(`todo`/`ready`/`done`/`needs-human`/unrecognized) and found and closed
the only two genuinely gate-blocking or gate-informing compound-rollup
shapes among them, there is no remaining branch-shape combination left to
search in this specific vein. The declined `artifacts`-field candidate
was checked and found to have no distinct code path behind it in the one
branch (`todo`) where it might have mattered.

**What this does not resolve**: the backlog remains genuinely, structurally
exhausted (same 4 adversarial fixtures, QN-017/020/021/022, unchanged).
`gate_correctness`'s own 65+-iteration structural ceiling is entirely
unaffected — this iteration made no claim about gate *logic*, only about
passthrough-fidelity test coverage of already-correct logic. V_meta's
three-factor ceiling likewise stands untouched. And — importantly, stated
honestly rather than overclaimed — this iteration's exhaustive-enumeration
claim is scoped specifically to the check()/checkGate()-branch
passthrough-fidelity vein; it does not prove `skeleton` as a whole (a
qualitative, precedent-scored factor covering "the v0 loop runs
end-to-end") has zero further headroom from any conceivable angle, only
that this particular, twice-productive discovery vein is now demonstrated
closed by direct enumeration rather than by absence of a fresh attempt.

**Recommendation to the orchestrator/human, stated plainly**: this
iteration's evidence, taken together with iteration 86's, now supports a
*narrower and more specific* framing than either iteration 85's original
"Practical Convergence" claim or iteration 86's own more cautious
"skeleton has at least some headroom, depth undetermined" finding. The
specific vein that produced both iteration 86's and this iteration's
movements is now shown, by exhaustive branch enumeration (not absence of
search), to be closed. This firms up — does not weaken — the case that
`skeleton`'s remaining headroom, if any, now lies in a different, as-yet
unidentified vein (structurally comparable to how `gate_correctness`'s own
ceiling was established: a specific vein demonstrated exhausted, not a
blanket claim about the whole factor). Two consecutive genuine V_instance
movements (86, 87) are still fresh, honest evidence against declaring
*full* Practical Convergence this iteration; but the specific, concrete,
previously-open question the iteration-86 audit posed — "was this an
isolated pocket?" — is now answered: it was a two-instance pocket, and
that pocket is now empty. No unilateral wind-down or convergence action is
taken by this iteration; the decision remains for orchestrator/human
sign-off.

## Reflection

**Learned**: the difference between "a fresh attempt using the known
pattern" (iteration 86) and "an exhaustive enumeration of every branch"
(this iteration) is methodologically significant and produces a
qualitatively stronger claim. Iteration 86 correctly found a real gap but
could only honestly claim "not recently re-attempted, so possibly more
exists." This iteration's explicit branch-by-branch classification (with
`todo` closed off as a genuine non-candidate, not merely unexamined) is
what allows the stronger "this vein is now exhausted" claim rather than
another "found one more, depth still undetermined" repeat.

**Challenges**: distinguishing a genuinely distinct gap from a
superficially-similar duplicate required careful attention to *why* two
branches with the same surface shape (`childrenStatus` rollup) are
actually different findings — the `ready` branch's `childrenOk` directly
gates the transition, while the `done` branch's rollup is corrective
metadata after the fact. Getting this distinction right (and stating it
explicitly, both in the task file and in this report) was necessary to
avoid the appearance of re-crediting the same discovery twice under a
different label.

**Next focus**: per §11, the recommendation is for the orchestrator/human
to weigh the now-stronger, narrower framing: the specific check()/
checkGate()-branch vein is demonstrated exhausted; any further `skeleton`
headroom, if it exists, would need to come from a genuinely different
angle (not yet identified, and this iteration deliberately did not search
further afield to avoid manufacturing a third finding under time
pressure). If continuing, a natural next step would be a genuinely fresh
search outside the check()/checkGate()-passthrough vein entirely (e.g.
other Core-aggregation surfaces such as `task_list`/`action_list`
filtering fidelity across Providers) — flagged honestly as unexplored and
unverified, not as a known-open gap.

## Artifacts

- `tasks/QN-073.md` — new task file (ready-compound Core-passthrough
  coverage, both Providers).
- `packages/quay/test/task-check.test.mjs` — extended with native-Provider
  ready-compound-passthrough cases + adversarial severed-children check.
- `packages/quay-github/test/task-check-passthrough.test.mjs` — extended
  with GitHub-Provider ready-compound-passthrough cases (Case 4) +
  adversarial ready-branch `isCompound`-forced-false check.
- `experiments/quay-native-bootstrap/provenance.md` — new QN-073 entry, iteration-87 summary
  section, updated σ/V.
- `experiments/quay-native-bootstrap/iterations/iteration-87.md` — this report.
