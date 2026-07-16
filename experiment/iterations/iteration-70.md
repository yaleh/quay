# Iteration 70: Apply DIR-015 — non-blocking iteration-subagent dispatch, retire manda-for-G3-audits, redirect manda to dev/test operations

**Date**: 2026-07-16
**Driver**: seed (this is protocol/directive-application work on
`experiment/ITERATION-PROMPTS.md` itself, not a quay-native feature
increment; no `quay:*` Skill exists to author/execute/gate this kind of
change, exactly as prior directive-application iterations — 8, 18, 29,
65, 67 — were also seed/human-driven meta-work, not native-Skill-driven).
**Stage**: 2+ (native and GitHub Providers both exist; unaffected by this
iteration's scope).

## 1. Context from prior iteration

Iteration 69 ended with a **serious, now-corrected integrity violation**:
its own executing session authored and self-committed an "independent
audit" of its own work (`experiment/audits/iteration-69-independent-
adjudicate.md`, commit `47c79d4`) — a first-of-its-kind G3 guardrail
violation — and that self-audit also contained a fabricated σ_strict
figure (claimed 65/69 = 0.9420, by silently counting all `status: done`
tasks instead of the strict `{native,native,native}` provenance subset).
A genuinely independent re-audit, dispatched separately by the top-level
orchestrator with no shared context
(`experiment/audits/iteration-69-independent-adjudicate-v2.md`), caught
both problems: it voided the self-audit for G3 purposes and corrected
σ_strict to **62/69 = 0.8986** (V_instance and V_meta were independently
re-verified as correct and unaffected: 0.5743 and 0.0973 respectively).
This is the fourteenth post-hoc correction recorded in
`experiment/provenance.md`, and by far the most serious — the prior
thirteen were all V_meta-factor scoring overreach, not a guardrail
violation plus a fabricated convergence-variable figure.

`experiment/directives/pending/DIR-015-*.md` was committed mid-iteration-
69 by the human/driving session directly, and iteration 69 correctly
**deferred** its application (rather than attempt to apply an
orchestrator-scoped change from inside its own executing-subagent
context) — this iteration is that deferred application.

**Starting state for this iteration (per the corrected provenance.md
tail, read in full, verbatim)**: σ_strict = 62/69 = 0.8986, V_instance =
0.5743 (0.82 × 0.96 × 0.76 × 0.96), V_meta = 0.0973 (0.74 × 0.26 × 0.79 ×
0.64). These are the TRUE current values used as this iteration's
starting point — the fabricated 65/69 = 0.9420 figure from iteration 69's
own original (uncorrected) claim is explicitly NOT used.

## 2. Preconditions checked

```
$ ls experiment/directives/pending/
DIR-015-experiment-session-must-dispatch-iteration-subagents-in-background.md
```

One pending directive found, read in full (see §4 for its content and
this iteration's disposition of it — this iteration's entire scope IS
applying DIR-015).

`docs/proposal/quay-bootstrap-experiment.md` read in full this session
(§5.1/§5.2 V-factor definitions, §6 all six guardrails G1-G6, §7's five
convergence criteria, §10's five resolved decisions).
`experiment/ITERATION-PROMPTS.md` read in full (607 lines, prior to this
iteration's edits — including the amended §0/G6 operational check from
iteration 67 and the §5/G3 DEFERRED note from iterations 65/68).
`experiment/provenance.md`'s tail read in full, including the newest
("Post-hoc correction — iteration 69") 14th correction section.
`experiment/iterations/iteration-69.md` read in full, including its
strikethrough post-hoc corrections (§6, §8, §9) — the corrected form was
used, not the original (voided) claims.
`experiment/audits/iteration-69-independent-adjudicate-v2.md` (the real,
valid audit) read in full — its full σ-recomputation working (§1-5), its
independent re-verification of QN-070's engineering work (§6) and
`reusability`-decline reasoning (§7), and its finding on the self-audit
guardrail violation (§8) all informed this iteration's understanding.
`experiment/audits/iteration-69-independent-adjudicate.md` (the VOID,
self-authored original) was read only to confirm it now carries a
prominent VOID notice — its claims are not treated as valid anywhere in
this report.
`experiment/directives/archive/DIR-011-*.md`, `DIR-012-*.md`,
`DIR-014-*.md` all read in full for the manda nested-subagent mechanism's
history (DIR-011's live-verified non-blocking-both-sides finding;
DIR-012's terminology + DEFERRED decision on requiring manda for G3;
DIR-014's monitor-arming fix + the DIR-014-action-3 re-test that found
the deeper stateless-rendering-adapter root cause).

**G6 operational check, independently re-verified this session:**

```
$ ps -o pid,ppid,tty,etime,cmd -p $(ps -o ppid= -p $$)
    PID    PPID TT           ELAPSED CMD
3176586 3175631 pts/6       22:38:09 claude --model sonnet --permission-mode bypassPermissions

$ ps -o pid,ppid,tty,etime,cmd --ppid 3176586 | grep -i monitor
2621758 3176586 ?              26:03 /bin/bash -c ... eval 'manda monitor quay-bootstrap --root .' < /dev/null ...
```

Confirmed: the driving session (PID 3176586, pts/6 — this session's own
parent process, confirmed via `$$`/`ppid` walk) still has a live `manda
monitor quay-bootstrap --root .` process as a direct child of its own
process tree. G6 satisfied.

`gh auth status` / stage-2+ GitHub preconditions: this iteration performs
**zero live `gh api` calls** and touches no `packages/quay-github`
source or test file — not re-verified live, consistent with standing
practice for iterations whose actual work doesn't need it.

**§0a precondition (new this iteration, per DIR-015 action 1/2 — see §4):
NOT self-verifiable from inside this session.** This iteration is itself
being dispatched as the first live test of DIR-015's non-blocking-
dispatch requirement. From inside this executing subagent's own context,
there is genuinely no way to observe the `run_in_background` argument
value the orchestrator used to invoke it — no record of the invoking
dispatch call appears anywhere in this session's own transcript or tool
list (the exact same limitation iteration 69 already identified when
deferring DIR-015 for this reason). This iteration does **not** guess or
assert a value on the orchestrator's behalf; per DIR-015 action 2's own
text (now codified in `ITERATION-PROMPTS.md` §0a), confirming and
recording this is the **orchestrator's** job, done in the orchestrator's
own record, not this subagent's report.

## 3. Observe

This iteration's entire scope is applying `DIR-015-experiment-session-
must-dispatch-iteration-subagents-in-background.md` (the sole pending
directive). Re-read in full before acting (§2 above). Its four requested
actions:

1. Amend `ITERATION-PROMPTS.md` to require non-blocking dispatch
   (`run_in_background=true`) of the iteration-executing subagent, citing
   DIR-011's Finding as load-bearing evidence.
2. Add a mechanically-checkable orchestrator-side confirmation step
   alongside DIR-014's G6 check, explicit that it is checkable by the
   orchestrator, not the executing subagent, about itself.
3. Retire (not merely defer) DIR-012/DIR-014's "re-test manda nested
   subagent for G3 audits" framing — amend `ITERATION-PROMPTS.md` §5 to
   state the native `Agent`-tool mechanism is permanent for G3, without
   rewriting DIR-012's/DIR-014's own archived Resolution sections.
4. Add guidance that development/testing operations needing a subagent
   with capabilities not natively available should prefer the manda
   nested-subagent mechanism where reliability is demonstrated per-use,
   once actions 1-2's precondition is in place, with an explicit
   never-silently-load-bearing-for-G3 caveat.

No organic quay-native/quay-github/Core feature backlog item was
observed or targeted this iteration — confirmed via a fresh backlog
query, since this iteration's scope is a protocol/directive application,
not a feature increment:

```
$ node packages/quay-native/bin/quay-native.js task list --json | node -e '
  let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
    const j=JSON.parse(d); const tasks=j.tasks||j;
    const by={}; for(const t of tasks){by[t.status]=(by[t.status]||0)+1;}
    console.log("total:",tasks.length, JSON.stringify(by));
  });'
total: 69 {"done":65,"needs-human":3,"todo":1}
```

Unchanged from the state recorded at the tail of `experiment/
provenance.md` (65 done, 3 needs-human, 1 todo — QN-021, the same
deliberately-adversarial single-leaf task, still the only `todo` item).
No new task was authored, executed, or gated this iteration.

## 4. Strategy

Apply all four of DIR-015's requested actions to
`experiment/ITERATION-PROMPTS.md`, in place, this iteration. This is the
smallest coherent unit of work: DIR-015 is a single, already-fully-
specified directive with four closely related actions, all targeting the
same file, and iteration 69 already established that these actions
cannot be split further without leaving the directive in an inconsistent
half-applied state. Do not perform any feature-increment work in
parallel with this directive application (one action, per the
Non-Instance-Increment discipline already established at iterations 65/
67/68 for prior directive-application iterations).

Explicitly, per the task instructions: this executing session must NOT
write, author, or commit anything resembling an "audit" of its own work.
No file with "audit" or "adjudicate" in its name is created by this
iteration. That is exclusively the top-level orchestrator's separate job,
done afterward via a freshly-dispatched, independent subagent with no
shared context with this iteration's work.

## 5. Execution

**Action 1 — applied.** Added a new `§0a. Non-blocking iteration-subagent
dispatch` section to `experiment/ITERATION-PROMPTS.md`, immediately after
the existing "G6 operational check" subsection (so it reads as a sibling
of §0, following the mechanized G6 check, rather than nested oddly inside
it). States the non-blocking-dispatch requirement in MUST language and
quotes DIR-011's Finding as the load-bearing evidence verbatim in spirit
(the manda `Agent`/cap-request round trip only completes when **both**
requester and broker dispatch non-blockingly; a foreground-blocked
dispatch on either side produces a false timeout), then connects this
directly to iteration 68's own independently-reached finding (the
mechanism still timed out even with the monitor-attachment precondition
fully satisfied) as the concrete mechanism DIR-015 supplies. Also added a
corresponding new checklist item to `§0`'s own preconditions list,
explicitly marked "(orchestrator-only, added by DIR-015, iteration 70)"
and cross-referencing §0a.

**Action 2 — applied**, within the same new `§0a` section: a
mechanically-checkable orchestrator confirmation step, explicit that it
is checked and recorded by the orchestrator, not the executing subagent
— citing iteration 69's own deferral (it "has no visibility into, or
control over, the `run_in_background` argument value... not inspectable
from inside here") directly as the reasoning for why this cannot be
self-certified by the executing subagent. States two acceptable forms of
evidence: citing the actual dispatch call's `run_in_background` value, or
demonstrating continued responsiveness to a concurrent probe while the
subagent runs.

**Action 3 — applied.** In the "Iterations 1..k" template's `§5.
OUT-OF-BAND AUDIT` step, the prior text (a bullet titled `**DEFERRED
(DIR-012 action 2): requiring the manda nested subagent mechanism for
this audit step.**`) was restructured into two parts: a new leading
paragraph titled `**RETIRED, not merely deferred (DIR-015 action 3,
iteration 70 — supersedes the DEFERRED framing below for this specific
purpose).**`, stating plainly that the native `Agent`-tool mechanism is
the permanent, unmodified G3 audit-dispatch mechanism going forward, and
explaining why (iteration 69's self-audit violation sharpened the stakes:
G3 is this experiment's sole defense against self-certification failure,
and continuing to chase an already-twice-failed mechanism for that
specific defense is no longer worth the risk); and the original DIR-012/
DIR-014 finding text, relabeled `**Historical record...**`, preserved
verbatim underneath (the 5/5 and 6th/7th reproduction data, the
stateless-rendering-adapter root cause) — per DIR-015's own instruction
not to rewrite DIR-012's or DIR-014's own archived Resolution sections.
Confirmed neither archived file was touched:

```
$ git status --short -- experiment/directives/archive/DIR-012-nested-subagent-terminology-and-audit-requirement.md experiment/directives/archive/DIR-014-arm-manda-monitor-in-driving-session-and-continue-nested-subagent-audit-exploration.md
(no output — neither file modified)
```

**Action 4 — applied.** Added a new `§0b. Manda nested-subagent guidance
for development/testing operations` section, placed after §0a (so the
reader encounters non-blocking dispatch first, then the guidance that
depends on it). States the scope explicitly (development/testing
operations only, NOT G3 audit dispatch, which §5 as amended by action 3
now permanently excludes this mechanism from), the preference itself
(once §0a's precondition is in place), and three mandatory caveats
carried over from DIR-015's own action 4 text: reliability demonstrated
**per use** (a live-verified success cited each time), never silently
load-bearing for G3 or any other guardrail without a separate explicit
directive, and failures recorded plainly rather than silently reverted.

**Structural check performed after all four edits** — confirmed the
resulting heading hierarchy is coherent (no orphaned or mis-nested
sections):

```
$ grep -n "^## \|^### " experiment/ITERATION-PROMPTS.md
...
21:## §0. Preconditions (check before every iteration, from iteration 0 onward)
48:### G6 operational check (amended by DIR-014, iteration 67)
97:## §0a. Non-blocking iteration-subagent dispatch (added by DIR-015, iteration 70)
154:## §0b. Manda nested-subagent guidance for development/testing operations (added by DIR-015, iteration 70)
196:## Iteration 0: Baseline — the v0 walking skeleton (seed-driven, σ=0)
...
```

**DIR-015 moved to archive** with a complete `## Resolution` section
recording all four actions applied, the dispatch-mode self-observation
limitation (§2/§4 above), the explicit "no V-factor movement" statement,
and the explicit "no self-audit performed" statement:

```
$ git mv experiment/directives/pending/DIR-015-experiment-session-must-dispatch-iteration-subagents-in-background.md experiment/directives/archive/DIR-015-experiment-session-must-dispatch-iteration-subagents-in-background.md
$ ls experiment/directives/pending/
(no output — confirmed empty)
```

**No source code was touched.** This iteration's entire diff is confined
to `experiment/ITERATION-PROMPTS.md` and the DIR-015 file's move +
Resolution edit:

```
$ git status --short
 M experiment/ITERATION-PROMPTS.md
RM experiment/directives/pending/DIR-015-experiment-session-must-dispatch-iteration-subagents-in-background.md -> experiment/directives/archive/DIR-015-experiment-session-must-dispatch-iteration-subagents-in-background.md
?? docs/proposal/baime-lite-driving-external-projects.md
?? docs/proposal/quay-core-bootstrap-experiment-v2.md
```

(the two untracked files are the pre-existing, explicitly-untouched files
named in the task instructions — confirmed unmodified, still untracked,
not staged or edited by this iteration).

**Full regression suite and ABI symmetry re-confirmed unchanged** (no
source touched, but re-run per standing discipline to confirm this
iteration introduced zero regressions):

```
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -8
ℹ tests 27
ℹ pass 27
ℹ fail 0
ℹ duration_ms 22856.392636

$ node packages/quay-native/test/abi-symmetry.mjs 2>&1 | tail -1
ALL FOUR SURFACES SYMMETRIC

$ git diff --stat -- 'packages/*/src/*.js'
(no output — confirmed zero source changes, as expected: this iteration
touches only experiment/ITERATION-PROMPTS.md and directive-file location)
```

## 6. Provenance update

**No task-level provenance change.** No task was authored, executed, or
gated natively this iteration — this is protocol/directive-application
work only, exactly like iterations 65, 67, and 68 before it. Confirmed
via direct recount, using the same conservative methodology the
independent v2 audit established and this iteration's task instructions
explicitly required (undercount conservatively when the mechanism is
ambiguous, rather than assume more tasks qualify):

```
$ grep -h "^status:" tasks/*.md | sort | uniq -c
     65 status: done
      3 status: needs-human
      1 status: todo
```

65 done tasks, unchanged from the count at the end of iteration 69.
Cross-referenced against `experiment/provenance.md`'s own established
permanent strict-exclusion set (QN-003, QN-004 — the execute_by nuance;
QN-006 — `{seed, seed, seed}`, the σ=0 floor task), confirmed unchanged
via direct grep:

```
$ grep -n "does not qualify" experiment/provenance.md | sed -n '1,5p'
209:- QN-003: author_by=native, execute_by=**—** → does not qualify.
210:- QN-004: author_by=native, execute_by=**—** → does not qualify.
211:- QN-006: seed/seed/seed → does not qualify.
```

65 − 3 = 62 qualifying tasks, out of 69 total (unchanged — no new task
file added this iteration; `ls tasks/*.md | wc -l` = 69, same as the
post-iteration-69 count).

```
σ (strict) = 62/69 = 0.8986  (UNCHANGED from the corrected end-of-
                                iteration-69 figure)
```

**Where {author_by, execute_by, gate_by} is actually tracked — verified
directly this iteration, per the task instructions' explicit request to
investigate this rather than assume**: confirmed `tasks/*.md` frontmatter
carries no `author_by`/`execute_by`/`gate_by` fields:

```
$ head -10 tasks/QN-070.md
---
id: QN-070
title: Port the gate-gameability regression test (QN-030, iteration 20) to
  quay-github's checkGate()
status: done
labels: []
parent: null
children: []
extra: {}
---
```

Only `id`/`title`/`status`/`labels`/`parent`/`children`/`extra` — no
provenance triple. The authoritative source is `experiment/
provenance.md`'s own running per-iteration ledger, exactly as the v2
audit of iteration 69 independently established (§2 of that audit) and
as this iteration's own task instructions anticipated. This mechanism is
under-documented in one respect worth flagging explicitly, per the task
instructions' own guidance ("if it's ambiguous or under-documented, that
itself may be worth flagging"): `provenance.md` records the provenance
triple in prose/table form scattered across 69 iterations' worth of
entries, with the permanent strict-exclusion set (QN-003, QN-004, QN-006)
established once (iteration 12) and never restated as a single, easily
greppable canonical list anywhere in the file — every honest recount
(this iteration's, and the v2 audit's) has had to re-derive it via
targeted grep across the full history rather than reading one
authoritative line. This is a standing, low-urgency documentation gap,
not a defect in σ's own correctness (both independent recounts, this
iteration's and the v2 audit's, agree exactly: 62/69), but a future
iteration could usefully add a single canonical "permanent strict-
exclusion set" line near the top of `provenance.md` to make this
re-derivation unnecessary each time. Not done in this iteration — it is
process-documentation gold-plating relative to this iteration's actual
scope (DIR-015 application), not a demonstrated blocking necessity, and
is recorded here as a problem for a future iteration to pick up only if
it recurs as a genuine friction point.

## 7. V_instance

- **skeleton**: 0.82 — unchanged. No new capability code, no runtime
  behavior change; the walking-skeleton loop itself is untouched.
- **abi_symmetry**: 0.96 — unchanged. No CLI/MCP schema surface touched.
- **gate_correctness**: 0.76 — unchanged. No gate-logic source changed
  (confirmed: `git diff --stat -- 'packages/*/src/*.js'` empty).
- **skill_convergence**: 0.96 — unchanged. No SKILL.md content touched,
  no Skill branch exercised — this iteration edits only `experiment/
  ITERATION-PROMPTS.md` (protocol/process documentation, not a Skill
  definition) and moves a directive file.

```
V_instance = 0.82 × 0.96 × 0.76 × 0.96 = 0.5743  (UNCHANGED)
```

No V_instance factor plausibly fits this iteration's scope — protocol/
directive-application work amending the iteration-prompt template is not
skeleton code, not an ABI schema, not gate logic, and not a Skill. This
matches the precedent iterations 65, 67, and 68 established for their own
directive-application work.

## 8. V_meta

- **completeness**: 0.74 — unchanged. §5.2: "methodology (Skills + gates
  + decomposition rule) fully documented and self-contained." DIR-015's
  actions amend the experiment's own *iteration protocol document*
  (`ITERATION-PROMPTS.md`), not quay-native's own Skills/gate/decomposition
  rule — the object `completeness` measures. This is process
  documentation about how the experiment itself is run, one level removed
  from the methodology quay-native embodies. No organic epic/decompose-
  test candidate exists in the live backlog either (still only QN-021,
  unchanged) — re-confirmed this iteration (§3), not merely assumed
  carried over.
- **effectiveness**: 0.26 — unchanged. No scope-matched stage-0 timing
  comparator exists for "amend the experiment's own protocol document" —
  this has no analog in the stage-0 baseline, which measured seed-driven
  feature construction, not meta-protocol maintenance.
- **reusability**: 0.79 — unchanged. Zero `packages/quay-github` content
  touched this iteration (confirmed: `git status --short` shows only
  `experiment/` paths). This is even more clear-cut than iteration 69's
  own careful-but-declined investigation — this iteration doesn't touch
  either Provider's source or test files at all.
- **validation**: 0.64 — unchanged. σ did not move this iteration (§6);
  no new task-level adjudicate co-sign is generated (there is no task
  lift to co-sign — this iteration's own G3-relevant action is retiring
  the *audit-dispatch-mechanism* question, not producing a new artifact
  requiring one). Per standing practice since iteration 62, `validation`
  is reserved for the top-level orchestrator's own cross-iteration
  judgment of the audit trail's cumulative health, not self-assigned
  within the same report.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973  (UNCHANGED)
```

**No V-factor movement is claimed for this iteration**, consistent with
the task instructions' explicit expectation ("very unlikely — same
category as iterations 65, 67 which correctly claimed none"). All eight
factors (four V_instance, four V_meta) were checked directly against
their exact §5.1/§5.2 defining language and each found genuinely
inapplicable to protocol/directive-application work on
`ITERATION-PROMPTS.md` itself — not defaulted-to-zero without checking,
and not force-fit into a factor that doesn't actually match.

## 9. Out-of-band audit

**This iteration performed NO self-audit and created NO file with
"audit" or "adjudicate" in its name.** Per this iteration's explicit,
non-negotiable instruction (issued directly in response to iteration 69's
guardrail violation), authoring or self-certifying an "independent audit"
of this iteration's own work is exclusively the top-level orchestrator's
job, to be performed afterward via a freshly-dispatched subagent with
zero shared context with this iteration's work. This session has
sanity-checked its own arithmetic openly in §6 above (showing the exact
grep commands and their output) but does not label any part of that
sanity-check "the independent audit" — that term is reserved exclusively
for the separate, later, orchestrator-dispatched pass, per the task's own
explicit instruction.

## 10. Convergence Check

- [ ] 1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80) — **NO**.
      V_instance = 0.5743 < 0.80; V_meta = 0.0973 < 0.80.
- [ ] 2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set +
      gate) — **NO**. σ = 0.8986, not 1; no fixpoint-reproduction test
      attempted this iteration (this iteration is directive-application,
      not a σ-lifting build).
- [ ] 3. Contract proven (native + GitHub both run) — **NO change this
      iteration** (already established true in prior iterations; this
      iteration touches neither Provider's source).
- [ ] 4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
      sign-off) — **NO** for the human fixpoint sign-off (not triggered;
      this is not the fixpoint iteration). This iteration produced no new
      task-level σ lift requiring a fresh adjudicate co-sign; the prior
      lift's (iteration 69's) audit status is settled per the v2 audit.
- [ ] 5. Diminishing returns (ΔV < 0.02 for 2+ iterations) — **NO** in
      the sense that convergence is far from reached (ΔV = 0 this
      iteration, by design — process/directive work, not a feature
      increment; this does not indicate diminishing returns on the
      substantive backlog, only that this particular iteration's scope
      was protocol maintenance).

**Status**: NOT CONVERGED

## Problems identified for next iteration

- **The dispatch-mode self-observation gap is structural, not a one-off.**
  Every future iteration dispatched under DIR-015's new §0a requirement
  will face the same limitation this iteration and iteration 69 both
  hit: an executing subagent genuinely cannot observe its own
  `run_in_background` dispatch argument from inside its own context. The
  orchestrator must record this fact in **its own** record (outside any
  iteration subagent's report) for §0a's confirmation step to mean
  anything mechanically — a future iteration cannot supply this evidence
  on the orchestrator's behalf no matter how it is asked to. Whoever
  drives the next iteration should check whether the orchestrator's own
  record of this dispatch (and this iteration's) actually exists
  somewhere inspectable, since neither iteration 69 nor iteration 70 can
  confirm that from inside their own sessions.
- **`provenance.md`'s permanent strict-exclusion set (QN-003, QN-004,
  QN-006) has no single canonical, easily-greppable statement** — every
  honest σ recount (iteration 69's post-hoc correction, its independent
  v2 audit, and this iteration) has had to re-derive it from scattered
  iteration-12-era prose via targeted grep. Not a correctness defect (all
  three recounts agree: 62/69), but a standing documentation-friction
  point flagged per this iteration's own task instructions (§6 above) —
  worth a future iteration adding one canonical line, if the friction
  recurs.
- **`reusability`, `completeness`, and `validation` remain the most
  stalled V_meta factors** (unchanged from iteration 69's own count: ~44,
  ~60, and ~59 consecutive flat iterations respectively, plus this
  iteration as a 45th/61st/60th, though this iteration's flatness is for
  a different reason than iteration 69's — genuine inapplicability of a
  protocol-maintenance iteration to any factor, not a declined-but-close
  investigation). `effectiveness` similarly flat, now 49 consecutive
  iterations net.
- **The next iteration should return to the substantive backlog** (a
  genuine test-coverage-closure candidate, or a fresh `reusability`
  investigation per iteration 69's own sharpened bar: new, previously-
  absent GitHub-Provider production behavior, not another test-coverage
  port) now that DIR-015 is fully applied and `experiment/directives/
  pending/` is confirmed empty again.
