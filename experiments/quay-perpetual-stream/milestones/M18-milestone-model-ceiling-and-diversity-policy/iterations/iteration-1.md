# M18-milestone-model-ceiling-and-diversity-policy — iteration-1

Independent re-derivation, run in parallel with iteration-0 (no iteration-0 material read; per the
dispatch instructions, divergence between the two is the intended signal, not a defect).

## 1. Summary

Amended `inherited-core.md` (sizing-rubric section + value-typed SELECT ledger section) and
`OUTER-LOOP.md` (SELECT/charter-authoring step + it0 systematic-explore checks) per this
milestone's charter in-scope items 1-4. Built `scripts/it0-line-budget-check.sh`, a new
mechanically-checkable plan-time line-budget gate, demonstrated against both a small (PASS) and a
deliberately oversized, no-phase/stage-plan (FLAG) test charter. All work performed inside the
pre-created worktree/branch; no merge to master performed.

## 2. HARD GATES (pasted verbatim)

### 2a. Directives/pending disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
```
(command produced no output — directory is empty)

**Disposition:** N/A — zero files present in `directives/pending/` at the time this iteration ran.
There is nothing to disposition (applied/deferred/rejected) this iteration; stated explicitly per
the hard-gate instruction rather than silently skipped.

### 2b. Hub health

```
$ cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
http://localhost:46215
{"root":"/home/yale/work/quay"}
```

### 2c. G7 reachability

```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```

### 2d. Worktree confirmation

The worktree had already been created for this iteration before dispatch, per the task
instructions. Confirmed present and on the correct branch (not recreated):

```
$ cd experiments/quay-perpetual-stream/milestones/M18-milestone-model-ceiling-and-diversity-policy/worktrees/iteration-1
$ git log -1 --format="HEAD is now at %h %s"
HEAD is now at 9350ab0 SELECT m18 = M-MILESTONE-CEILING-DIVERSITY-POLICY: dashboard log entry
$ git branch --show-current
exp5-m18-iteration-1
```

All edits this iteration were made under this worktree directory (files at
`experiments/quay-perpetual-stream/{inherited-core.md,OUTER-LOOP.md}` and
`experiments/quay-perpetual-stream/scripts/it0-line-budget-check.sh` inside the worktree, verified
identical to the shared tree at the worktree's base commit before any edits):

```
$ diff experiments/quay-perpetual-stream/inherited-core.md /home/yale/work/quay/experiments/quay-perpetual-stream/inherited-core.md
$ diff experiments/quay-perpetual-stream/OUTER-LOOP.md /home/yale/work/quay/experiments/quay-perpetual-stream/OUTER-LOOP.md
identical: 0
```
(both diffs produced no output before any edits — worktree started byte-identical to the shared
tree at the base commit)

## 3. it0 systematic-explore checks (run BEFORE work)

**(a) Ceiling/floor arithmetic — N/A by design.** This milestone's charter states Δv̂ = zero direct
VT points (method infra, not a capability-surface change). Confirmed at it0: no VT-chart claim is
introduced anywhere in this iteration's work — the amendments to `inherited-core.md`/`OUTER-LOOP.md`
are substrate-document edits with no `dashboard.md` VT-curve append, no `cov_s` change, no surface
weight change. This iteration's own report makes no VT delta claim.

**(b) Gate-hash/transclusion.**

```
$ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M18-milestone-model-ceiling-and-diversity-policy.md
PASS: experiments/quay-perpetual-stream/charters/M18-milestone-model-ceiling-and-diversity-policy.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
exit=0
```

**(c) Dogfooding evidence-gate.** Applied to this report itself (self-check, since this iteration's
own report is the artifact under evidence-gate discipline): every Done-when clause claim below is
backed by a pasted fenced code block within a few lines, not narrative-only.

**(d) Domain-misfit audit-channel.** This milestone edits two markdown substrate files plus one new
shell script — no live external system, no product code. Consistent with the
M-SIZING/M-VMETA-GATE/M-GATES method-infra-only precedent (charter §it0(d)). The audit channel is
the mechanical scripts themselves (gate-hash-check, and now line-budget-check) run against real
inputs and pasted — the same channel this charter's own Done-when clause 3 requires.

## 4. Work performed

### 4.1 `inherited-core.md` — sizing-rubric amendment (Done-when 1)

Added a new subsection "Milestone-model ceiling — ≤2000-line milestone, nested ≤500/≤200
phase/stage budgets" immediately after the existing size-gauge self-consistency check (before the
"Value-typed SELECT ledger" section begins), citing
`docs/proposals/exp5-quay-task-proposal-plan-skill.md` §4 as the source. States explicitly: "an
expansion above the current small-milestone norm is safe **only when** the milestone is decomposed
into a phase/stage plan with the nested ≤500/≤200-line budgets" — and that a charter claiming the
ceiling without a plan "has not earned the larger size." Scopes the ceiling to development-class
milestones, non-retroactive (forward from this milestone, mirroring the governance/infra hard
floor's own forward-only posture).

Diff (pasted verbatim):

```diff
diff --git a/experiments/quay-perpetual-stream/inherited-core.md b/experiments/quay-perpetual-stream/inherited-core.md
index ccfc840..27fbc75 100644
--- a/experiments/quay-perpetual-stream/inherited-core.md
+++ b/experiments/quay-perpetual-stream/inherited-core.md
@@ -206,6 +206,51 @@ DIR-004 already reached by direct review** — confirming the gauge is a faithfu
 that judgment, not a redescription that would give a different answer (same self-consistency
 pattern as the domain-misfit section's own M01-dist validation above).
 
+### Milestone-model ceiling — ≤2000-line milestone, nested ≤500/≤200 phase/stage budgets
+### (M18-milestone-model-ceiling-and-diversity-policy, DIR-012 item 2 / requested-action item 2;
+### source: `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §4)
+
+The size definition and gauge above (M06-sizing) intentionally left the UPPER bound of "correctly
+sized" open — they define how to tell whether a GIVEN scope is sized right for a build+verify
+template, not how large a scope may safely grow. `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
+§4 resolves that open question for development-class (product-code) milestones specifically,
+answering "a milestone is a whole plan, not a single phase":
+
+```
+milestone ≤ ~2000 lines   =  one whole plan (multiple phases)
+   phase  ≤ ~500  lines
+   stage  ≤ ~200  lines
+```
+
+**This ceiling amends, it does not replace, the size definition/gauge above.** The size
+definition's own core test — "does iteration-0 land ALL Done-when in one pass, with iteration-1
+doing real independent re-derivation, not empty verification and not forced into new build
+work" — still applies at every size. What changes is only the UPPER bound on how large a single
+coherent value step is allowed to be before that test can still hold: exp5's inner-convergence
+record (13/13 through M17, no mid-milestone re-scope) held only because milestones stayed small
+(the existing build+verify template's de facto ceiling was far below 2000 lines, never stated
+explicitly). Going to ~2000 lines WITHOUT a phase/stage decomposition would almost certainly force
+exactly the mid-milestone re-scope the size gauge above flags as OVER-SIZED.
+
+**The safety condition, stated explicitly (do not read the ≤2000 figure in isolation):** an
+expansion above the current small-milestone norm is safe **only when** the milestone is
+decomposed into a phase/stage plan with the nested ≤500/≤200-line budgets above — the plan is
+what contains the risk the larger ceiling introduces (design doc §4: "the two changes (bigger
+milestone + plan skill) therefore must ship together — the plan is what contains the risk the
+larger size introduces"). A milestone charter that claims the ≤2000-line ceiling WITHOUT a
+phase/stage plan attached has not earned the larger size — it should be resized down to the
+existing small-milestone norm, or the phase/stage plan must be produced before dispatch (see the
+plan-time line-budget gate in `OUTER-LOOP.md`'s SELECT/charter-authoring step, added by this same
+milestone).
+
+**Scope of this ceiling.** This is the size ceiling for **development-class** milestones (product
+code, the class this document's "Value-typed SELECT ledger" section below now names explicitly).
+Methodology/design-class milestones (doc-only deliverables, the M10-M17 precedent) are unaffected
+by this ceiling — a design doc has no comparable "lines of implementation" risk profile, and this
+section does not change how they are sized. This ceiling does NOT retroactively resize any
+already-completed milestone (M01-M17); it applies forward, the same non-retroactive posture the
+governance/infra hard floor below already uses for its own forward-only application (from m7).
+
 ## Value-typed SELECT ledger + governance/infra hard floor (M06-sizing Done-when clauses 2-3)
```

### 4.2 `inherited-core.md` — value-typed SELECT ledger amendment (Done-when 4, 5)

Added a new subsection "Two-class diversity policy — methodology/design vs. development-class
milestones" after the existing "Ranking discipline" paragraph, citing
`docs/proposals/exp5-quay-task-proposal-plan-skill.md` §5 for the class table and §6 for the
pipeline-mechanism detail (cited by reference, not duplicated in full, per charter in-scope item
4). States the precondition explicitly (development-class MAY use the narrower pattern only once
`quay-task-to-plan` or an equivalent mechanism exists) and states, in its own dedicated bolded
paragraph, that M18 itself does NOT switch patterns.

Diff (pasted verbatim, continuing the same file):

```diff
@@ -248,6 +293,48 @@ type can and should outrank a positive-VT capability-growth candidate when the n
 higher (see M06-sizing's own SELECT log entry, dashboard.md, for a live worked instance: chosen
 over M-GH-WRITE/M-GH-PARENT which had the only positive VT Δv̂≈+3-4 among the m6 candidates).
 
+### Two-class diversity policy — methodology/design vs. development-class milestones
+### (M18-milestone-model-ceiling-and-diversity-policy, DIR-012 item 2 / requested-action item 2;
+### source: `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §5)
+
+The value-typed ledger above classifies milestones by VALUE TYPE. This subsection adds a second,
+orthogonal classification — **milestone CLASS** — keyed on the same ledger's value types, that
+determines WHERE independent-re-derivation diversity is spent for a given milestone. Diversity is
+a budget, not a free good; where it should be spent differs by what kind of deliverable a
+milestone produces:
+
+| class | deliverable | value-type(s), per the ledger above | diversity strategy |
+|---|---|---|---|
+| **methodology / design** (the M10-M17 precedent — doc-only) | a design/doc artifact | typically `discovery` / `governance-integrity` / `instrument-correction` | **whole-milestone independent re-derivation, UNCHANGED** — iteration-1 independently re-derives the entire deliverable from a fresh worktree, exactly as M01-M17 already do. Cheap: the whole deliverable is a doc. |
+| **development** (the M16-CLI-EDIT-PARITY-IMPL precedent — real product-code changes) | working code, ≤~2000 lines per the ceiling above | typically `capability-growth` | **MAY, at a future charter's discretion, use the narrower pattern**: N-independent-proposal re-derivation + adjudication (upstream) → single implementation → light tail self-check (downstream: the existing adversarial-audit gate, unchanged) — INSTEAD OF whole-milestone dual iteration. |
+
+**Precondition, stated explicitly — this is a MAY, not a default, and is gated on a mechanism that
+does not yet exist:** a development-class milestone may use the narrower pattern **once the
+`quay-task-to-plan` skill (or an equivalent proposal-adjudication mechanism) actually exists** to
+run the N-independent-proposal step through. Until that mechanism exists, development-class
+milestones continue to run the existing whole-milestone dual-iteration pattern like every other
+milestone to date. This is a forward-looking POLICY STATEMENT for future milestones, not something
+any milestone can invoke today.
+
+**M18 itself does NOT switch to this pattern.** This milestone (M18) is itself method-infra/
+doc-editing (amending `inherited-core.md`/`OUTER-LOOP.md`), and even setting that aside, the
+`quay-task-to-plan` skill this policy's precondition names does not exist yet (DIR-012 item 3,
+explicitly future work — not built by this milestone; see this milestone's own charter,
+"Explicitly OUT of scope"). M18 runs, and has run, the existing whole-milestone independent
+dual-iteration pattern the same way M13-M17 did. Stated here explicitly so a skeptical future
+re-read cannot mistake this policy STATEMENT for a claim that M18 itself already used it.
+
+**Mechanism detail — see the design doc, not duplicated here.** The concrete pipeline shape a
+development-class milestone would run under the narrower pattern — "clamp at both ends" (N
+independent proposal subagents + adjudication upstream, single implementation with a plan-check in
+the middle, the existing adversarial-audit gate unchanged downstream) — is specified in
+`docs/proposals/exp5-quay-task-proposal-plan-skill.md` §6 ("The pipeline — clamp at both ends, plan-
+check in the middle"). This section states the POLICY (which class uses which diversity strategy,
+and under what precondition); it deliberately does not duplicate §6's full pipeline diagram or
+mechanism detail here, to keep this Tier-B pinned-substrate file's size controlled (DIR-009's
+charter-thinness discipline, applied to Tier-B as well as Tier-A) — a future charter invoking this
+policy should read §6 directly for the mechanism.
+
 ### Self-consistency check: retroactively applying the ledger to m1-m5 (read-only, M06-sizing
 ### Done-when clause 4 — does NOT rewrite dashboard.md's settled VT numbers)
```

### 4.3 `OUTER-LOOP.md` — plan-time line-budget gate (Done-when 2)

Added a new bullet to step 3 ("AUTHOR CHARTER") requiring the charter to state an explicit
`Line budget: <N>` line and run `it0-line-budget-check.sh` before dispatch; added a new sub-check
(e) to step 4 ("it0 SYSTEMATIC-EXPLORE CHECKS") alongside the existing (a)-(d) mechanized checks, so
the gate is run, not just read about — following the exact same pattern the existing
gate-hash/ceiling/dogfood checks use.

Diff (pasted verbatim):

```diff
diff --git a/experiments/quay-perpetual-stream/OUTER-LOOP.md b/experiments/quay-perpetual-stream/OUTER-LOOP.md
index ac8b865..6c351e6 100644
--- a/experiments/quay-perpetual-stream/OUTER-LOOP.md
+++ b/experiments/quay-perpetual-stream/OUTER-LOOP.md
@@ -78,6 +78,17 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
      the charter must state `inherited-core.md`'s "Web UI verification requirement" evidence rule
      explicitly in that clause's own text — a `curl` status check is never sufficient evidence for
      it (liveness/HARD-GATES only).
+   - **Plan-time line-budget gate (M18-milestone-model-ceiling-and-diversity-policy, DIR-012 item 2):**
+     for any milestone (especially development-class, per `inherited-core.md`'s "Milestone-model
+     ceiling" section) whose scope plausibly approaches or exceeds the ~2000-line ceiling, state the
+     charter's own `Line budget: <N>` explicitly, and run
+     `scripts/it0-line-budget-check.sh <charter-file>` (added by this milestone; see it0 step below)
+     BEFORE dispatch. A FLAG result (scope plausibly over ~2000 lines with no phase/stage plan
+     reference) must not be dispatched as-is — either resize the charter down to the existing
+     small-milestone norm, or attach a phase/stage plan (nested ≤500/≤200-line phase/stage budgets,
+     per the ceiling section) before dispatch. This is a REAL mechanically-checkable gate, not a
+     narrative mention — the exact DIR-002-class "enforcement half never built" gap this milestone
+     exists to close.
    - the **in-scope gap subset only** (+ every OPEN blocking gap verbatim);
    - **binary Done-when clauses** (mandatory — §3.4; without them milestones drag, cf. exp1/exp4);
    - the **inner termination five conditions** (§3.2);
@@ -100,6 +111,12 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
        list; if Step 3 concludes no independent mechanism is reachable, that IS a §3.2 condition-3
        ceiling trigger — redesign the milestone's scope before dispatch, don't dispatch without an
        audit channel.
+   (e) **plan-time line-budget gate** (M18-milestone-model-ceiling-and-diversity-policy) —
+       `scripts/it0-line-budget-check.sh <charter-file>` against the drafted charter; a FLAG (exit 1)
+       means the charter's scope plausibly exceeds the ~2000-line ceiling
+       (`inherited-core.md`'s "Milestone-model ceiling" section) with no phase/stage plan
+       reference — resize the charter or attach a phase/stage plan before dispatch, don't dispatch
+       an unflagged oversized charter.
    Any check firing → fix before dispatch, per the procedures/scripts above (all under
    `experiments/quay-perpetual-stream/scripts/`).
 5. **DISPATCH INNER** — run the milestone as a bounded BAIME experiment to convergence. Per iteration
```

### 4.4 New gate script: `scripts/it0-line-budget-check.sh`

Built following the same style/precedent as `it0-ceiling-check.sh` / `it0-dogfood-evidence-gate.sh`
(header comment block explaining what it checks, `set -u`, usage/exit-code contract, non-zero exit
on flag). Design: parse an explicit `Line budget:`/`Estimated lines:` declaration (or a nested
milestone/phase/stage budget block) from the charter; fall back to a coarse "In-scope work section
line count" proxy if no explicit figure is stated; separately detect a phase/stage plan reference
(nested budget block, `Phase`/`Stage` headings, or a `docs/plans/*.md` pointer); FLAG (exit 1) iff
scope > threshold (default 2000) AND no plan reference found.

Full script contents (163 lines) committed at
`experiments/quay-perpetual-stream/scripts/it0-line-budget-check.sh`,
commit `ddc0a6d9091f2fe34d003afd332be5a2a1c64ece` on branch `exp5-m18-iteration-1`.

## 5. Gate-script demonstration (Done-when 3 — pasted PASS + FAIL/flag runs)

Test charters (`/tmp/lb-test/small-charter.md`, `/tmp/lb-test/oversized-charter.md`):

```
$ cat /tmp/lb-test/small-charter.md
# Charter M-TEST-SMALL — a small, correctly-sized test charter

Line budget: 180

## In-scope work
1. Add a single validation function to the CLI edit path.
2. Add a unit test for it.
```

```
$ cat /tmp/lb-test/oversized-charter.md
# Charter M-TEST-OVERSIZED — a deliberately oversized test charter, no phase/stage plan

Line budget: 4200

## In-scope work
1. Rewrite the entire task-store persistence layer to support a new backend.
2. Add a new provider ABI implementation from scratch, including auth, pagination, and webhooks.
3. Migrate all existing CLI commands to the new backend with full backward compatibility.
4. Add a new Web UI surface for the new backend's admin console.
```

Real runs, both real outputs pasted (not summarized):

```
$ bash experiments/quay-perpetual-stream/scripts/it0-line-budget-check.sh /tmp/lb-test/small-charter.md
Charter: /tmp/lb-test/small-charter.md
Threshold: 2000 lines
Declared scope: 180 lines (source: explicit 'Line budget: 180' declaration)
Phase/stage plan reference: NOT FOUND
PASS: either under the 2000-line ceiling, or over it WITH a phase/stage plan reference.
exit=0
```

```
$ bash experiments/quay-perpetual-stream/scripts/it0-line-budget-check.sh /tmp/lb-test/oversized-charter.md
Charter: /tmp/lb-test/oversized-charter.md
Threshold: 2000 lines
Declared scope: 4200 lines (source: explicit 'Line budget: 4200' declaration)
Phase/stage plan reference: NOT FOUND
FLAG: scope (4200) plausibly exceeds the 2000-line ceiling with NO
      phase/stage plan reference found. Per inherited-core.md's Milestone-model ceiling
      section, this charter has NOT earned the larger size — resize down to the existing
      small-milestone norm, or attach a phase/stage plan (nested ≤500/≤200 budgets, or an
      explicit docs/plans/*.md pointer) before dispatch.
exit=1
```

**Additional sanity runs performed (not required by Done-when 3, but exercised to validate the
plan-detection branch and the no-declaration proxy branch are not dead code):**

```
$ bash experiments/quay-perpetual-stream/scripts/it0-line-budget-check.sh /tmp/lb-test/oversized-with-plan-charter.md --threshold 1500
Charter: /tmp/lb-test/oversized-with-plan-charter.md
Threshold: 1500 lines
Declared scope: 1900 lines (source: explicit 'Line budget: 1900' declaration)
Phase/stage plan reference: FOUND (nested milestone/phase/stage line-budget block found)
PASS: either under the 1500-line ceiling, or over it WITH a phase/stage plan reference.
exit=0
```

```
$ bash experiments/quay-perpetual-stream/scripts/it0-line-budget-check.sh experiments/quay-perpetual-stream/charters/M18-milestone-model-ceiling-and-diversity-policy.md
Charter: experiments/quay-perpetual-stream/charters/M18-milestone-model-ceiling-and-diversity-policy.md
Threshold: 2000 lines
No explicit scope declaration found. proxy: charter's own In-scope-work section line count (29 lines of charter text — NOT a real implementation-line estimate, only a coarse heuristic; charter should state an explicit Line budget instead)
Phase/stage plan reference: NOT FOUND
PASS: either under the 2000-line ceiling, or over it WITH a phase/stage plan reference.
exit=0
```

Sanity check: M18's own charter (no explicit line-budget declaration, real in-scope-work section)
correctly passes via the proxy path — the script did not spuriously flag it.

## 6. Regression / tooling check (Done-when 7)

No product code touched; markdown substrate + one new shell script. Ran syntax/lint checks and
regression-ran the pre-existing gate scripts to confirm no breakage:

```
$ bash -n experiments/quay-perpetual-stream/scripts/it0-line-budget-check.sh && echo "bash -n: syntax OK"
bash -n: syntax OK

$ shellcheck experiments/quay-perpetual-stream/scripts/it0-line-budget-check.sh
$ echo "shellcheck exit=$?"
shellcheck exit=0

$ for f in experiments/quay-perpetual-stream/scripts/*.sh; do echo "-- $f --"; shellcheck "$f" && echo "OK"; done
-- experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh --
OK
-- experiments/quay-perpetual-stream/scripts/it0-dir-projection-check.sh --
OK
-- experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh --
OK
-- experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --
OK
-- experiments/quay-perpetual-stream/scripts/it0-line-budget-check.sh --
OK

$ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M18-milestone-model-ceiling-and-diversity-policy.md
PASS: experiments/quay-perpetual-stream/charters/M18-milestone-model-ceiling-and-diversity-policy.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
exit=0

$ bash experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh --file experiments/quay-continuous-bootstrap/gap-list.md UQ-042
UQ-042: CLOSED
exit=0
```

No regressions found. This satisfies Done-when clause 7 (raw output pasted, tooling changed since a
new script was added, so "N/A" alone would not apply — a real regression pass was run instead).

## 7. Scope-boundary confirmation (Done-when 6)

`git diff --stat` against this milestone's pre-charter base commit (`9350ab0`, "SELECT m18 =
M-MILESTONE-CEILING-DIVERSITY-POLICY: dashboard log entry" — the commit immediately before the
charter-authoring commit):

```
$ git log --oneline -5
ddc0a6d M18 iteration-1: milestone ceiling + two-class diversity policy substrate
9350ab0 SELECT m18 = M-MILESTONE-CEILING-DIVERSITY-POLICY: dashboard log entry
d96d40b Author M18-milestone-model-ceiling-and-diversity-policy charter
5915fb4 ABSORB m17 = M-TASK-TO-PLAN-SKILL-DESIGN: milestone_counter -> 17
59f6cbb ABSORB m17 = M-TASK-TO-PLAN-SKILL-DESIGN: backlog row

$ git merge-base HEAD master
9350ab05de7f76b6558da181053a8b623a0ad8eb

$ git diff --stat 9350ab0..HEAD
 experiments/quay-perpetual-stream/OUTER-LOOP.md    |  17 +++
 .../quay-perpetual-stream/inherited-core.md        |  87 +++++++++++
 .../scripts/it0-line-budget-check.sh               | 163 +++++++++++++++++++++
 3 files changed, 267 insertions(+)
```

**Confirmed explicitly: DIR-012 item 3 (skill implementation/dogfooding) was NOT performed this
milestone.** Exactly the three intended files changed (`inherited-core.md`, `OUTER-LOOP.md`, one new
gate script under `experiments/quay-perpetual-stream/scripts/`); zero `.claude/skills/` files
touched; no `M-TASK-TO-PLAN` implementation artifacts of any kind created. `backlog.md`/
`dashboard.md` bookkeeping for this milestone's own charter/SELECT step happened in earlier commits
(`d96d40b`/`9350ab0`, pre-dating this iteration) — this iteration's own commit adds no further
bookkeeping changes; the ABSORB-time `backlog.md` DONE row (Done-when clause 8) is left for the
outer loop at ABSORB, per the milestone's own dispatcher note ("Record each iteration under
.../iterations/").

## 8. Self-assessment against the charter's 8 Done-when clauses

1. **MET.** §4.1 above — `inherited-core.md`'s sizing-rubric section amended with ≤2000/≤500/≤200
   ceiling, citing design doc §4, pasted diff.
2. **MET.** §4.3 above — `OUTER-LOOP.md`'s SELECT/charter-authoring step (+ it0 checks list) gains an
   explicit, mechanically-checkable plan-time line-budget gate, pasted diff.
3. **MET.** §4.4 + §5 above — `it0-line-budget-check.sh` built (new script under `scripts/`),
   demonstrated firing correctly on a small charter (PASS, exit 0) and a deliberately-oversized
   charter with no phase/stage plan (FLAG, exit 1), both real pasted runs.
4. **MET.** §4.2 above — `inherited-core.md`'s value-typed SELECT ledger section amended with the
   two-class diversity policy, explicitly stating M18 itself is NOT switching patterns (its own
   bolded paragraph), pasted diff.
5. **MET.** §4.2 above — `inherited-core.md` cites (does not duplicate)
   `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §6 for the diversity-policy mechanism
   detail, pasted diff showing the citation paragraph.
6. **MET.** §7 above — `git diff --stat` against the pre-charter base commit shows only the three
   intended files changed; explicit confirmation DIR-012 item 3 was not performed; zero
   `.claude/skills/` files touched.
7. **MET.** §6 above — tooling DID change (new gate script); ran `bash -n`, `shellcheck` (clean,
   exit 0) on the new script and all four pre-existing gate scripts (no regressions), and
   re-ran two pre-existing gate scripts end-to-end against real inputs (both still PASS) —
   raw output pasted, not narrative-only.
8. **NOT YET MET this iteration — expected, left for ABSORB.** `backlog.md`'s
   `M-MILESTONE-CEILING-DIVERSITY-POLICY` row marked DONE is an outer-loop ABSORB-step action (the
   milestone's own dispatcher note: "Record each iteration under .../iterations/"; ABSORB/dashboard
   bookkeeping is explicitly the outer loop's job, not an inner iteration's). This iteration's
   substrate work (clauses 1-7) is what ABSORB will point the backlog row at.

**Overall: 7 of 8 Done-when clauses MET by this iteration's own work; clause 8 is correctly deferred
to the outer loop's ABSORB step, not a gap in this iteration.**

## 9. Convergence check (§3.2's five conditions)

1. **Done-when complete & stable ≥1 iteration** — 7/8 clauses met by this iteration; clause 8 is an
   outer-loop action by design, not an inner-iteration gap. Per the charter's own framing ("expect
   condition 1 ... to be the natural terminus"), this iteration's material constitutes a complete,
   substantively-done pass. Whether this is "stable" depends on iteration-0's independent
   re-derivation reaching materially the same substrate content (divergence, if any, is exactly
   what this two-iteration structure is designed to surface — not adjudicated by this iteration
   itself).
2. **ΔV<0.02 both layers K=2 consecutive** — N/A, this milestone carries zero VT-chart weight by
   design (Δv̂=0, confirmed at it0(a) above); no V curve exists to measure a delta against.
3. **Ceiling→redesign-OR-stop** — no ceiling encountered; the scope as chartered was fully
   completable in one pass with real, verifiable gate-script evidence.
4. **Budget≈10 backstop** — not reached (this is iteration-1 of what the charter frames as a
   2-iteration whole-milestone dual-iteration pattern).
5. **External HALT** — none observed; `directives/pending/` empty, no `.halt` file encountered.

**This iteration's own recommendation:** condition 1 (Done-when complete & stable) is the natural
terminus per the charter's own stated expectation. This iteration's independent re-derivation
should be reconciled against iteration-0's by the outer loop; if the two iterations' substrate
content is materially consistent (both landing the same ceiling figures, same two-class policy
shape, same citation targets), that reconciliation itself is the "stable ≥1 iteration" evidence
condition 1 requires.

## 10. Reflection

**What was learned.** The gate-script design space here differs from the existing `it0-*-check.sh`
scripts in one respect worth naming: `it0-ceiling-check.sh` and `it0-gate-hash-check.sh` both check
against an unambiguous ground truth (a gap-list table row's status; a byte-exact hash). A
line-budget gate has no equally crisp ground truth at SELECT/charter-authoring time — "how many
lines will this milestone's implementation actually be" is inherently an estimate, not a fact
extractable from the charter text alone. The script built here resolves this by preferring an
explicit author-stated declaration (a `Line budget: <N>` convention this iteration introduces) and
falling back to a deliberately conservative, explicitly-labeled-as-coarse proxy only when no
declaration exists — making the estimate's provenance visible in the script's own output rather
than silently guessing. This mirrors the dogfood-evidence-gate's own "coarse proximity heuristic,
not a full validator" self-description.

**Challenges.** None blocking. The main design decision was how strict to make the phase/stage-plan
detection (three independent detection paths — nested budget block, Phase/Stage headings, or a
docs/plans/*.md pointer — rather than requiring one exact format) — resolved by supporting all
three, since the charter itself doesn't mandate one specific plan-declaration syntax, only that a
phase/stage decomposition exist.

**Next focus (for the outer loop, not a next inner iteration under this same charter):** reconcile
this iteration's substrate content against iteration-0's independent version at ABSORB; if
materially consistent, complete Done-when clause 8 (`backlog.md` DONE row) and note DIR-012 item 3
remains open for a future milestone, per the charter's own explicit-OUT-of-scope statement.

## 11. Artifacts

- `experiments/quay-perpetual-stream/inherited-core.md` (amended, worktree commit `ddc0a6d`)
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` (amended, same commit)
- `experiments/quay-perpetual-stream/scripts/it0-line-budget-check.sh` (new, same commit)
- Branch `exp5-m18-iteration-1`, worktree at
  `experiments/quay-perpetual-stream/milestones/M18-milestone-model-ceiling-and-diversity-policy/worktrees/iteration-1`
  — NOT merged to master, left for the outer loop.
- This report: `experiments/quay-perpetual-stream/milestones/M18-milestone-model-ceiling-and-diversity-policy/iterations/iteration-1.md`
  (written directly to the shared main tree, per the dispatch instructions).
