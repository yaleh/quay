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
   health snapshot across all tracks + a re-test of the standing hypothesis (§1). **Do NOT wait for a
   human.** After writing it, CONTINUE to the next milestone. The human reviews snapshots
   asynchronously.

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

## Chart transitions (§6.2)
When a chart saturates (all surfaces cov→1, VT→chart max) and value still exists, open a NEW chart:
add a surface or deepen a capability ceiling, record a numeric conversion factor old→new points.
This keeps VT globally unbounded and is what a well-chosen explore milestone does.
