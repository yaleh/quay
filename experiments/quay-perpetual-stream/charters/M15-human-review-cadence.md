# Charter M15-human-review-cadence — institutionalize the human-review channel as a standing health track (Tier-A)

**Milestone id:** M15-human-review-cadence · **surface:** method infra (`dashboard.md`,
`inherited-core.md`, `OUTER-LOOP.md`) · **type:** explore
**Source:** `backlog.md`'s `M-HUMAN-REVIEW-CADENCE` row, DIR-001 item 6. Originally backlogged
("worth a recurring-cadence design once ≥2 more DIR-* instances exist to generalize from") — that
condition is now met: DIR-002 through DIR-011 (10 further instances since DIR-001) all exist,
archived under `directives/archive/`, giving a real 11-directive sample to generalize the cadence
design from instead of a speculative one.
**Charter authored:** m14→m15 boundary, 2026-07-18. **Checkpoint due:** `milestone_counter=15` per
the standing cadence (§4's checkpoint step) — write `checkpoints/cp-15.md` at this milestone's ABSORB,
non-blocking, per OUTER-LOOP.md step 8.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **discovery** (primary — DIR-001's
  own offline-validated finding is that every structural discovery in this stream's history came from
  the human-directive channel, never the simulated-user/persona channel; formalizing how that channel
  is tracked and surfaced is itself a discovery-instrument improvement) + **governance-integrity**
  (secondary — DIR-002/DIR-005/DIR-007's own pattern: an important invariant with no mechanical
  tracking eventually goes stale/invisible; this closes that gap for the human-review channel itself,
  mirroring M-VMETA-GATE's ledger+health-track shape).
- Δv̂: **zero direct VT points** — this is method infra (a health track + doc convention), not a
  capability-surface change. Mirrors M-GATES/M-DIR-PROJECTION/M-SIZING/M-VMETA-GATE's own zero-VT,
  governance-integrity-typed precedent (all DONE, all zero-VT, all method infra).
- Metric `Y`: none (no VT chart move). Success is: does `dashboard.md` gain a real, computed
  "Human-review cadence" health track (not just a doc description); does `inherited-core.md` state a
  concrete, citable rule an outer-loop pass can apply; is the rule explicitly non-blocking (per the
  standing invariant "the loop never blocks waiting for a human" — §4.7/OUTER-LOOP.md's own header).

## In-scope work
1. **Tally the real DIR-* history as the generalization dataset.** Read all 11 directives
   (`directives/archive/DIR-001*.md` through `DIR-011*.md`) and record, per directive: which
   milestone-count gap it arrived at (e.g. DIR-004 arrived pre-bootstrap / DIR-009-011 all arrived at
   the same m12→m13 boundary in one burst), whether it was human-initiated mid-conversation or a
   scheduled/requested check-in, and what kind of finding it carried (structural blind-spot, drift
   detected, routing decision, scope split). This is the concrete evidence base DIR-001 item 6 asks
   for ("once ≥2 more DIR-* instances exist to generalize from") — use it, don't re-assert the
   original DIR-001 finding without fresh support.
2. **Add a "Human-review cadence" health track to `dashboard.md`**, in the same section/style as the
   existing `V_meta consolidation lag` track (M-VMETA-GATE precedent): a computed
   `milestones-since-last-human-directive` number (derived from the tally above — the last directive
   arrived at the m12→m13 boundary, i.e. before m13; recompute at each ABSORB going forward), plus a
   stated soft-alarm threshold `K` (recommend reusing the existing checkpoint cadence, K=5, so the
   two tracks share one mental model) and **explicit non-blocking language** — this track is
   observational only, logged at each checkpoint, never a HARD BLOCK on `milestone_counter++` (unlike
   the V_meta consolidation-lag gate, which the loop's own invariants explicitly forbid this new track
   from mimicking, since directives are asynchronous/human-paced by nature, not a mechanically
   resolvable backlog item).
3. **Add a "Human-review cadence" section to `inherited-core.md`**, generalizing DIR-001 item 6's
   finding into a citable standing rule: state the real tally from item 1 as the evidence, state the
   soft-alarm threshold and its non-blocking nature, and state the one concrete behavior this induces
   in the outer loop — at each checkpoint (`milestone_counter % 5 == 0`), the checkpoint snapshot must
   include this track's current value, so a human skimming `checkpoints/cp-<NN>.md` async sees "N
   milestones since last human input" without needing to dig through `directives/archive/`.
4. **Wire the checkpoint step.** `OUTER-LOOP.md` step 8 (CHECKPOINT) must reference computing/logging
   this track — a small, precise edit to the existing step 8 bullet, not a new step. Confirm by
   re-reading step 8's text before and after.
5. **Do NOT add any blocking mechanism.** No change to step 0 (DRAIN) that could make the loop wait,
   pause, or require human acknowledgment — the existing DRAIN step is explicitly asynchronous
   already (reads whatever landed in `pending/`, proceeds regardless) and must stay that way. This
   milestone only makes the existing asynchrony **visible**, it does not change its blocking
   semantics.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` A tally of all 11 `directives/archive/DIR-*.md` files (arrival point, initiation mode,
   finding kind) is produced and pasted — the concrete evidence base for this milestone's design.
2. `[ ]` `dashboard.md` contains a new "Human-review cadence" health track with a real computed
   `milestones-since-last-human-directive` value (matching the tally in clause 1) and a stated K=5
   soft-alarm threshold — pasted diff.
3. `[ ]` `inherited-core.md` contains a new "Human-review cadence" section stating the rule, citing
   the real tally, and stating explicitly that this track is non-blocking (contrast with the V_meta
   consolidation-lag gate, which IS blocking) — pasted diff.
4. `[ ]` `OUTER-LOOP.md` step 8 (CHECKPOINT) is edited to reference this track — pasted before/after
   diff of the step 8 bullet only (no other step touched).
5. `[ ]` This milestone's own ABSORB, at `milestone_counter=15`, actually writes
   `checkpoints/cp-15.md` per the now-updated step 8 — the FIRST live proof-of-mechanism for this
   milestone's own deliverable, not deferred to a future checkpoint. Pasted file contents or diff.
6. `[ ]` No blocking/gating mechanism was introduced — confirm by re-reading OUTER-LOOP.md step 0
   (DRAIN) unchanged, and state explicitly that the new track carries no HARD BLOCK language anywhere
   it appears.
7. `[ ]` `backlog.md`'s `M-HUMAN-REVIEW-CADENCE` row is updated at ABSORB, marked DONE, pointing at
   the `dashboard.md`/`inherited-core.md`/`OUTER-LOOP.md` diffs — pasted diff.

Milestone is DONE when all seven are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2–5 if they fire first. Sized comparably to M-VMETA-GATE (m7) — a ledger/health-
track + doc-convention build, real code-adjacent editing (dashboard.md/inherited-core.md/
OUTER-LOOP.md, all markdown, no application code) but genuine independent-re-derivation material for
iteration-1 (the tally in item 1, the K-threshold reasoning, and whether the wording anywhere
accidentally implies a blocking behavior are all independently checkable, not empty verification).

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch.

**Charter thinness ≠ agent prompt thinness.** The dispatched `baime:iteration-executor` prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before constructing the prompt) — never only a hash, or this reintroduces DIR-009 dilution.

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive · (3) ceiling→redesign-OR-stop · (4) budget≈10 backstop, past→default HALT ·
(5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — N/A this milestone (zero VT points by design, stated above);
   confirm at it0 that no VT-chart claim is accidentally introduced.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires a pasted diff/tally/file content;
   no clause may be marked met on narrative alone. Clause 5 in particular requires LIVE proof (the
   checkpoint file this milestone's own ABSORB produces), not a description of what it would contain.
d. **Domain-misfit audit-channel** — this milestone edits three markdown method-infra files with no
   live external system and no product code. Consistent with M-SIZING/M-VMETA-GATE/M13/M14's own
   doc/method-infra-only precedent — record this explicitly rather than forcing a mismatched
   audit-channel citation.

## Adversarial-audit gate — NOT expected to trigger (state explicitly at ABSORB)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a capability-growth-
typed milestone with nonzero realized VT Δv appended at ABSORB — this milestone is typed
discovery+governance-integrity with Δv̂=0 by design, so condition (a) does not apply. Condition (b)
requires iteration-0 to recommend SKIPPING iteration-1 — this charter does not authorize that
(iteration-1 has real independent-re-derivation material per the sizing note above), so condition (b)
should also not fire absent an iteration-0 self-exemption; if it does, override per the m6/M13/M14
precedent, dispatch iteration-1 regardless, record the override explicitly.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher. Record each iteration under
`experiments/quay-perpetual-stream/milestones/M15-human-review-cadence/iterations/`. Worktree:
`experiments/quay-perpetual-stream/milestones/M15-human-review-cadence/worktrees/iteration-N`,
branch `exp5-m15-iteration-N`.

**No live external-system access required** — pure method-infra doc/markdown editing, reading this
repo's own `directives/archive/` history, `dashboard.md`, `inherited-core.md`, `OUTER-LOOP.md`.
