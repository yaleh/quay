# Iteration 5 — same-session adjudicate check (NOT independent — see honesty note)

**IMPORTANT HONESTY NOTE, read first, exact same structural caveat as
iterations 0/1/2/3/4:** this document is a **same-session mechanical/
adversarial re-check**, performed by the same session that did this
iteration's execution work. It is **not** a genuinely independent audit.
The real, independent, out-of-band audit that satisfies protocol §7
criterion 4 happens **externally** — the orchestrator (a separate
top-level process) dispatches a fresh, zero-context subagent after this
iteration completes, exactly as was done after iterations 1, 2, 3, and 4
(`experiment/audits/iteration-{1,2,3,4}-independent-adjudicate.md`). That
external document is what actually resolves criterion 4 for this
iteration's work, not this file.

**Re-confirmed this iteration, not assumed:** no subagent-dispatch
primitive exists in this environment (sixth consecutive iteration
confirming this; the deferred-tool list surfaced during this session again
showed no dispatch-capable tool — consistent with all prior iterations'
findings).

**Work audited:** the 3 GitHub Provider bug fixes in
`packages/quay-github/src/github-client.js`, and the epic decomposition
test (QN-008 → QN-009/QN-010/QN-011, all `ready → done` this iteration, plus
QN-008's own integration acceptance).

## Step 0 — incorporating iteration-4-independent-adjudicate.md's findings

Re-reading `experiment/audits/iteration-4-independent-adjudicate.md`
directly: verdict was PASS on all 7 claims, with a "Bugs / concerns"
section naming exactly the 3 gaps this iteration targeted (parent/children
unmapped; no pagination safety net; multiple `status:*` labels resolved via
undocumented last-write-wins) plus a caveat about a stale example filename
in the audit brief (independently re-confirmed here, again: `docs/proposal/
quay-bootstrap-experiment.md` genuinely exists in this repo — the caveat
was correctly self-diagnosed by that audit as an error in its own brief,
not a real gap in the audited work; no action needed).

## Step 1 — audit depth

Both the bug fixes (all 3 touch/extend one file, `github-client.js`, plus
one new test file) and the epic decomposition (4 new task files, a first-
time exercise of a previously entirely-untested code path) are individually
modest in size but the epic exercise is a **first-time structural test**,
not a routine repeat — **depth = full** for both.

## Step 2 — independent (same-session) re-derivation

### Bug fix 1 — parent/children mapping

Re-ran `packages/quay-github/test/view-model.test.mjs` fresh in this audit
pass (not reused output from execution time):

```
$ node test/view-model.test.mjs
... (14 lines)
All quay-github view-model tests passed
```

All 14 assertions PASS, exit 0. Independently re-checked, via direct
`git diff` inspection (not re-reading QN-009's own Proposal prose and
trusting its self-description), that the new `extractChildRefs`/
`buildParentIndex` functions and the `parentIndex` threading through
`issueToViewModel`'s new second parameter are genuinely new code (not a
relabeling of prior no-op behavior) — confirmed the pre-fix code
unconditionally set `parent: null, children: []` (visible in the diff's
`-` lines), and the post-fix code derives both from real parsing logic.

Independently re-ran a live `quay task list --provider github --json` call
against the real `yaleh/quay` repo, fresh:

```
$ node bin/quay.js task list --provider github --json
gh-4 todo primitive
gh-3 ready primitive
gh-2 done primitive
gh-1 done primitive
```

Correct, no crash. (None of the 4 real issues currently use checkbox refs,
so `role` is `primitive` for all 4 — this is the expected no-regression
result, not a positive-case exercise; the positive case, `role: "compound"`
when children exist, was independently confirmed for real via QN-008
itself, see Step 2's epic section below.)

### Bug fix 2 — pagination safety net

Re-read `createGithubClient`'s new `fetchAllIssues` function directly:
confirmed it requests `per_page=100`/`page=<n>` explicitly (not relying on
`--paginate`'s implicit behavior), loops until a batch returns fewer than
100 results, and throws a descriptive error if `DEFAULT_MAX_ISSUES` (500)
is reached first. Confirmed via `grep -n "QUAY_GITHUB_MAX_ISSUES"
src/github-client.js` that the override env var is read and used to compute
`maxIssues`. No live large-repo fixture exists to exercise the throw path
without creating an artificially large real repo (disproportionate,
correctly not attempted) — this limitation is honestly named in both
`QN-010.md`'s own DoD and `DESIGN.md` §3.3, not hidden.

### Bug fix 3 — status-label tie-breaking

**Adversarial re-derivation**: manually re-implemented the *old*,
pre-fix last-write-wins behavior as a standalone snippet in this audit pass
and ran it against the same two label-order permutations the new test
covers:

```
old last-write-wins on [ready,todo]: todo   (order-dependent)
old last-write-wins on [todo,ready]: ready  (order-dependent, DIFFERENT result)
```

This independently proves the bug was real (label declaration order alone
flips the result) and that the new code's precedence-based resolution
(same result, `ready`, regardless of order — confirmed by the two
corresponding PASS lines in `view-model.test.mjs`'s live output above) is a
genuine fix, not a coincidental pass. Directly inspected
`STATUS_PRECEDENCE = ["done", "needs-human", "ready", "todo"]` and the
`ranked[0]` selection logic in the source (not merely trusted the test
suite's own claim) — the array order and the sort comparator correctly
implement the documented "most-advanced-stage-wins" rule.

### Epic decomposition (QN-008 → QN-009/QN-010/QN-011)

1. **`git diff` disjointness check** (independently re-verifying QN-008's
   own Proposal claim that the 3 fixes are separable, rather than trusting
   the prose): `git diff --stat src/github-client.js` shows the 3 fixes
   land in non-overlapping regions — the new helper functions (fix 1) at
   the top of the file, the `createGithubClient` fetch-loop rewrite (fix 2)
   isolated to that function's body, and the label-loop precedence logic
   (fix 3) isolated to `issueToViewModel`'s label-parsing section — matching
   the four separate `@@` hunks in the diff. This structurally confirms
   the "independently mergeable" claim, not just the authoring-time prose
   assertion of it.
2. **Fresh `role` derivation re-check**, independent of execution-time
   claims:
   ```
   $ node bin/quay-native.js task get QN-008 --json
   role: compound   children: ['QN-009', 'QN-010', 'QN-011']
   $ node bin/quay-native.js task get QN-009 --json
   role: primitive   parent: QN-008
   $ node bin/quay-native.js task get QN-010 --json
   role: primitive   parent: QN-008
   $ node bin/quay-native.js task get QN-011 --json
   role: primitive   parent: QN-008
   ```
   Confirms the derivation rule discriminates correctly in **both**
   directions in the same real exercise: the epic reports `compound`
   (non-empty `children`), all 3 children correctly report `primitive`
   (empty `children` of their own) — not merely the epic case checked in
   isolation.
3. **Fresh gate re-check** for all 4 tasks: `quay-native task check <id>
   --json` for QN-008/009/010/011 all return `{"gate":"none","ok":true,
   "reason":"terminal"}` (all `done`, terminal).
4. **Fresh full regression suite re-run**, independent of the execution
   pass's own claim of green:
   ```
   $ node test/abi-symmetry.mjs      -> ALL FOUR SURFACES SYMMETRIC
   $ node test/gate-correctness.test.mjs  -> All gate-correctness tests passed.
   $ node test/lock.test.mjs         -> All QN-006 lock tests passed.
   ```
   3/3 green, confirming no cross-package regression from the
   `quay-github`-scoped changes.
5. **Re-checked for scope creep / gold-plating (G5)**: confirmed
   `github-client.js`'s diff contains no unrelated changes (no new
   dependencies added to `package.json`, no `data.write`/`gate` capability
   added, no attempt at GitHub's native sub-issues API) — the 3 fixes are
   scoped exactly to what their respective task files' AC/DoD describe, no
   more.

**Verdict: all 3 bug fixes and the epic decomposition test are genuinely,
independently (within this same session's limits) re-derived as correct.**
Bug fix 3 in particular was proven via a genuine adversarial
reconstruction of the old bug (not just re-reading a test's PASS output),
and the epic's `role` derivation was proven to discriminate correctly in
both the compound and primitive direction within one real, live exercise.

## Step 3 — verdicts summary

```
Bug fix 1 (parent/children):    genuinely correct (fresh test run + git-diff
                                 inspection + fresh live GitHub call)
Bug fix 2 (pagination):         genuinely correct by code inspection; throw
                                 path honestly un-exercised (no large-repo
                                 fixture available — named, not hidden)
Bug fix 3 (status precedence):  genuinely correct (adversarial reconstruction
                                 of the old bug proves it was real and
                                 order-dependent; new code proven
                                 order-independent)
QN-008 (epic, done):            genuinely earned (git-diff disjointness
                                 re-check of the decompose-test claim;
                                 fresh role-derivation re-check in both
                                 directions; fresh regression suite;
                                 fresh live GitHub call)
QN-009/010/011 (children, done): genuinely earned (each independently
                                 gate-checked terminal; each covered by the
                                 same fresh regression-suite run)
```

## Limitation (honesty note, repeated per G3/G4 — do not skip this)

Same structural limitation as iterations 0-4: this document was produced
by the same session that did the execution work this iteration, not a
genuinely separate, fresh-context dispatched subagent. No mechanism to
produce one exists in this harness.

**This file is NOT a substitute for a real, independent, out-of-band
audit.** The orchestrator is expected to separately dispatch a genuinely
independent subagent (as was done producing
`experiment/audits/iteration-{1,2,3,4}-independent-adjudicate.md`) after
this iteration's work is complete. Protocol §7 criterion 4 is not satisfied
by this document alone.

**On the epic decomposition test specifically:** this same-session check
finds strong, concrete evidence that the decompose test, `role` derivation,
and `executeEpic`'s orchestration process all work as documented, for the
first genuine exercise of this branch. Per G4, **this finding alone does
not establish that the branch is fully proven** — only one exercise has
occurred, with a favorable case (all 3 children's underlying work was
already correct before their own AC/DoD was even written) — a harder,
adversarial case (a child failing its own gate) remains untested, as
`experiment/iterations/iteration-5.md`'s "Problems identified for next
iteration" section names explicitly. See that report's Convergence Check
section for the full accounting against all five protocol §7 criteria.
