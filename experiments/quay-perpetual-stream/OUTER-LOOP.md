# OUTER-LOOP.md — quay-perpetual-stream (Experiment 5) driver

You are the **OUTER orchestrator** of a perpetual two-layer BAIME experiment. Execute this file.
It is intentionally thin: detail lives in the protocol; this is the operational loop. It **generates
per-milestone charters** — it is not itself a big per-iteration prompt.

## Pinned references (read once at session start)
- **Protocol (architecture, all §§):** `docs/proposals/quay-perpetual-stream-experiment-v5.md`
- **Offline calibration/evidence:** `experiments/offline-replay/RESULTS.md`
- **Dashboard (mutable outer state):** `experiments/quay-perpetual-stream/dashboard.md`
- **Backlog (milestone candidates):** `experiments/quay-perpetual-stream/backlog.md`
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
1. **SELECT** the next milestone from `backlog.md` per the explore/exploit policy (§4.5): **≥1 explore
   milestone per 5**. Exploit = high-value, high-ρ, method handles it; explore = new surface/domain
   that grows the reusable core. Prefer aged high-value items (DIR-004 Distribution is URGENT).
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
5. **DISPATCH INNER** — run the milestone as a bounded BAIME experiment to convergence. Per iteration
   use `baime:iteration-executor` fed the charter (Tier-A) only. Terminate on the first of (§3.2):
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
   - **Impl-row gate (DIR-016 / M21-impl-row-enforcement, HARD BLOCK on step 7's
     `milestone_counter++`):** before this milestone may be marked DONE / `milestone_counter`
     incremented in step 7 below, determine whether this milestone is **design-only** — its own
     `backlog.md` row states "design delivered" / "design-doc only", OR its deliverable includes a
     "Done-when clauses a future implementing milestone would need" section (or equivalent). If it
     IS design-only, this ABSORB **MUST** create a corresponding **selectable, non-DONE
     `<M-NAME>-IMPL` candidate row** in `backlog.md`, sourced to the design doc's own "Done-when
     clauses a future implementing milestone would need" checklist (or the nearest equivalent
     section), before `milestone_counter++` in step 7 may execute. Leaving the implementation
     follow-up as prose only (a "still requires a future SELECT" sentence with no row) does **NOT**
     satisfy this gate — it is the exact drop-through DIR-016 was filed to close. Run
     `scripts/it0-impl-row-check.sh <milestone-id> backlog.md` to verify mechanically rather than
     eyeballing the row; a non-zero exit means the row is missing or malformed and step 7 MUST NOT
     proceed until it is created and the check re-run clean. This is the same HARD BLOCK
     shape/placement as the V_meta consolidation-lag gate and the adversarial-audit gate below —
     unambiguously blocking, not advisory. If this milestone is NOT design-only (it shipped
     product/method-infra code, or is itself an `-IMPL` implementation of a prior design), this gate
     is a documented no-op: state plainly in the ABSORB log entry that the milestone is not
     design-only and why, rather than silently omitting the check.
   - **Adversarial-audit gate (DIR-007 / M10-audit-consolidation, HARD BLOCK on this milestone's VT-
     curve append / Done-when-complete claim — distinct from, and in addition to, the inner
     milestone's own iteration-1):** BEFORE this milestone's realized `Δv` is appended to the VT
     curve or its Done-when clauses are recorded as complete, check whether this milestone meets
     EITHER cadence-rule condition in `inherited-core.md`'s "Adversarial-audit cadence rule": (a) it
     is VT-scoring (its SELECT-time value-typed ledger entry includes `capability-growth` and its
     ABSORB would append a nonzero VT Δv), OR (b) its own iteration-0 recommended skipping
     iteration-1 (a self-exemption attempt). **If either fires**, dispatch the adversarial-audit role
     (`inherited-core.md`'s "Adversarial-audit role" section — a fresh-context `baime:iteration-
     executor` call, `run_in_background=true`, dispatched by the OUTER loop itself, NEVER folded
     into the inner milestone's own iteration-1) BEFORE this ABSORB step may complete. Output to
     `milestones/M<NN>/audits/iteration-N-adversarial-audit.md`. A **REFUTED** verdict blocks the VT
     append / Done-when-complete claim until the underlying record is corrected (same HARD BLOCK
     shape as the V_meta consolidation-lag gate below); a **CONCERNS** verdict is recorded but
     non-blocking; **NO REFUTATION FOUND** clears the gate. **If NEITHER condition fires** (the
     default case — methodology-infra/governance milestones with no VT weight, per the explicit
     non-blanket cadence rule), this gate is a documented no-op: state plainly in the ABSORB log
     entry that neither condition applied and why, rather than silently omitting the check.
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
7. **UPDATE DASHBOARD** — VT, slope (marginal Δv), ρ, charter-thickness, discovery-latency,
   calibration-error, `V_meta consolidation lag` (re-derive milestones-since-confirmed for every
   ledger row per `v-meta-ledger.md`), milestone_counter++ (only after the gate above clears).
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
