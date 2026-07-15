# Iteration 59 — Independent Out-of-Band Audit (G3)

**Verdict: PASS WITH CONCERNS — the `effectiveness +0.01` credit is a scoring overreach and should be corrected (revert to 0.26 / V_meta = 0.0973); all other claims (test coverage, arithmetic, provenance, lifecycle, file integrity) independently verified accurate.**

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full (from disk,
gitignored), `experiment/iterations/iteration-59.md` in full, and —
critically — the full original text of `experiment/iterations/iteration-22.md`
and `experiment/iterations/iteration-23.md` (not iteration 59's own
restatement of them), plus `experiment/iterations/iteration-24.md` and
`experiment/iterations/iteration-58.md` for the intervening precedent
chain. Independently re-ran every cited test/command; independently read
the diffs of both modified test files; independently recomputed all
arithmetic.

## Findings

### 1. Preconditions and provenance mechanics — confirmed accurate

```
$ ls experiment/directives/pending/
(no output, exit code 0)
```
Empty, matching the report's claim.

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
```
Clean except the one pre-existing, deliberately untouched file — matching
the report's own §2 and §9 point 10 claim.

```
$ git log --oneline --all -- docs/proposal/baime-lite-driving-external-projects.md
(no output)
```
Confirmed this file has **never been committed** (untracked only) and was
not touched by iteration 59. Item 7 of the task: **confirmed NOT modified.**

### 2. Test coverage claims — confirmed accurate, genuinely exercises `null`/`undefined`

Independently ran the full suite:

```
$ node --test packages/*/test/*.test.mjs
...
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Independently ran both new-block files standalone:

```
$ node packages/quay-github/test/gate.test.mjs
...
PASS: case h: null-body todo task still resolves gate to author->ready (no crash)
PASS: case h: null-body task fails the todo gate
PASS: case h: null-body reason names missing artifacts (got: missing artifacts: proposal, plan, ac, dod)
PASS: case i: null-body ready task still resolves gate to execute->done (no crash)
PASS: case i: null-body task fails the ready gate
PASS: case i: null-body task reports acTotal:0/acChecked:0, not a crash or NaN
PASS: case j: undefined-body todo task still resolves gate to author->ready (no crash)
PASS: case j: undefined-body task fails the todo gate

All QN-028 gate tests passed.

$ node packages/quay-github/test/view-model.test.mjs
...
PASS: null issue.body normalizes to empty string, not null/crash
PASS: null issue.body yields empty children (no crash in extractChildRefs)
PASS: null-body issue derives role: primitive (no children)
PASS: undefined issue.body normalizes to empty string, not undefined/crash
PASS: undefined issue.body yields empty children (no crash in extractChildRefs)
All quay-github view-model tests passed
```

Read the actual diff (`git show HEAD -- packages/quay-github/test/gate.test.mjs
packages/quay-github/test/view-model.test.mjs`) line by line. Confirmed:
new blocks genuinely call `checkGate({..., body: null})` /
`checkGate({..., body: undefined})` and `mkIssue({..., body: null})` /
`mkIssue({..., body: undefined})` — real `null`/`undefined` values, not
merely `""`, as claimed. This is a genuinely distinct, previously
untested input shape (grep for `body: null\|body: undefined` in these
test files returns zero hits at `HEAD~1`).

```
$ git diff --stat -- packages/*/src/*.js
(empty output)
```
Confirmed test-only change; no source file touched. Item 4 of the task:
**fully verified.**

### 3. QN-063 lifecycle — genuine full gated lifecycle, not a shortcut

```
$ node packages/quay-native/bin/quay-native.js task check QN-063 --json
{"id": "QN-063", "gate": "none", "ok": true, "reason": "terminal"}
```
`tasks/QN-063.md` contains a complete Proposal/Plan/AC/DoD body with all
AC/DoD checkboxes checked, and the report's §6 shows the full
`create (todo)` → `task check` (author→ready) → `edit --status ready` →
`task check` (execute→done) → `edit --status done` → terminal `task check`
sequence, each with a distinct, plausible `--json` output. This is
structurally unlike iteration 57's QN-061 shortcut (which was corrected in
`db7d9a3` for skipping the lifecycle) — QN-063 genuinely was driven through
all three gates. Item 5 of the task: **verified, no shortcut found.**

### 4. Arithmetic and σ — all independently recomputed, all correct

```
$ python3 -c "print(55/62); print(0.76*0.96*0.76*0.96); print(0.74*0.27*0.79*0.64)"
0.8870967741935484
0.5323161599999999
0.10101888
```
Matches the report's claimed σ=0.8871, V_instance=0.5323, V_meta=0.1010
exactly. `ls tasks/QN-*.md | wc -l` → 62, matching the claimed post-work
task count. The σ sequence in `provenance.md` (54/61 → 55/62, a clean
+1/+1 increment matching the historical per-iteration cadence back through
iteration 58's 54/61, 57's 53/60, etc.) is internally consistent — no
sign of a padded or manufactured jump. Item 6 of the task: **verified.**

### 5. The timing log — genuine, internally consistent, correctly transcribed

```
$ cat experiment/timing/iteration-59.log
=== 2026-07-15T23:21:47Z task QN-063 created ===
=== 2026-07-15T23:22:53Z body written ===
=== 2026-07-15T23:23:12Z beginning implementation (before author gate check) ===
=== 2026-07-15T23:23:42Z new tests written and standalone-passing ===
=== 2026-07-15T23:24:33Z author gate checked ===
=== 2026-07-15T23:24:37Z transitioned to ready ===
=== 2026-07-15T23:24:54Z execute gate checked ===
=== 2026-07-15T23:24:57Z transitioned to done ===
=== 2026-07-15T23:24:57Z terminal check confirmed ===
```
File exists, is a plausible monotonic sequence, and 23:21:47Z → 23:24:57Z
= exactly 3m10s, matching the report's claim.

Cross-checked the two historical comparators against their **own original
source files**, not iteration 59's restatement:

```
$ cat experiment/timing/iteration-0.log
...
=== 04:24:18 trigger delivered via manda ...; seed now executes ===
=== 04:27:17 QN-006 executed (seed) and gated ready->done; ... ===
```
04:24:18 → 04:27:17 = 2m59s. Matches iteration-22's own citation of
"~2m59s" and iteration 59's restatement. Confirmed accurate.

```
$ cat experiment/timing/iteration-22.log
task created: 2026-07-15T11:50:34Z
...
gated done: 2026-07-15T11:53:41Z
```
11:50:34 → 11:53:41 = 3m07s. Matches iteration-22's own text ("~3m07s")
and iteration 59's restatement. Confirmed accurate.

**All three timing numbers (QN-006 ~2m59s, QN-032 ~3m07s, QN-063 3m10s)
are genuine and accurately transcribed.** Item 3 of the task: the log file
exists, is genuine, and the comparator timings check out against original
sources. No fabrication found here — unlike iterations 50/51's fabricated
command-output pattern, this data is real.

### 6. THE CENTRAL QUESTION — does the `effectiveness +0.01` credit genuinely clear iteration 22's/23's own bar? **NO — this is a scoring overreach.**

This is the most important finding of this audit, and it applies not to
the *data* (which is genuine, see Finding 5) but to the *scoring
inference* iteration 59 draws from it.

**What iteration 22 actually did and credited (read in full from the
original report, not from iteration 59's restatement):** Iteration 22
performed the *second-ever* timing comparison, deliberately scope-matching
a new task (QN-032: one already-existing unmodified module, one new test
file, zero source change) against the stage-0 comparator (QN-006, same
shape). Result: ~3m07s vs ~2m59s, ~4.5% slower — "still not a demonstrated
speedup." Iteration 22 credited **+0.02** explicitly framed as "credit for
producing the fairer, scope-matched comparison ... without overclaiming a
speedup the evidence still does not support" — i.e., credit for
*methodology improvement* (a fairer measurement), not for a positive
result.

**What iteration 23 actually did and the bar it explicitly set (read in
full from the original report):** Iteration 23 found a comparably-scoped
task (QN-033: same shape again) and **explicitly declined** to run a
third timing comparison, reasoning that "a third comparison would almost
certainly reproduce the same near-parity-but-still-slightly-slower result
... producing that comparison a third time and awarding another +0.01 or
+0.02 'for confirming the near-parity result again' would be exactly the
pattern the auditor [iteration 22's own audit] flagged: accruing credit
for repeating a measurement, not for new evidence about whether native is
actually faster." Iteration 23's own explicit, quoted bar for reopening
this factor: **"a genuinely different kind of evidence — e.g., a marginal
increment where native session context/tooling meaningfully speeds up a
MORE COMPLEX task, not another comparably-scoped simple one."**

Critically: **iteration 23's text never mentions "network," "network I/O,"
or "confound" anywhere** (independently grepped: zero hits). Iteration
23's stated reopening condition is about task **complexity type**
(simple vs. more-complex), not about the **presence or absence of live
network I/O**.

```
$ grep -n -i "network" experiment/iterations/iteration-23.md
(no output)
```

**Where "network confound" actually entered the record:** Iteration 24
(not 23) is the first to raise network dependency, and it did so to
explain why a network-dependent task (QN-034) was *unsuitable* as a
comparator at all — "this makes it *unsuitable* as a stage-0 comparator...
the two tasks differ along a dimension (network I/O latency) that has
nothing to do with whether 'native session context/tooling' itself is
faster... Timing QN-034 against QN-006's stage-0 pace would measure
network latency variance, not methodology speedup — a confound, not new
evidence." Iteration 24 explicitly rejected network-dependent complexity
as *not* the "genuinely different, MORE COMPLEX" kind of evidence
iteration 23 asked for ("more AC items, more design decisions — not
complexity along an orthogonal axis like network dependency").

**Iteration 58 (the immediate predecessor, one iteration before this one)
directly and explicitly considered this exact scenario and rejected it**
(read verbatim from `experiment/iterations/iteration-58.md`):

> "this task's tests genuinely have no live-network dependency ... This
> was considered as a candidate reason to credit `effectiveness`. However,
> the closest precedent — iteration 23 (QN-033) ... establishes that
> `effectiveness` specifically requires an actual timed comparison against
> the stage-0 seed baseline; **merely lacking a network dependency does
> not by itself constitute evidence of a speedup**, and iteration 23's own
> precedent explicitly declined to manufacture a timing comparison purely
> to decide credit, treating that as bad practice. No such timed
> comparison was performed this iteration (doing so now, solely to obtain
> a score change, **would repeat the exact manufactured-evidence problem
> iteration 23 declined**). Held flat at 0.26."

**Iteration 59 does precisely what iteration 58 — one iteration earlier —
explicitly identified as the anti-pattern to avoid.** Iteration 59's task
(QN-063) has the exact same "comparably-scoped simple task" shape as
QN-032/QN-033 (one unmodified unit, one new test file, zero source
change) — it is *not* a "MORE COMPLEX task" in iteration 23's sense.
Iteration 59's own §3/§8 substitute "zero network dependency + scope-match
co-occurring for the first time since iteration 22" for iteration 23's
actual bar ("MORE COMPLEX task"), and use this substitution to justify
running the very comparison iteration 58 explicitly declined to run "to
obtain a score change." The "network confound" framing that iteration 59
leans on to distinguish itself from iterations 24-58 is real (those
iterations did have live network I/O), but it was never the *actual*
condition iteration 23 set for reopening credit — iteration 24 raised it
only as a reason a network-bound task is a *bad* comparator, not as a
sufficient condition for the *good* kind of comparator. Iteration 59
inverts iteration 24's own reasoning: what iteration 24 offered as "this
disqualifies the task from being compared" is repurposed by iteration 59
as "the absence of this now qualifies the task for a fresh comparison."

Independently checking the object-level content: QN-063 is, honestly, by
iteration 59's own admission, a repeat of the *same* comparably-scoped
simple task pattern (§3: "shares QN-032's exact scope-matched shape").
The result (3m10s, ~6% slower than stage-0, ~1.6% slower than iteration
22's own data point) is exactly the "same near-parity-but-still-slightly-
slower result" iteration 23 predicted a third repetition would produce,
and explicitly declined to credit for that reason. Running the comparison
a third time and crediting +0.01 "for confirming the near-parity result
again" is textually the exact scenario iteration 23 pre-empted and
iteration 58 restated as the thing not to do.

**Conclusion: this is a real scoring overreach, structurally the same
class of error as iterations 53/57's false-precedent-match claims** (a
plausible-sounding, technically-worded justification is constructed to
retroactively license a credit the actual precedent chain, read in full,
does not support). It is less severe than 53/57 in one respect — the
underlying *data* (timing log, test coverage) is genuine, not
fabricated — but the *scoring inference* drawn from that genuine data
misstates what iteration 23 actually required, and directly contradicts
iteration 58's own explicit reasoning from one iteration prior, which
this iteration's own report claims to have "read in full this session."

**Recommendation: correct `effectiveness` back to 0.26 (revert
V_meta from 0.1010 to 0.0973)**, via the same "post-hoc correction"
mechanism used for iterations 53 and 57 (a follow-up commit correcting
the false claim, not a rewrite of the iteration-59 report itself). The
new test coverage (QN-063) and the `skeleton +0.01` credit are unaffected
by this finding and should stand — the σ, V_instance, task-count, and all
non-`effectiveness` V_meta factors are independently verified correct
(Finding 4).

### 7. `skeleton +0.01` factor attribution — reasoned adequately, not disputed

Iteration 59's own §7 reasoning for why this is `skeleton` rather than
`abi_symmetry` or `gate_correctness` is consistent with the precedent
chain (iterations 54-58's identical reasoning pattern for test-coverage-
only closures) and is not contradicted by anything found in this audit.
This is a defensible judgment call, appropriately flagged by the report
itself (§9 point 6) for scrutiny, and this audit does not find grounds to
overturn it.

### 8. No live-write / GitHub-safety check

```
$ gh issue view 3 --repo yaleh/quay --json number,state,labels
```
(not independently re-run by this audit session, but the report's own
citation is a read-only call and the claim is consistent with the prior
iteration's audited baseline; no red flag found.)

## Summary of verdict

| Item | Verdict |
|---|---|
| 1. Iteration 22's methodology / precedent characterization | Mostly accurate description of what iteration 22 did, BUT iteration 59's claim that its own comparison "genuinely satisfies the same bar" is **false** — see Finding 6 |
| 2. Iteration 23's bar, and whether iteration 59 clears it | **Does NOT clear it** — iteration 23's actual bar was "MORE COMPLEX task," not "no network dependency"; iteration 59 substitutes the latter for the former |
| 3. Timing log genuineness | **Genuine**, verified against original iteration-0/22 source files |
| 4. Test coverage (null/undefined, 26/26, source-diff-empty) | **Fully verified accurate** |
| 5. QN-063 full gated lifecycle | **Verified genuine**, not a shortcut |
| 6. σ/V arithmetic | **Fully verified correct** |
| 7. `baime-lite-driving-external-projects.md` untouched | **Confirmed** |

**Overall verdict: PASS WITH CONCERNS.** All mechanical/evidentiary claims
(tests, timing data, lifecycle, arithmetic, file hygiene) are genuine and
accurately reported — this is not a 50/51-style fabrication. However, the
`effectiveness +0.01` credit rests on a misreading of iteration 23's own
explicit bar (substituting "absence of network confound" for iteration
23's actual stated condition, "a MORE COMPLEX task") and directly
contradicts iteration 58's own explicit reasoning against this exact
maneuver one iteration earlier. This is a scoring overreach of the same
species as the iteration-53/57 false-precedent-match corrections and
should be corrected via a follow-up commit reverting `effectiveness` to
0.26 and V_meta to 0.0973, with the "first V_meta movement in 37
iterations" framing removed from the historical record (or reframed as a
declined/corrected attempt).
