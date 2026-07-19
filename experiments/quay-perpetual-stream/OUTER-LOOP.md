# OUTER-LOOP.md — quay-perpetual-stream (Experiment 5) driver

You are the **OUTER orchestrator** of a perpetual two-layer BAIME experiment. Execute this file.
It is intentionally thin: detail lives in the protocol; this is the operational loop. It **generates
per-milestone charters** — it is not itself a big per-iteration prompt.

## Pinned references (read once at session start)
- **Protocol (architecture, all §§):** `docs/proposals/quay-perpetual-stream-experiment-v5.md`
- **Offline calibration/evidence:** `experiments/offline-replay/RESULTS.md`
- **Dashboard (mutable outer state):** `experiments/quay-perpetual-stream/dashboard.md`
- **Backlog (milestone candidates):** `experiments/quay-perpetual-stream/backlog.md` — **generated
  view** as of M24-task-backlog-projection-impl (DIR-015 item 2 / m13 design doc §1/§13): the task
  store (`label: milestone-candidate` tasks) is canonical; `backlog.md`/`dashboard.md` are regenerated
  from it via `scripts/regenerate-backlog-views.mjs`, not hand-edited as the source of truth going
  forward. SELECT (step 1 below) reads the task store directly.
- **Inherited core (Tier-B methodology):** `experiments/quay-perpetual-stream/inherited-core.md`

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
   explore milestone per 5**. Exploit = high-value, high-ρ, method handles it; explore = new
   surface/domain that grows the reusable core. Prefer aged high-value items (DIR-004 Distribution is
   URGENT).
   **Write the selection back onto the task store as part of this step:** the chosen candidate task
   gets `milestone:M-NN` appended to its `labels` (via `task_write`) at dispatch time, and every OTHER
   candidate task actually considered this pass (i.e. compared against the winner, not the full
   unconsidered backlog) gets a short **not-selected note** appended to its body — e.g. a `## Not
   selected (M-NN)` section stating the pass number and one-line reason (aged-out, smaller Δv̂, wrong
   value type for this pass's explore/exploit slot, etc.). This makes the SELECT reasoning
   inspectable per-task instead of only living in a dashboard/checkpoint narrative.
   **Stamp `extra.schema:"v1"` + author `## Proposal` + `## Plan` at THIS step:** when writing the
   SELECTed task via `task_write`, set `extra.schema:"v1"` (without it the task reports N/A-legacy —
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
   `- [ ]`. Boxes go to `- [x]` ONLY at step 6, by the acceptance audit as it independently confirms
   each item — never here, never by the loop itself. Clause 0 HARD-blocks step 7's `milestone_counter++`
   on any missing/empty section OR any box left unchecked past the audit, but it CANNOT detect an
   improperly self-ticked box — so the who/when rule is discipline, not code. Checklist form is
   forward-only; pre-existing prose-form tasks are grandfathered.
   **Before dispatch, run `scripts/task-schema-check.sh tasks/<id>.md` against the SELECTed task; a
   FAIL blocks dispatch** (fix the task body, not the script — same discipline as the gate-hash /
   line-budget checks). This proves the schema was emitted by construction: `## Proposal` present,
   `## Plan` well-formed, AC/DoD as checklists, no empty/status-mirror `## Resolution`, no projection
   scaffolding, and the `extra.schema:"v1"` marker present (an `N/A legacy` line means the marker was
   forgotten above — add it and re-run).
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
4. **it0 SYSTEMATIC-EXPLORE CHECKS** (§4.4) — run the mechanized checks below, not just read about
   them (M02-gates milestone, `charters/M02-gates.md`):
   (a) **ceiling/floor arithmetic** — `scripts/it0-ceiling-check.sh <gap-id>...` against every
       gap/directive ID this milestone's charter cites as in-scope; non-zero exit or a CLOSED/
       NOT-FOUND result means the charter's scope is stale — re-derive before dispatch.
   (b) **gate-hash/transclusion** — `scripts/it0-gate-hash-check.sh <charter-file>` against the
       drafted charter; non-zero exit means an undeclared paraphrase of the pinned HARD GATES
       block — fix the charter text (not the script) before dispatch.
   (c) **dogfooding evidence-gate** — `scripts/it0-dogfood-evidence-gate.sh <iteration-report.md>
       [window]` against each inner iteration's report as it's produced; a FAIL means a claimed-met
       Done-when clause has no nearby pasted-output evidence — send back to the inner iteration
       before ABSORB, not silently accepted.
   (d) **domain-misfit audit-channel** — apply the decision procedure in `inherited-core.md`
       ("Domain-misfit audit-channel — concrete decision procedure") to this milestone's Done-when
       list; if Step 3 concludes no independent mechanism is reachable, that IS a §3.2 condition-3
       ceiling trigger — redesign the milestone's scope before dispatch, don't dispatch without an
       audit channel.
   (e) **plan-time line-budget gate** — `scripts/it0-ceiling-line-budget-check.sh <charter-file>`; a
       FLAG (exit 1) = scope exceeds the ~2000-line ceiling with no phase/stage plan reference. Same
       gate defined at step 1 (SPLIT-OR-COMMIT); this is its firing point against the drafted charter.
   Any check firing → fix before dispatch, per the procedures/scripts above (all under
   `experiments/quay-perpetual-stream/scripts/`).
5. **DISPATCH INNER** — run the milestone as a bounded BAIME experiment to convergence. **Per-
   iteration worktrees are created off `master` HEAD** (DIR-027 retired DIR-018's driver base point —
   the loop runs directly on `master`; the per-iteration worktree pattern itself —
   `milestones/M<NN>/worktrees/iteration-{0,1}`, each on its own branch, merged into `master` at
   ABSORB — is unchanged, only its base point is now `master` rather than the deleted driver branch).

   **5a. Class routing (DIR-014 items 2/3 — MANDATORY, not discretionary; the
   `quay-task-to-plan` skill now EXISTS, M20/M22, so its precondition is satisfied).** Before the
   implementation iteration, route by the milestone's CLASS (per `inherited-core.md`'s two-class
   diversity policy — keyed on the value-typed ledger):
   - **Development-class** (deliverable is working product/skill code; typically `capability-growth`-
     typed — the M16-CLI-EDIT-PARITY-IMPL precedent): the loop **MUST** run the proposal→plan pipeline
     FIRST — invoke the `quay-task-to-plan` skill on the milestone's grouped task(s):
     `/quay-task-to-plan <milestone-task-id>` (or the skill's `.claude/skills/quay-task-to-plan/`
     Steps directly). It runs **N independent blank-slate proposal subagents → adjudication (M13-
     style) → writes the reconciled proposal back to the task's `## Proposal` body (DIR-011 portable)
     → authors a milestone-level plan (`docs/plans/*.md`, referenced from the task's `## Plan` per
     Clause 8) → iterates a grounded convergent plan-check** (~2-3 rounds, Phase-5 stopping rule).
     THEN the implementation iteration (`baime:iteration-executor`) implements **against that checked
     plan**, gated per stage by the TDD ≥80% hard gate, with the existing downstream adversarial-audit
     gate (Clause 1) unchanged. The pipeline's N-independent-proposal step IS this class's upstream
     diversity — the whole-milestone iteration-1 re-derivation is NOT additionally run (independence
     is spent upstream at the proposal + downstream at the audit gate). This is **no longer a MAY**: a
     development-class milestone that skips the pipeline is a DoD violation (Clause 3's line-budget
     gate + Clause 8's plan-reference requirement both bite; see also DIR-014).
   - **Methodology/design-class** (deliverable is a design/methodology doc or substrate edit;
     typically `discovery`/`governance-integrity`-typed — the M10-M17 precedent): **UNCHANGED** —
     whole-milestone independent dual-iteration (iteration-0 builds, iteration-1 re-derives the whole
     deliverable from a fresh worktree), exactly as m1-m40. No pipeline invocation.

   Per iteration use `baime:iteration-executor` fed the charter (Tier-A) only (development-class:
   fed the charter AND the checked plan from 5a).
   Terminate on the first of (§3.2):
   Done-when complete | ΔV<0.02 both-layers K=2 consecutive | ceiling→redesign-OR-stop | past
   budget≈10 & nothing climbing | external HALT. Record under `milestones/M<NN>/`.
   **Waiting on a long inner iteration (background) — poll, don't conclude:**
   - The **completion notification is the primary wake** — dispatch as a harness-tracked background
     task so the loop is auto-re-invoked when the iteration finishes, at ANY duration. The build may
     run far longer than any timer; that is fine.
   - Any `ScheduleWakeup` fallback (~1200–1800 s) is a **hang-detection heartbeat, NOT a deadline.**
   - On a **fallback wake: poll the background task.** Still running → re-arm the fallback and keep
     waiting; do NOT absorb, do NOT advance to step 6/next milestone. Only proceed when the iteration
     has **genuinely completed** (Done-when / termination checked against real output).
   - If the iteration waits on **external state the harness can't track** (e.g. a GitHub Actions run),
     poll that system's status explicitly and match the fallback to its cadence — never conclude from
     the timer alone.
6. **ABSORB** — measure realized `Δv`, append to VT curve; compute calibration error
   `|Δv−Δv̂|/Δv̂`; update ρ (fraction executed with inherited method unchanged); append the milestone's
   adaptations to the log; check φ — if a prior adaptation was just reused unchanged by THIS
   (different-domain) milestone, **CONSOLIDATE**: merge it into `inherited-core.md` and retire the
   citation (§4.2).
   - **SPLIT-OR-COMMIT — two terminal outcomes ONLY, no partial/pending (DIR-026, inherited-core
     Clause 9):** once a milestone has started, at ABSORB it is in exactly ONE of two outcomes:
     (i) **`done`** — every AC/DoD clause satisfied (Clauses 0-8 below; a "partial" ABSORB with an
     unchecked AC box is HARD-blocked by Clause 0); OR (ii) **`needs-human`** — the task is set to the
     terminal `needs-human` lifecycle status with a recorded `OUTCOME: needs-human — <reason>` line in
     the ABSORB entry. **There is NO "shipped a slice, parent stays pending" outcome.** `needs-human`
     is legitimate **ONLY** for a factor OUTSIDE project control (external service/resource/credential/
     dataset/upstream); an IN-PROJECT reason (architecture mismatch, algorithm complexity, change
     volume, refactor scope, "too hard") is NOT valid and is a DoD violation — such work must be
     SPLIT smaller (step 1) and completed. `it0-dod-check.mjs` Clause 9 mechanically enforces the
     `needs-human` reason (in-project → FAIL; external → PASS); Clause 0 waives its unchecked-AC block
     only for a declared `needs-human`. A `needs-human` outcome does NOT advance `milestone_counter`
     as a completion — it is a tracked terminal failure the human reviews.
   - **Execution-provenance task write-back (M24-task-backlog-projection-impl, DIR-015 item 2 / m13
     design doc §10):** for the milestone-candidate task(s) just executed this pass — including any
     in-scope DIR-labeled task whose underlying directive this milestone resolved — `task_write` an
     appended `## Execution record` body section (milestone id, iteration(s), realized `Δv`, merge
     commit SHA(s), one-line outcome summary — the same shape as the backfilled tasks' `## Outcome`
     section) and set `status: done`. This is a DIFFERENT actor/time than the `milestone:M-NN`
     selection-label write in step 1 (SELECT). (Directives are now task-canonical with no anti-drift
     check — DIR-028; the milestone/backlog-projection check, where present, explicitly ignores
     `## Execution record` sections and `milestone:M-NN` labels when computing divergence, per M24
     Stage 1.2 — this write-back is expected content, not drift.)
   - **Per-milestone acceptance audit (UNCONDITIONAL, 2026-07-19 — supersedes the old conditional
     adversarial-audit trigger; HARD BLOCK on this milestone's VT-curve append / Done-when-complete
     claim AND on step 7's `milestone_counter++`):** EVERY milestone, with NO cadence precondition,
     dispatch a fresh-context adversarial audit subagent (`inherited-core.md`'s "Adversarial-audit
     role" — a fresh-context `baime:iteration-executor` call, `run_in_background=true`, dispatched by
     the OUTER loop itself, NEVER folded into the inner milestone's own iteration-1). Its explicit
     charge, in refute-first stance:
       1. **AC satisfaction:** read the milestone's TASK (`tasks/<task-id>.md`) `## Acceptance
          Criteria` section and, for EACH criterion, try to REFUTE that it is actually met — citing the
          concrete artifact / test output / diff that proves it, NOT the implementer's self-report. Any
          AC criterion it cannot confirm met ⇒ REFUTED.
       1a. **Checklist write-back (DIR-020/M34-ac-dod-checklist-writeback, 2026-07-19 — checklist-form
          tasks only):** as each AC/DoD item is confirmed in step 1, the audit WRITES BACK to the task
          file directly (a `task_write`-equivalent edit) ticking `- [x]` for that item, citing the
          supporting evidence in its own audit report (not in the tick itself) — leaving `- [ ]` for
          any item it cannot confirm. The audit is the **ONLY** writer that ticks boxes; SELECT (step
          1) always authors `- [ ]` and must never self-tick. A prose-form task (pre-existing, no
          checklist syntax) has no boxes to tick — this sub-step is a documented no-op for it, state so
          explicitly. Any AC box still `- [ ]` after this write-back is REFUTED-equivalent and HARD-
          blocks step 3's mechanical gate below, exactly as an unmet criterion does.
       1b. **Deviation-log write-back (DIR-017 Step 3/M36-dod-leakage-metrics, 2026-07-19).**
          **Single writer, no split**: this SAME dispatched audit subagent performs EVERY deviation-row
          write to `dashboard.md`'s "Homeostatic variables (DIR-017 Step 3)" table, at this SAME ABSORB,
          for BOTH row kinds below — there is no second, separately-timed edit by "the outer loop
          itself" as a distinct actor. The two kinds only differ in what the audit cites as `caught-by`:
          (i) `caught-by: machine` — the audit's OWN REFUTED/CONCERNS finding this same pass, meeting
          `inherited-core.md`'s "Deviation-record schema" section's "what qualifies as a deviation" test;
          (ii) `caught-by: human` — an ABSORB entry (already drafted by the outer loop before this audit
          sub-step runs, per step 6's own ordering) that self-discloses a process deviation or reports a
          human-authored directive's finding — the audit reads that already-written disclosure and
          transcribes it into the deviation table as evidence, it does not originate the finding. Mirrors
          sub-step 1a's write-back discipline exactly: one writer, one dispatch point, no new
          separately-scheduled process. This audit is ALSO responsible, at EVERY ABSORB it runs (not only
          the one where a row was created), for checking whether any existing `fixed`-status row has
          since accrued the external-verification evidence needed to promote it to `verified-eliminated`
          (mirrors the V_meta consolidation-lag gate's own every-ABSORB re-check discipline, step 6's
          second bullet below).
       2. **DoD satisfaction:** confirm the task's `## Definition of Done` (the standard five clauses +
          any task-specific extras) is satisfied for this milestone.
       3. **Mechanical gate green:** confirm `scripts/it0-dod-check.sh <task-id> <charter-file>
          <absorb-entry-file>` exited 0 (ALL clauses incl. clause 0 AC/DoD-present, which now also
          HARD-blocks on any remaining unchecked `- [ ]` box for checklist-form tasks). If it did not,
          the audit is REFUTED by construction.
     Output to `milestones/M<NN>/audits/iteration-N-acceptance-audit.md`, and state the verdict in the
     ABSORB log entry using one of the tokens **REFUTED** / **CONCERNS** / **NO REFUTATION FOUND** (so
     the DoD clause-1 documentation-discipline check sees a disposition). A **REFUTED** verdict is a
     HARD BLOCK: the VT append / Done-when-complete claim and step 7's `milestone_counter++` MUST NOT
     proceed until the underlying record is corrected and the audit re-run clears (same HARD BLOCK
     shape as the V_meta consolidation-lag gate below). **CONCERNS** is recorded, non-blocking. **NO
     REFUTATION FOUND** (no AC criterion refuted, DoD satisfied, mechanical gate green) clears it.
     This gate ALWAYS runs and ALWAYS records a verdict — there is NO documented-no-op case any more; a
     milestone can no longer avoid the audit by being non-VT. The former cadence-rule conditions (a)
     VT-scoring / (b) iteration-0 self-exemption are retained ONLY as escalation hints for how hard to
     push the refutation, never as a gate on WHETHER the audit runs.
   - **V_meta consolidation-lag gate (DIR-005 / M07-vmeta-gate, HARD BLOCK on step 7's
     `milestone_counter++`):** before this milestone may be marked DONE / `milestone_counter`
     incremented in step 7 below, check every row in `v-meta-ledger.md`. For each row whose status is
     `confirmed` (past the φ 2-cross-domain-confirmation threshold) but not yet `consolidated`,
     compute `milestones-since-confirmed = milestone_counter (current, pre-increment) − confirming
     milestone number (recorded in the row)`. If this exceeds the `dashboard.md` `V_meta
     consolidation lag` health track's alarm (**K=2**), step 7's `milestone_counter++` MUST NOT
     execute until the row is resolved by EITHER (a) consolidating the row's pattern into
     `inherited-core.md` at this ABSORB (pasted diff) OR (b) recording an explicit DATED
     carry-forward reason directly in the ledger row (no silent deferral — a missing/blank
     disposition is not a valid resolution). Update the row's status/notes in `v-meta-ledger.md`
     accordingly as part of this ABSORB step, before proceeding to step 7.
   - **Design-only-milestone impl-row gate (DIR-016/M21; HARD-BLOCKS step 7's `milestone_counter++`,
     same shape/placement as the V_meta + adversarial-audit gates).** Check logic + the design-only
     definition + the "row created ever, even if later SELECTed & DONE" semantics all live in
     `scripts/it0-impl-row-check.sh` (wrapped as `it0-dod-check.mjs` Clause 4): run
     `scripts/it0-impl-row-check.sh <milestone-id> backlog.md`; non-zero exit = the required selectable
     non-DONE `<M-NAME>-IMPL` row is missing → counter++ MUST NOT run until it exists and the re-run
     PASSes. **Rationale (uncoded):** prose-only deferral with no row is invalid — SELECT only sees
     non-DONE rows, so no row = deferred to never (DIR-016). Record the check's PASS/FAIL in this
     ABSORB's entry.
   - **DoD meta-enforcer gate — `quay gate <milestone-task>` (DIR-017/M25 + M32 + DIR-021/M38;
     HARD-BLOCKS step 7's `milestone_counter++`; operative since M38).** Runs AFTER the
     adversarial-audit, V_meta-lag, and impl-row gates individually clear and BEFORE the `master`
     merge + counter++. It does NOT replace them — it adds one standing check that the RECORD of all
     six DoD clauses + the Clause-5 no-self-exemption meta-clause is complete and undrifted. Check
     logic = `scripts/it0-dod-check.mjs` (Clauses 0–9, incl. Clause 3 line-budget, 6 escrow-Δv,
     7 product-work test-floor — see `inherited-core.md` for each clause's trigger); the QENG engine
     (`packages/quay/src/gate/`) is the operative wrapper. `quay gate` is the OPERATIVE invocation —
     NOT a bare `it0-dod-check.sh` call.
     - **Ordering + disposition authoring (DIR-021 — uncoded; the engine does NOT enforce this):**
       write the ABSORB-entry file (`/tmp/m<NN>-absorb-entry.md`) FIRST, carrying this milestone's
       real ABSORB narrative — the adversarial-audit verdict + V_meta-lag + line-budget/impl-row
       dispositions just produced. Clauses 1/2/6/7 only scan for those disposition TOKENS, they do
       not re-derive them — so un-authored dispositions pass silently unless you write them in. The
       `extra.acceptance` command references this FILE PATH, never ABSORB text baked in at SELECT
       (chicken/egg: the narrative is drafted live, mid-milestone).
     - **`extra.acceptance` convention:** `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
       <task-id> <charter-file> <absorb-entry-file>` — task-id (NOT milestone-id, per M37),
       repo-root-relative paths (runner cwd = workspaceRoot = repo root). Normally seeded once at
       SELECT (step 1) with the eventual `/tmp/m<NN>-absorb-entry.md` path, so this ABSORB-time step
       is a no-op re-confirm.
     - **Run + evidence:** `quay gate <milestone-task>` (exit 0 = PASS, 1 = FAIL; `milestone_counter++`
       MUST NOT run until it re-runs and exits 0). Then paste BOTH the literal `quay gate` stdout AND
       the raw `quay gate-log <milestone-task> --json` GateEvent array (not a paraphrase) into the
       ABSORB entry — evidence, mirroring the other gates' row-update discipline.
     - **M39 named gates (opt-in, NOT a required migration):** `quay gate <task> --gate impl-row|line-budget`
       (opt in via `extra.implRowArgs`/`lineBudgetArgs`) are thin wrappers over the SAME
       `it0-impl-row-check.sh`/`it0-ceiling-line-budget-check.sh` scripts (`registry.js`, no logic
       duplicated), each appending a named GateEvent. They do NOT replace the bare checks and are NOT
       mandatory — the bare `it0-*.sh` path stays the standing one.
     - **Lifecycle future path:** `quay complete <milestone-task>` (DIR-023, once adopted; precondition
       status=ready, runs the same acceptance gate, writes status=done on PASS) replaces today's
       standing `quay gate` + manual status/backlog update.
     - Line-budget (Clause 3) ALSO re-fires here as a drift check that plan-time's PASS still holds
       against the FINAL charter (see step 1 / step 4e). Smoke-test the wiring anytime:
       `quay gate QENG-5-DEMO-PASS` → 0, `quay gate QENG-5-DEMO-FAIL` → 1 (fixture tasks) — NOT a
       substitute for gating the REAL milestone.
   - **ABSORB lands the milestone's work on `master` directly (DIR-027 retired DIR-018's
     driver→master publish sub-step; runs AFTER the adversarial-audit, V_meta consolidation-lag,
     design-only-milestone impl-row, AND DoD meta-enforcer gates above all clear, and BEFORE step 7's
     `milestone_counter++`):** merge this milestone's iteration worktree/branch into `master` (the
     loop already works on `master` — there is no driver branch to publish FROM). Any conflict at
     this merge (e.g. two iteration branches, or a human private-worktree edit folded in) is subject
     to the same no-silent-drop reconciliation-note requirement (DIR-013/DIR-018 item 3, see step 0) —
     per-file resolution, both sides read, a reconciliation note recorded in this ABSORB's log entry,
     never a blanket `--ours`/`--theirs`. (The M18 race DIR-018 originally addressed is now handled by
     DIR-027's human-steering hygiene — pause `.halt` or use a private worktree off `master` — see
     step 0.)
7. **UPDATE DASHBOARD** — VT, slope (marginal Δv), ρ, charter-thickness, discovery-latency,
   calibration-error, `V_meta consolidation lag` (re-derive milestones-since-confirmed for every
   ledger row per `v-meta-ledger.md`), milestone_counter++ (only after the V_meta gate, the
   design-only-milestone impl-row gate, AND the DoD meta-enforcer gate above ALL clear, AND the
   ABSORB `master` merge sub-step above has landed the milestone's work on `master`).
   **`backlog.md`/`dashboard.md` regeneration (M24-task-backlog-projection-impl, design doc §13,
   applies forward from m24):** re-run `scripts/it0-backlog-regen.mjs` (generates the
   `backlog.md`/backlog-section-of-`dashboard.md` view from the live `milestone-candidate`-labeled
   task set, value-ordered by default with a `--sort=updated` recency alternate) as part of this
   step, paired with the status-change writes above — the same "glue regeneration to the exact
   action that changes the canonical source" discipline the M05 DIR-projection mechanism already
   uses (design doc §14 item 2), not a separate standing/CI-only check.
8. **CHECKPOINT (non-blocking)** if `milestone_counter % 5 == 0`: write `checkpoints/cp-<NN>.md` — a
   health snapshot across all tracks (including `dashboard.md`'s "Human-review cadence" track's
   current `milestones-since-last-human-directive` value, per `inherited-core.md`'s Human-review
   cadence rule) + a re-test of the standing hypothesis (§1). **Do NOT wait for a human.** After
   writing it, CONTINUE to the next milestone. The human reviews snapshots asynchronously.

## The loop runs autonomously — it NEVER blocks waiting for a human
Human input is asynchronous (below). At **each milestone boundary** the loop checks the two — and
only two — stop signals:
1. **Human external HALT (async):** the human touches `experiments/quay-perpetual-stream/.halt` at any
   time. The loop detects it at the boundary and exits cleanly (the in-flight milestone finishes
   first, or is aborted if the human also flags it urgent). This is the human *actively stopping*, not
   the loop *waiting*.
2. **Internal exit signal (self-halt):** at a checkpoint, if VT slope < the pre-declared threshold with
   no worthwhile explore chart, OR the standing hypothesis is falsified (a milestone failed to
   converge / degradation across tracks) → write the checkpoint flagged `HALT-RECOMMENDED` and stop,
   leaving it for async human review.

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
