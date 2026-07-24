# OUTER-LOOP.md — quay-perpetual-stream (Experiment 5) driver

You are the **OUTER orchestrator** of a perpetual two-layer BAIME experiment. Execute this file.
It is intentionally thin: detail lives in the protocol; this is the operational loop. It **generates
per-milestone charters** — it is not itself a big per-iteration prompt.

## Spec

```
λ(workspaceRoot: Path) → Milestone*

outer_cycle :: Workspace → Done | Halt
  drain      :: Directive[] ⇀ Disposition[]     -- 0; ⊨ task-canonical (DIR-028)
  select     :: Candidate[] ⇀ Task              -- 1; ⊨ exclude human-steered (human-steered-classify.ts); ⊨ D-quota (DIR-066, deliverable-governor.ts); ⊨ cadence (explore-exploit-cadence.ts)
  hypothesize :: Task → Δv̂                       -- 2; ⊨ numeric, pre-dispatch
  charter    :: Task → Charter                   -- 3; ⊨ gate-hash transclusion; ⊨ line-budget (it0-ceiling-line-budget-check.sh)
  execute    :: Params → {done, needs-human}     -- 4; ⊨ /execute-milestone workflow (DIR-067, .claude/workflows/execute-milestone.js)
  checkpoint :: Counter → Checkpoint?            -- 5; ⊨ every 5; ⊨ non-blocking

invariants (∀ cycle):
  · ¬point-baime-at-stream (invariant 1) · ¬perturb-inflight (invariant 2)
  · gate-text-transclusion-or-hash (invariant 3) · drain-before-select (step 0→1)
  · master-direct (DIR-027; no driver branch) · halt-sentinel (.halt → clean exit)
  · self-halt: rolling-slope<threshold (DIR-038-A, rolling-slope-check.ts)
    → chart-saturation-check (DIR-063, chart-saturation-check.ts)
    → HALT-RECOMMENDED | TRANSITION-RECOMMENDED (subagent DRAFTING gated behind TRANSITION-DUE)
  · governance:product → INFORMATIONAL ONLY (DIR-066; NO LONGER hard-halt)
  · explore/exploit: ≥1 per 5; mechanical cadence check by explore-exploit-cadence.ts (CRYST-D3 R6)
  · termination: ΔV<0.02 K=2 consecutive → TERMINATION-DUE (termination-delta-v-check.ts, CRYST-D3 R7)
```

## contracts:

1. **Workflow exists**: `test -f .claude/workflows/execute-milestone.js` → exit 0. The step-4 pipeline is the single-source definition (ADR-004).
2. **No stale governance:product HALT**: `grep -c 'governance:product.*HALT-RECOMMENDED' OUTER-LOOP.md | grep -v 'NO LONGER\|supersedes\|informational'` → 0. DIR-066 retired the hard halt; only the informational note remains.
3. **All code-pointers resolve**: `grep -oE 'scripts/[a-zA-Z0-9_-]+\.[a-z]+' OUTER-LOOP.md | sort -u | while read s; do test -f "experiments/quay-perpetual-stream/$s" || echo "MISSING: $s"; done` → empty. Every referenced script exists on disk.
4. **Explore/exploit cadence script exists**: `test -f experiments/quay-perpetual-stream/scripts/explore-exploit-cadence.ts` → exit 0. The mechanical cadence check (CRYST-D3 R6) is single-source.
5. **Termination ΔV script exists**: `test -f experiments/quay-perpetual-stream/scripts/termination-delta-v-check.ts` → exit 0. The mechanical termination check (CRYST-D3 R7) is single-source.

## Pinned references (read once at session start)
- **Protocol (architecture, all §§):** `docs/proposals/quay-perpetual-stream-experiment-v5.md`
- **Offline calibration/evidence:** `experiments/offline-replay/RESULTS.md`
- **Dashboard (mutable outer state):** `experiments/quay-perpetual-stream/dashboard.md`
- **Backlog (milestone candidates):** `experiments/quay-perpetual-stream/backlog.md` — **generated
  view** as of M24-task-backlog-projection-impl (DIR-015 item 2 / m13 design doc §1/§13): the task
  store (`label: milestone-candidate` tasks) is canonical; `backlog.md`/`dashboard.md` are regenerated
  from it via `scripts/it0-backlog-regen.ts`, not hand-edited as the source of truth going
  forward. SELECT (step 1 below) reads the task store directly.
- **Inherited core (Tier-B methodology):** `experiments/quay-perpetual-stream/inherited-core.md`

## Session-start healthcheck (QC-T1 native task store liveness probe)
After reading the pinned references, call `task_get QC-T1` to verify the native task store is
accessible. If the result is "no such task: QC-T1": call `task_write` to re-create the fixture
with `{id: QC-T1, title: "healthcheck fixture — native task store liveness probe", status: todo,
labels: [fixture, healthcheck], body: "Permanent liveness probe — never complete. Re-create if
absent (idempotent)."}`, then retry `task_get QC-T1` to confirm. Never silently continue if the
re-creation also fails — halt and raise `needs-human`. This probe is idempotent: re-running at any
session start finds QC-T1 (creating it if missing) without side-effects.

## Invariants — never violate
1. **Never point BAIME at the stream; only at a milestone.** (Every exp4 pathology = violating this.)
2. **Never perturb an in-flight inner milestone** (its charter is frozen). Human async input is
   handled by YOU, the outer layer, at the next milestone boundary (protocol §4.7) — via
   `/quay-directive` / backlog. Urgent structural break = an authorized external HALT of the inner
   milestone, then outer re-design. Never absorb async input mid-milestone.
3. **Gate text in a charter is TRANSCLUDED verbatim** from the pinned template and hash-checked —
   never paraphrased (this is the DIR-009 defense; offline-validated, `RESULTS.md` B2 check 2).

## First-run bootstrap  (do ONLY if `dashboard.md` shows `state: UNINITIALIZED`)
1. Confirm exp4 is stopped (it is) and that the carry is by-reference: `backlog.md` points at exp4's
   reopened DIRs + open gaps; `inherited-core.md` points at the 3 extracted skills + exp4 methodology.
2. **Score VT origin (chart-0):** for each surface {CLI 25, MCP 20, Web UI 20, Packaging 20, Docs 15}
   score coverage `cov_s ∈ [0,1]` from exp4's `gap-list.md` (fraction of that surface's known
   capabilities delivered & verified). `VT₀ = Σ weight_s·cov_s`. Record on `dashboard.md`.
3. Set `state: RUNNING`, `milestone_counter: 0`, `chart: 0`. Commit the dashboard.

## Outer cycle — one pass = one milestone
0. **DRAIN human inbox** — read the pending directives via `task_list --label directive`
   (native provider MCP tool, or `node packages/quay/bin/quay.js task list --label directive --json`)
   filtered to those with `extra.dirStatus: pending`. **Directives are TASK-CANONICAL (DIR-028 /
   Plan A): a directive IS a `label:directive` quay task — the single source of truth. There is no
   `directives/*.md` file, no projection, and no anti-drift check** (all three were retired; the task,
   stored as `tasks/DIR-NNN.md`, is git-tracked and canonical). Disposition each pending directive →
   a milestone-candidate task / a standing-rule amendment (`inherited-core.md` or `dashboard.md`
   control limits) / an out-of-cycle action (VT chart transition, HALT); then record its disposition
   on the SAME task — set `extra.dirStatus` (`applied`/`deferred`/`rejected`) and append a
   `## Resolution` to the task body. This is where async human steering (§4.7) enters — at the
   boundary, never mid-milestone. `/quay-directive` creates these tasks directly (task-canonical);
   there is no file-vs-task reconciliation to run (the dual source it compensated for is gone).
   **The loop runs DIRECTLY on `master` (DIR-027 retired DIR-018's driver-branch isolation).** There
   is no `exp5-outer-driver` integration branch and no master↔driver DRAIN/publish merge dance: the
   loop's own commit stream (charter authoring, per-iteration worktree base points, inner-merge
   resolution, ABSORB) lands on `master`. Human commits (via `/quay-directive`, manual edits) also
   land on `master`; there is no branch buffer, so **human-steering hygiene (DIR-027 item 5, replacing
   the isolation it removed):** when the loop is running, a human edit should either pause the loop
   (`touch experiments/quay-perpetual-stream/.halt`, drained at the next boundary) OR be made in a
   private worktree off `master` and folded in at a clean window — the same race-free pattern
   DIR-018/DIR-019 documented for human commits, now the primary discipline. (Historical: DIR-018
   put the loop on a driver branch to avoid this race; DIR-027 retired it after the isolation proved
   to relocate rather than prevent the race under heavy human steering — see DIR-027 Finding.)
   **No-silent-drop reconciliation-note requirement (standing, DIR-013/DIR-018 item 3 — still
   applies to any merge the loop does, e.g. folding a human private-worktree edit or an
   iteration-worktree merge into `master`):** any real per-file conflict MUST be resolved by reading
   BOTH sides' actual content — **never** a blanket `git checkout --ours`/`--theirs` wholesale (the
   exact DIR-013 failure: an auto-resolved merge that silently discarded one side's content). Record
   a short reconciliation note (which file, what each side had, what was kept/merged and why) in the
   relevant log entry; a missing note is not a valid resolution of a conflict. Documented convention,
   not a script/hook — applied by reading this text, like the gate-hash and line-budget checks'
   fix-the-charter (not the mechanism) discipline.
1. **SELECT** the next milestone candidate. **Candidates are read via `task_list`, not `backlog.md`
   prose** (M24-task-backlog-projection-impl, DIR-015 item 2 / m13 design doc §1/§13 — the task store
   is canonical for backlog/milestone/selection tracking going forward; `backlog.md` is a generated
   view, see step 0's note below and the regeneration script under `scripts/`). Run
   `task_list --label milestone-candidate --status todo` (native provider MCP tool, or
   `node packages/quay/bin/quay.js task list --label milestone-candidate --status todo --json`
   equivalently) to get the live open-candidate set; apply the explore/exploit policy (§4.5): **≥1
   explore milestone per 5**. Run `node scripts/explore-exploit-cadence.ts --json` (CRYST-D3 R6,
   2026-07-24) to mechanically determine whether an explore is DUE (≥4 consecutive non-explore
   milestones since the last explore — the script IS the single-source definition). Exploit =
   high-value, high-ρ, method handles it; explore = new surface/domain that grows the reusable core. Prefer aged high-value items (DIR-004 Distribution is
   URGENT).
   **EXCLUDE `human-steered` candidates from autonomous SELECT.** A candidate is `human-steered` per
   the 3-clause definition in `inherited-core.md` ("Human-steered task definition (DIR-062)"): (1)
   driver-self-rewrite — touches `OUTER-LOOP.md` / `inherited-core.md` / `.claude/skills/`; (2)
   mission-redirection — `extra.missionRedirection: true`; (3) unauthorized cross-workspace drive —
   drives a workspace NOT covered by `drivable-workspaces.yml`. The executable classifier is
   `scripts/human-steered-classify.ts` (DIR-062-A, M125) — invoke it per candidate with `--touched`
   (the task's declared touched files: read the `## Touches` section from the task body — if absent,
   pass no `--touched` flags; clause 1 will not fire, which is correct for tasks that don't touch
   driver files. A task that DOES touch driver files but lacks `## Touches` MUST carry
   `label:human-steered` — the label is the safety net for the un-declared case), `--workspace` (any
   foreign workspace the task drives, from `## Touches` or the charter scope), and
   `--mission-redirection` (only if `extra.missionRedirection: true` is set on the task — this is a
   human-set marker, never inferred). `label:human-steered` is retained as a manual override/escape
   hatch: a task carrying the label is excluded regardless of the classifier's verdict (covers the
   case where a task touches driver files but lacks `## Touches`, or any risk not captured by the
   three clauses). Filter them out here before ranking.
   **Round-1 deliverable governor (DIR-066 — SOFT, replaces DIR-038-B's hard governance:product halt).**
   Over the autonomous-selectable candidates (human-steered already excluded), the pass runs in TWO rounds.
   **Round 1 composes the "candidates considered this pass" set** (the shortlist ranked in Round 2 below):
   classify each candidate `deliverable:yes|no` by criterion (丙) — YES iff its landed output is consumed
   OUTSIDE this loop (shipped `packages/`/`plugin/` code, the release pipeline, a skill/ADR/transferable
   methodology, or a fix observed in a real downstream); NO for the loop's own gate/DoD/VT/dashboard/
   directive/SELECT machinery or bookkeeping; **ambiguous → NO**. Maintain a **streak** = consecutive
   SELECTed `deliverable:no` milestones (a `yes` resets to 0; the §4.5 mandatory explore/arch-audit slot is
   EXEMPT/streak-neutral). Compose the shortlist via `scripts/deliverable-governor.ts` `composeShortlist`
   with `floor = min(1, streak/6)`, `N_seats = round((1−floor)·S_max)`, `S_max = 4` — so as the streak
   rises the shortlist's D-fraction rises to 1 (size `S ∈ [1,4]`; a single forced D → `S=1`). Record each
   candidate's `deliverable` + the streak + S in the SELECT rationale. **This never halts.** When
   `streak ≥ 6` AND no autonomous D is available (deliverable-starved backlog), emit a prominent, greppable
   `DELIVERABLE-STARVATION` line (SELECT log + a dashboard flag) so a watching human sees it, then run the
   best N and **auto-continue** — set no `.halt`, emit no `HALT-RECOMMENDED`. Continuing N when no D exists
   is correct. **Round 2 (below) is unchanged** — the VT Δv̂ + value-typed ledger + governance/infra
   hard-floor ranker picks the winner from this ≤4 shortlist.
   **Batch assembly (DIR-075, M142 — concurrent execution):** after the ranked shortlist is composed,
   assemble a concurrent batch via `concurrent-batch-scheduler.ts` (the single-source batch scheduler,
   ADR-004). This step replaces the old single-winner SELECT with a batch-wide dispatch:
   a. **Charter readiness.** For each candidate in the shortlist, ensure its charter has been authored
      (step 3 charter-authoring) AND carries `type:` (one of `execution`/`learning`/`methodology`/etc.
      per `inherited-core.md`'s value-type ledger) AND `## Touches` (repo-relative path globs, ≥2
      concrete leading segments before any wildcard). If a candidate's charter lacks these, author them
      now — without them, `concurrent-batch-scheduler.ts` defers the candidate to serial (fail-closed).
   b. **Run the scheduler.** `node experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts
      --root . <charter1.md> <charter2.md> ...` over the ranked shortlist's charter files. The script
      outputs `BATCH (N-wide, concurrent): <ids>` + `deferred: <id> — <reason>` lines. Parse them.
   c. **Dispatch semantics.** BATCH set → step 4 concurrent dispatch (multiple `/execute-milestone`
      workflows dispatched as background tasks). Deferred candidates → remain in the candidate pool for
      the next cycle (record the deferral reason in a `## Not selected` note on the task). A 1-wide
      batch = fall back to serial (the existing single-milestone path, preserved unchanged).
   d. **Learning-type milestones are always serial** (scheduler defers them — `isLearning()` guard
      matches any type containing `/learning/i`). When a learning-type milestone is SELECTed as the
      sole candidate or the batch is 1-wide learning, the loop runs exactly one serial milestone —
      the SELECT←ABSORB feedback path, preserved unchanged.
   **Write the selection back onto the task store as part of this step:** each candidate in the BATCH
   gets `milestone:M-NN` appended to its `labels` (via `task_write`) at dispatch time, and every OTHER
   candidate task actually considered this pass (i.e. shortlisted but deferred by the batch scheduler,
   not the full unconsidered backlog) gets a short **not-selected note** appended to its body — e.g. a
   `## Not selected (M-NN)` section stating the pass number and one-line reason (deferred by batch
   scheduler: learning-type / touches-overlap / ill-declared touches). This makes the SELECT reasoning
   inspectable per-task instead of only living in a dashboard/checkpoint narrative.
   **For each candidate in the batch, stamp `extra.schema:"v1"` + author `## Proposal` + `## Plan` at THIS step:** when writing the
   batch candidate via `task_write`, set `extra.schema:"v1"` (without it the task reports N/A-legacy —
   the pre-dispatch self-check below catches a forgotten marker). Author a real `## Proposal` (the
   chosen approach, per the proposal-to-plan / quay-task-to-plan pipeline) and a `## Plan` — a
   milestone-candidate MUST carry one: a resolving `docs/plans/*.md` ref if staged, else
   `N/A — <reason>` (Clause 8 / schema A1–A2 check the shape).
   **Author the task's AC + DoD at THIS step — the authoring half of DoD Clause 0.** The task is the
   SINGLE canonical source for both: do NOT copy them into the charter (which only references them),
   and revise the task's copy, never fork into the charter (anti-drift).
   - `## Acceptance Criteria` — ≥1 concrete criterion specific to this value unit. The checklist SHAPE
     is enforced by `task-schema-check.sh` (A3) + Clause 0; the SUBSTANCE is NOT — each criterion must
     NAME the artifact/test/observable output that proves it, so the step-6 audit can try to refute it.
   - `## Definition of Done` — a REFERENCE to the standard five clauses (never an inlined copy) + any
     task-specific extras, as checklist items.
   **Never self-tick (DIR-020 — uncoded who/when invariant):** author every AC/DoD box UNCHECKED
   `- [ ]`. Boxes go to `- [x]` ONLY in the workflow's Audit phase, by the acceptance audit as
   it independently confirms each item — never here, never by SELECT. Clause 0 HARD-blocks the
   workflow Land phase's `milestone_counter++`
   on any missing/empty section OR any box left unchecked past the audit, but it CANNOT detect an
   improperly self-ticked box — so the who/when rule is discipline, not code. Checklist form is
   forward-only; pre-existing prose-form tasks are grandfathered.
   **Before dispatch, run `scripts/task-schema-check.sh tasks/<id>.md` against EACH batch candidate; a
   FAIL on any candidate blocks dispatch for that candidate** (fix the task body, not the script —
   same discipline as the gate-hash / line-budget checks). This proves the schema was emitted by
   construction: `## Proposal` present, `## Plan` well-formed, AC/DoD as checklists, no
   empty/status-mirror `## Resolution`, no projection scaffolding, the `extra.schema:"v1"` marker
   present (an `N/A legacy` line means the marker was forgotten above — add it and re-run), and
   `## Touches` well-formed if the task has `type: execution` (INFO if absent, HARD FAIL if
   overbroad or empty).
   **Size the candidate BEFORE dispatch** using `inherited-core.md`'s "Milestone size definition +
   verify-iteration size gauge" section: does the proposed scope let iteration-0 land ALL Done-when
   in one pass, with iteration-1 having real material to independently re-derive (not empty
   verification, not forced into new build work, no mid-milestone re-scope)? If not, split along a
   different seam or explicitly budget a multi-build milestone before authoring the charter — never
   carry an implicitly half-shipped value step forward.
   **SPLIT-OR-COMMIT (DIR-026 — MANDATORY, not a suggestion):** if the candidate cannot be FULLY
   completed within THIS one milestone, it MUST be **split** via `task edit --children <child-ids>`
   (M12 parent/children) into sub-tasks each of which IS fully completable within a milestone
   (recursively, until each child fits the ceiling AND is completable), and ONE child is SELECTed.
   **Selecting a task with the intent to complete only PART of it is prohibited** — split first, then
   select a whole child; the remainder becomes explicit board children (each with its own AC/DoD),
   never a prose "later phase." A parent task is `done` iff ALL its children are `done`. This is the
   discipline that ends the "do a slice, leave the parent pending forever" failure — the exact
   pattern that let a core directive item be deferred across five milestones (see DIR-026 Finding).
   <!-- enforcement: scripts/it0-split-or-commit-check.ts (C1/exp5-M-CRYST-C1) — the
        parent-done-iff-children rule, the SELECT-split rule above, AND child-link-symmetry (a task
        declaring `parent: Y` must be listed in Y's `children`, else parent-done silently excludes it
        and a program reads as complete while a phase is still open — the exp5-M-TS-MIGRATION P1-P4
        modeling hole) are mechanically enforced by this script. Run `quay gate --gate split-or-commit`
        at ABSORB. D3·R7. -->
   **Plan-time line-budget gate (M18/DIR-012 item 2 — mechanically checkable):** run
   `scripts/it0-ceiling-line-budget-check.sh <charter-file>` against the drafted charter BEFORE
   dispatch (fires again at step 4e). The ~2000-line ceiling + the item-count proxy + the
   phase/stage-plan satisfaction rule (inline `Line budget:`/`Phase`/`Stage`, or a `Plan:` ref) all
   live in the script; a FLAG = oversized with no phase/stage plan → add the plan reference or
   resize/split before dispatch. **On ANY it0-check FAIL, fix the charter/task, never the script.**
   **Record each candidate's value type(s)** (mandatory, applies forward from m7) from
   `inherited-core.md`'s "Value-typed SELECT ledger" section — capability-growth / discovery /
   instrument-correction / risk-option / governance-integrity — alongside its VT Δv̂. VT Δv̂ is one
   input among several, never the sole ranker: a zero/negative-VT candidate carrying a
   governance-integrity, instrument-correction, or risk/option type can and should outrank a
   positive-VT capability-growth candidate when the non-VT risk is higher. Apply the ledger's
   **governance/infra hard floor**: a governance/infra candidate whose scope excludes its own
   enabling/enforcement half must be rejected or resized here, never dispatched partial.
2. **VALUE HYPOTHESIS** (§4.1/§6.2): commit a numeric `Δv̂ = Σ weight_s·Δĉov_s` + the metric `Y` that
   will measure realized `Δv`. Record predicted on the dashboard BEFORE dispatch.
3. **AUTHOR CHARTER** → `charters/M<NN>-<slug>.md`, Tier-A, target ≤ 2 K tokens (§3.1):
   - HARD GATES block: **EITHER** transcluded byte-for-byte from the pinned template (hash-checked,
     invariant 3), **OR** cited **by-reference** — path + verified hash via
     `scripts/it0-gate-hash-check.sh --by-reference <charter-file>` (added by M06-sizing) — instead
     of transcribing the full block verbatim, to keep the CHARTER FILE itself thin. **Either form is
     an acceptable satisfaction of invariant 3**, but the by-reference form does NOT change what a
     DISPATCHED iteration-executor agent's prompt must contain: that prompt must always include the
     literal gate text somewhere, in full, regardless of which form the charter file uses — a
     dispatched agent must never see only a hash reference with no literal text (this would
     reintroduce the exact gate-dilution risk DIR-009 defends against). The charter may shrink; the
     agent-facing prompt may not lose the literal text.
   - **Web UI verification requirement (M10-audit-consolidation, DIR-006):** if this milestone's
     scope includes ANY Done-when clause claiming Web UI rendering/interaction/visual verification,
     the charter must state `inherited-core.md`'s "Web UI verification requirement" evidence rule
     explicitly in that clause's own text — a `curl` status check is never sufficient evidence for
     it (liveness/HARD-GATES only). See that section for the full mechanized rule.
   - the **in-scope gap subset only** (+ every OPEN blocking gap verbatim);
   - **binary Done-when clauses** (mandatory — §3.4; without them milestones drag, cf. exp1/exp4);
   - the **inner termination five conditions** (§3.2);
   - the **it0 systematic-explore checks** (next step);
   - a pinned pointer (path + git SHA) to `inherited-core.md` (Tier-B, not inlined).
4. **RUN EXECUTION PIPELINE** — for the batch assembled in step 1. The batch may be 1-wide (serial,
   existing behavior) or N-wide (concurrent, DIR-075/M142). The `/execute-milestone` workflow
   (`.claude/workflows/execute-milestone.js`, DIR-067, 2026-07-24) runs the full execution pipeline:
   Verify (5 it0 systematic-explore checks in parallel) → Build (class-route + inner iteration in
   isolated worktree) → Audit (adversarial fresh-context acceptance audit, write-back AC/DoD ticks
   per DIR-020) → Gate (7 mechanical absorb gates in parallel) → Land (merge into master).
   The workflow script IS the single source for the execution pipeline logic (ADR-004) — OUTER-LOOP
   references it, never re-derives the steps.

   **4a. Serial path (1-wide batch, or `mode` absent — backward-compatible default).** When the batch
   from step 1 has exactly one candidate, the existing serial path is preserved unchanged:
   a. Create the absorb-entry file: `touch /tmp/m<NN>-absorb-entry.md` and populate it with the
      ABSORB narrative header (milestone id, charter path, value hypothesis Δv̂ from step 2).
   b. Invoke `/execute-milestone` with `{taskId, charterFile, absorbEntryFile}`.
   c. On completion, the workflow returns `{outcome: 'done'|'needs-human', taskId}` and the Land
      phase handles dashboard update + milestone_counter++ inline (existing behavior).
   d. Watch with `/workflows`; completed phases are cached (resumable within the same session).

   **4b. Concurrent path (N-wide batch, N ≥ 2 — DIR-075/M142).** When the batch from step 1 has
   two or more candidates, concurrent dispatch + serial fan-in:
   a. **Dispatch.** For each candidate in the batch:
      - Create absorb-entry file `/tmp/m<NN>-absorb-entry.md` with ABSORB narrative header.
      - Dispatch `/execute-milestone` with `{taskId, charterFile, absorbEntryFile, mode: "concurrent"}`
        as a harness-tracked background task (`run_in_background: true`).
   b. **Wait for completion.** All N workflows run concurrently. The driver polls all N for
      completion — harness notifications are the primary wake; ScheduleWakeup fallback is
      hang-detection only, not a polling cadence (DIR-078).
   c. **Collect survivors.** When all N complete, collect those returning `{outcome: "done"}`
      (gate PASS + audit NO-REFUTATION). Gate-fail / REFUTED candidates → `needs-human`
      (existing path, unchanged — those worktrees are NOT merged).
   d. **Anti-drift guardrail (NON-WAIVABLE).** Run `node experiments/quay-perpetual-stream/scripts/
      anti-drift-touches-check.ts <ran-batch-manifest.json>` on the REAL `git diff --numstat`
      output from each survivor's build — actual files touched, not declared intent. A HARD FAIL
      aborts the ENTIRE batch (do not merge any survivor — a mis-declared overlap means the
      pre-flight orthogonality check has a bug or a charter was dishonest).
   e. **Fan-in plan.** Run `node experiments/quay-perpetual-stream/scripts/serial-fanin-absorb.ts
      --counter <current milestone_counter> <survivors-manifest.json>` for the deterministic
      merge plan (stable-sort by milestone id → reproducible). The plan assigns each survivor a
      sequential milestone number starting at `milestone_counter + 1`.
   f. **Merge.** Merge each survivor's worktree into `master` one at a time, in the plan order.
      Any conflict → per-file resolution, both sides read, reconciliation note recorded (DIR-013).
   g. **Dashboard + counter.** Append N dashboard entries via `renderDashboardAppend(plan)` from
      the fan-in plan. `milestone_counter += survivors.length`.
   h. **Regenerate views.** Run `experiments/quay-perpetual-stream/scripts/it0-backlog-regen.ts`
      to regenerate `backlog.md`/`dashboard.md` views.
   i. **Close-out hygiene.** Run `tree-hygiene-check.sh` + `worktree-branch-hygiene-check.sh`
      one final time to confirm the close-out is clean.
   j. **Execution provenance.** For each survivor, `task_write` to append `## Execution record`
      (milestone id, iteration count, realized Δv, merge commit SHA, one-line outcome summary)
      and set `status: done` on the task.
   The dispatch-record file `/tmp/m<NN>-dispatch-record.txt` is created by the workflow's
   Audit phase per the M90 procedure.

5. **CHECKPOINT (non-blocking)** if `milestone_counter % 5 == 0`: write `checkpoints/cp-<NN>.md` — a
   health snapshot across all tracks (including `dashboard.md`'s "Human-review cadence" track's
   current `milestones-since-last-human-directive` value, per `inherited-core.md`'s Human-review
   cadence rule) + a re-test of the standing hypothesis (§1). **Do NOT wait for a human.** After
   writing it, CONTINUE to the next milestone. The human reviews snapshots asynchronously.

   **5a. ROUTINE TRACK (DIR-051/056, wired 2026-07-24).** Invoke the saved workflow `/run-routines`
   (`.claude/workflows/run-routines.js`) with `{workspaceRoot, tasksDir, milestoneCounter}`.
   The workflow runs the full routine dispatch pipeline deterministically: Schedule (read
   `.quay/loop.yml` routines: → run `routine-scheduler.ts` → DUE list) → Dispatch (for each DUE
   probe: `readProbeSpec` → instrument availability check → dispatch fresh-context background
   agent) → Gate (each finding through `routine-file-gate.ts`: quality/dedup/rate — ACCEPT or
   REJECT) → Verify (FILE-ONLY invariant: `git status --porcelain` — no product/method code
   touched). Returns `{fired, filed, rejected, fileOnlyViolation}`. Watch with `/workflows`;
   completed phases are cached. Absent `routines:` = no-op (scheduler returns none due →
   workflow exits immediately). The workflow script IS the single source for the routine-track
   logic (ADR-004) — OUTER-LOOP references it, never re-derives the steps.

## The loop runs autonomously — it NEVER blocks waiting for a human
Human input is asynchronous (below). At **each milestone boundary** the loop checks the two — and
only two — stop signals:
1. **Human external HALT (async):** the human touches `experiments/quay-perpetual-stream/.halt` at any
   time. The loop detects it at the boundary and exits cleanly (the in-flight milestone finishes
   first, or is aborted if the human also flags it urgent). This is the human *actively stopping*, not
   the loop *waiting*.
2. **Internal exit signal (self-halt):** at a checkpoint, if VT slope < the pre-declared threshold with
   no worthwhile explore chart, OR the standing hypothesis is falsified (a milestone failed to
   converge):
   **2a. Chart-saturation pre-step (DIR-063, 2026-07-23).** Before emitting `HALT-RECOMMENDED` on a
   slope-only trigger, run `scripts/chart-saturation-check.ts` (DIR-063-A, M127) — the single-source
   saturation detector — with `--slope <rolling> --headroom $(node scripts/chart-headroom.ts) --counter <milestone_counter>`
   (headroom is mechanically extracted from dashboard by `scripts/chart-headroom.ts` (DIR-063 gap fix, 2026-07-24)
   — the single source for the `(chart-max − wired) / chart-max` formula; never re-derived in prose).
   If the detector emits `TRANSITION-DUE` (hysteresis-guarded: slope≈0 for K≥2 consecutive, headroom
   <10%, counter >growth-phase): replace the bare `HALT-RECOMMENDED` with `TRANSITION-RECOMMENDED`.
   Then escalate to a ONE-TIME subagent that drafts candidate value surfaces for the next chart (each
   must pass `scripts/chart-saturation-check.ts`'s anti-gaming guard — `headroom` computed from the
   proposed surface, not a hand-picked number). The human still ratifies. If the detector does NOT
   emit `TRANSITION-DUE`, emit the normal `HALT-RECOMMENDED` (the slope halt is genuine, not
   saturation). SUBAGENT-DRAFTING IS STRICTLY GATED BEHIND `TRANSITION-DUE` — never per-milestone,
   never unconditional per-checkpoint. This is the load-bearing anti-cost-explosion constraint.
   The standing hypothesis falsification path (milestone failed to converge) is unchanged — it still
   produces `HALT-RECOMMENDED` directly, no transition pre-step (saturation is a slope-only heuristic;
   a failed milestone is not saturation).
   **One mechanical HARD-halt input (DIR-038-A) — a checkpoint MUST compute and report it:**
   - **VT slope** = the ROLLING per-milestone slope over the last K≥5 milestones INCLUDING zero-Δv ones,
     from `scripts/rolling-slope-check.ts` (`windowSlope`/`haltVerdict`) — that module IS the single
     definition (DIR-038-A). The old "qualifying-only" denominator (mean of ONLY the nonzero
     capability-growth milestones) is RETIRED: it froze at 3.80 and structurally could not see a stall —
     16 consecutive zero-VT milestones (M34–M49) never tripped `< +1.0`, while the honest rolling slope
     over that region is ≈0. Report the rolling number (e.g. m29–m35 ≈ 0.64 per 5), never the 3.80
     artifact. Anti-gaming guard `honestNotInflated` FAILS-LOUD (exit 1) if the rolling slope exceeds
     the qualifying-only figure — a re-based ruler that scores the loop BETTER is presumptively gaming.
   **governance:product is NO LONGER a hard-halt input (DIR-066 supersedes DIR-038-B).** The
   `scripts/governance-product-ratio-check.ts` line ratio (`sumByClass`/`haltInput`) MAY still be computed
   and reported at a checkpoint as an **informational** metric, but a breach **does NOT trip
   `HALT-RECOMMENDED`** — the "loop building its own instruments while the product freezes" concern is now
   handled continuously and softly at SELECT (step 1, the Round-1 deliverable governor), not by a discrete
   checkpoint halt. Rationale (DIR-066): the line ratio has a fixed ~700-line/milestone process-prose tax
   that makes even a pristine product milestone read ≈55:1, so as a hard gate it is structurally
   unsatisfiable and fired at cp-120/cp-125 where the per-task deliverable signal reads healthy. The
   pure-soft `DELIVERABLE-STARVATION` signal (SELECT step 1) is the replacement surfacing — visible, never
   halting.

## Human async control surface (never blocks the loop — §4.7)
- **Steer:** `/quay-directive` (creates a `label:directive` task — task-canonical, DIR-028) or a `backlog.md` edit, any
  time → drained by the outer layer at the next milestone boundary (cycle step 0), never mid-milestone.
- **Stop:** `touch experiments/quay-perpetual-stream/.halt` → clean exit at next boundary.
- **Review:** read `checkpoints/` and `dashboard.md` any time — no interaction required.

**Lesson recorded (DIR-013 / M19-task-to-plan-docs-reconcile, 2026-07-18) —
concurrent human/loop edits to the same file.** A human-directed `proposal-to-plan`
design run and the autonomous M17 milestone independently edited the same doc
(`docs/proposals/exp5-quay-task-proposal-plan-skill.md`) at the same time on
`master`; the auto-resolved merge (`989e0cd`) took one side's body wholesale,
leaving dangling internal cross-references and a self-contradictory section
count that a "clean" (no textual conflict) merge did not catch. Two lessons,
recorded here (not enforced — no mechanism is built by this note):
1. **Prefer pausing the loop or working on a branch when a human is live-editing
   a file the loop will also touch.** A human steering the stream mid-session on
   a file the loop is concurrently authoring into should either `touch .halt`
   first, or the loop-side work should happen on a branch, rather than relying on
   git's auto-merge to reconcile independently-authored content in the same file.
2. **A merge must not claim "dispatch-ready" / "singular and unambiguous" without
   a post-merge cross-reference sweep.** If an appended section cites other
   section numbers (`§N`), the merge step (or the milestone that authored the
   appended section) must verify every such reference still resolves before
   declaring the result dispatch-ready — a textually-clean auto-merge is not
   evidence of a semantically-consistent one.

Whether to build a mechanical enforcement for lesson 2 (a proposal-internal
`§N`-reference-resolves check) is explicitly **left to a future milestone's
scoping** — this note only records the lesson; no check is built here.

## Chart transitions (§6.2)
When a chart saturates (all surfaces cov→1, VT→chart max) and value still exists, open a NEW chart:
add a surface or deepen a capability ceiling, record a numeric conversion factor old→new points.
This keeps VT globally unbounded and is what a well-chosen explore milestone does.
