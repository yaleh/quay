---
name: outer-loop
description: quay-perpetual-stream (Experiment 5) autonomous outer driver — generates per-milestone charters
provenance: docs/proposals/quay-perpetual-stream-experiment-v5.md
---

λ(workspaceRoot: Path) → Milestone*

-- CYCLE STEPS (sequential; each blocks on predecessor completion)

drain :: Directive[] ⇀ Disposition[]
drain(D) = invoke(".claude/workflows/drain-directives.js", {workspaceRoot})
  ⊨ task-canonical (DIR-028): label:directive tasks only; no directives/*.md
  ⊨ absent → {drained: 0}; must complete before select (I₄)

select :: Candidate[] ⇀ Task
select = task_list(label=milestone-candidate, status=todo)  -- canonical source, not backlog.md
  → filter(human_steered_classify)                           -- scripts/human-steered-classify.ts (DIR-062-A)
  → compose_shortlist                                        -- scripts/deliverable-governor.ts (DIR-066)
  → rank(pick, explore_due)                                  -- scripts/explore-exploit-cadence.ts (CRYST-D3 R6)
  → writeback(winner, considered \ {winner})
  → author_ac_dod(winner)   -- ¬self-tick (DIR-020): all - [ ] UNCHECKED; - [x] ONLY by Audit phase
  → set_schema_v1(winner)   -- extra.schema:"v1"; absent → N/A-legacy
  → author_proposal_plan(winner)  -- ## Proposal + ## Plan; MUST carry docs/plans/*.md ref or N/A—<reason>
  → schema_check(winner)    -- scripts/task-schema-check.sh; FAIL → fix task, block dispatch
  → size_check(winner)      -- inherited_core."Milestone size definition"
  → split_or_commit(winner) -- DIR-026 MANDATORY; scripts/it0-split-or-commit-check.ts
  → line_budget_check(charter_file)  -- scripts/it0-ceiling-line-budget-check.sh; FAIL → fix charter, never script
  ⊨ human-steered EXCLUDE (label:human-steered ≡ manual override regardless of classifier verdict)
  ⊨ ∀c: record(value_type(c), Δv̂(c))  -- inherited_core."Value-typed SELECT ledger"
     (capability-growth|discovery|instrument-correction|risk-option|governance-integrity)
  ⊨ governance/infra hard floor: scope ⊇ enforcement half → reject|resize if partial
  ⊨ VT Δv̂ = one input among several; never sole ranker
  ⊨ explore ≥1 per 5; exploit = high-value, high-ρ; prefer aged high-value (DIR-004 Distribution URGENT)
  ⊨ deliverable:yes ≡ output consumed OUTSIDE loop; ambiguous → no
  ⊨ floor = min(1, streak/6); S = round((1−floor)·4); S_max = 4
  ⊨ streak = consecutive deliverable:no SELECTs; yes resets; explore/arch-audit exempt
  ⊨ streak≥6 ∧ no autonomous D → DELIVERABLE-STARVATION (prominent, greppable; auto-continue; ¬halt)
  ⊨ writeback: task_write(winner, labels ++ milestone:M-NN); ∀others: append("## Not selected (M-NN)", reason)

hypothesize :: Task → Δv̂
hypothesize(t) = Σ weight_s·Δĉov_s ∧ commit(dashboard, {predicted: Δv̂, metric: Y})
  ⊨ numeric; pre-dispatch

charter :: Task → Charter
charter(t) = write("charters/M<NN>-<slug>.md", {gate, scope, done_when, inner_term, it0_checks, ptr})
  ⊨ gate: transclusion_byte_for_byte ⊕ by_reference(scripts/it0-gate-hash-check.sh --by-reference)
  ⊨ I₃: dispatched agent prompt MUST contain literal gate text (never hash-only; DIR-009 defense)
  ⊨ Web UI scope: Done-when clause MUST embed inherited_core."Web UI verification requirement" (DIR-006)
     (curl status check never sufficient for rendering/interaction/visual claims)
  ⊨ AC/DoD: task is canonical source; charter references only (¬copy; ¬fork into charter — anti-drift)
  ⊨ Tier-A ≤ 2K tokens (§3.1); binary Done-when clauses mandatory (§3.4)
  ⊨ scope: in-scope gap subset ∪ open blocking gaps verbatim
  ⊨ pointer: path ⊕ git_sha → inherited_core (Tier-B, not inlined)
  ⊨ inner termination: five conditions (§3.2); it0 systematic-explore checks enumerated

execute :: Params → {done, needs-human}
execute(params) = invoke(".claude/workflows/execute-milestone.js", {taskId, charterFile, absorbEntryFile})
  ⊨ absorb-entry pre-created: /tmp/m<NN>-absorb-entry.md (milestone id, charter path, Δv̂ from step 2)
  ⊨ dispatch-record at /tmp/m<NN>-dispatch-record.txt (created by Audit phase per M90)
  ⊨ IS single-source (ADR-004, DIR-067): Verify(Build(5 it0 checks parallel)) → Build(class-route +
     inner iteration in isolated worktree) → Audit(adversarial fresh-context; write-back AC/DoD ticks)
     → Gate(7 absorb gates parallel: vmeta-lag, impl-row, DoD meta-enforcer, dashboard-budget,
     tree-hygiene, worktree-branch-hygiene, audit-independence) → Land(merge→master + capture-prune
     + dashboard update + milestone_counter++)
  ⊨ phases cached; resumable within session

checkpoint :: Counter → Checkpoint?
checkpoint(n) = n%5=0 → write("checkpoints/cp-<NN>.md", health_snapshot) | ∅
  ⊨ non-blocking: write → CONTINUE to next milestone; never wait for human
  ⊨ includes: human-review cadence metric (milestones-since-last-human-directive) + re-test standing hypothesis (§1)

routines :: () → {fired, filed, rejected, fileOnlyViolation}
routines() = invoke(".claude/workflows/run-routines.js", {workspaceRoot, tasksDir, milestoneCounter})
  ⊨ IS single-source (ADR-004, DIR-051/056): Schedule(read .quay/loop.yml → routine-scheduler.ts →
     DUE list) → Dispatch(readProbeSpec → availability check → fresh-context background agent) →
     Gate(routine-file-gate.ts: quality/dedup/rate → ACCEPT|REJECT) → Verify(FILE-ONLY invariant)
  ⊨ absent routines: → no-op (scheduler returns none due → exit immediately)
  ⊨ FILE-ONLY: git status --porcelain → no product/method code touched

-- INVARIANTS (∀ cycle; mechanically enforced unless noted "discipline")

  I₁:  ¬point-baime-at-stream                              (discipline — exp4 pathology guard)
  I₂:  ¬perturb-inflight                                    (charter frozen until boundary; ¬mid-milestone async)
  I₃:  gate-text-transclusion-or-hash                       (DIR-009 defense; RESULTS.md B2 check 2)
  I₄:  drain-before-select                                  (step-ordering)
  I₅:  master-direct                                        (DIR-027; no driver branch; .halt ⊕ private worktree for human edits)
  I₆:  halt-sentinel                                        (.halt → clean exit at next boundary)
  I₇:  ¬self-tick                                           (DIR-020; discipline — code cannot detect who/when)
  I₈:  explore ≥1 per 5                                     (scripts/explore-exploit-cadence.ts)
  I₉:  split-or-commit                                      (DIR-026; scripts/it0-split-or-commit-check.ts)
  I₁₀: schema-v1 marker                                     (extra.schema:"v1"; scripts/task-schema-check.sh)
  I₁₁: deliverable-governor SOFT                            (DIR-066; scripts/deliverable-governor.ts; ¬hard-halt)
  I₁₂: human-steered EXCLUDE                                (scripts/human-steered-classify.ts; label:human-steered override)
  I₁₃: FILE-ONLY routines output                            (run-routines Verify phase)
  I₁₄: task-canonical directives                            (DIR-028; label:directive tasks only)
  I₁₅: parent-done iff children-done                        (scripts/it0-split-or-commit-check.ts; child-link-symmetry)

-- CONTRACTS (executable at session start; any FAIL → halt ∧ report)

  C₁: test -f .claude/workflows/execute-milestone.js → exit 0
  C₂: test -f .claude/workflows/drain-directives.js → exit 0
  C₃: test -f .claude/workflows/run-routines.js → exit 0
  C₄: test -f scripts/explore-exploit-cadence.ts → exit 0
  C₅: test -f scripts/termination-delta-v-check.ts → exit 0
  C₆: ¬∃ "governance:product.*HALT" in OUTER-LOOP.md beyond informational (DIR-066 supersedes hard halt)
  C₇: ∀s ∈ extract_scripts(OUTER-LOOP.md): test -f experiments/quay-perpetual-stream/$s → exit 0

-- HALT CONDITIONS (evaluated at milestone boundary only; loop NEVER blocks waiting for human)

  halt_human :: () → Bool
  halt_human() = exists(".halt") → clean exit at boundary; in-flight milestone finishes first
    ⊨ human actively stopping, not loop waiting

  halt_self :: State → {CONTINUE | HALT-RECOMMENDED | TRANSITION-RECOMMENDED | TERMINATION-DUE}
  halt_self(s) =
    slope     = invoke("scripts/rolling-slope-check.ts")        -- DIR-038-A; K≥5 incl. zero-Δv
    headroom  = invoke("scripts/chart-headroom.ts")             -- DIR-063 gap fix
    saturated = invoke("scripts/chart-saturation-check.ts",     -- DIR-063-A (M127); hysteresis K≥2
                  {slope, headroom, counter: s.milestone_counter})
    term      = invoke("scripts/termination-delta-v-check.ts")  -- CRYST-D3 R7; ΔV<0.02 K=2 consecutive
  in
    term=TERMINATION-DUE     → TERMINATION-DUE
  | saturated=TRANSITION-DUE  → subagent_draft → TRANSITION-RECOMMENDED
  | slope<threshold           → HALT-RECOMMENDED
  | otherwise                 → CONTINUE
    ⊨ qualifying-only denominator RETIRED (froze 3.80, can't see stall); honestNotInflated FAILS-LOUD
    ⊨ subagent drafting STRICTLY GATED behind TRANSITION-DUE (anti-cost-explosion; ¬per-milestone;
       ¬unconditional per-checkpoint); drafted surfaces must pass anti-gaming guard
    ⊨ convergence failure → HALT-RECOMMENDED directly (¬saturation; sat is slope-only heuristic)
    ⊨ governance:product INFORMATIONAL only (DIR-066); scripts/governance-product-ratio-check.ts may
       still compute/report at checkpoint but breach ¬trip HALT-RECOMMENDED

-- SESSION-START

  healthcheck :: () → Bool
  healthcheck() = task_get("QC-T1")
    ⊨ absent → task_write({id: QC-T1, title: "healthcheck fixture — native task store liveness probe",
       status: todo, labels: [fixture, healthcheck],
       body: "Permanent liveness probe — never complete. Re-create if absent (idempotent)."}) → retry
    ⊨ re-creation also fails → halt ∧ needs-human; never silently continue
    ⊨ idempotent: re-running at any session start finds QC-T1 (creating if missing) without side-effects

  read_pinned :: () → Context
  read_pinned() = load([
    "docs/proposals/quay-perpetual-stream-experiment-v5.md",   -- protocol (architecture, all §§)
    "experiments/offline-replay/RESULTS.md",                   -- offline calibration/evidence
    "experiments/quay-perpetual-stream/dashboard.md",          -- mutable outer state
    "experiments/quay-perpetual-stream/inherited-core.md"      -- Tier-B methodology
  ])
    ⊨ backlog.md: generated view (scripts/it0-backlog-regen.ts; DIR-015 item 2); task store canonical for SELECT

-- FIRST-RUN BOOTSTRAP (iff dashboard.md state ≡ UNINITIALIZED)

  bootstrap :: () → State
  bootstrap() =
    confirm(exp4_stopped) →
    VT₀ = Σ_{s∈{CLI:25, MCP:20, WebUI:20, Packaging:20, Docs:15}} weight_s·cov_s(exp4."gap-list.md") →
    set(dashboard, {state: RUNNING, milestone_counter: 0, chart: 0, VT₀}) →
    commit(dashboard)
    ⊨ carry by-reference: backlog.md → exp4 reopened DIRs + open gaps;
       inherited_core → 3 extracted skills + exp4 methodology

-- CHART TRANSITIONS (§6.2)

  chart_transition :: State → Chart
  chart_transition(s) = (∀ surfaces cov→1 ∧ VT→chart_max) →
    open_new_chart(add_surface ⊕ deepen_capability, conversion_factor(old→new))
    ⊨ VT globally unbounded; explore milestone is the mechanism

-- HUMAN ASYNC CONTROL SURFACE (§4.7; never blocks the loop)

  human_steer :: () → Directive
  human_steer() = /quay-directive → label:directive task → drained at step 0; never mid-milestone
    ⊨ backlog.md edit also supported; drained at next boundary

  human_stop :: () → Halt
  human_stop() = touch(".halt") → clean exit at next boundary
    ⊨ urgent structural break: authorized external HALT of in-flight milestone, then outer re-design

  human_review :: () → ()
  human_review() = read(checkpoints/*, dashboard.md) — async; no interaction required

-- MERGE SAFETY (DIR-013 lesson recorded 2026-07-18; not mechanically enforced)

  merge_safety :: Merge → Bool
  merge_safety(m) =
    (concurrent human⊕loop edits same file) → prefer(.halt ⊕ branch) over auto-merge ∧
    merge_clean → verify(§N references_resolve) before declaring dispatch-ready
  -- Lesson 1: pause or branch when human is live-editing a file the loop will also touch.
  -- Lesson 2: textually-clean auto-merge is not evidence of semantically-consistent merge.
  -- Enforcement left to future milestone scoping.
