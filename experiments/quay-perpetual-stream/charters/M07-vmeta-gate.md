# Charter M07-vmeta-gate — Methodology-infra: track/alarm/gate the inner→outer V_meta hand-off (Tier-A)

**Milestone id:** M07-vmeta-gate · **surface:** none (methodology-infra, no VT weight — like M02-gates,
M-DIR-PROJECTION, M-SIZING) · **type:** explore
**Source:** DIR-005 (`experiments/quay-perpetual-stream/directives/pending/DIR-005-v-meta-consolidation-lag-tracked-and-gated-at-absorb.md`)
**Charter authored:** m6→m7 boundary, 2026-07-18, chart-1.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's current
HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis (recorded BEFORE dispatch, §4.1/§6.2)
- Value type (per M06-sizing's value-typed SELECT ledger, `inherited-core.md`): **governance-integrity**
  (primary) + **risk/option** (secondary) — same class of failure as DIR-002/DIR-006: an invariant
  ("confirmed insights get folded into `inherited-core.md`") with no mechanical enforcement, currently
  silently accumulating debt (3 known outstanding instances, one already past its own confirmation
  threshold).
- No VT Δv̂ — like M02-gates/M-DIR-PROJECTION/M-SIZING before it, this milestone builds outer-loop
  infrastructure, not a chart-0/chart-1 surface capability. Ranking justification is the value-typed
  ledger itself, not VT.
- Metric `Y`: binary Done-when completion (below), each independently pasted-evidence checkable.

## In-scope work (DIR-005's requested action, verbatim items 1-4, as 5 work items)
1. **Tracked ledger.** Create an explicit V_meta insight ledger (new file
   `experiments/quay-perpetual-stream/v-meta-ledger.md`, or a new section in `dashboard.md` — pick
   whichever fits better, record the choice), one row per insight: `insight | origin milestone |
   confirmation count | status {proposed|confirmed|consolidated}`. Migrate the 3 known outstanding
   items verbatim from DIR-005's Finding section:
   (a) m1's domain-audit-channel≡CI-job pattern + per-subcommand audit exercise — logged, not yet
   consolidated.
   (b) same pattern, CONFIRMED (m1 packaging + m3 cross-provider, past the φ 2-confirmation
   threshold) — not yet consolidated.
   (c) m3's repo-root isolation-leak lesson — noted, never applied.
2. **Health track + alarm.** Add a `V_meta consolidation lag` health track to `dashboard.md`'s health
   tracks section, symmetric to the existing discovery-latency track: for any ledger row past the φ
   confirmation threshold (2 cross-domain confirmations) but not `consolidated`, count
   milestones-since-confirmed; **alarm at >2 milestones (K=2)**.
3. **ABSORB gate.** Edit `OUTER-LOOP.md`'s ABSORB step: a milestone may NOT be marked DONE /
   increment `milestone_counter` while any `confirmed`-but-not-`consolidated` ledger row is past the
   alarm threshold. Resolve by EITHER consolidating into `inherited-core.md` at that ABSORB, OR
   recording an explicit DATED carry-forward reason in the ledger row (no silent deferral).
4. **First proof (the gate must actually bite).** Item (b) above — `CI-job≡audit-channel` — is
   ALREADY past threshold at charter-authoring time (confirmed m1+m3, m6 now complete = 0 milestones
   of slack already consumed by the time this milestone's own ABSORB happens at m7). **This
   milestone's own ABSORB (the very next one after this charter) must EITHER consolidate the pattern
   into `inherited-core.md` (pasted diff) OR record the new dated carry-forward reason** —
   demonstrating the gate fires on a real pre-existing case, not only hypothetical future ones. This
   is a hard requirement of Done-when 4 below, not optional.
5. **Explicit non-goal (do NOT do this):** do not add an exploration/reflection iteration back into
   the inner loop. The inner loop's build+verify specialization (2-iteration template) is retained
   unchanged — only the hand-off to outer V_meta absorption is instrumented and bounded.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape, verbatim from DIR-005)
1. `[ ]` The V_meta insight ledger exists with the 3 known outstanding items migrated in (status
   fields populated) — pasted diff.
2. `[ ]` `dashboard.md` gains a `V_meta consolidation lag` health track with the K=2 threshold
   written explicitly — pasted diff.
3. `[ ]` `OUTER-LOOP.md`'s ABSORB step contains the gate, referencing the ledger and the track —
   pasted diff.
4. `[ ]` First proof: the next ABSORB (this milestone's own) either consolidates the past-threshold
   `CI-job≡audit-channel` pattern into `inherited-core.md` (pasted diff) OR records a dated
   carry-forward reason — one of the two is verifiably present.
5. `[ ]` No code ⇒ no test run required; if any script is touched, full existing suite passes
   (pasted raw output).

Milestone is DONE when all five are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2–5 if they fire first (ΔV plateau K=2, ceiling, budget≈10 past with nothing
climbing, external HALT).

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch.

**Charter thinness ≠ agent prompt thinness.** The dispatched `baime:iteration-executor` prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before constructing the prompt) — never only a hash, or this reintroduces DIR-009 dilution. Worked
example of the resulting agent-facing prompt:
`experiments/quay-perpetual-stream/milestones/M06-sizing/proof-of-concept/M01-dist-dispatch-prompt-worked-example.md`.

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop · (4) budget≈10
backstop, past→default HALT · (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — not applicable (no VT/ceiling for methodology-infra milestones).
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch to
   confirm the pinned source hasn't drifted since this reference was recorded.
c. **Dogfooding evidence-gate** — Done-when clauses 1-4 all require pasted diffs/output.
d. **Domain-misfit audit-channel** — this milestone's own Done-when 4 IS the audit-channel proof: a
   real, pre-existing, past-threshold case the gate must correctly handle, not a hypothetical one.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher (see HARD GATES note above — the by-reference form
is charter-thinness only, not agent-prompt-thinness). Record each iteration under
`experiments/quay-perpetual-stream/milestones/M07-vmeta-gate/iterations/`. Worktree:
`experiments/quay-perpetual-stream/milestones/M07-vmeta-gate/worktrees/iteration-N`, branch
`exp5-m07-iteration-N`.
