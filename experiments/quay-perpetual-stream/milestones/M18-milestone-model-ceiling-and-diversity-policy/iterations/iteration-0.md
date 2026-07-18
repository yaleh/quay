# M18-milestone-model-ceiling-and-diversity-policy — iteration-0

**Milestone:** M18-milestone-model-ceiling-and-diversity-policy (land DIR-012 item 2, Tier-A)
**Worktree:** `experiments/quay-perpetual-stream/milestones/M18-milestone-model-ceiling-and-diversity-policy/worktrees/iteration-0`
**Branch:** `exp5-m18-iteration-0`
**Base commit:** `9350ab0` ("SELECT m18 = M-MILESTONE-CEILING-DIVERSITY-POLICY: dashboard log entry")
**Iteration commit:** `ad1a9a6` ("M18 iteration-0: land DIR-012 item 2 substrate — ceiling + diversity policy + gate script")
**Status:** iteration-0 work complete, NOT merged to master (left for the outer loop per instructions).

---

## 1. Required reading — confirmed complete

Read, in order: the M18 charter, `inherited-core.md`'s sizing-rubric + value-typed SELECT ledger
sections, `OUTER-LOOP.md`'s SELECT/charter-authoring step, `docs/proposals/exp5-quay-task-proposal-
plan-skill.md` §4/§5/§6, `directives/archive/DIR-012-*.md` Requested-action item 2, and the existing
`experiments/quay-perpetual-stream/scripts/it0-*-check.sh` scripts (`it0-ceiling-check.sh`,
`it0-gate-hash-check.sh`, `it0-dogfood-evidence-gate.sh`) for the established gate-script pattern.

## 2. HARD GATES — pasted literal output

### Gate 1 — pending directives listing + disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
```
(no output — directory listed empty)

**Disposition: N/A — the listing is empty.** There are zero pending directives to disposition this
iteration. Stated explicitly per the instruction, not silently skipped.

### Gate 2 — manda hub health

```
$ cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
http://localhost:46215
{"root":"/home/yale/work/quay"}
```

Hub is up and responding to `/healthz` with the expected JSON payload (repo root echo).

### Gate 3 — G7 reachability

```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```

### Gate 4 — worktree confirmation (already created, not recreated)

```
$ cd experiments/quay-perpetual-stream/milestones/M18-milestone-model-ceiling-and-diversity-policy/worktrees/iteration-0
$ git status
On branch exp5-m18-iteration-0
nothing to commit, working tree clean
$ git log -1 --oneline
9350ab0 SELECT m18 = M-MILESTONE-CEILING-DIVERSITY-POLICY: dashboard log entry
$ git rev-parse HEAD
9350ab05de7f76b6558da181053a8b623a0ad8eb
```

Confirmed: worktree already exists on branch `exp5-m18-iteration-0`, HEAD at `9350ab0`. Not
recreated. Cross-checked from the shared tree:

```
$ git worktree list | grep m18
.../M18-milestone-model-ceiling-and-diversity-policy/worktrees/iteration-0  9350ab0 [exp5-m18-iteration-0]
.../M18-milestone-model-ceiling-and-diversity-policy/worktrees/iteration-1  9350ab0 [exp5-m18-iteration-1]
```

All four HARD GATES pass; all edits below were made inside the `iteration-0` worktree only.

## 3. it0 systematic-explore checks

- **(a) ceiling/floor arithmetic — N/A, confirmed no VT-chart claim introduced.** Per the charter's
  own it0-check (a): this milestone is zero-VT by design (method infra, mirrors M-SIZING/
  M-VMETA-GATE/M-DIR-PROJECTION). Confirmed at it0: no `Δv` number, no VT-surface coverage change,
  and no `dashboard.md` VT curve append is made anywhere in this iteration's work. **Δv̂=0 as
  designed, confirmed explicitly — no VT-chart claim was introduced.**
- **(b) gate-hash/transclusion** — the charter cites its HARD GATES block by-reference
  (`GATE-HASH-REF`). Re-verified below (§4).
- **(c) dogfooding evidence-gate** — every claim below is backed by pasted command output within
  the evidence-proximity convention this experiment's own `it0-dogfood-evidence-gate.sh` checks for.
- **(d) domain-misfit audit-channel** — this milestone edits two markdown substrate files + adds one
  shell gate script; the domain-misfit audit channel is the gate script's own real PASS/FAIL
  behavior against constructed fixtures (demonstrated in §5), the same self-proving-mechanism shape
  the existing `it0-*-check.sh` scripts already established (M02-gates precedent). No live external
  system involved. Consistent with M-SIZING/M-VMETA-GATE/M-GATES's method-infra-only precedent.

### Gate-hash re-verification (charter's own by-reference check)

```
$ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference \
    experiments/quay-perpetual-stream/charters/M18-milestone-model-ceiling-and-diversity-policy.md
PASS: experiments/quay-perpetual-stream/charters/M18-milestone-model-ceiling-and-diversity-policy.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
```

## 4. Work performed — summary + diffs

### 4.1 `inherited-core.md` — sizing-rubric amendment (in-scope item 1)

Added a new subsection ("Milestone ceiling expansion — ≤2000-line milestone, nested ≤500/≤200
phase/stage budgets") immediately after the existing "Result:" paragraph closing the
"Milestone size definition + verify-iteration size gauge" section (M-SIZING, m6), and immediately
before the "Value-typed SELECT ledger" `##` heading — i.e. inserted INSIDE the sizing-rubric
section, not appended elsewhere. States the ceiling adopts `docs/proposals/exp5-quay-task-proposal-
plan-skill.md` §4 verbatim in spirit (cited, not duplicated), states explicitly that the ≤2000-line
milestone is safe ONLY when decomposed via a phase/stage plan, and that the ceiling expansion and
the plan requirement "ship together." Also states the relationship to the existing gauge (the
per-phase/per-stage unit is what the existing gauge judges under the expanded regime, not a looser
standard) and points at the new gate script for mechanical enforcement.

### 4.2 `inherited-core.md` — value-typed SELECT ledger amendment (in-scope items 3-4)

Added a new subsection ("Two-class diversity policy — methodology/design vs. development-class
milestones") immediately after the ledger's existing self-consistency-check "Result:" paragraph and
immediately before the "Web UI verification requirement" `##` heading — i.e. inserted INSIDE the
value-typed SELECT ledger section. States: Class 1 (methodology/design, M10-M17 precedent) keeps
whole-milestone independent re-derivation unchanged; Class 2 (development, M16-CLI-EDIT-PARITY-IMPL
precedent) MAY use the narrower N-independent-proposal + single-implementation + light-tail-check
pattern, gated on an explicit precondition (the `quay-task-to-plan` skill or equivalent
proposal-adjudication mechanism actually existing — DIR-012 item 3, not yet built). States
explicitly, in its own paragraph, that **M18 itself does NOT switch patterns** and runs the existing
whole-milestone dual-iteration pattern like M13-M17. Closes with a "Mechanism detail" paragraph
citing `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §6 for the "clamp at both ends"
pipeline shape, without duplicating its content (in-scope item 4).

Both `inherited-core.md` diffs, pasted in full:

```diff
diff --git a/experiments/quay-perpetual-stream/inherited-core.md b/experiments/quay-perpetual-stream/inherited-core.md
index ccfc840..ef1e767 100644
--- a/experiments/quay-perpetual-stream/inherited-core.md
+++ b/experiments/quay-perpetual-stream/inherited-core.md
@@ -206,6 +206,67 @@ DIR-004 already reached by direct review** — confirming the gauge is a faithfu
 that judgment, not a redescription that would give a different answer (same self-consistency
 pattern as the domain-misfit section's own M01-dist validation above).
 
+### Milestone ceiling expansion — ≤2000-line milestone, nested ≤500/≤200 phase/stage budgets
+### (M18-milestone-model-ceiling-and-diversity-policy, DIR-012 item 2; amends, does not replace,
+### the size definition/gauge above)
+
+The size definition and gauge above (M06-sizing/DIR-004) answer HOW to judge whether a given
+scope fits ONE build+verify cost unit; they deliberately leave open HOW LARGE a single coherent
+value step is allowed to be before it must be split. `docs/proposals/exp5-quay-task-proposal-plan-
+skill.md` §4 ("Milestone sizing: expand to ≤2000 lines — but only because the plan makes it safe")
+answers that open question. This subsection adopts that answer as substrate, cited (not
+re-derived) here:
+
+**The ceiling, with nested sub-budgets:**
+
+```
+milestone ≤ ~2000 lines   =  one whole plan (multiple phases)
+   phase  ≤ ~500  lines
+   stage  ≤ ~200  lines
+```
+
+**This is an AMENDMENT to the size definition above, not a replacement.** Every milestone run in
+this experiment so far (m1-m17) has been small enough that the size definition's own gauge
+("iteration-0 lands ALL Done-when in one pass, iteration-1 purely re-derives") applied directly,
+with no phase/stage structure needed — that regime is UNCHANGED and remains the default for
+methodology/design-class milestones (see the two-class diversity policy below). This subsection
+adds a SECOND regime, for milestones whose coherent value step genuinely does not fit the existing
+small-milestone norm: it may be sized up to ~2000 lines, but **only when accompanied by an explicit
+phase/stage decomposition plan** (produced by the future `quay-task-to-plan` skill, DIR-012 item 3,
+not yet built — or, until then, by the existing `proposal-to-plan` skill, per DIR-012's own
+`docs/plans/3-7-quay-task-to-plan-skill.md` precedent, itself produced this way).
+
+**Why this expansion is safe ONLY when decomposed, stated explicitly (the load-bearing
+qualification, per the design doc §4):** exp5's inner-convergence record (13/13 milestones, no
+mid-milestone re-scope, as of m17) has held only because milestones have been kept small. Going to
+~2000 lines WITHOUT a phase/stage plan would almost certainly force the exact mid-milestone
+re-scope the size-gauge's OVER-SIZED verdict (m1/M01-dist, above) already demonstrates happens once
+a milestone exceeds one coherent build+verify unit. The plan is what CONTAINS the risk the larger
+ceiling introduces — a milestone sized above the small-milestone norm with no accompanying
+phase/stage plan is not a correctly-sized large milestone, it is an under-planned one, and must be
+rejected/resized at SELECT time exactly as the existing size definition's OVER-SIZED case already
+requires (this is a restatement of that existing discipline at a new scale, not a new kind of
+discipline). **The ≤2000-line ceiling and the phase/stage plan requirement ship together — a
+charter may not claim the larger ceiling while skipping the decomposition.**
+
+**Relationship to the existing gauge:** the verify-iteration size gauge above still applies
+UNCHANGED to whichever unit is actually being judged — for a ceiling-expanded milestone, that unit
+is the PHASE (≤500 lines) or STAGE (≤200 lines), not the whole ~2000-line milestone; the gauge's
+"iteration-0 lands it in one pass, iteration-1 re-derives" question is answered per-phase/stage
+under this regime, exactly mirroring how it was already answered per-milestone under the
+small-milestone regime. This is the concrete meaning of "one whole plan (multiple phases)" above:
+the plan is what lets a ~2000-line milestone be judged, phase by phase, against the SAME gauge that
+already governs small milestones — not a different, looser standard.
+
+**Mechanical enforcement:** see `OUTER-LOOP.md`'s SELECT/charter-authoring step for the plan-time
+line-budget gate that checks this at charter-authoring time (a real script, not a narrative
+reminder) — `scripts/it0-ceiling-line-budget-check.sh`, demonstrated below.
+
+**Source:** `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §4 (cited, not duplicated in
+full — the design doc's own worked reasoning, the meta-cc/quay `proposal-to-plan` review-loop
+evidence it cites, and the "clamp at both ends" pipeline context all live there; this section
+states only the operational rule and its enforcement pointer).
+
 ## Value-typed SELECT ledger + governance/infra hard floor (M06-sizing Done-when clauses 2-3)
 
 VT (the chart-0/chart-1 capability-growth score) prices only ONE kind of milestone value. DIR-004's
@@ -272,6 +333,64 @@ categories — the same self-consistency pattern used above for the size gauge (
 and in the domain-misfit section (against M01-dist). No dashboard.md VT number is altered by this
 table; it only ADDS a value-type label alongside the existing settled numbers.
 
+### Two-class diversity policy — methodology/design vs. development-class milestones
+### (M18-milestone-model-ceiling-and-diversity-policy, DIR-012 item 2; amends, does not replace,
+### the value-typed ledger above)
+
+The five value types above classify WHY a milestone has value; this subsection adds a SECOND,
+orthogonal classification — WHAT KIND of deliverable a milestone produces — because the correct
+independent-re-derivation strategy (how diversity/independence is spent to catch errors) differs by
+that second axis, not by value type. Source: `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
+§5 ("Two milestone classes, two diversity strategies"), cited here (not re-derived).
+
+**Class 1 — methodology/design-class milestones** (the M10-M17 precedent — doc-only deliverables;
+typically `discovery` or `governance-integrity`-typed in the value-typed ledger above, though the
+two axes are independent and neither implies the other): deliverable is a design/methodology
+document or a substrate edit. Diversity strategy: **whole-milestone independent re-derivation,
+UNCHANGED** — the existing two-iteration build+verify template (iteration-0 builds, iteration-1
+independently re-derives the whole deliverable from a fresh worktree), exactly as m1-m17 have
+already run. This is cheap for this class because the entire deliverable IS a doc — re-deriving it
+whole is not wasteful the way re-deriving 2000 lines of implementation would be.
+
+**Class 2 — development-class milestones** (the M16-CLI-EDIT-PARITY-IMPL precedent — real
+product-code changes; typically `capability-growth`-typed): deliverable is working code. Diversity
+strategy: **MAY, at a future charter's discretion, use a narrower pattern instead of whole-milestone
+dual iteration** — N-independent-proposal re-derivation (catching the expensive, cheap-to-catch-
+early APPROACH error, before any code is written) + a single implementation pass + a light tail
+self-check (independence is already spent at both ends: upstream at the proposal, downstream at the
+existing adversarial-audit gate, DIR-007/M10, unchanged and reused). The reasoning: re-deriving
+~2000 lines of already-approved implementation wholesale is waste; re-deriving the APPROACH is not,
+because a wrong approach caught after 2000 lines are written is catastrophically late while the same
+error is nearly free to catch before any code exists. M13's own two independent iterations diverging
+on a real design decision (the DIR-010 namespace question) is the existence proof this pattern is
+already latent in exp5's practice, just not yet named/available as a lighter-weight option.
+
+**Precondition, stated explicitly (this is a MAY, not an automatic switch):** the narrower
+development-class pattern is available to a future charter only ONCE a proposal-adjudication
+mechanism actually exists to run the N-independent-proposal step through — concretely, the
+`quay-task-to-plan` skill (DIR-012 item 3, not yet built as of this milestone) or an equivalent. Until
+that mechanism exists, EVERY milestone — methodology/design-class and development-class alike —
+continues to run the existing whole-milestone dual-iteration pattern. A charter may not invoke the
+narrower development-class pattern by name alone; it must cite the actual adjudication mechanism it
+is using.
+
+**This milestone (M18) itself does NOT switch patterns.** M18 is itself method-infra/doc-editing
+(this file and `OUTER-LOOP.md`), and even setting that aside, the `quay-task-to-plan` skill this
+policy's precondition requires does not exist yet (DIR-012 item 3 remains explicitly future work,
+out of scope here — see this milestone's charter, "Explicitly OUT of scope"). M18 runs, and is
+recorded as running, the existing whole-milestone dual-iteration pattern exactly like M13-M17. This
+statement is deliberately explicit and self-referential precisely because the ledger/policy being
+amended here is the kind of substrate a later milestone might misread as retroactively applying to
+the milestone that wrote it — it does not.
+
+**Mechanism detail (the pipeline shape "clamp at both ends" refers to):** see
+`docs/proposals/exp5-quay-task-proposal-plan-skill.md` §6 for the full pipeline diagram (task →
+N-independent proposals → adjudication → milestone → plan-author + grounded convergent-check →
+single implementation with per-stage TDD gate → light tail self-check → ABSORB →
+adversarial-audit). Cited here, not duplicated, per DIR-009's charter-thinness discipline —
+this section states only the policy (which class gets which strategy, and the precondition
+gating Class 2's availability), not the mechanism's internals.
+
 ## Web UI verification requirement — mechanized browser-tool evidence rule (M10-audit-consolidation
 ## Done-when 1, DIR-006)
```

### 4.3 `OUTER-LOOP.md` — plan-time line-budget gate (in-scope item 2)

Added a new bullet to step 1 (SELECT), immediately after the existing sizing-check bullet, wiring
in the new gate script:

```diff
diff --git a/experiments/quay-perpetual-stream/OUTER-LOOP.md b/experiments/quay-perpetual-stream/OUTER-LOOP.md
index ac8b865..c7f36aa 100644
--- a/experiments/quay-perpetual-stream/OUTER-LOOP.md
+++ b/experiments/quay-perpetual-stream/OUTER-LOOP.md
@@ -52,6 +52,18 @@ per-milestone charters** — it is not itself a big per-iteration prompt.
    verification, not forced into new build work, no mid-milestone re-scope)? If not, split along a
    different seam or explicitly budget a multi-build milestone before authoring the charter — never
    carry an implicitly half-shipped value step forward.
+   **Plan-time line-budget gate (M18-milestone-model-ceiling-and-diversity-policy, DIR-012 item 2 —
+   mechanically-checkable, not narrative):** run
+   `scripts/it0-ceiling-line-budget-check.sh <charter-file>` against the drafted charter BEFORE
+   dispatch. This flags any charter whose scope plausibly exceeds the ~2000-line milestone ceiling
+   (`inherited-core.md`'s "Milestone ceiling expansion" subsection) without a nested phase/stage plan
+   — either an explicit `Line budget:`/`Phase`/`Stage` structure present in the charter text, or a
+   `Plan:` line pointing at an external phase/stage plan document. A charter under the small-
+   milestone norm (no declared line budget, or a declared budget ≤2000 WITH a phase/stage plan
+   present) PASSES. A charter that declares (or whose in-scope-item count/shape plausibly implies)
+   a budget above ~2000 lines with NO phase/stage plan reference FAILS/flags — fix by adding the
+   phase/stage plan reference, or resize/split the candidate, before dispatch; same "fix the
+   charter, not the script" discipline as the existing gate-hash check (Check 2 below).
    **Record each candidate's value type(s)** (mandatory, applies forward from m7) from
    `inherited-core.md`'s "Value-typed SELECT ledger" section — capability-growth / discovery /
    instrument-correction / risk-option / governance-integrity — alongside its VT Δv̂. VT Δv̂ is one
```

### 4.4 New gate script — `scripts/it0-ceiling-line-budget-check.sh` (in-scope items 2-3)

New 136-line executable shell script, following the established `it0-*-check.sh` style
(usage/exit-code header comment, `set -u`, PASS/FAIL text output, non-zero exit on flag). Full
content committed at `experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh`
(`ad1a9a6`); logic summary:

1. Detects an explicit `Line budget: <N>` / `Estimated lines: <N>` declaration in the charter; if
   `N > 2000`, the charter is flagged over-budget.
2. If no explicit budget is declared, falls back to a coarse proxy: counts top-level numbered items
   under the charter's `## In-scope work` heading; more than a configurable threshold (default 8)
   flags over-budget.
3. If over-budget, checks for a phase/stage plan: EITHER a structural `Phase <N>` + `Stage <N>`
   heading/label pair inline in the charter text, OR a `Plan: <path>` line resolving to an existing
   file that itself contains both structural markers. Uses a strict heading/label regex (not a bare
   substring match) specifically to avoid false-PASS on incidental prose mentions of the words
   "phase"/"stage" (caught and fixed during this iteration's own testing — see §5).
4. PASS (exit 0) if not over-budget, or over-budget WITH a plan found. FAIL/FLAG (exit 1) if
   over-budget with NO plan found.

`shellcheck` clean:

```
$ shellcheck experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh; echo "exit=$?"
exit=0
```

## 5. Gate-script demonstration — PASS and FAIL/FLAG cases (Done-when clause 3)

Two constructed test-charter fixtures (not committed to the repo — ephemeral `/tmp` files used only
for this demonstration, as the charter's own Done-when clause 3 requires "a real run showing both a
PASS ... and a FAIL/flag ... case").

**Fixture 1 — small charter (expect PASS):**

```
$ cat /tmp/m18-demo/small-pass.md
# Charter M-TEST-SMALL — small methodology milestone (PASS demo fixture)

## In-scope work
1. Amend section A of inherited-core.md.
2. Add one new gate script.
3. Update OUTER-LOOP.md's SELECT step text.

## Binary Done-when
1. `[ ]` Section A amended, diff pasted.
2. `[ ]` Gate script demonstrated PASS/FAIL.
```

```
$ bash experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh /tmp/m18-demo/small-pass.md
PASS: /tmp/m18-demo/small-pass.md — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.
exit=0
```

**Fixture 2 — deliberately oversized charter, NO phase/stage plan (expect FAIL/FLAG):**

```
$ cat /tmp/m18-demo/oversized-fail.md
# Charter M-TEST-OVERSIZED — oversized, no decomposition (FAIL demo fixture)

Line budget: ~4500 lines — a full new provider implementation, CLI surface, and Web UI panel.

## In-scope work
1. Build the new provider client module.
2. Build the new provider server adapter.
3. Add CLI subcommands for the new provider.
4. Add MCP tool wrappers for the new provider.
5. Add Web UI panel for the new provider.
6. Add conformance test suite.
7. Add documentation.
8. Add migration tooling.
9. Add CI workflow.
10. Add release packaging changes.

## Binary Done-when
1. `[ ]` All of the above shipped in one pass, diff pasted.
```

```
$ bash experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh /tmp/m18-demo/oversized-fail.md
FAIL/FLAG: /tmp/m18-demo/oversized-fail.md — scope plausibly exceeds the small-milestone norm (declared line budget 4500 > 2000), and NO phase/stage plan was found (no inline Phase+Stage structure, no 'Plan: <path>' line resolving to a document with both Phase and Stage markers).
Per inherited-core.md's 'Milestone ceiling expansion' subsection: a milestone sized above the small-milestone norm is safe ONLY when decomposed via a phase/stage plan. Fix by adding a phase/stage plan reference, or resize/split this candidate, before dispatch.
exit=1
```

**Fixture 3 (supplementary, not required by Done-when but run to confirm the escape path works) —
oversized-by-item-count charter WITH a real external phase/stage plan (expect PASS):**

```
$ cat /tmp/m18-demo/oversized-with-plan.md   # 9 in-scope items, "Plan: /tmp/m18-demo/fixture-plan.md"
$ cat /tmp/m18-demo/fixture-plan.md
# Plan: fixture

## Phase 1: setup
### Stage 1: scaffold

## Phase 2: implementation
### Stage 1: core
### Stage 2: tests

$ bash experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh /tmp/m18-demo/oversized-with-plan.md
PASS: /tmp/m18-demo/oversized-with-plan.md — scope plausibly exceeds the small-milestone norm (In-scope work section has 9 top-level numbered items (> threshold 8), no explicit line-budget declaration to override the proxy), BUT a phase/stage plan is present (external plan document (/tmp/m18-demo/fixture-plan.md, Phase/Stage markers confirmed)). Per inherited-core.md's ceiling-expansion rule, this is safe.
exit=0
```

**Bug found and fixed during this iteration's own testing (worth recording — a real self-caught
defect, not a clean first pass):** the FIRST version of the script's plan-detection logic used a
loose substring match (`grep -c 'phase'` / `grep -c 'stage'` anywhere in the file), which produced a
FALSE PASS on the oversized-no-plan fixture, because the fixture's OWN title line ("...a
deliberately oversized dev-class milestone with NO phase/stage plan...") happened to contain both
words in prose. Caught immediately by re-running the demonstration and inspecting the unexpected
PASS; fixed by switching to a strict heading/label structural regex (`^(#+\s*)?Phase\s*[0-9]+...`)
that only matches an actual numbered Phase/Stage heading or label line, not incidental prose. Final
script (as committed) reflects the fixed, strict version — the loose version was never committed.

## 6. Full test suite

No JS/Node product code or existing script was modified — only markdown substrate (`inherited-
core.md`, `OUTER-LOOP.md`) and one brand-new shell script were touched. Root `package.json` has no
`scripts.test` entry that this change would affect, and the new script has no dependency on any
existing test harness. Per Done-when clause 7's own N/A carve-out ("N/A-and-stated if only markdown
changed and no script/tooling touched" — here one NEW script was added, but no EXISTING
script/tooling was touched or could regress): **N/A, stated explicitly.** The new script's own
correctness is instead demonstrated directly via `shellcheck` (clean, §4.4) and the PASS/FAIL/PASS
three-case demonstration (§5). As a regression check, the pre-existing `it0-gate-hash-check.sh
--by-reference` gate was re-run against the M18 charter itself post-edit and still PASSES (§3),
confirming no existing gate script's behavior was disturbed by this iteration's edits.

## 7. `git diff --stat` against pre-charter base commit (Done-when clause 6)

```
$ git diff --stat 9350ab0 HEAD
 experiments/quay-perpetual-stream/OUTER-LOOP.md    |  12 ++
 .../quay-perpetual-stream/inherited-core.md        | 119 ++++++++++++++++++
 .../scripts/it0-ceiling-line-budget-check.sh       | 136 +++++++++++++++++++++
 3 files changed, 267 insertions(+)
```

Confirms: only `inherited-core.md`, `OUTER-LOOP.md`, and the new gate script under `scripts/`
changed — **no `.claude/skills/` files touched**, no product code touched. DIR-012 item 3
(skill implementation/dogfooding) was explicitly NOT performed this milestone, confirmed by this
diff-stat.

## 8. Self-assessment against the 8 Binary Done-when clauses

1. **`[x]` MET.** `inherited-core.md`'s sizing-rubric section amended with the ≤2000/≤500/≤200-line
   ceiling and nested budgets, citing the design doc §4 — diff pasted §4.2/§4.1.
2. **`[x]` MET.** `OUTER-LOOP.md`'s SELECT/charter-authoring step gains an explicit,
   mechanically-checkable plan-time line-budget gate (a real script invocation, not narrative) —
   diff pasted §4.3.
3. **`[x]` MET.** `scripts/it0-ceiling-line-budget-check.sh` (new script) demonstrated firing
   correctly on both a PASS (small charter) and a FAIL/FLAG (oversized, no phase/stage plan)
   case, with real pasted command output — §5. A third supplementary case (oversized-with-plan,
   PASS) additionally confirms the escape path is not vacuous.
4. **`[x]` MET.** `inherited-core.md`'s value-typed SELECT ledger section amended with the two-class
   diversity policy, explicitly stating M18 itself is NOT switching patterns — diff pasted §4.2.
5. **`[x]` MET.** `inherited-core.md` cites (does not duplicate) `docs/proposals/exp5-quay-task-
   proposal-plan-skill.md` §6 for the diversity-policy mechanism detail — see the "Mechanism detail"
   paragraph in the diff, §4.2.
6. **`[x]` MET.** `git diff --stat` against the pre-charter base commit (`9350ab0`) shows only the
   three expected files changed, no `.claude/skills/` files touched — pasted §7. (Bookkeeping note:
   the milestone's own charter/iteration files are additive and outside this diff-stat's base/HEAD
   range since the charter and this report are tracked in the shared main tree, not this worktree's
   branch — consistent with the charter's own instruction to write this report to the shared tree.)
7. **`[x]` MET (N/A-and-stated).** No existing script/tooling was modified (only markdown + one new
   script added); N/A carve-out applies, stated explicitly — §6. The new script's own correctness is
   independently demonstrated via `shellcheck` clean + the 3-case PASS/FAIL/PASS run (§5), and the
   one pre-existing gate re-run as a regression check still PASSES (§3).
8. **`[ ]` NOT YET MET — correctly deferred to ABSORB, not an iteration-0 gap.** `backlog.md` does
   not yet carry an `M-MILESTONE-CEILING-DIVERSITY-POLICY` row. Per the charter's own clause 8
   wording ("gains a row..., marked DONE at ABSORB") and the precedent of every prior milestone in
   this experiment (`dashboard.md`'s existing SELECT-log-only mid-milestone state, `backlog.md` rows
   added at ABSORB time by the outer loop, e.g. M17/M16's own rows), this is an OUTER-LOOP ABSORB-
   time action, not an inner-iteration action. `dashboard.md` already carries this milestone's
   SELECT log entry (commit `9350ab0`, pre-dating this iteration). Flagged here explicitly rather
   than silently left off the checklist.

**7 of 8 clauses MET this iteration; clause 8 is structurally an ABSORB-time action, correctly
deferred, not a gap in this iteration's own work.**

## 9. Convergence check (§3.2, five conditions)

1. **Done-when complete & stable ≥1 iteration** — 7/8 clauses fully met, 1 clause (backlog row)
   structurally belongs to ABSORB and cannot be met by any inner iteration. All in-scope work items
   1-4 from the charter are complete. This is the expected natural terminus per the charter's own
   framing ("real independent-re-derivation material for iteration-1 exists"). **Not yet stable ≥1
   iteration** — iteration-1 has not yet run; per the charter's own sizing note, iteration-1's real
   material to re-derive is: (a) whether the gate script actually fires correctly on fresh
   independently-constructed PASS/FAIL fixtures, (b) whether the diversity-policy wording is
   internally consistent with the existing value-typed ledger on a fresh read, (c) whether M18's own
   self-exemption statement survives a skeptical re-read. This iteration does NOT recommend skipping
   iteration-1 (no self-exemption claimed) — consistent with the charter's own Adversarial-audit
   gate note (condition (b) should not fire).
2. **ΔV<0.02 both layers K=2 consecutive** — N/A, this is iteration-0; no prior ΔV to compare.
3. **Ceiling→redesign-OR-stop** — not encountered; no scope ceiling was hit.
4. **Budget≈10 backstop** — N/A, iteration count (1) far under budget.
5. **External HALT** — none observed; `.halt` file not checked/present (out of this iteration's
   HARD GATES list, no signal of one).

**Verdict: proceed to iteration-1** (independent re-derivation), per condition 1's own framing that
this milestone is sized for exactly a 2-iteration build+verify pattern with real material for
iteration-1 to check, consistent with M18 running the unmodified whole-milestone dual-iteration
pattern per its own charter's explicit non-self-exemption (in-scope item 3 / this report §4.2's
"This milestone (M18) itself does NOT switch patterns" statement).

## 10. Reflection

**Learned:** the gate script's own item-count-proxy fallback path needed a genuinely constructed
test (fixture 3) to exercise, since the primary declared-budget path and the proxy path are mutually
exclusive branches in the script's own logic — a demonstration limited to only the two Done-when-
required cases (small-PASS, oversized-declared-budget-FAIL) would have left the proxy branch
completely unexercised. Running a third case caught this and is recorded even though not strictly
required, because leaving an untested code path in a brand-new gate script would undermine exactly
the "dogfooding evidence-gate" discipline (it0 check (c)) this milestone is itself supposed to
extend.

**Challenges:** the first draft of the plan-detection regex was too loose (a bare substring match on
"phase"/"stage" anywhere in the file) and produced a false PASS on the oversized-no-plan fixture
because the fixture's own filename-adjacent prose title happened to contain both words — caught by
re-inspecting the (wrong) PASS result rather than trusting it, fixed by tightening to a structural
heading/label regex. This is itself a small, real instance of exactly the kind of "a check that
always passes when the code looks right is not an audit channel" failure mode
`inherited-core.md`'s own domain-misfit procedure (Step 3b) warns against — worth noting as a
concrete self-example, not just an abstract principle, for any future milestone building a similar
grep-based gate script.

**Next focus (for iteration-1):** independently re-derive/re-verify (a) both `inherited-core.md`
amendments' internal consistency against a fresh read of the ledger and sizing sections as they now
stand (not just the diff), (b) re-run the gate script against fresh, independently-constructed
PASS/FAIL fixtures (not reusing this iteration's exact fixture text, to make re-derivation
meaningful rather than a repeat), (c) re-read the M18 self-exemption statement adversarially for
whether it could be misread as retroactively licensing M18's own dispatch pattern change.

## 11. Artifacts

- `experiments/quay-perpetual-stream/inherited-core.md` (worktree copy, committed `ad1a9a6`) —
  sizing-rubric + value-typed-ledger amendments.
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` (worktree copy, committed `ad1a9a6`) —
  plan-time line-budget gate wiring.
- `experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh` (new, committed
  `ad1a9a6`, executable, shellcheck-clean).
- This report: `experiments/quay-perpetual-stream/milestones/M18-milestone-model-ceiling-and-
  diversity-policy/iterations/iteration-0.md` (shared main tree, per instructions).
- Not merged to master — branch `exp5-m18-iteration-0` left for the outer loop.
