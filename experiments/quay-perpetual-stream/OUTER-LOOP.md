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

select :: Candidate[] ⇀ Candidate[]   -- batch (1..N); 1-wide = serial path, N≥2 = concurrent dispatch
select =
  -- Step 1: SELECT preflight (DIR-072/M153) — encapsulated single invocation replacing ~15 manual turns
  preflight = invoke(".claude/workflows/select-preflight.js", {workspaceRoot})
    ⊨ halt → return at boundary (clean exit per I₆); ¬block
    ⊨ pendingDirectives > 0 → /drain-directives first (DIR-071, I₄)
    ⊨ preflight yields {shortlist, cadence, deliverableStreak, starvation, candidates with schema/touches status, portfolio}
    ⊨ portfolio = synthesized singleton/composite MilestoneCandidate decision record (DIR-119-A Phase 1;
      scripts/candidate-synthesis.ts + scripts/portfolio-choice.ts) — advisory in this milestone (DIR-119-A's own
      Proposal defers operational wiring/self-certification to DIR-119-C); the legacy shortlist below is UNCHANGED
  → shortlist = preflight.shortlist  -- composed by deliverable-governor (DIR-066); deliverable classification baked in
  → N = min(|shortlist|, .quay/loop.yml.concurrency)  -- DIR-106 Fix 2: SELECT up to concurrency candidates (not just top-1);
     default concurrency=1 preserves backward-compat serial behavior
  → candidates = shortlist[0..N]     -- ranked top-N; remaining candidates stay in pool for next cycle
  → batch_assemble(charters(candidates))  -- scripts/concurrent-batch-scheduler.ts (DIR-075/M142); ⊨ charter readiness: type: + ## Touches
  → log("BATCH (${|batch|}-wide, concurrent): ${batch}")         -- DIR-106 Fix 4: surface batch diagnostics
  → log("  deferred: ${deferred.map(d => d.id + ' — ' + d.reason).join('\n')}")
  → writeback(batch, deferred, considered \ {batch ∪ deferred})
  → ∀c∈batch: author_ac_dod(c)   -- ¬self-tick (DIR-020): all - [ ] UNCHECKED; - [x] ONLY by Audit phase
  → ∀c∈batch: set_schema_v1(c)   -- extra.schema:"v1"; absent → N/A-legacy
  → ∀c∈batch: prepare(c)  -- DIR-117: invoke(".claude/workflows/prepare-milestone.js", {taskId, milestoneId,
     charterFile, class, highRisk?}) BEFORE final dispatch — orchestrates quay-task-to-plan's proposal authors →
     adjudication/write-back → BOUNDED grounded proposal review (incl. mechanism-claim wiring coverage, DIR-117
     unit B) → Plan author → grounded Plan-check, then writes milestones/M<NN>/preparation.json + proposal-
     ledger.json (a derived verification RECEIPT + typed finding ledger only — task ## Proposal +
     docs/plans/*.md remain the content sources of truth, never copied into either). Replaces the old inert
     `author_proposal_plan(c)` prose instruction with a real invocation. A Plan whose checked touch set exceeds
     c's `## Touches` declaration → update the declaration and re-run batch_assemble (line above) before
     dispatch (DIR-117 Requested-action item 5/9).
     ⊨ DIR-125 (M193) STOPPING RULE — ProposalReview is bounded EXACTLY like PlanCheck's existing <=3-round/
     F_i=0 rule, never an externally-restarted full regeneration: ONE full independent review per generation
     (authors + adjudicator run ONCE), then — only for unresolved BLOCKING findings — up to 2 focused-revise +
     independent-delta-review rounds (3 for explicit `highRisk`), gated by a 45m/75m soft wall-clock budget
     checked BEFORE admitting the next round (never killing an in-flight one) and a split checkpoint (>=3
     independent blocking findings in one subsystem, >2 independently landable mechanisms, or an oversized
     touch set). Non-blocking findings are NEVER silently dropped — each carries an explicit disposition
     (`plan`/`split`/`accepted-risk`/`backlog`/`duplicate`/`superseded`) and stays queryable in the ledger. A
     caller MUST NOT restart the whole prepare(c) invocation just because ProposalReview found something —
     that IS the DIR-120/M192 defect this closes (10 consecutive full-regeneration rounds, ~3h15m, ~1.13M
     output tokens, never reaching PlanAuthor). Exhausting the cap/budget, or a split recommendation, returns
     `needs-human` with the ledger — a human decides next steps, never a silent auto-retry or auto-split.
     ⊨ STATUS (M195/DIR-117-B, ENFORCED — proven on a real milestone): the workflow + milestone-preparation-
     check.ts + fixtures are landed, unit-tested, AND operationally proven — M195 ran the real
     SELECT→prepare→execute route on DIR-117-B itself (milestones/M195/preparation.json + proposal-ledger.json
     + docs/plans/M195-dir-117-b.md), with a real negative-control run (stale + missing receipt) returning
     {outcome:"revision-needed", phase:"Prepared"} before Build (milestones/M195/negative-control/). The
     pre-DIR-117-B opt-in skip is RETIRED: execute-milestone's `Prepared` phase is now ENFORCED-BY-DEFAULT —
     every dispatch MUST supply a `preparationReceiptFile`; omitting it fails closed with
     {outcome:"revision-needed", reason:"preparation-receipt-missing", phase:"Prepared"} before Build. The
     `prepare(c)` step above produces that receipt for every legitimate dispatch, so the enforced contract does
     not block the live loop. KNOWN EXPOSURE: any pending ad-hoc dispatch that predates a receipt (e.g. a queued
     composite/DIR-119-B or DIR-124-series dispatch) MUST route its primary task through `prepare-milestone.js`
     first — receipt-less dispatches are now always a caller bug, never a supported shape.
     ⊨ RESUME CONTRACT (M197/gap-prepare-milestone-cross-generation-no-incremental-reuse): DIR-125's bounded
     convergence loop above only bounds rounds WITHIN one `prepare(c)` generation — it makes NO claim about a
     FRESH `prepare(c)` dispatch after a prior generation ended `needs-human`/crashed. Before this milestone,
     every redispatch (cold or otherwise) always re-ran ProposalAuthors + Adjudicate from scratch, discarding
     ANY manual fix already applied to the task's on-disk `## Proposal` — confirmed real recurrence: 3
     consecutive DIR-119-D/M196 dispatches each hit the identical class of wiring-coverage defect because each
     fresh dispatch threw away the previous round's hand-repaired Proposal. This is the SAME staleness class
     CLAUDE.md's M144 rule names for `Workflow`'s own `resumeFromRunId` cache (external state — here, the task
     body — changed between rounds, so a cache/re-derivation keyed only on prompt+args cannot see the fix), but
     at `prepare-milestone`'s own domain-semantic level rather than the underlying `Workflow` engine's cache:
     `resumeFromRunId` would incorrectly replay the STALE cached run; `resumeFromAdjudicatedProposal` instead
     tells `prepare-milestone.js` to skip re-deriving a Proposal a human/agent already fixed. CALLER RULE: when
     a `prepare(c)` dispatch returns `needs-human` (or crashes) and a human (or an agent under human-steered
     discipline, DIR-027) manually repairs the on-disk `## Proposal` to resolve the findings, the NEXT `prepare(c)`
     dispatch for that same task MUST pass `{..., resumeFromAdjudicatedProposal: true}` rather than a bare fresh
     call — this skips `ProposalAuthors`/`Adjudicate` entirely and enters directly at `ProposalReview` using the
     CURRENT (repaired) `## Proposal` as-is. `fullSynthesisCount` on the resulting receipt records `0` (skipped)
     instead of `1` (cold); `validateConvergenceCounters`'s existing `fullSynthesisCount > 1` fail-closed check
     is unweakened by either value. A cold dispatch (flag omitted) is completely unaffected — unchanged behavior.
  → ∀c∈batch: schema_check(c)    -- scripts/task-schema-check.sh; FAIL → fix task, block dispatch
  → ∀c∈batch: size_check(c)      -- inherited_core."Milestone size definition"
  → ∀c∈batch: split_or_commit(c) -- DIR-026 MANDATORY; scripts/it0-split-or-commit-check.ts
  → ∀c∈batch: line_budget_check(charter_file)  -- scripts/it0-ceiling-line-budget-check.sh; FAIL → fix charter, never script
  ⊨ human-steered EXCLUDE — scripts/human-steered-classify.ts (DIR-062-A); label:human-steered ≡ manual override
     -- classify: --touched from task ## Touches; absent → no --touched flags
     -- classify: --mission-redirection — human-set marker, NEVER inferred
     -- classify: --workspace → drivable-workspace-check.ts against drivable-workspaces.yml
     -- safety: driver-file-editing tasks WITHOUT ## Touches MUST carry label:human-steered
  ⊨ ∀c: record(value_type(c), Δv̂(c))  -- inherited_core."Value-typed SELECT ledger"
     (capability-growth|discovery|instrument-correction|risk-option|governance-integrity)
  ⊨ governance/infra hard floor: scope ⊇ enforcement half → reject|resize if partial
  ⊨ VT Δv̂ = one input among several; never sole ranker
  ⊨ explore ≥1 per 5; exploit = high-value, high-ρ; prefer aged high-value (DIR-004 Distribution URGENT)
  ⊨ deliverable:yes ≡ output consumed OUTSIDE loop; ambiguous → no
  ⊨ floor = min(1, streak/6); S = round((1−floor)·4); S_max = 4
  ⊨ streak = consecutive deliverable:no SELECTs; yes resets; explore/arch-audit exempt
  ⊨ streak≥6 ∧ no autonomous D → DELIVERABLE-STARVATION (prominent, greppable; auto-continue; ¬halt)
  ⊨ writeback: ∀c∈batch: task_write(c, labels ++ milestone:M-NN); ∀deferred: append("## Not selected (M-NN)", reason)

hypothesize :: Task → Δv̂
hypothesize(t) = Σ weight_s·Δĉov_s ∧ commit(dashboard, {predicted: Δv̂, metric: Y})
  ⊨ numeric; pre-dispatch

charter :: Task → Charter
charter(t) = write("charters/M<NN>-<slug>.md", {gate, scope, done_when, inner_term, it0_checks, ptr})
  ⊨ commit: git add experiments/quay-perpetual-stream/charters/M<NN>-*.md as part of THIS milestone's
     own commit sequence, immediately after writing it — never left for Land to discover as untracked
     (gap-absorb-charter-audit-not-committed / M176: 16 charters + 19 audit files backlogged M144-M166
     from this exact gap, swept once by hand in bfc5289 — closed at the source, not re-swept)
  ⊨ gate: transclusion_byte_for_byte ⊕ by_reference(scripts/it0-gate-hash-check.sh --by-reference)
  ⊨ I₃: dispatched agent prompt MUST contain literal gate text (never hash-only; DIR-009 defense)
  ⊨ Web UI scope: Done-when clause MUST embed inherited_core."Web UI verification requirement" (DIR-006)
     (curl status check never sufficient for rendering/interaction/visual claims)
  ⊨ AC/DoD: task is canonical source; charter references only (¬copy; ¬fork into charter — anti-drift)
  ⊨ Tier-A ≤ 2K tokens (§3.1); binary Done-when clauses mandatory (§3.4)
  ⊨ scope: in-scope gap subset ∪ open blocking gaps verbatim
  ⊨ pointer: path ⊕ git_sha → inherited_core (Tier-B, not inlined)
  ⊨ inner termination: five conditions (§3.2); it0 systematic-explore checks enumerated

batch_assemble :: Candidate[] → {batch: Candidate[], deferred: Deferred[]}
batch_assemble(ranked) =
  a. charter_readiness(c): ensure type: + ## Touches on each candidate (fail-closed: missing → deferred)
  b. run("node plugin/scripts/concurrent-batch-scheduler.ts --root . <charters>")
     — use plugin/ path (NOT experiments/ symlink): the isDirect guard in these scripts compares
     process.argv[1] against fileURLToPath(import.meta.url); symlink paths never match, causing
     silent no-op (DIR-106 audit finding — pre-existing, now fixed)
     — single-source batch scheduler (ADR-004); imports disjointness from touches-orthogonality-check.ts
  c. BATCH set (concurrent dispatch via step 4b) || deferred candidates → remain in pool
  ⊨ learning-type → always serial (scheduler defers via isLearning() guard)
  ⊨ 1-wide → fallback to serial path (execute, unchanged — existing single-milestone pipeline)
  ⊨ touches-shared-state → deferred (writes must serialize at fan-in ABSORB)
  ⊨ ill-declared Touches → deferred (conservative gating: parseTouches + checkTouchesPair)

execute :: Params → {done, needs-human}
execute(params) where |batch|=1 = invoke(".claude/workflows/execute-milestone.js", {taskId, charterFile, absorbEntryFile, preparationReceiptFile})
  ⊨ absorb-entry pre-created: /tmp/m<NN>-absorb-entry.md (milestone id, charter path, Δv̂ from step 2)
  ⊨ dispatch-record at /tmp/m<NN>-dispatch-record.txt (created by Audit phase per M90)
  ⊨ IS single-source (ADR-004, DIR-067): Verify(Build(5 it0 checks parallel)) → Prepared(DIR-117-B/M195,
     ENFORCED-BY-DEFAULT: `preparationReceiptFile` is REQUIRED — milestone-preparation-check.ts runs against
     it and the phase fails closed with {phase:"Prepared", outcome:"revision-needed"} on a MISSING param
     (reason:"preparation-receipt-missing"), a missing/failed/stale receipt, N/A Plan, or touch-set expansion.
     The pre-DIR-117-B opt-in skip is retired — proven on M195's real run + negative control; the `prepare(c)`
     step above supplies the receipt for every legitimate dispatch) → Build(class-route + inner iteration in isolated worktree)
     → Audit(adversarial fresh-context; write-back AC/DoD ticks)
     → Gate(7 absorb gates parallel: vmeta-lag, impl-row, DoD meta-enforcer, dashboard-budget,
     tree-hygiene, worktree-branch-hygiene, audit-independence) → Land(merge→master + capture-prune
     + dashboard update + milestone_counter++)
  ⊨ phases cached; resumable within session
  ⊨ serial path (1-wide) — preserved unchanged; counter++ + dashboard inline
  ⊨ DIR-119-B (M189, Phase 2 of O4): execute-milestone.js ALSO accepts an arbitrary-width
     {milestoneCandidate:{taskIds,...}, compositeManifestFile, charterFile, absorbEntryFile} shape
     (a synthesized DIR-119-A MilestoneCandidate) — normalized to the SAME internal taskIds array
     legacy {taskId,...} calls produce (composite-args.ts's normalizeExecuteArgs; NEVER rejected on
     array length). Verify gains a 6th mechanical check, composite-preflight.ts, that re-validates
     normalization plus (only when compositeManifestFile is given) the phase-DAG/audit-shard/
     capacity/atomic-Land composite contract (composite-contracts.ts). Build/Audit/Gate/Land stay
     conservatively single-lead-oriented for THIS first implementation (task-scoped gates run per
     member; Land marks every member task but performs exactly ONE counter increment + ONE
     dashboard entry regardless of width — composite-build/audit/reconcile/land.ts). A real cold
     multi-task exercise of this path is explicitly DIR-119-C's job, not self-certified here.
  ⊨ DIR-119-D1 (M198): when the chosen candidate/batch is genuinely multi-task
     (`taskIds.length > 1`), a new sub-step runs BEFORE the execute-milestone.js dispatch above:
     `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-manifest-synthesis.ts --candidate-json <portfolio-selected-entry> --charter <charterFile> --workspace-root . --out <path>`
     — synthesizes the real `CompositeManifest{phases[], auditShards[]}` this
     candidate's own DIR-119-B composite dispatch above consumes (`<portfolio-selected-entry>` is
     the real synthesized `MilestoneCandidate` JSON select-preflight.js's own `portfolio.selected[]`
     now threads through, per its own SelectPreflight phase edit — never a hand-shaped stub). On a
     non-zero exit (contract violation, prohibiting-edge conflict, or missing task facts) this is a
     HARD STOP before Build is ever reached — fail-closed, the composite dispatch below never fires
     with a bad/absent manifest. On success, the written path is threaded into the
     execute-milestone.js dispatch above as `compositeManifestFile`, alongside the pre-existing
     `taskId`/`milestoneCandidate`/`charterFile`/`absorbEntryFile`/`preparationReceiptFile` names.
     For `taskIds.length === 1` this sub-step is skipped entirely — the legacy singleton dispatch
     is byte-for-byte unaffected (compatibility invariant; no `compositeManifestFile`, no synthesis-
     CLI invocation logged for that path). This is a doc-text-only mechanism, matching how the
     existing `execute-milestone.js`'s own Verify phase already shells out to the sibling
     `composite-preflight.ts` checker as a labeled step (the workflow DSL's five globals —
     phase/agent/parallel/log/args — expose no import/filesystem/shell primitive of their own).

dispatch :: Batch → Action
dispatch(batch) =
  |batch| = 0 → log("no batchable candidates; N deferred → next pool") → routines()
  |batch| = 1 → execute(serial)
  |batch| ≥ 2 → concurrent_execute
  ⊨ explicit empty-batch branch (DIR-107 Fix 4): "nothing selected" is logged and observable

concurrent_execute :: Batch → {done[], needs-human[]}
concurrent_execute(B) where |B| ≥ 2:
  a. ∀c∈B: dispatch Workflow({scriptPath: ".claude/workflows/execute-milestone.js",
     args: {taskId: c.id, charterFile: c.charter, absorbEntryFile: c.absorb,
     preparationReceiptFile: c.receipt, mode: "concurrent", isolationMode: "worktree"}},
     run_in_background: true) from MAIN session
     — NOT from within a workflow (DIR-092 architectural fix; Workflow-internal dispatch is broken)
     — `preparationReceiptFile` is REQUIRED post-M195/DIR-117-B flip (enforced-by-default Prepared
     gate): every candidate's receipt is produced by `prepare(c)` in the SELECT cycle; a dispatch
     omitting it fails closed with `preparation-receipt-missing` before Build
     — `isolationMode: "worktree"` is REQUIRED for EVERY concurrent dispatch (DIR-123): each candidate
     Builds in its own per-milestone git worktree so the concurrent Builds never share the working tree.
     This is also the OBSTACLE-5 mechanical backstop: a concurrent batch is worktree-isolated BY
     CONSTRUCTION here, so a no-isolation dispatch can never be admitted into a concurrent batch. A
     no-isolation (default) dispatch must NEVER overlap a concurrent batch against the same checkout
     (hard precondition — see tasks/DIR-123.md / CLAUDE.md; the default path takes no Land lock and
     commits directly to master in Build, so it is not serialized against worktree Lands).
  b. wait ∀ N complete (monitor background task completion)
  c. survivors = {c | outcome: "done"}
  d. PRE-MERGE GATE — audit-independence per survivor (DIR-107 Fix 3): verify each survivor's
     audit session ID ≠ its build session ID (DIR-032/034 anti-forgery; inline verification per
     DIR-093). Any survivor failing → route to needs-human, EXCLUDE from fan-in (partial-batch:
     independent survivors still land). audit-indep gate removed from Workflow per DIR-097, runs
     HERE at fan-in ABSORB.
  e. PRE-MERGE GATE — anti-drift: scripts/anti-drift-touches-check.ts on git diff --numstat
     for each survivor's touched files (NON-WAIVABLE — DRY structural enforcement; any overlap →
     hard error, diagnose before merge). Runs BEFORE any merge step g — master stays clean on
     HARD FAIL.
  f. scripts/serial-fanin-absorb.ts for deterministic merge plan from survivor results
     (buildBranch ∪ touchedFiles ∪ dashboardEntry → ordered merge sequence)
  g. MERGE each survivor one at a time in plan order consuming buildBranch (SOLE merge owner;
     ¬parallel merge — single git worktree). Under DIR-123 worktree isolation each survivor's
     buildBranch is its per-milestone worktree branch (milestone/M<NN>/iteration-0) and the workflow
     MERGED NOTHING itself — so for EACH survivor, under the single-flight Land lock
     (scripts/milestone-worktree.ts): `--land-lock-acquire` → `--merge` (real `git merge --no-ff
     buildBranch`) → CAPTURE the milestone's evidence (git add audits/iterations/charter + commit on
     the primary) → `--remove` (worktree remove + branch -d) → `--land-lock-release`. The lock is held
     across merge+CAPTURE+remove so concurrent survivors serialize over EVERY shared-checkout mutation
     (no git-index/HEAD race on the CAPTURE commits). A real merge conflict → the lock is released and
     the survivor routes to needs-human (never a blanket --ours/--theirs; the merge auto-aborts clean).
  h. milestone_counter += |survivors|; dashboard.md append each survivor's dashboardEntry
  i. regenerate backlog.md/dashboard.md views via scripts/it0-backlog-regen.ts; close-out hygiene
     (tree-hygiene-check.sh + worktree-branch-hygiene-check.sh final pass)
  ⊨ Build phase stays INLINE per workflow (loop's fix preserved — Workflow-internal dispatch is broken)
  ⊨ audit-independence + anti-drift-touches-check are PRE-MERGE gates (steps d,e before step g)
  ⊨ anti-drift-touches-check NON-WAIVABLE (concurrent builds MUST be touch-orthogonal)
  ⊨ fan-in merge is deterministic (serial-fanin-absorb.ts plan order, not heuristic)
  ⊨ survivors < N is legal (failed milestones → needs-human; survivors merge, failed recorded in ABSORB)
  ⊨ step g is SOLE merge owner — workflows produce committed branches; fan-in owns all merges. Under
    DIR-123 worktree isolation this is literal: the per-workflow concurrent Land merges NOTHING and
    returns buildBranch + worktreeRel; step g does every merge + CAPTURE + worktree-remove under the
    Land lock. (The serial, non-concurrent execute-milestone Land instead merges within the workflow,
    holding that same Land lock for its ENTIRE Land phase.)

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
  I₁₆: sentinel-removal-idempotent                          (rm -f, ¬bare rm for any optional sentinel
                                                              file; M166 crystallization)

-- CONTRACTS (executable at session start; any FAIL → halt ∧ report)

  C₁: test -f .claude/workflows/execute-milestone.js → exit 0
  C₂: test -f .claude/workflows/drain-directives.js → exit 0
  C₃: test -f .claude/workflows/run-routines.js → exit 0
  C₄: test -f scripts/explore-exploit-cadence.ts → exit 0
  C₅: test -f scripts/termination-delta-v-check.ts → exit 0
  C₆: ¬∃ "governance:product.*HALT" in OUTER-LOOP.md beyond informational (DIR-066 supersedes hard halt)
  C₇: ∀s ∈ extract_scripts(OUTER-LOOP.md): test -f experiments/quay-perpetual-stream/$s → exit 0
  C₈: test -f .claude/workflows/select-preflight.js → exit 0 (DIR-072/M153: SELECT preflight workflow)
  C₉: test -f experiments/quay-perpetual-stream/scripts/select-preflight.ts → exit 0 (DIR-072/M153)

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
