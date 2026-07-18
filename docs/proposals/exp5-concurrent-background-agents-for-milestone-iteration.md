# Concurrent background subagents for exp5 milestone iteration — where they accelerate, where they must not

- **Status:** proposal, drafted only — no edits applied, no DIR filed. Records a
  live verification + discussion so it can be reviewed and, if adopted, turned
  into an outer-loop mechanism deliberately. Per the human's standing request
  during this discussion, **no directive was created** — the loop is being left
  to run un-injected so the next SELECT can be observed; this document is the
  written record, not an authorization.
- **Date:** 2026-07-18 (revised same day — §5 reworked after the human supplied
  the native-subagent no-nesting constraint; original §5.1 "iteration-executor
  fans out via Workflow" retracted as a nesting violation, replaced by the
  Level-0-orchestrated Shape A / Shape B analysis)
- **Context:** captured from a live conversation between the human (Yale) and an
  observer Claude Code session (exp5 = `experiments/quay-perpetual-stream/`,
  state RUNNING at milestone_counter 5, m6 = M-SIZING dispatched). The human
  asked whether the Claude-Code-session ability to launch multiple background
  subagents can accelerate milestone iteration (inner or outer), and explicitly
  invited a live verification. Two background `Explore` subagents were launched
  concurrently to (a) verify the mechanism and (b) ground the two load-bearing
  claims below with real evidence. Both completed (~70s each, ~55–60K subagent
  tokens each, wall-clock ≈ one agent because concurrent). This document is
  **not** a directive; it records the verification and the recommendation.

## 1. What was verified (live, this session)

A single Claude Code session launched **two background subagents in parallel**
via the native `Agent` tool with `run_in_background: true` (subagent_type
`Explore`, read-only). Both ran concurrently and returned independently:

- **Scout A** — audited the shared-state conflict surface across exp5's
  methodology-state files.
- **Scout B** — sized and value-typed the three queued product-milestone
  candidates (M-MERGE-RECOVER, M-GH-WRITE, M-GH-PARENT) against real code.

The mechanism works and is reliable. Critically, **this is the native
Agent/Task mechanism, not `manda`** — the reliability envelope that made exp4/5
hard-mandate "never use manda for real dispatch" (self-deadlock DIR-020,
broker-side foreground-spawn blocking DIR-011/015/016/024) does not apply here.
The old *mechanical* reason to avoid parallel dispatch is therefore gone. The
constraint that remains is **methodological**, not mechanical (§4).

## 2. The distinction that governs everything: within-milestone vs across-milestone

Parallelism only helps where there is no dependency. The BAIME loop's structure
puts the real dependencies in specific places:

- **Inner loop** = build (iteration-0) → independent-verify (iteration-1). This
  is a **strict sequential dependency** — verify-of-nothing is meaningless, and
  the verify iteration's value comes precisely from being independent, fresh-
  context, and *after* the build. It cannot be collapsed into parallel. What
  *can* parallelize is *within* an iteration: independent build sub-tasks (e.g.
  M-ABI-EVAL's capability-matrix vs conformance-suite), independent test-suite
  reruns, and — as a quality upgrade — multiple adversarial skeptics in the
  verify iteration instead of one (same wall-clock, stronger QA).

- **Outer loop** = SELECT → dispatch → ABSORB, one milestone at a time. The
  SELECT of milestone N+1 **depends on the learning absorbed at ABSORB of
  milestone N** — this is the V_meta convergence channel, not incidental
  overhead. Concrete instances: m3's ABSORB executed the chart-0→chart-1
  transition; m4's ABSORB corrected the VT baseline (MD-001). A milestone run in
  parallel with its predecessor is **blind to that predecessor's lessons** —
  which discards exactly the per-milestone learning that makes this a BAIME
  experiment rather than a batch job.

**Principle: parallelize *within* a milestone's internally-independent phases;
do NOT parallelize *across* milestones.**

## 3. Evidence (from the two live scouts)

### 3.1 Shared-state contention — why across-milestone parallelism is not safe as structured (Scout A)

- `dashboard.md` and `backlog.md` are **single, append-mostly files written by
  every milestone's ABSORB phase** (dashboard touched ~10×, backlog ~11× across
  6 milestones). `gap-list.md` is written selectively per discovery channel
  (method-infra milestones don't touch it).
- **A real merge conflict already occurred**: merging `exp5-m04-iteration-1`
  (merge commit `afcdbff`) produced `# Conflicts: backlog.md` — the DIR-002
  drain section and the M04-discover ABSORB section were appended at the same
  end-of-file location. Resolved by concatenation, no semantic loss.
- **Sharper than the original claim**: that conflict was *not* milestone-vs-
  milestone parallelism — it was a single milestone plus an **asynchronous DIR
  drain interleaving mid-milestone**. So the current *sequential* loop already
  produces shared-state conflicts whenever an async event (a DIR arrival)
  interleaves. Truly parallel milestones would be strictly worse.
- Cleanly isolated (conflict-safe): **code** — per-milestone directories
  `milestones/M0N-*/`, worktrees, and branches `exp5-m0N-iteration-*`. Worktree
  isolation covers code but **not** the shared methodology-state files.
- **Verdict: milestone-level parallelism is NOT conflict-safe as currently
  structured.** Making it safe would require one of: serialize ABSORB (the
  status quo); shard dashboard/backlog per-milestone with checkpoint-time
  aggregation (a real refactor); or move methodology-state to a structured store
  with concurrent-write guards. None is justified today.

### 3.2 Product candidates are real, sized, and ranked (Scout B)

| candidate | scope | fits one build+verify? | value type | blocking uncertainty |
|---|---|---|---|---|
| **M-MERGE-RECOVER** | ~6 unmerged exp4 iterations (bin/quay.js, serve.js, package.json) + README/CHANGELOG + DOC-006/007; 3–5 files | Yes on the re-implement-fresh path (safer, smaller diff than re-merge) | **instrument-correction / product-integrity** | are exp4 test blocks still applicable to current master; re-merge conflict count unknown |
| **M-GH-WRITE** | github-client.js + mcp-server.js inputSchema + provider.yml; min form (error on unsupported field) ~10 lines, stretch (real write) ~2h | Yes (both forms bounded) | **capability-growth** (write coverage 1/5 → 4–5/5) | parent needs sub-issues API → crosses DESIGN G5 "no GraphQL"; min form sidesteps it |
| **M-GH-PARENT** | github-client.js `get()` + ~1–3 lines reusing `list()`'s parentIndex | Trivially yes (~15 min) | small polish | none — mechanical; bundle into M-GH-WRITE |

The backlog **already ranks M-MERGE-RECOVER as the next SELECT** (its own
line 84, calling MD-001 "the most consequential item yet", ahead of GH-WRITE/
PARENT). This corroborates the earlier prediction: once `directives/pending/`
clears (DIR-005) and no new DIR is injected, the highest-value candidate the
outer loop faces is a **product** milestone — so product development should
resume without further steering.

## 4. Recommendation

> **Read with §5.0/§5.1.** A hard architectural constraint — native subagents do
> not nest — refines this section: uses 2 and 3 below are only feasible as
> *Shape A* (split into more iterations, orchestrated by the main loop), not by a
> single executor fanning out internally. Use 1 (scouting) is unaffected.

Adopt background subagents **only for within-milestone / within-phase fan-out**,
where they are pure acceleration with no shared-state write and no learning-loop
disruption. Three concrete, safe uses (the first was demonstrated live this
session):

1. **SELECT-time candidate scouting** — when SELECT faces N candidates, spawn N
   read-only background scouts to estimate each candidate's value-typed ledger
   entry + it0-viability in parallel, then pick with better information.
   Collapses N candidate evaluations into ~1 wall-clock unit. Read-only ⇒ zero
   shared-state write ⇒ safe. *(This proposal's own Scout A/B are an instance.)*
2. **Discovery/exploit fan-out** — the persona sweep (M04-discover's CLI/MCP/
   WebUI/Docs personas), conformance-suite scenario generation, and
   capability-matrix cells are embarrassingly parallel.
3. **Verification fan-out** — replace the single independent-verify agent with
   several adversarial skeptics (majority-refute kills a finding); same wall-
   clock, stronger QA.

Do **NOT** run whole milestones concurrently. The mechanism is reliable enough
(native, not manda), but across-milestone parallelism (a) breaks the SELECT←
ABSORB learning dependency that constitutes V_meta convergence and (b) collides
on the append-all methodology-state files (`dashboard.md`/`backlog.md`), as
already witnessed at merge `afcdbff`. If milestone-level concurrency is ever
wanted, it must be preceded by the state-sharding refactor in §3.1 — a
deliberate, separately-justified change, not a default.

## 5. Detailed design discussion (three follow-up questions)

This section deepens §2–§4 along the three axes raised in the follow-up
discussion: how within-milestone parallelism works concretely, whether
across-milestone parallelism can be gated by milestone *type*, and whether a
mechanism can decide the granularity dynamically.

### 5.0 Governing constraint: native subagents do NOT nest

The real system has a hard architectural constraint that overrides the naïve
framing of §4/§5.1-as-originally-drafted:

- **Level 0** = the main Claude Code session (the OUTER-LOOP driver). It **can**
  spawn subagents.
- **Level 1** = subagents it spawns (`baime:iteration-executor`, the Explore
  scouts in this proposal). They are **leaves — they cannot spawn their own
  subagents.** Nesting is exactly the problem `manda` was meant to solve, and
  `manda` is not mature enough to rely on.
- Current dispatch pattern: the main loop spawns **one Level-1
  `iteration-executor` per iteration, sequentially** — only one Level-1 slot is
  ever in use.

**Consequence (this retracts the original §5.1):** an `iteration-executor` (a
Level-1 leaf) **cannot** call `Workflow` or otherwise fan its build phase out
into Level-2 workers. All parallelism must be **orchestrated at Level 0** — the
main loop spawns the parallel units itself. And the only unit the main loop
dispatches is an **iteration**. Therefore:

> **"Within-milestone concurrency" is identical to "split the milestone into more
> iterations that the main loop dispatches concurrently."** It is not a separate
> option from the iteration-count question we discussed earlier — the no-nesting
> constraint fuses them.

### 5.1 The two feasible shapes (both orchestrated at Level 0)

**Shape A — within-milestone, expressed as more iterations.** Restructure a
milestone so each independent map-chunk is its **own iteration**; the main loop's
normal "spawn an executor per iteration" loop then runs the N independent
iterations concurrently, plus a final **reduce iteration** (a barrier).

| milestone type | independent iterations (parallel) | reduce iteration (barrier) |
|---|---|---|
| evaluation (M-ABI-EVAL) | conformance scenarios / matrix-cell groups as independent iterations | assemble matrix, compute cov, write report |
| discovery (M04-discover) | 4 personas (CLI/MCP/WebUI/Docs) as independent iterations | merge findings, re-score VT |
| verification | several adversarial skeptics as independent iterations | majority-vote adjudication |

Fits **map-heavy** milestones (evaluation, discovery). Does **not** fit the
build→verify backbone (hard sequential). Cost: N× the per-iteration fixed
overhead (charter/gate/merge/dashboard) — see the reconciliation in §5.1.1.
Discipline unchanged: each parallel iteration produces **isolated output only**;
the single reduce iteration is the **only writer** of the one dashboard/report
entry.

**Shape B — across-milestone, multiple iterations.** The main loop spawns
`iteration-executor`s for **different milestones** concurrently. Under the
no-nesting constraint this is **mechanically the cheapest** path: each
milestone's iteration is already a natural Level-1 leaf unit, so Shape B needs
**zero milestone restructuring**, whereas Shape A must redesign the milestone
into N iterations. **This is why cross-milestone parallelism is "more feasible"
here** — a correct observation. The catch is §5.2: Shape B is only *safe* for the
orthogonal-execution subclass, and still needs state-sharding.

**The tension the constraint exposes.** The mechanically-cheapest path (B, no
restructuring) is precisely the methodologically-riskiest one (it breaks the
SELECT←ABSORB learning loop and collides on the append-all state files, as at
merge `afcdbff`). The methodologically-clean path (A, single milestone, no
learning dependency) is the one that costs restructuring + N× overhead. So the
no-nesting constraint does not "make parallelism easy" — it **biases the path of
least resistance toward the more dangerous option**, which must be named, not
glossed.

#### 5.1.1 Reconciliation with the earlier "more iterations" discussion

Earlier this session (turn 2026-07-18T09:36, recovered via meta-cc) the
conclusion was: *under a serial model, adding inner increments mostly pays fixed
overhead with no matching learning, so exp5 pushed increments to the milestone
granularity.* The no-nesting-but-Level-0-parallel model **partially flips that**:

- **Wall-clock** for a map-heavy phase goes from "serial sum" to "concurrent
  max" — so splitting that phase into more iterations now has a real
  justification (it is the *only* way to parallelize it), and no longer costs
  serial time.
- But the **fixed overhead is still paid N times** (N charters/gates/merges, N
  shared-state writes at reduce). So Shape A's viability is **gated on lowering
  per-iteration overhead** — i.e. on **DIR-004 item 5** (cite the HARD-GATES
  block by verified hash instead of transcribing it, bringing charter thickness
  under 2K). Without that, splitting into N iterations is N× the ~2K charter and
  concurrency cannot buy it back.

Net: the earlier "don't add more iterations" conclusion **still holds for the
build→verify backbone** (sequential, no parallel benefit) but is **reversed for
map-heavy phases** (parallel benefit real, provided DIR-004 reduces the per-
iteration tax first).

### 5.2 Across-milestone: type is a proxy; the real criterion is dependency

Not all outer milestones are learning-type — some are primarily execution. But
the precise gate is **dependency**, and type is its proxy. The SELECT←ABSORB
dependency carries two kinds of information: the **value-function state**
(VT/chart/backlog rankings — used by SELECT to *choose*) and the **code/product
state** (used by execution to *build on*).

- **Learning-type** (discovery/evaluation/methodology-infra: M-ABI-EVAL,
  M04-discover, M-GATES, M-SIZING, M-DIR-PROJECTION): their **output IS a change
  to the value function or the machinery**. The next SELECT/execution strongly
  depends on them → **always sequential**.
- **Execution-type on ORTHOGONAL surfaces** (M-DIST, M-MERGE-RECOVER,
  M-GH-WRITE): output is code on one surface; it moves the value function only
  via its own Δv and changes no machinery. The next SELECT depends on it **only
  if the next milestone touches the same surface/code**.

**Parallel-eligibility test (all three must hold):** (1) execution-type; (2) its
`touches` set is disjoint from every co-running milestone (no shared code, no
shared cov term); (3) it produces no value-function/machinery change a
concurrent SELECT would need.

**Two gates remain even for eligible milestones:** (a) the append-all state
files still collide → **state-sharding still required**; but note their
dashboard entries are *independent facts* (two Δv on two surfaces), so a sharded
dashboard merges them cleanly — unlike two learning entries, which carry causal
order and cannot. This is the mechanical basis for "execution-type parallelizes,
learning-type does not". (b) VT is **separable over disjoint surfaces** (Δv
additive), so concurrent baselining is safe there.

**Checked against the real queue:** M-GH-WRITE ∥ M-GH-PARENT = **no** (both edit
`github-client.js`, not orthogonal — hence Scout B's bundle recommendation).
M-MERGE-RECOVER ∥ M-GH-WRITE = **candidate yes** (disjoint code: bin/quay.js,
serve.js, docs vs the github provider) — *if* state-sharding exists.

**Honest note:** exp5's *history* was learning-dominated (only m1 of m1–m6 was
execution-type), so parallelism would not have helped in the past — it only
starts paying in the upcoming product phase. This is the other face of the
"high-frequency DIRs crowd product slots into learning milestones" dynamic.

### 5.3 A dynamic scheduler — design, plus its own blind spot

A mechanism can decide the granularity, as a **two-level scheduler**:

- **Outer schedule:** at SELECT, pick a *batch* rather than one — take the
  top-ranked candidate, then greedily add candidates whose `touches` set is
  disjoint from all already-selected *and* which are execution-type; run the
  orthogonal batch in parallel (worktree + sharded state), then a **single
  sequential fan-in ABSORB** merges their dashboard/backlog entries and VT
  (additive over disjoint surfaces). Learning-type always runs alone, serial.
- **Inner schedule:** for map-heavy milestones, the charter declares the
  independent map-chunks as separate iterations (Shape A) that the **main loop
  (Level 0)** dispatches concurrently, followed by a reduce iteration. Note this
  cannot be delegated into a single `iteration-executor` (no nesting, §5.0) — the
  main loop must own the fan-out.

**The enabler that makes it honest** (not guesswork): a **machine-checkable
`touches` declaration** in each charter (surfaces + code paths + value-function
terms + machinery). Without it, "orthogonal" is a guess.

**Its own blind spot** (the self-referential-blindness principle applies): the
scheduler is itself an instrument with a blind spot — a **mis-declared `touches`
set** causes a silent conflict or a lost learning dependency, and the scheduler
cannot detect that it mis-classified using only its own logic. So it must carry:
(i) a **conservative default** — when in doubt, serialize; and (ii) an
**after-the-fact anti-drift check** (same enforcement pattern as DIR-002/005):
after a parallel batch ABSORB, mechanically verify that no two branches touched
the same file / same cov term; on violation → **fail loud, fall back to serial
re-absorb**.

**Cost/benefit gate:** parallelism has coordination overhead (sharding +
fan-in). It only pays with ≥2 orthogonal execution milestones queued *and*
milestones long enough to amortize it. exp5's 2-iteration milestones + a queue
that usually holds only 1–2 orthogonal candidates ⇒ outer-batch payoff is
**marginal today**. Do not speculatively build it — that would be exactly the
"more machinery than the development it serves" methodology bloat this stream is
already watching for.

### 5.4 Layered conclusion (revised for the no-nesting constraint)

1. **Single-iteration internal fan-out — RETRACTED.** The original §5.1 assumed
   an `iteration-executor` could `Workflow`-fan-out its build phase; that is
   Level-1→Level-2 nesting and is not supported (§5.0). Removed.
2. **SELECT-time candidate scouting — survives, do now.** It is the main loop
   (Level 0) spawning read-only leaf scouts (this proposal's own Scout A/B), no
   nesting involved. Safe and immediately useful.
3. **Within-milestone parallelism = Shape A (split into more iterations, main
   loop dispatches concurrently + a barrier reduce iteration).** Fits map-heavy
   milestones (evaluation, discovery) only; the persona/verification fan-outs of
   the original §4 are instances of it. **Gated on DIR-004** lowering the per-
   iteration overhead first (§5.1.1), else N× the ~2K charter tax negates it.
4. **Across-milestone parallelism = Shape B (different milestones' iterations
   concurrently).** Mechanically the cheapest under no-nesting (the "more
   feasible" observation), but **safe only for orthogonal execution-type
   milestones** (§5.2) + state-sharding; dangerous otherwise (breaks the learning
   loop). The constraint biases the easy path toward this risky one — treat with
   care.
5. **Level 0 is the sole orchestrator.** The main loop must dispatch parallel
   units itself; it cannot delegate a whole iteration to one executor and expect
   internal parallelism. The outer batch scheduler (§5.3) stays gated behind ≥2
   orthogonal execution milestones queued + state-sharding paid for — do not
   pre-build.

## 6. Status / next step

- No DIR filed, no loop change applied (per the human's "don't inject" request).
- Suggested observation: let the loop run un-injected through DIR-005's
  disposition and the next SELECT; confirm empirically whether it self-selects
  M-MERGE-RECOVER (product) as §3.2 predicts.
- If the §4 pattern (SELECT-time parallel scouting) is later adopted, it should
  enter through the normal `/quay-directive` channel at a milestone boundary,
  worded as within-milestone fan-out only, with the across-milestone prohibition
  and its state-sharding precondition stated explicitly.
