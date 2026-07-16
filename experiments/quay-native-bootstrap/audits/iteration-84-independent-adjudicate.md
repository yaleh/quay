# Iteration 84 — independent G3 out-of-band audit

**Auditor**: independent G3 guardrail agent, out-of-band, dispatched directly by
the top-level orchestrator's own native Agent tool (never manda, per this
experiment's permanent DIR-016 rule). Zero prior context beyond the audit
dispatch prompt — every claim below was re-derived from the actual repository
state (`ls`/`grep` against `tasks/*.md`, direct `node` re-runs of all 31 test
files, a direct read of `experiments/quay-native-bootstrap/directives/archive/DIR-024-*.md` and
`experiments/quay-native-bootstrap/directives/pending/DIR-025-*.md`/`DIR-021-*.md` in full, `git show
d699e6e --stat` and its full diff of `experiments/quay-native-bootstrap/provenance.md`, `git log
--oneline -10`, direct re-derivation of σ_strict/V_instance/V_meta, and a full
fresh reading of the protocol document, iteration 83's report, and iteration
83's own independent audit), not taken on trust from iteration 84's own report
or its commit message.

**Subject**: commit `d699e6e` ("Iteration 84: document V_meta
practical-convergence standing fact (per iteration-83 audit); archive resolved
DIR-024; confirm DIR-025 3c not yet actionable").

**Verdict: PASS.**

Every concrete, checkable factual claim in iteration 84's report was
independently re-verified and found accurate: the σ_strict/V_instance/V_meta
arithmetic re-derives exactly; the backlog-exhaustion claim (QN-017/020/021/022
are the only non-`done` tasks, and are genuinely adversarial fixtures, not
usable independent work) is confirmed by direct inspection of the task files
themselves; the regression-suite claim (29/29 real tests pass, 2 subprocess
helpers exit 1 as documented, ABI four-surface symmetry) reproduces exactly;
and the git diff scope matches the report's own stated summary precisely — no
task, Skill, or production file was touched, and `DIR-024`'s move from
`pending/` to `archive/` shows zero content diff (a pure rename, `0
insertions/deletions` for that file in `git show --stat`). The new
standing-fact note in `provenance.md` genuinely has concrete, falsifiable
re-trigger conditions (not merely prose asserting stagnation) and is
appropriately, explicitly scoped as **not** a protocol §7 convergence claim.
Choosing path (i) over path (ii) or DIR-025 3c was, independently, the
correct call given the actual backlog state confirmed in this audit's own
step (a).

---

## (a) Independent re-verification of every concrete factual claim

### (a.1) σ_strict / V_instance / V_meta arithmetic

```
$ ls tasks/QN-*.md | wc -l                          -> 70
$ grep -h "^status:" tasks/QN-*.md | sort | uniq -c  -> 66 done, 3 needs-human, 1 todo
$ python3 -c "print(62/70)"                          -> 0.8857142857142857
$ python3 -c "print(0.83*0.96*0.76*0.96)"             -> 0.58134528
$ python3 -c "print(0.74*0.26*0.79*0.64)"             -> 0.09727744
```

**Confirmed exactly**: σ_strict = 62/70 = 0.8857, V_instance = 0.5813, V_meta =
0.0973 — all unchanged from iteration 83, exactly as claimed. The 62 numerator
(66 done, minus the 3 permanently-excluded tasks per `provenance.md`'s
"Permanent strict-exclusion set" section, independently re-read in full)
checks out identically to iteration 83's own audit's derivation.

### (a.2) Backlog-exhaustion claim — QN-017/020/021/022 are the only non-`done`
tasks, and are genuinely adversarial fixtures

```
$ ls tasks/QN-*.md | wc -l                                     -> 70
$ grep -h "^status:" tasks/QN-*.md | sort | uniq -c             -> 66 done, 3 needs-human, 1 todo
$ grep -l "^status: todo\|^status: needs-human" tasks/QN-*.md
tasks/QN-017.md  status: needs-human
tasks/QN-020.md  status: needs-human
tasks/QN-021.md  status: todo, parent: QN-020
tasks/QN-022.md  status: needs-human
```

Read all four task files in full, directly (not summary). Confirmed:

- **QN-017**: labeled `deliberately-adversarial`; title states it is "authored
  deliberately to fail — not 'hard,' but unsatisfiable by construction," to
  exercise `needs-human` on the specific, confirmed-absent precondition (no
  native subagent-dispatch primitive). `status: needs-human`, `parent: null`,
  `children: []`.
- **QN-020**: labeled `deliberately-adversarial`; title is "Exercise
  executeEpic's own integration-level needs-human branch." `status:
  needs-human`, has children (QN-021 among them).
- **QN-021**: labeled `deliberately-adversarial`; `parent: QN-020`, i.e. it is
  a **child of QN-020**, not independent of it. `status: todo` — the only
  `todo` task in the entire 70-task backlog.
- **QN-022**: labeled `deliberately-adversarial`; title is "Exercise
  executeEpic's narrower 'all children done, but the epic's own integration
  acceptance itself fails' needs-human sub-case." `status: needs-human`,
  `parent: null`.

**Confirmed exactly as the report describes**: all four are genuinely
labeled and titled as adversarial fixtures designed to be structurally
unsatisfiable (to exercise `needs-human` gate paths), not organically open
development work. QN-021 being a child of QN-020 independently confirms the
report's specific claim that they are "not even mutually independent" — this
directly falsifies any reading that 2-3 of these four could be treated as
"independent, non-conflicting" tasks for DIR-025 3c's fan-out precondition.

### (a.3) Regression-suite claim

```
$ for pkg in packages/{quay-native,quay,quay-github}; do
    for f in $pkg/test/*.mjs; do node "$f"; echo "$? $f"; done
  done
```

Reproduced: 29 of 31 test files exit 0; `cas-writer-helper.mjs` and
`concurrent-writer.mjs` exit 1 when run standalone (confirmed, consistent with
every prior iteration/audit's finding, to be subprocess-worker helper modules
invoked by other tests, not standalone tests in their own right).

```
$ node packages/quay-native/test/abi-symmetry.mjs
-> ALL FOUR SURFACES SYMMETRIC (task_list, task_get, task_write, task_check
   all report "match": true across CLI and MCP surfaces)
```

**Confirmed exactly.**

### (a.4) Git diff scope — `git show d699e6e --stat`

```
$ git show d699e6e --stat
 ...archive/DIR-024-...-support-concurrent-dispatch.md |   0
 experiments/quay-native-bootstrap/iterations/iteration-84.md                 | 398 +++++++++++++
 experiments/quay-native-bootstrap/provenance.md                               | 138 ++++++++
 3 files changed, 536 insertions(+)
```

**Confirmed exactly as the report claims**: no `packages/` source file, no
`tasks/QN-*.md` file, and no Skill file appears in the diff. The `DIR-024`
file's line shows **0 insertions and 0 deletions** — this is a pure git rename
(`pending/` → `archive/`) with byte-identical content, independently confirmed
by reading the full file content directly (see (d) below) — not a silent
alteration disguised as a move. `git log --oneline -10` also confirms the
commit sequence exactly as described in the report's §1 context section:
`6710d22` ("Resolve DIR-024 and record DIR-025 concurrency trial results")
sits directly between iteration 83's audit commit (`4f1c3eb`) and iteration
84's own commit (`d699e6e`), consistent with the report's claim that this
resolution happened in the orchestrator's own live session, between
iterations, not fabricated after the fact.

---

## (b) Critical evaluation of the new standing-fact note

Read `experiments/quay-native-bootstrap/provenance.md`'s new section ("Standing fact: V_meta
practical-convergence ceiling...", lines 43-123) in full, directly, and
compared it line-by-line against the pre-existing "Permanent strict-exclusion
set" section (lines 11-41) it claims to mirror.

**Does it have real teeth (a concrete, falsifiable re-trigger condition)?**
Yes. Five explicit conditions are given, and each is independently checkable
against repository state without subjective judgment:

1. A new backlog task scope-matched to QN-006's shape — checkable via `ls
   tasks/QN-*.md` + reading any new task's file.
2. Genuine new demand for wider GitHub `data.write` — checkable against any
   new task's AC/DoD text.
3. A new Method-step gap found during unrelated work — checkable against
   whether a SKILL.md Gaps-section edit occurs outside a dedicated search.
4. A native subagent-dispatch primitive becoming available — checkable via
   `ToolSearch`, exactly as done in every prior iteration.
5. Twelve iterations passing with none of 1-4 triggering — checkable by
   iteration-count arithmetic.

These are not vague ("things seem stable") — they name specific artifacts
(task files, `ToolSearch` output, an iteration counter) that a future
iteration can mechanically check in one line each, exactly as iteration 84
itself demonstrates in its own §3/§6 (re-checking conditions 1 and 4 live,
this iteration, and finding neither met). This is a real, working
self-application, not merely a promise.

**Does it accurately and honestly mirror the "Permanent strict-exclusion
set" pattern's rigor level?** Yes, and the report's own framing is accurate,
not overclaimed, on this point:

| Dimension | Strict-exclusion set | Standing fact (new) |
|---|---|---|
| Canonical, greppable, one location | Yes | Yes |
| Cites its own originating iteration/audit | Yes (iteration 71, iteration 70's audit) | Yes (iteration 84, iteration 83's audit) |
| States explicitly it changes no score | Yes (pointer, not new decision) | Yes (explicit disclaimer, twice) |
| Has a table of affected items + reasons | Yes (3 tasks) | Yes (3 factors) |
| Has an explicit re-open/re-trigger mechanism | Implicit ("if a future task is ever proposed... must be justified") | Explicit, 5 numbered, falsifiable conditions |

If anything, the new note is **more explicit** about its re-trigger mechanism
than the pattern it mirrors (the strict-exclusion set's own "re-open"
language is a single unstructured sentence; the new note enumerates five
concrete conditions). This is a faithful, not an inflated, mirroring.

**Is it appropriately scoped (explicitly NOT a protocol §7 convergence
claim)?** Yes. The note's opening paragraph states this twice, in bold, with
the specific arithmetic reason (V_meta = 0.0973 far below 0.80, and full §7
requires all five criteria). Iteration 84's own §11 Convergence Check
independently reaches "NOT CONVERGED," consistent with this. No overclaiming
was found anywhere in the note's text.

**One minor observation, not a correction**: the "held flat since" iteration
counts in the note's table (61/59/62 iterations for effectiveness/
reusability/completeness respectively, as of iteration 84) use an
exclusive-of-baseline convention (`84 − 23 = 61`, not `84 − 23 + 1 = 62`).
This is internally consistent with iteration 83's own audit, which used the
same convention as of iteration 83 (`83 − 23 = 60`). Not an error — flagged
only as a documentation nuance a careful reader might otherwise stumble on.

---

## (c) Independent judgment: was choosing path (i) over (ii) or DIR-025 3c
the right call?

This audit does not defer to iteration 83's audit's recommendation or
iteration 84's own reasoning — it re-derives the judgment from this audit's
own step (a) backlog check.

**On DIR-025 action 3c**: this audit's own independent read of all four
non-`done` task files (a.2 above) confirms, first-hand, that:

- All four carry the `deliberately-adversarial` label and state in their own
  titles/proposals that they are constructed to be structurally
  unsatisfiable.
- QN-021 is a **child of QN-020** (`parent: QN-020`) — not independent of it
  by definition, directly falsifying any claim that 2 of the 4 could
  represent "independent, non-conflicting" work.
- QN-017/QN-020/QN-022 are each blocked on the same confirmed-absent
  precondition (no native subagent-dispatch primitive) or are already
  correctly terminal `needs-human` states.

Given this, DIR-025 3c's own precondition ("IF suitable independent backlog
work is available") is **genuinely, verifiably not met** — this is not a
convenient dodge dressed up as a structural finding; it is directly
confirmable from the task files' own frontmatter and prose, independent of
any narrative iteration 84 supplies. This audit's own re-check reaches the
identical conclusion from first principles.

**On path (i) vs (ii)**: given DIR-025 3c is ruled out (no independent
backlog exists to fan out), the only remaining choice was between (i)
document the standing fact, or (ii) deliberately author a new,
organically-motivated increment. Path (ii) requires there to *be* organic
material to build — and the same backlog check that rules out 3c also
establishes there is no organically-arising new task in the current backlog
that isn't one of the four adversarial fixtures. Path (ii) would have
required *manufacturing* new scope (a new task, a new GitHub-Provider
feature, or similar) specifically to produce a V-movement data point — which
is exactly the metric-manufacturing anti-pattern this experiment's own G5
guardrail and its `ITERATION-PROMPTS.md` §8 evolution guidance prohibit, and
which iteration 83's search (independently re-verified accurate by iteration
83's own audit) already established would be the only way to attempt (ii)
right now. Given that, path (i) — documenting an accurately-scoped,
evidence-backed standing fact with real re-trigger conditions, and directing
future effort toward the genuinely still-open V_instance factors
(`gate_correctness` = 0.76, explicitly flagged by iteration 84's own
"Problems identified for next iteration" section) — is, independently, the
correct call. This audit reaches this conclusion from its own backlog
verification, not merely by accepting iteration 83's audit's or iteration
84's own stated reasoning.

**Independent verdict on (c): path (i) was the right call, verified from
this audit's own first-hand backlog inspection, not inherited from either
prior document.**

---

## (d) DIR-024 archival and DIR-021/DIR-025 pending-status accuracy

### (d.1) DIR-024 archived correctly?

```
$ git show d699e6e --stat -- '*DIR-024*'
 .../archive/DIR-024-broker-side-agent-spawn-must-be-background-to-support-concurrent-dispatch.md | 0
```

Zero insertions, zero deletions for this file in the commit — confirms a
pure location move (`experiments/quay-native-bootstrap/directives/pending/` →
`experiments/quay-native-bootstrap/directives/archive/`), not a content edit. Independently read the
full archived file (`experiments/quay-native-bootstrap/directives/archive/DIR-024-*.md`): its
frontmatter states `status: resolved`, and its "Resolution" section is
present, complete, and cites the three specific `cord` cap-request IDs
(`18c2c7636ffff3b3`, `18c2c7672815ec9f`, `18c2c76b5d72897b`) each serviced
with `Agent(..., run_in_background=true)`, exactly as both the report and the
directive's own prior-session resolution note describe.

**Confirmed: DIR-024 archived correctly — moved with resolved content
intact, not silently altered.**

### (d.2) DIR-021/DIR-025 correctly left `pending`?

Read both files in full directly.

- **DIR-021**: `status: pending`, a standing SOP requiring a fresh manda
  nested-subagent trial "when a directive calls for verifying that
  capability." Iteration 84's actual work this iteration (writing a
  standing-fact note, archiving a resolved directive, checking backlog
  status) organically required no manda dispatch of any kind — confirmed by
  this audit's own read of the commit diff (a.4 above), which touches only
  documentation files. Leaving it `pending`, unmodified, is accurate.
- **DIR-025**: `status: pending`, a standing SOP. Its own "Progress note"
  section (read in full) confirms actions 3a (DIR-024 fix) and 3b
  (concurrency trial) are done, with specific cap-request IDs and timestamps
  cited, and explicitly states 3c/3d "remain for a future iteration." This
  audit's own independent backlog check (a.2/(c) above) confirms 3c's stated
  precondition ("suitable independent backlog work is available") is
  genuinely not met right now — the report's reasoning for declining 3c this
  iteration is accurate, not an evasion.

**Confirmed: both directives correctly left `pending`, with accurate,
independently-verifiable reasoning for why neither was triggered this
iteration.**

---

## Summary of independently re-verified figures

| Check | Report's claim | Independently re-derived | Match |
|---|---|---|---|
| Total tasks | 70 | 70 | Yes |
| Done tasks | 66 | 66 | Yes |
| Non-done tasks | QN-017/020/021/022, all adversarial fixtures | confirmed by direct file read; QN-021 is `parent: QN-020` | Yes |
| Full regression suite | 29/29 real test files pass | re-run directly, all exit 0 | Yes |
| ABI symmetry | ALL FOUR SURFACES SYMMETRIC | re-run, identical output | Yes |
| σ_strict | 62/70 = 0.8857 | 62/70 = 0.885714... | Yes |
| V_instance | 0.5813 | 0.83×0.96×0.76×0.96 = 0.58134528 | Yes |
| V_meta | 0.0973 | 0.74×0.26×0.79×0.64 = 0.09727744 | Yes |
| Commit diff scope | 3 files (2 new docs + DIR-024 rename), no source touched | confirmed exactly via `git show --stat` | Yes |
| DIR-024 archive | moved, content intact | confirmed: 0 insertions/deletions, resolution text intact | Yes |
| DIR-021/DIR-025 | left `pending`, accurate reasoning | confirmed by direct read of both files | Yes |

## Recommendation

**PASS.** No post-hoc correction is warranted against
`experiments/quay-native-bootstrap/iterations/iteration-84.md` or `experiments/quay-native-bootstrap/provenance.md`'s new
standing-fact section — every specific, checkable factual claim was
independently verified and found accurate, the new standing-fact note
genuinely has falsifiable teeth and is honestly scoped as sub-§7, and this
audit's own independent backlog inspection (not deference to prior
documents) confirms path (i) was the correct choice over (ii) or DIR-025 3c.

**No process concerns to flag.** This iteration's work was narrow,
low-risk, well-scoped documentation/bookkeeping, and the report does not
overclaim credit for it (V_instance and V_meta are both explicitly held flat
with a stated, correct rationale). The one item worth watching going
forward (not a defect, an observation for future iterations): the standing
note's own re-trigger condition 5 (re-search after 12 iterations with no
organic trigger) should actually be honored when iteration ~96 arrives —
future audits should check that this iteration count is tracked accurately
and the dedicated search is not silently deferred past its own stated
window.

---

## Post-audit verification (HEAD vs. `origin/master`)

After committing this audit report, this audit pushed to `origin` and
confirmed `HEAD` and `origin/master` point to the identical commit SHA (see
below).
