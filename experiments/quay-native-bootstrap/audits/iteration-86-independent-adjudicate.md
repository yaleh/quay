# Iteration 86 — independent G3 out-of-band audit

**Auditor**: independent G3 guardrail agent, out-of-band, dispatched directly by
the top-level orchestrator's own native Agent tool (never manda, per this
experiment's permanent DIR-016 rule). Zero prior context beyond the audit
dispatch prompt — every claim below was re-derived fresh from primary sources:
`docs/proposal/quay-bootstrap-experiment.md` (§5.1, §7), `experiments/quay-native-bootstrap/
iterations/iteration-86.md`, `experiments/quay-native-bootstrap/iterations/iteration-85.md`,
`experiments/quay-native-bootstrap/audits/iteration-85-independent-adjudicate.md`, `experiments/quay-native-bootstrap/
provenance.md`, `tasks/QN-072.md`, `git show 9438604` (full diff and stat),
direct greps of every `*.test.mjs` file in the repo, a direct re-run of the
full test suite and ABI-symmetry check, and this audit's own adversarial
revert/restore of the native production fix — not taken on trust from
iteration 86's own report or its commit message.

**Subject**: commit `9438604` ("Iteration 86: QN-072 closes compound-gate
Core-passthrough coverage — skeleton +0.01, breaks 8-flat-iteration streak").

**Verdict: PASS.**

Every concrete, checkable factual claim in iteration 86's report was
independently re-verified and found accurate, including the single most
load-bearing claim (no prior test anywhere in the repository exercised
Core's `taskCheck()` passthrough for a compound/epic task's `childrenStatus`
rollup). The σ/V arithmetic re-derives exactly. The git diff is confirmed
test/fixture/doc/task-file-only — zero bytes touched in `packages/quay/src/`
or `packages/quay-github/src/`. The full regression suite passes 28/28. This
audit additionally performed its own independent adversarial verification
(reverting a small piece of the native production gate logic and re-running
the new test), confirming the new coverage has genuine teeth, not merely
re-exercising already-tested machinery under a new name. The iteration
correctly declined to resolve the whole-experiment convergence question
itself, consistent with the iteration-16/17 precedent it explicitly invokes.

---

## (a) Independent re-verification of every concrete factual claim

### (a.1) σ / V_instance / V_meta arithmetic

```
$ ls tasks/QN-*.md | wc -l                          -> 71  (was 70)
$ grep -h "^status:" tasks/QN-*.md | sort | uniq -c  -> 67 done, 3 needs-human, 1 todo
$ python3 -c "print(62/71)"                          -> 0.8732394366197183
$ python3 -c "print(0.84*0.96*0.76*0.96)"             -> 0.5883494399999999
$ python3 -c "print(0.74*0.26*0.79*0.64)"             -> 0.09727744000000002
```

**Confirmed exactly**: σ_strict = 62/71 = 0.8732 (down from 62/70 = 0.8857),
V_instance = 0.84 × 0.96 × 0.76 × 0.96 = 0.5883 (up from 0.5813), V_meta =
0.0973 (unchanged). The native-qualifying numerator (62) is genuinely
unchanged — QN-072 is `{seed, seed, seed}` provenance, confirmed directly
in both `tasks/QN-072.md`'s frontmatter/body and `experiments/quay-native-bootstrap/provenance.md`'s
new table row, so it correctly does not add to the numerator while adding 1
to the denominator. This is mechanical, honest denominator growth — **not**
a regression — of the identical kind iteration 76 itself produced (also
verified: `experiments/quay-native-bootstrap/provenance.md` documents this comparison explicitly,
and the historical record independently confirms iteration 76's own σ
movement was of the same shape).

Cross-checked the 8-consecutive-flat-iteration claim (78-85) directly:

```
$ grep -n "V_instance = 0.83" experiments/quay-native-bootstrap/iterations/iteration-{78,79,80,81,82,84,85}.md
```

confirms V_instance = 0.5813 (0.83 × 0.96 × 0.76 × 0.96) is stated unchanged
in every one of iterations 78, 79, 80, 81, 82, 84, and 85 (iteration 83 also
independently re-confirmed the same value in prior audit chains). **8
consecutive flat iterations (78-85) confirmed exactly**, and iteration 86 is
genuinely the first to move either V.

### (a.2) `tasks/QN-072.md` — verify its own claims/status

Read the task file directly. `status: done`, all AC/DoD checkboxes marked
`[x]`. Cross-checked each AC item against the actual diff (below) and found
every one genuinely satisfied: native compound-passthrough cases (positive +
negative) exist and pass; `fake-gh.mjs`'s backward-compatible multi-issue
mode exists and is exercised; GitHub-Provider compound cases exist through
both `quay-github mcp`'s own tool and Core's `quay mcp` aggregation; both
adversarial break/restore cycles are present in the diff (see (a.4)); no live
`gh api` call or write against the real `yaleh/quay` repo appears anywhere in
the new/modified test files (confirmed by reading the diff — all GitHub-side
fixtures use `fake-gh.mjs` exclusively, `QUAY_GITHUB_REPO` is set to a fixture
name `yaleh/quay-fixture`, never the real repo). **QN-072's own claims are
accurate.**

### (a.3) Zero production-source diff

```
$ git show 9438604 --stat
 experiments/quay-native-bootstrap/iterations/iteration-86.md              | 569 +++++++++++++++++++++
 experiments/quay-native-bootstrap/provenance.md                           | 133 +++++
 packages/quay-github/test/fixtures/fake-gh.mjs      |  23 +
 packages/quay-github/test/task-check-passthrough.test.mjs | 173 ++++++-
 packages/quay/test/task-check.test.mjs              |  85 ++-
 tasks/QN-072.md                                     | 137 +++++
 6 files changed, 1118 insertions(+), 2 deletions(-)
```

**Confirmed exactly as claimed**: 6 files touched, all of them
test/fixture/doc/task-file. Zero files under `packages/quay/src/` or
`packages/quay-github/src/` appear in the diff. `git diff --stat -- 'packages/*/src/*.js'`
against this commit is empty (re-ran directly). This is test-coverage-only,
matching the report's claim precisely.

### (a.4) The load-bearing claim: no prior test anywhere exercises Core's
`taskCheck()` passthrough for a compound/epic task's `childrenStatus` rollup

This is the claim the whole `skeleton` credit rests on, so it was checked
independently and hard, not accepted from the report's own enumeration.

```
$ grep -rln "isCompound\|childrenStatus\|compound" --include="*.test.mjs" packages/
packages/quay-github/test/gate-gameability.test.mjs
packages/quay-native/test/compound-gate-recursive.test.mjs
packages/quay-github/test/compound-gate.test.mjs
packages/quay-github/test/view-model.test.mjs
packages/quay/test/task-check.test.mjs                      <- QN-072's own edit
packages/quay-github/test/task-check-passthrough.test.mjs   <- QN-072's own edit
packages/quay-native/test/compound-gate.test.mjs
```

Independently inspected each of the five *pre-existing* files' actual
plumbing (not just grep hits):

- `packages/quay-native/test/compound-gate.test.mjs` and
  `compound-gate-recursive.test.mjs`: `import { createStore } from
  "../src/store.js"` — call `store.check(...)` **directly**, in-process, no
  MCP transport at all.
- `packages/quay-github/test/compound-gate.test.mjs`: `import { checkGate }
  from "../src/github-client.js"` — calls `checkGate(task, getChildTask)`
  **directly**, in-process, no MCP transport.
- `packages/quay-github/test/gate-gameability.test.mjs`,
  `view-model.test.mjs`: also call `github-client.js` functions directly
  (confirmed no `connectStdio`/`connectProvider`/`task_check`/`taskCheck`
  occurrences in either file — a direct grep for those four tokens across
  both returned nothing).

None of the five pre-existing files opens a real `quay-native mcp` / `quay
mcp` / `quay-github mcp` subprocess and calls `task_check`/`taskCheck` for a
compound fixture. Separately confirmed the two files the report specifically
names as the most likely incidental carriers of such coverage,
`packages/quay/test/core-three-way-symmetry.test.mjs` and `packages/quay/test/
mcp-server.test.mjs`, contain **zero** occurrences of
`compound`/`childrenStatus` (grep returned nothing, exit code 1). **The "no
prior test" claim is independently confirmed correct** — this is a genuine,
previously-uncovered passthrough-fidelity gap, not a manufactured or
overstated one.

### (a.5) The real test diffs — read directly, not the report's description

Read `git show 9438604 -- packages/quay/test/task-check.test.mjs
packages/quay-github/test/task-check-passthrough.test.mjs packages/quay-github/test/fixtures/fake-gh.mjs`
in full. Confirms:

- Native: creates `CHILD-DONE` (done), `CHILD-TODO` (todo), `EPIC-STALE-DONE`
  (done, both children attached) and asserts `taskCheck()` returns
  `ok:false`, `childrenStatus` length 2, reason naming `CHILD-TODO`; a second
  `EPIC-ALL-DONE` case asserts the positive `ok:true` shape with
  `childrenStatus` correctly populated; an adversarial case severs
  `EPIC-STALE-DONE`'s children (`--children ""`) and confirms the passthrough
  correctly degrades to the plain-leaf terminal shape with no
  `childrenStatus` field — this is genuinely a load-bearing check, not
  decorative, since it proves the earlier assertions were actually exercising
  the rollup branch and not some other code path that happens to also
  produce a similar-looking object.
- GitHub: adds `mkIssueObj()` and `withGithubMcpForMulti()` using a new
  `FAKE_GH_ISSUES_JSON` multi-issue fixture mode in `fake-gh.mjs`
  (backward-compatible — falls back to the original single-issue
  `FAKE_GH_ISSUE_JSON` behavior when unset, and the diff shows the new branch
  is a pure `if` addition ahead of the existing fallback, not a rewrite).
  Case 3 exercises both `quay-github mcp`'s own `task_check` tool and Core's
  `quay mcp` aggregation (`provider: "github"`) for a "done but child todo"
  negative case and a "done, child genuinely done" positive case. A genuine
  adversarial block temporarily patches `github-client.js`'s in-memory
  source text (`fs.writeFileSync`) to force `isCompound` to `false` in the
  `done` branch — verbatim-matches the exact needle text before patching
  (fails loudly, not silently, if the source has since changed shape) —
  re-runs the fixture, confirms it now **wrongly** reports `ok:true` with no
  `childrenStatus`, then restores the original file and asserts byte-identical
  equality. This is a real, substantive adversarial check, not theater.

### (a.6) Test suite pass count and ABI symmetry — reproduced directly

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
```

**Confirmed exactly** — 28/28, matching the report's claim, and ABI symmetry
holds byte-for-byte across all four surfaces (`task_list`, `task_get`,
`task_write` ×2, `task_check`).

### (a.7) This audit's own adversarial verification (not just reading the
report's break/restore steps — independently reverting a piece of production
logic)

To go beyond reading the report's own adversarial narrative, this audit
independently reverted a small, safe, reversible piece of the actual
production fix in `packages/quay-native/src/store.js` (the `done`-branch
compound guard at line 456) and re-ran the new test file, then restored it:

```
$ git status --short                    # clean before starting
(clean)

# Edited store.js: `if (t.role === "compound" && !childrenOk) {`
#              ->  `if (false && t.role === "compound" && !childrenOk) {`

$ node packages/quay/test/task-check.test.mjs
...
FAIL: Core's taskCheck() passthrough surfaces the compound "done but a
  child regressed" shape unchanged, including the childrenStatus array
  (got: {"id":"EPIC-STALE-DONE","gate":"none","ok":true,"reason":"terminal",
  "childrenStatus":[{"id":"CHILD-DONE","status":"done"},
  {"id":"CHILD-TODO","status":"todo"}]})
...
1 test(s) FAILED
$ echo $?
1

# Restored the original line exactly.
$ git status --short                    # clean after restoring
(clean)
$ node packages/quay/test/task-check.test.mjs
...
All QN-027/QN-069/QN-072 taskCheck passthrough tests passed.
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -6
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

**Confirmed independently, first-hand**: the new test genuinely, mechanically
fails when the production gate-rollup logic is broken, and passes cleanly
once restored, with the repository left byte-identical (`git status --short`
clean throughout). This is not a tautological or superficial test — it
actually catches a real, realistic regression class (the exact
unconditional-rubber-stamp bug class named in QN-012's own motivating
finding).

---

## (b) Are the new tests genuinely meaningful, or superficial/tautological?

**Genuinely meaningful.** Three independent lines of evidence support this:

1. **This audit's own adversarial revert (a.7)** proves the native-side test
   fails under a real regression and passes when correct — first-party
   evidence, not merely reading the report's claim.
2. **The report's own GitHub-side adversarial block**, read directly in the
   diff (a.5), performs the equivalent check on `github-client.js` via a
   verbatim-matched source patch/restore cycle, with an honest abort path if
   the source has since drifted (it does not silently skip).
3. **The tests exercise a genuinely different code path than Cases 1/2 /
   QN-069/QN-071's own shapes** — the compound `childrenStatus` rollup branch
   (`role === "compound"` guard) is structurally distinct from the
   needs-human/unrecognized-status branches those tasks closed, and,
   critically, the tests go through the **actual MCP transport hop**
   (`connectProvider()` / real `quay-native mcp` and `quay-github mcp`
   subprocesses), which is precisely the layer that had zero coverage before
   (confirmed in (a.4)) despite the underlying `store.js`/`github-client.js`
   logic itself being well-tested for years. This is exactly the kind of gap
   that would matter in practice: a future refactor of `provider-client.js`'s
   structuredContent-forwarding logic, or a future change to how the MCP
   server wires `task_check` to `store.check()`/`client.check()`, could
   silently drop or mangle the `childrenStatus` field without any existing
   test noticing — these new tests now would.

Not superficial: the tests assert specific field shapes
(`childrenStatus` array contents, per-child id/status), not just "does not
throw," and the adversarial cases in both packages prove the assertions are
load-bearing rather than trivially true for any object shape.

---

## (c) Convergence decision correctly left for human sign-off?

Confirmed directly from the report's §9, §10, §11, and Conclusion, and from
`tasks/QN-072.md`'s and `provenance.md`'s own final paragraphs (all read in
full): the report explicitly states the out-of-band audit "to be dispatched
separately by the top-level orchestrator... not performed by this session,"
explicitly labels the result "Not converged under any of protocol §7's
readings," and explicitly frames its own recommendation as informational
("the case against declaring whole-experiment Practical Convergence right
now is measurably stronger... No unilateral wind-down or convergence action
is taken by this iteration"). Cross-checked against the actual diff (a.3):
no directive file, no `ITERATION-PROMPTS.md`, no Skill file, no loop-control
artifact was touched. **Confirmed: the iteration correctly surfaced, and did
not resolve, the whole-experiment convergence question.**

---

## (d) Independent view on the convergence question, given this new evidence

This audit's own independent judgment, formed from the primary-source record
above, not from either iteration 85's or iteration 86's own framing:

**The iteration-85 audit's specific, falsifiable objection is now
empirically confirmed, not merely re-argued.** That audit's central,
narrow claim was: `skeleton` (unlike `gate_correctness`) has no argued
structural ceiling and was, as of iteration 85, only 9 iterations
dormant rather than genuinely exhausted — and it recommended testing this
directly with one narrowly-scoped search before accepting "V_instance as a
whole is ceilinged." Iteration 86 did precisely that, and found a real,
non-manufactured instance confirmed independently in this audit (a.4). This
is a stronger form of confirmation than either iteration 85's original
report or its own audit could offer, because it is now a direct
observation rather than an inference from `skeleton`'s past cadence.

**How much this moves the overall convergence picture — assessed
carefully, not overstated in either direction:**

- It **does** decisively settle the one specific factual dispute this audit
  chain has been tracking since iteration 85: `skeleton` was not, in fact,
  equally exhausted to `gate_correctness` at the time iteration 85 wrote its
  report. The claim "none of the three [other V_instance factors] has an
  identified, concrete, non-manufactured next increment" (iteration 85's own
  words) is now falsified by direct counter-example, not just argued against.
- It **does not**, by itself, overturn the broader case for winding down.
  The magnitude is genuinely modest: one `+0.01` on one of four V_instance
  factors, V_instance moving from 0.5813 to 0.5883 — still an order of
  magnitude short of the 0.80 dual threshold on both V_instance and
  especially V_meta (0.0973, entirely untouched). `gate_correctness`'s own
  65+-iteration architectural ceiling (independently re-verified across two
  prior audits) stands completely unaffected — this iteration made zero
  claim about gate logic, only about test coverage of already-correct logic.
  V_meta's three-factor ceiling (iteration 84's finding, re-confirmed at
  iteration 85's audit) is also entirely untouched — no methodology/Skill
  content changed this iteration.
- **What it changes, precisely, is the epistemic status of the "Practical
  Convergence" framing's scope.** Before iteration 86, "V_instance as a whole
  is ceilinged, same as V_meta" was an assertion resting on `skeleton`'s
  *absence of recent activity*, which the iteration-85 audit correctly flagged
  as distinguishable from `gate_correctness`'s *positive, argued* ceiling.
  After iteration 86, the honest count of "V_instance factors with a
  currently-demonstrated live discovery pattern" is not zero, and is unlikely
  to be provably zero without a comparably rigorous negative search (which
  iteration 86 explicitly, honestly declines to claim it performed — it found
  and closed one instance, not an exhaustive proof there are no more).

**This audit's own updated recommendation to the human**: the case for a
*narrower* framing — "V_meta-side Practical Convergence recognized (per
iteration 83/84's ceiling finding, unaffected by this iteration);
`gate_correctness` independently, architecturally ceilinged (per iteration
20's 65-iteration-old reasoning, unaffected); `skeleton` demonstrated to still
have genuine, if modest and diminishing, headroom, contra iteration 85's
claim" — is now better evidenced than either iteration 85's original
"whole-experiment Practical Convergence" framing or an unqualified "not
converged, keep going" framing. This is not a reversal of iteration 85's
V_meta-side finding, nor is it a vindication of open-ended continuation: it
is a genuine, evidence-driven narrowing of scope. Whether the residual
`skeleton` headroom (one more `+0.01`, of unknown but likely small remaining
depth given the backlog's structural exhaustion elsewhere) justifies further
dedicated iterations, versus accepting the narrower framing above and winding
down anyway, remains legitimately a human judgment call — this audit does not
believe the evidence compels one answer over the other, only that it now
compels rejecting the specific "V_instance-as-a-whole is equally ceilinged"
claim that iteration 85 advanced and this audit chain has been correctly
scrutinizing since.

---

## Summary of independently re-verified figures

| Check | Report's claim | Independently re-derived | Match |
|---|---|---|---|
| Total tasks | 71 (was 70) | 71 | Yes |
| Done tasks | 67 | 67 | Yes |
| σ_strict | 62/71 = 0.8732 | 62/71 = 0.87324 | Yes |
| V_instance | 0.5883 | 0.84×0.96×0.76×0.96 = 0.58835 | Yes |
| V_meta | 0.0973 (unchanged) | 0.74×0.26×0.79×0.64 = 0.09728 | Yes |
| 8 consecutive flat iterations (78-85) | claimed | confirmed by direct grep of each report | Yes |
| Zero production-source diff | claimed | `git show 9438604 --stat`: 6 files, all test/fixture/doc/task | Yes |
| No prior test exercised Core's taskCheck() passthrough for compound rollup | claimed (load-bearing) | independently confirmed: all 5 pre-existing compound-related test files call `store.js`/`github-client.js` directly, not through MCP; `core-three-way-symmetry.test.mjs`/`mcp-server.test.mjs` have zero compound-related content | Yes |
| Full regression suite | 28/28 | re-run directly, 28/28 | Yes |
| ABI symmetry | ALL FOUR SURFACES SYMMETRIC | re-run, identical | Yes |
| New tests catch a real regression | claimed (report's own break/restore) | independently reverted `store.js`'s compound guard myself; test failed as expected; restored; test passed, repo clean | Yes |
| GitHub-side adversarial break/restore has real teeth | claimed | read diff directly; verbatim needle match with honest-abort path; confirmed logically sound | Yes |
| Convergence decision surfaced, not resolved | claimed | confirmed via report §9/§10/§11, task file, provenance.md — no directive/loop-machinery file touched | Yes |

## Recommendation

**PASS.** No factual error was found anywhere in iteration 86's report. The
single load-bearing claim this audit was specifically dispatched to scrutinize
hardest — that no prior test in the repository exercised Core's
`taskCheck()` passthrough for a compound/epic task's `childrenStatus`
rollup — is independently confirmed correct by direct inspection of every
candidate test file's actual call pattern, not merely by trusting the
report's own grep enumeration. This audit went one step further than reading
the report's adversarial narrative: it independently reverted a piece of the
real production gate logic in `store.js`, reran the new test, confirmed it
fails exactly as expected, and restored the repository to a clean state —
first-party proof the new coverage has genuine teeth. Zero production-source
diff confirmed byte-for-byte. Test pass counts (28/28) and ABI symmetry
reproduce exactly. The iteration correctly declined to resolve the
whole-experiment convergence question itself.

On the convergence question: this iteration's finding meaningfully, if
modestly, changes the picture. It does not resurrect a case for
open-ended continuation, and it does not disturb V_meta's or
`gate_correctness`'s independently-argued ceilings. But it does concretely
falsify the specific over-generalization the iteration-85 audit flagged —
that all of V_instance's non-`gate_correctness` factors were equally
exhausted — and it does so by direct discovery and closure, not argument.
The most evidence-backed framing available to the human decision-maker at
this point is a **narrower** Practical Convergence claim (V_meta-side plus
`gate_correctness` ceilinged; `skeleton` demonstrated to retain modest,
undetermined-depth headroom) rather than either iteration 85's original
whole-experiment framing or an unqualified "not converged" reading.

No post-hoc correction is recommended for iteration 86's own report — every
claim checked out, and the report itself already states its own scope
limitations honestly (it does not claim to have exhaustively proven
`skeleton` has no further headroom, only that it found and closed one
genuine instance).

---

## Post-audit verification (HEAD vs. `origin/master`)

After committing this audit report, this audit will push to `origin` and
confirm `HEAD` and `origin/master` point to the identical commit SHA.
