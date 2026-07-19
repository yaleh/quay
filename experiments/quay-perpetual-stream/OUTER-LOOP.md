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
0. **DRAIN human inbox** — read `directives/pending/`. Disposition each directive → a `backlog.md`
   milestone candidate / a standing-rule amendment (`inherited-core.md` or `dashboard.md` control
   limits) / an out-of-cycle action (VT chart transition, HALT); then move it to `directives/archive/`.
   This is where async human steering (§4.7) enters — at the boundary, never mid-milestone. `/quay-directive`
   writes here.
   **Also run `task_list --label directive`** (native provider MCP tool, or
   `node packages/quay/bin/quay.js task list --label directive --json` equivalently) and
   **reconcile it against the files** (M-DIR-PROJECTION, DIR-002): every `label: directive` task
   found must correspond to a real `DIR-NNN.md` file (`pending/`, `archive/`, or `retracted/`), and
   each file's own `status:` line must agree with its task's `Status mirror:`/`extra.dirStatus`
   field. Run `experiments/quay-perpetual-stream/scripts/it0-dir-projection-check.sh` to do this
   mechanically rather than eyeballing the two lists — a non-zero exit means drift and must be
   resolved (regenerate the stale projection via `/quay-directive`'s projection step, or fix the
   underlying data) before the drain step is considered complete, not silently carried forward.
   **Master → driver merge sub-step (DIR-018 / M23-outer-driver-isolation, isolation discipline —
   runs BEFORE SELECT, as part of DRAIN):** the OUTER loop's own commit stream (charter authoring,
   per-iteration worktree base points, inner-merge conflict resolution) lives on the dedicated
   branch `exp5-outer-driver`, never directly on human-shared `master`. At this DRAIN step, before
   SELECT, deliberately fast-forward/merge `master` → `exp5-outer-driver`:
   `git checkout exp5-outer-driver && git merge master` (or fast-forward if `master` is a strict
   ancestor). This is the ONLY point at which human commits made directly to `master` (via
   `/quay-directive`, manual edits, or any other human-authored commit) enter the driver's own
   history — human steering merges in deliberately, at this named boundary, never by racing the
   loop for the same `master` mid-milestone.
   **No-silent-drop reconciliation-note requirement (standing instruction, applies to BOTH merge
   directions below — DIR-018 item 3):** any conflict encountered during this master→driver merge
   (or the driver→master publish merge at step 6/7 below) MUST be resolved **per-file**, reading
   both sides' actual content — **never** a blanket `git checkout --ours` / `git checkout --theirs`
   applied wholesale without reading both sides (this is the exact DIR-013 failure this rule exists
   to prevent: an auto-resolved merge that silently took one side's body wholesale and discarded the
   other side's content). For every file with a real conflict, record a short **reconciliation
   note** in this DRAIN step's log entry (or the ABSORB log entry, for the driver→master direction)
   stating: which file, what each side contained, which content was kept/merged and why. A missing
   or blank reconciliation note is not a valid resolution of a conflict — the note is mandatory
   whenever a real per-file conflict was resolved, mirroring the V_meta-lag/`-IMPL`-row gates'
   "no silent deferral" discipline. This is a documented convention, not a new script or
   pre-commit hook (per DIR-018's own "keep it minimal, not a heavy process" request) — the loop
   applies it by reading this text, the same way it already applies the gate-hash and line-budget
   checks' fix-the-charter (not the mechanism) discipline.
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
   **Author the task's AC + DoD at THIS (proposal) step — mandatory, the authoring half of DoD clause
   0 (`inherited-core.md`'s "AC/DoD live in the TASK" rule):** before dispatch, write two sections
   into the SELECTed candidate task's body via `task_write` (the task is the single canonical source
   of truth for both — do NOT put them in the charter, which only references them). **Authored as GFM
   checklists, UNCHECKED (DIR-020/M34-ac-dod-checklist-writeback, 2026-07-19):** each item is written
   as `- [ ]` — a milestone starts with NOTHING ticked at SELECT time. Boxes are ticked to `- [x]`
   ONLY later, by the per-milestone acceptance audit's write-back at step 6, as it independently
   confirms each item — never here, never by the loop itself (self-ticking at authoring time is
   exactly what this rule forbids). Pre-existing prose-form tasks are not retroactively converted;
   checklist form is required going forward.
   - `## Acceptance Criteria` — ≥1 concrete, individually-checkable criterion specific to this value
     unit (what was formerly the charter's "Binary Done-when", now authored into the task), each as an
     UNCHECKED `- [ ]` checklist item. Each criterion must name the artifact / test / observable
     output that would prove it met (so the per-milestone acceptance audit at step 6 can try to
     refute — and, if it cannot refute, tick — each one).
   - `## Definition of Done` — a REFERENCE to the standard five clauses in `inherited-core.md`'s
     "Definition of Done" section (never a copy), PLUS any task-specific extra done-conditions,
     likewise authored as UNCHECKED `- [ ]` checklist items where task-specific extras are listed.
   These MAY be revised while authoring the charter/plan, but the revision is made to the task's copy,
   never forked into the charter. `scripts/it0-dod-check.sh` clause 0 mechanically HARD-blocks step 7's
   `milestone_counter++` at ABSORB if either section is missing/empty/placeholder, OR (checklist-form
   AC) if any `- [ ]` box remains unchecked — so authoring them here is not optional, and leaving a box
   unticked past the audit's write-back is REFUTED-equivalent.
   **Size the candidate BEFORE dispatch** using `inherited-core.md`'s "Milestone size definition +
   verify-iteration size gauge" section: does the proposed scope let iteration-0 land ALL Done-when
   in one pass, with iteration-1 having real material to independently re-derive (not empty
   verification, not forced into new build work, no mid-milestone re-scope)? If not, split along a
   different seam or explicitly budget a multi-build milestone before authoring the charter — never
   carry an implicitly half-shipped value step forward.
   **Plan-time line-budget gate (M18-milestone-model-ceiling-and-diversity-policy, DIR-012 item 2 —
   mechanically-checkable, not narrative):** run
   `scripts/it0-ceiling-line-budget-check.sh <charter-file>` against the drafted charter BEFORE
   dispatch. This flags any charter whose scope plausibly exceeds the ~2000-line milestone ceiling
   (`inherited-core.md`'s "Milestone ceiling expansion" subsection) without a nested phase/stage plan
   — either an explicit `Line budget:`/`Phase`/`Stage` structure present in the charter text, or a
   `Plan:` line pointing at an external phase/stage plan document. A charter under the small-
   milestone norm (no declared line budget, or a declared budget ≤2000 WITH a phase/stage plan
   present) PASSES. A charter that declares (or whose in-scope-item count/shape plausibly implies)
   a budget above ~2000 lines with NO phase/stage plan reference FAILS/flags — fix by adding the
   phase/stage plan reference, or resize/split the candidate, before dispatch; same "fix the
   charter, not the script" discipline as the existing gate-hash check (Check 2 below).
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
   (e) **plan-time line-budget gate** (M18-milestone-model-ceiling-and-diversity-policy) —
       `scripts/it0-ceiling-line-budget-check.sh <charter-file>` against the drafted charter; a FLAG (exit 1)
       means the charter's scope plausibly exceeds the ~2000-line ceiling
       (`inherited-core.md`'s "Milestone-model ceiling" section) with no phase/stage plan
       reference — resize the charter or attach a phase/stage plan before dispatch, don't dispatch
       an unflagged oversized charter.
   Any check firing → fix before dispatch, per the procedures/scripts above (all under
   `experiments/quay-perpetual-stream/scripts/`).
5. **DISPATCH INNER** — run the milestone as a bounded BAIME experiment to convergence. **Per-
   iteration worktrees are created off `exp5-outer-driver` HEAD, not `master` HEAD** (DIR-018 /
   M23-outer-driver-isolation — the driver branch, kept current by step 0's master→driver merge, is
   the base point for every iteration worktree/branch this milestone dispatches; the per-iteration
   worktree pattern itself — `milestones/M<NN>/worktrees/iteration-{0,1}` — is unchanged, only its
   base point moved). Per iteration use `baime:iteration-executor` fed the charter (Tier-A) only.
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
   - **Execution-provenance task write-back (M24-task-backlog-projection-impl, DIR-015 item 2 / m13
     design doc §10):** for the milestone-candidate task(s) just executed this pass — including any
     in-scope DIR-labeled task whose underlying directive this milestone resolved — `task_write` an
     appended `## Execution record` body section (milestone id, iteration(s), realized `Δv`, merge
     commit SHA(s), one-line outcome summary — the same shape as the backfilled tasks' `## Outcome`
     section) and set `status: done`. This is a DIFFERENT actor/time than the `milestone:M-NN`
     selection-label write in step 1 (SELECT) and than the anti-drift checks' narrow status-mirror
     contract (`it0-dir-projection-check.mjs`/a future backlog-projection check both explicitly
     ignore `## Execution record` sections and `milestone:M-NN` labels when computing divergence, per
     M24 Stage 1.2 — this write-back is expected content, not drift).
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
   - **Design-only-milestone impl-row gate (DIR-016 / M21-impl-row-enforcement, HARD BLOCK on step
     7's `milestone_counter++`):** a milestone is **design-only** for this gate's purposes if EITHER
     its own `backlog.md` row text states "design delivered"/"design-doc only" (or equivalent), OR
     its deliverable includes a "Done-when clauses a future implementing milestone would need"
     section (or equivalently-named dispatch-ready follow-up checklist). If THIS milestone is
     design-only, its ABSORB **MUST** create a selectable, non-DONE `<M-NAME>-IMPL` candidate row in
     `backlog.md` — sourced to the design doc's own "Done-when clauses a future implementing
     milestone would need" checklist — **before** step 7's `milestone_counter++` may execute. Run
     `scripts/it0-impl-row-check.sh <milestone-id> backlog.md` as the mechanical check; a non-zero
     exit means the row is missing (or the milestone is design-only with no row yet) and
     `milestone_counter++` **MUST NOT** run until the row exists and the script re-run PASSes. This
     is the SAME HARD BLOCK shape and placement as the V_meta consolidation-lag gate immediately
     above and the adversarial-audit gate above that — deferring a design-only milestone's
     implementation as prose only, with no selectable row, is NOT a valid resolution of this gate,
     because SELECT (step 1) only considers non-DONE rows and a deferral with no row is a deferral
     to never (DIR-016's finding). Record the check's PASS/FAIL output directly in this ABSORB's log
     entry, mirroring the V_meta gate's row-update discipline.
   - **DoD meta-enforcer gate (DIR-017 / M25-dod-meta-enforcer Step 1 + M32-dod-escrow-testfloor
     Step 2 + DIR-021 / M38-dod-gate-operative-real-milestone, HARD BLOCK on step 7's
     `milestone_counter++`):** runs immediately AFTER the adversarial-audit gate, V_meta
     consolidation-lag gate, and design-only-milestone impl-row gate above all individually clear,
     and BEFORE the driver→master publish sub-step below. This gate does NOT replace any of the
     three individual gates above — each keeps its own HARD BLOCK text and evaluation as-is — it
     adds ONE more standing check that the RECORD of all six named DoD clauses
     (`inherited-core.md`'s "Definition of Done" section: Clause 1 adversarial-audit, Clause 2
     V_meta-lag, Clause 3 line-budget, Clause 4 impl-row, Clause 6 escrow-Δv, Clause 7 product-work
     test-floor) plus the Clause 5 no-self-exemption meta-clause is actually complete and undrifted
     for this milestone.

     **PRIMARY invocation — `quay gate <milestone-task>` (QENG-1 gate engine + QENG-2 acceptance
     meter; operative since DIR-021/M38, not merely designed):**
     1. Write the ABSORB-entry-excerpt file (the same `awk`/paste extraction pattern used since
        M25, e.g. `/tmp/m<NN>-absorb-entry.md`) FIRST — it must exist and contain this milestone's
        actual ABSORB narrative (the disposition text just produced by the three gates above)
        BEFORE the next step, or the check reads stale/missing content.
     2. Confirm (or seed, if this is the milestone's first ABSORB-time run) the milestone task's
        `extra.acceptance` via `quay task edit <milestone-task> --acceptance 'bash
        experiments/quay-perpetual-stream/scripts/it0-dod-check.sh <task-id> <charter-file>
        <absorb-entry-file-path>'` — the command references the FILE PATH written in step 1, task
        id (not milestone id, per the convention confirmed at M37 ABSORB), repo-root-relative paths
        (the acceptance runner's cwd = workspaceRoot = repo root). In practice this is normally
        seeded once at SELECT time (step 1) with the eventual absorb-entry file path already
        decided (e.g. `/tmp/m<NN>-absorb-entry.md`), so this ABSORB-time step is usually a
        no-op re-confirmation, not a re-seed — see DIR-021's chicken/egg resolution note below.
     3. Run **`quay gate <milestone-task>`** — this is the OPERATIVE invocation, not
        `it0-dod-check.sh` called bare. It runs the identical `it0-dod-check.sh <id> <charter>
        <absorb>` command under the hood (`it0-dod-check.sh` remains the underlying check logic;
        `quay gate` is the wired invocation path — QENG-1 gate engine + QENG-2 acceptance meter,
        default gate = `acceptance`), and additionally APPENDS a GateEvent (`verdict: pass|fail`,
        actor `quay-cli`, timestamp, reason) to the engine's gate-event log. Exit 0 = PASS, exit 1 =
        FAIL — the SAME HARD BLOCK shape/placement as the three gates this wraps:
        `milestone_counter++` **MUST NOT** run until `quay gate <milestone-task>` is re-run and
        exits 0.
     4. Confirm the GateEvent landed: `quay gate-log <milestone-task> --json` — paste the raw JSON
        array (not a paraphrase) into the ABSORB log entry.
     5. Paste BOTH the `quay gate` command's literal stdout (`PASS` or `FAIL — <reason>`) AND the
        `quay gate-log --json` GateEvent directly in this ABSORB's log entry, mirroring the V_meta
        gate's and impl-row gate's own row-update discipline — this replaces the bare
        `it0-dod-check.sh` stdout paste used at every prior milestone through M37.
     (`quay complete <milestone-task>` is the equivalent DIR-023-lifecycle-adoption invocation once
     that layer lands — precondition status=ready, runs the same acceptance gate, and on PASS writes
     status=done directly; until DIR-023 is adopted, `quay gate` + a separate manual status/backlog
     update is the standing path.)

     **Named `impl-row`/`line-budget` engine gates (DIR-022 Layer 2 phase 1 / M39, ADDITIONAL
     capability, not a required migration):** since M39, the design-only-milestone impl-row check
     (above) and the plan-time/ABSORB-time line-budget check (step 1 and the "Underlying check
     details" note above) are ALSO invokable as named `quay gate` engine gates —
     `quay gate <task> --gate impl-row` and `quay gate <task> --gate line-budget` — for any real
     milestone task that opts in by setting `task.extra.implRowArgs` (`["<milestone-id>",
     "<backlog-file>"]`) or `task.extra.lineBudgetArgs` (`["<charter-file>"]`) respectively. Both are
     thin wrappers over the SAME `it0-impl-row-check.sh` / `it0-ceiling-line-budget-check.sh` scripts
     already used above (`packages/quay/src/gate/registry.js`, no gate logic duplicated); each run
     appends a real GateEvent (`gate: "impl-row"` / `gate: "line-budget"`) queryable via
     `quay gate-log <task> --json`, the same as the `dod`/`acceptance` gates. **This does NOT replace
     the two mechanical checks above, and does NOT mandate migrating every milestone's ABSORB flow to
     the named gates** — the bare `it0-*.sh` invocations documented above remain the standing,
     unconditional path for every milestone; the named-gate path is an opt-in additional invocation
     surface a milestone may use if it wants a GateEvent record of that specific check (see the M39
     charter's explicit out-of-scope note).

     **Chicken/egg ABSORB-ordering note (DIR-021):** the `extra.acceptance` command's
     `<absorb-entry-file>` argument does not exist yet at SELECT time (the ABSORB narrative is
     drafted live, mid-milestone) — this is resolved by the command referencing a FILE PATH (never
     literal ABSORB text baked in at SELECT time), written immediately before `quay gate` is invoked
     per step 1 above. This mirrors the `/tmp/m<NN>-absorb-entry.md` extraction pattern already
     standing practice for every `it0-dod-check.sh` invocation since M25 (see dashboard.md's own
     ABSORB entries, e.g. `/tmp/m37-absorb-entry.md`) — DIR-021 did not invent a new pattern, it
     wired the SAME pattern through the engine instead of a bare shell call.

     **Underlying check details (unchanged by the engine wiring):** Line-budget, Clause 3, fires
     separately at plan-time per step 1 — `it0-dod-check.sh` re-checks the charter's own line-budget
     clause here too, at ABSORB, as a drift check that plan-time's PASS still holds against the
     FINAL charter text, but a plan-time FAIL on that clause alone is not this gate's primary
     trigger point. Clause 6 escrow-Δv fires only for design-only milestones claiming a nonzero Δv —
     see `inherited-core.md`'s Clause 6 for the exact trigger condition. Clause 7 product-work
     test-floor fires for milestones whose backlog row carries a product-touching `surface:` label
     (`surface:cli`/`surface:web-ui`/`surface:provider-abi`/`surface:mcp`, or no `surface:` label at
     all — fail-closed) — see `inherited-core.md`'s Clause 7 for the exact trigger condition and the
     non-product-touching exemptions (`surface:method-infra`/`surface:docs`/`surface:cross-cutting`/
     `surface:packaging`). Reproduce the pass/fail behavior end-to-end against the fixtures at any
     time: `quay gate QENG-5-DEMO-PASS` → exit 0; `quay gate QENG-5-DEMO-FAIL` → exit 1 (committed
     fixture tasks whose meters run this exact script) — these remain useful as a smoke test of the
     wiring itself, but are NOT a substitute for running `quay gate <milestone-task>` against the
     REAL milestone at its own ABSORB.
   - **Driver → master publish sub-step (DIR-018 / M23-outer-driver-isolation, HARD sequencing —
     runs AFTER the adversarial-audit gate, V_meta consolidation-lag gate, design-only-milestone
     impl-row gate, AND the DoD meta-enforcer gate above all clear, and BEFORE step 7's
     `milestone_counter++`):** this is
     the ONLY point at which the loop's own work (charter drafts, iteration worktrees/branches,
     inner-merge conflict resolution — all of which happened upstream on `exp5-outer-driver`) lands
     on `master`. Publish via a single, atomic, deliberate merge:
     `git checkout master && git merge --no-ff exp5-outer-driver` — exactly one `--no-ff` merge
     commit per milestone boundary, never a sequence of individual milestone commits interleaved
     directly onto `master`. This is what closes the M18 damage DIR-018 names (a human commit
     landing on `master` mid-milestone racing an in-progress loop merge index): because the loop
     never writes to `master` directly between boundaries, there is nothing for a human commit to
     race until this single publish point, and that point is itself gated behind the audit/consolidation-
     lag/impl-row/DoD-meta-enforcer HARD BLOCKs above. Any conflict at THIS merge is subject to the
     same no-silent-drop reconciliation-note requirement as the master→driver merge at step 0
     (DIR-018 item 3, see above) — per-file resolution, both sides read, a reconciliation note
     recorded in this ABSORB's log entry, never a blanket `--ours`/`--theirs`.
7. **UPDATE DASHBOARD** — VT, slope (marginal Δv), ρ, charter-thickness, discovery-latency,
   calibration-error, `V_meta consolidation lag` (re-derive milestones-since-confirmed for every
   ledger row per `v-meta-ledger.md`), milestone_counter++ (only after the V_meta gate, the
   design-only-milestone impl-row gate, AND the DoD meta-enforcer gate above ALL clear, AND the
   driver→master publish sub-step above has landed the milestone's work on `master`).
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
- **Steer:** `/quay-directive` (writes `directives/pending/DIR-NNN.md`) or a `backlog.md` edit, any
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
