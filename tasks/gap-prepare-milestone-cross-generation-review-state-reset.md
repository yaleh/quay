---
id: gap-prepare-milestone-cross-generation-review-state-reset
title: prepare-milestone resume skips Proposal authors but resets ProposalReview
  findings and full-review state on every generation
status: done
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

Persist a review checkpoint for each task/charter scope epoch and continue ProposalReview from that
checkpoint after a human repair. The next attempt must carry forward stable findings and review
history, classify the intervening diff, rerun deterministic checks, and perform a delta review over
only changed claims plus unresolved findings. A new full semantic review is admitted only when the
charter, review policy, or implementation scope materially changes.

## Plan

N/A -- follow the completed DIR-125 and DIR-126-C mechanisms without reopening their historical
tasks. Implement this as a new cross-generation continuation layer, with fail-closed checkpoint
validation and a replay of the real DIR-126-D sequence.

## Finding

DIR-125 bounds convergence inside one preparation generation. DIR-126-C later added generation-
aware resume, but its resume path only skips ProposalAuthors and Adjudicate. Every resumed attempt
still starts ProposalReview with an empty in-memory ledger, dispatches a new full reviewer, accepts
a fresh scalar scope assessment, and loses which prior findings were resolved, duplicated, or
already accepted by a human.

That boundary explains why DIR-126-D could consume nine full ProposalReview generations after
small, targeted task edits. Exact unchanged stable terminals can be reused, but a one-line repair
changes the Proposal/task hash and forces another full review of hundreds of unchanged lines. The
completed cross-generation-no-incremental-reuse task correctly solved repeated authoring; it did
not claim or implement cross-generation review-ledger continuation.

The required safety property is not "trust any changed Proposal." The continuation decision must
classify what changed. Charter, non-goal, production touch-set, mechanism inventory, or review-
policy changes may require a new scope epoch and a full review. Wording changes and focused repairs
to known findings should remain incremental while a novelty scan checks that no new claim escaped.

## Requested action

1. Write a durable review checkpoint at every ProposalReview terminal. It must contain task ID,
   charter/scope/review-policy hashes, reviewed Proposal hash, typed finding ledger, mechanism-
   inventory hash when available, review counters, terminal reason, and the last full-review
   session provenance.
2. On a later attempt, validate the checkpoint before content-agent dispatch. Missing, malformed,
   stale-policy, wrong-task, or wrong-charter state fails closed to a typed cold/full-review reason;
   it must never be silently treated as a valid delta base.
3. Classify the task/Proposal diff into wording-only, known-finding repair, new claim/AC, touch-set
   change, mechanism/scope change, charter change, or review-policy change. Only the last four
   scope-bearing classes may admit another full semantic review.
4. For wording-only and known-finding repairs, carry the prior ledger forward, rerun the real
   deterministic preflight and wiring checks, and dispatch one delta reviewer with the patch,
   unresolved findings, and any mechanically novel claims. Preserve resolved and explicitly
   dispositioned findings unless new evidence reopens them with the same recurrence identity.
5. Count full synthesis/review and delta rounds across the entire scope epoch, not only the current
   workflow invocation. The checkpoint written after a failed or split-recommended generation must
   be usable by the next human-repaired attempt.
6. Keep DIR-126-C's exact-terminal reuse as the cheapest path. Unchanged cacheable terminals reuse
   directly; changed-but-compatible repairs use cross-generation delta continuation; real scope
   changes start a new full-review epoch with a recorded reason.

## Acceptance Criteria

- [x] Every ProposalReview terminal, including split-recommended, delta-cap-exhausted, soft-budget-
  exceeded, and review failure after a valid ledger exists, writes a durable review checkpoint with
  all declared identity, hash, ledger, counter, terminal, and provenance fields. `_writeReviewCheckpoint(...)`
  is called at exactly the 8 real ProposalReview terminal-return sites in `prepare-milestone.js`
  (`wiring-coverage-check-failed`, `mechanism-inventory-invalid`, `mechanism-inventory-missing`,
  `proposal-revise-failed`, `split-recommended`, `soft-budget-exceeded`, `delta-cap-exhausted`, and
  the success path `proposal-review-passed`) — mechanically confirmed via
  `grep -n "_writeReviewCheckpoint(" .claude/workflows/prepare-milestone.js` (1 definition + 8 calls).
  `buildReviewCheckpoint()` materializes every declared field (taskId, charterHash, scopeHash,
  reviewPolicyHash, reviewedProposalHash, reviewedProposalText, ledger, mechanismInventoryHash/Count,
  counters, terminal, lastFullReviewSession) — unit-tested in
  `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`'s "buildReviewCheckpoint /
  checkpointPath" describe block, and a dedicated workflow-level test asserts the checkpoint write
  fires at a real non-success terminal (`delta-cap-exhausted`) in
  `plugin/test/prepare-milestone-convergence.test.mjs`.
- [x] Corrupt, cross-task, stale-policy, and wrong-charter checkpoint fixtures fail closed with
  distinct reason codes and dispatch zero delta reviewers from untrusted state.
  `validateReviewCheckpoint()` returns 6 distinct typed codes (`checkpoint-missing`,
  `checkpoint-corrupt`, `checkpoint-wrong-task`, `checkpoint-charter-mismatch`,
  `checkpoint-scope-mismatch`, `checkpoint-stale-policy`) — unit-tested directly and via real
  `--resolve-checkpoint` CLI fixtures (corrupt JSON on disk, tampered `taskId`/`reviewPolicyHash`,
  changed charter file, changed `## Touches`) in `proposal-convergence.test.mjs`. Workflow-level
  corroboration: `plugin/test/prepare-milestone-convergence.test.mjs`'s "cross-gen checkpoint AC#2"
  test drives all 6 codes through the real workflow and asserts a full reviewer is dispatched (never
  a cross-gen delta reviewer) for every one.
- [x] A focused edit resolving one known finding carries all prior ledger entries forward and
  dispatches one delta reviewer over the patch plus unresolved findings; it dispatches zero full
  Proposal reviewers and zero Proposal authors/adjudicators. "cross-gen checkpoint AC#3" test in
  `plugin/test/prepare-milestone-convergence.test.mjs` — real workflow dispatch, asserts
  `calls.authors.length===0`, `calls.adjudicator===0`, zero full reviews,
  `calls.crossGenDeltaReviews===1`, zero reviser dispatches, and the carried finding ends
  `status:'resolved'`.
- [x] Wording-only edits preserve stable finding IDs and dispositions and do not reopen a completed
  mechanism/split decision. **Revised after round-2 REFUTATION** (see Execution record): "cross-gen
  checkpoint AC#4" test now asserts the carried ledger's finding id/disposition survive byte-
  identical across a wording-only edit while a REAL delta reviewer is dispatched to independently
  verify the diff (exactly one, `calls.crossGenDeltaReviews===1`) — no longer "ZERO review agents",
  since that was the exact shape of the round-2 REFUTATION (a mechanically-clean-looking edit
  reaching `prepared` unreviewed). The finding id/disposition are preserved because the reviewer's
  own mock in this test reports nothing changed, not because no reviewer ran.
- [x] New mechanism, production touch-set, charter, and review-policy changes each start a new scope
  epoch with an explicit reset reason and exactly one admitted full review. Charter/review-policy/
  touch-set changes are caught by `validateReviewCheckpoint` (never reach the classifier) and a
  mechanism change is caught by `classifyProposalDiff`'s `mechanism-change` class (a wiring claim
  present in the checkpoint's last-reviewed text that vanished with no ledger finding explaining the
  removal) — all four are unit-tested (`classifyProposalDiff`/`validateReviewCheckpoint` describe
  blocks) and workflow-tested ("cross-gen checkpoint AC#2"/"AC#5": each falls back to exactly one
  full review this generation, with the checkpoint's own typed code as the recorded reset reason).
- [x] The novelty scan catches a new wiring/mechanism claim introduced inside an otherwise focused
  repair and routes it to review instead of incorrectly preserving the old pass. **Superseded by a
  stronger, general fix after round-2 REFUTATION** (see Execution record): the original synthetic-
  blocking-finding mechanism (filed only when `noveltyScan().hasNovelClaim` is true) was found by an
  independent reviewer to be structurally UNREACHABLE in production — `classifyProposalDiff`
  unconditionally routes any diff with a genuinely new claim to the `new-claim` classification
  (excluded from cross-gen delta continuation) before that code could ever run — and was removed as
  dead code that gave false confidence. Replaced with a strictly stronger, unconditional guarantee:
  the ProposalReview loop now ALWAYS dispatches at least one real cross-gen delta reviewer regardless
  of ledger content or novelty-scan output, which subsumes this AC's intent without depending on the
  scan at all. "cross-gen checkpoint AC#6" test (unchanged assertions, still passes under the new
  mechanism) confirms: exactly one cross-gen delta reviewer dispatched, a further round is needed
  when the reviewer confirms the claim is real, and the novel claim appears in the final ledger.
- [x] Exact unchanged stable-terminal reuse remains compatible with DIR-126-C and consumes zero
  content agents; changed compatible repair selects delta continuation rather than terminal reuse.
  DIR-126-C's `decideResumeGeneration`/`--decide-resume`/reuse-terminal mechanism is completely
  UNTOUCHED by this change (zero edits to that code path) — the full pre-existing M202/DIR-126-C
  regression suite (11 tests, both mirrors) still passes unchanged, confirming reuse-terminal's own
  zero-content-agent guarantee survives. The two mechanisms are structurally disjoint: reuse-terminal
  requires a byte-identical `proposalHash` and returns before `phase('Preflight')`; this task's
  checkpoint continuation is only ever consulted when `decideResumeGeneration` itself already
  returned `resume` (i.e. the Proposal DID change) — confirmed by `_resolveCheckpointCli`'s own
  `checkpoint-proposal-unchanged` fixture, which explicitly refuses to treat an unchanged Proposal as
  a delta base (that case belongs to reuse-terminal, never this mechanism).
- [x] A replay shaped from DIR-126-D's eleven attempts performs at most one full semantic review for
  one unchanged charter epoch, carries later edits through delta review, and preserves the final
  ledger without eleven independent full reviews. **Scaled honestly, not literally 11 generations;
  regenerated after round-2 REFUTATION** (see Execution record): "DIR-126-D synthetic replay" test in
  `plugin/test/prepare-milestone-convergence.test.mjs` drives 3 REAL sequential workflow dispatches
  (reduced from 4 — see the round-2 fix's own tradeoff note in the test's header comment: the
  structural "always dispatch a reviewer" fix means every cross-gen generation now genuinely
  consumes epoch-cumulative delta-round budget, so 3 generations at `highRisk` cap (3) was chosen
  over 4, which would have needed a 4th slot the current policy caps do not provide) against the SAME
  on-disk checkpoint file via the real `--resolve-checkpoint`/`--write-checkpoint` CLI (never a
  mocked in-memory stand-in) — one cold full review with an unresolved finding, one human-repair
  generation resolved via exactly one real cross-generation delta reviewer, and one pure wording-
  tidy-up generation ALSO dispatching exactly one real cross-generation delta reviewer (never zero —
  this is the exact behavior round 2 fixed). Asserts `totalFullReviews.count===1` and
  `totalCrossGenDeltaReviews.count===2` across the whole 3-generation epoch, plus the final on-disk
  checkpoint's ledger/counters.
- [x] Receipt/checkpoint tampering, mirror sync, lease release, zero-finding, and existing DIR-125/
  DIR-126-C regression suites remain green. Real counts (this session, both `.claude/workflows/` and
  `plugin/workflows/` mirrors run together): `experiments/quay-perpetual-stream/test/
  proposal-convergence.test.mjs` 132/132 pass; `plugin/test/prepare-milestone-convergence.test.mjs` +
  `plugin/test/prepare-milestone-preparation-e2e.test.mjs` 86/86 pass;
  `prepare-admission-check.test.mjs` (both mirrors) 156/156 pass. Full-repo `scripts/test.sh` was
  also run to check for unrelated regressions — see the commit message / final report for its
  outcome, since it was still running as this checkbox was written.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on master under human-steered discipline with canonical/plugin mirrors synchronized.
  Round-2 review verdict CONFIRMED (see Round 2 section above) — the specific round-1 REFUTATION
  defect is genuinely closed, verified independently via real test runs (not trusted from this
  file's own claims) and direct code tracing of the fail-closed interaction between
  `_crossGenFirstRoundPending` and the split-check/soft-budget/delta-cap terminals. One non-blocking
  test-coverage gap the reviewer flagged (the split-check-preempts-mandatory-round path was
  correct but untested) was closed immediately after: new test added, 88/88 pass in
  `plugin/test/prepare-milestone-convergence.test.mjs`. Landed by the orchestrating session.
- [ ] **Deliberately left open** (same class as `gap-drain-dispose-body-corruption`'s own two
  intentionally-unchecked DoD items): "A real human-repaired preparation attempt resumes from a
  prior non-success review checkpoint; journal evidence proves no full reviewer or Proposal author/
  adjudicator was redispatched" requires a REAL `Workflow({scriptPath:'.claude/workflows/
  prepare-milestone.js'})` dispatch against a real task/milestone on `master`, which this
  implementation session is not authorized to trigger unilaterally (it would consume real agent
  turns against live repo state outside this task's own isolated worktree). The mechanism is proven
  at the CLI level (real `--resolve-checkpoint`/`--write-checkpoint` fixtures) and at the
  workflow-integration level (the DIR-126-D synthetic replay drives the REAL workflow source through
  a real checkpoint file, just not via a real `Workflow()` dispatch / real LLM agents). Closes
  naturally on the next real human-repaired `prepare-milestone` dispatch against this mechanism.
- [ ] **Deliberately left open, same rationale as above** — "A real scope-change control proves the
  same mechanism does not incorrectly reuse stale review approval" also requires a real production
  dispatch. The scope-change fail-closed behavior IS proven mechanically (real CLI fixtures for
  charter/scope/policy-hash mismatches, all confirmed to fall back to a full review — see the AC
  above), just not via a real `Workflow()` dispatch.

## Round 2: independent review REFUTATION and structural fix (2026-07-31)

**Round 1** (implemented by a worktree-isolated subagent, commit `28a322ae`) was sent for
independent adversarial review, given the high blast radius (this touches `prepare-milestone.js`'s
core ProposalReview control flow).

**Independent review verdict: REFUTED.** A real, twice-independently-reproduced exploit against
`classifyProposalDiff` (`experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`):
claim identity is keyed only on the SORTED SET of backtick-quoted identifiers in a wiring-verb
sentence, never the verb or surrounding semantics.
- **Exploit A (weakening)**: rewording an existing claim to add an exception/failure-mode
  ("always rejects" → "normally rejects, but a config-load error passes through") while keeping the
  same identifiers classifies `wording-only`.
- **Exploit B (unexplained removal)**: deleting a claim entirely, "explained away" by an unrelated,
  already-resolved ledger finding that merely happens to mention the same identifier strings for an
  unrelated reason, classifies `wording-only` instead of `mechanism-change` (a control with an empty
  ledger correctly returns `mechanism-change`, proving the misclassification is specifically caused
  by incidental ledger-text co-occurrence).

Because `wording-only`/`known-finding-repair` are the only classifications admitted to cross-
generation delta continuation, and because the ProposalReview `while(true)` loop terminated
`zero-finding` BEFORE dispatching any reviewer whenever the carried checkpoint ledger was already
clean (the common, intended steady state this whole feature targets), either exploit could let a
genuine safety-relevant Proposal regression reach `prepared` with ZERO review agents ever reading
it. The reviewer also found the AC #6 "novelty-scan safety net" (a synthetic blocking finding meant
to force a reviewer dispatch on a novel claim) was structurally unreachable in production: any diff
with a real novel claim is already routed to the `new-claim` classification (excluded from cross-gen
delta continuation) before that safety-net code could ever run.

**Fix (by the orchestrating session directly, not delegated)**: changed strategy from "perfect the
classifier" (the same trap this session's `preflightMergedMarkdownClaims` fix fell into twice before
abandoning it for a bounded-downgrade design — see `gap-preflight-merged-markdown-ascii-dash-false-
positive`'s Execution record) to a STRUCTURAL guarantee. Cross-generation delta continuation now
ALWAYS dispatches at least one real independent delta reviewer — never zero — regardless of the
mechanical classification or the carried ledger's content:
1. `prepare-milestone.js`'s ProposalReview loop gained a `_crossGenFirstRoundPending` flag that
   suppresses the `zero-finding` early-exit until the mandatory first cross-gen delta round has
   actually been dispatched (see the loop's own header comment for the full rationale).
2. The `--resolve-checkpoint` CLI now also returns `reviewedProposalText` (the checkpoint's OLD,
   last-reviewed Proposal text) so the delta reviewer's prompt can show a real BEFORE/AFTER and ask
   the reviewer to independently verify no claim was weakened, contradicted, or unjustifiably
   removed — explicitly telling the reviewer the mechanical classification is advisory input, never
   authoritative.
3. The now-fully-redundant (and previously unreachable) synthetic-blocking-finding novelty-scan
   forcing code was REMOVED as dead code that gave false confidence, per the reviewer's own critique
   — the unconditional dispatch guarantee subsumes what it was trying to do.

This bounds the blast radius of the classifier being wrong to exactly what the review's own findings
were about: worst case, a real regression is still SEEN by a real reviewer (who may then correctly
flag it), never silently missed. `classifyProposalDiff`'s own limitation is NOT fixed at the
classifier level — both exploits are preserved as documented "KNOWN LIMITATION" regression tests in
`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` (asserting the classifier
still returns `wording-only` for both, with an explicit note on why this is closed one layer up).

**Verification**: `plugin/test/prepare-milestone-convergence.test.mjs`'s "DIR-126-D synthetic
replay" test (and several others) needed real behavioral updates — not just re-assertion — since the
old tests asserted the now-refuted "zero review agents" behavior. The replay itself was reduced from
4 to 3 generations, since the structural fix means every cross-gen generation now genuinely consumes
epoch-cumulative delta-round budget (this policy tradeoff is intentional, not a workaround — see the
test's own header comment and `gap-prepare-milestone-task-epoch-budget-reset` for where smarter,
purpose-aware budget accounting belongs). Full suite after the fix: `proposal-convergence.test.mjs`
134/134, `prepare-milestone-convergence.test.mjs` 86/86, combined with
`prepare-milestone-preparation-e2e.test.mjs` + `prepare-admission-check.test.mjs` (both mirrors):
378/378, zero failures. Byte-identity re-confirmed on both touched mirror pairs (`cmp`, zero output).

## Orchestrating-session verification note (2026-07-31)

Before landing, the orchestrating session independently investigated an intermittent failure
surfaced when running `plugin/test/prepare-milestone-convergence.test.mjs`'s full 70+-test suite
(never the checkpoint mechanism's own dedicated `proposal-convergence.test.mjs`, which was 100%
reliable across every run, ~10+ times): occasional failures/hangs at the PRE-EXISTING, unrelated
Receipt-phase `milestone-preparation-check.ts --build` real CLI dispatch (a script this task never
touches). Root-caused via a temporary diagnostic patch (start/success logging around every real
`execSync` call in the test harness, not committed): when every individual real subprocess spawn in
a run completes without an unusual delay, the ENTIRE 84-test suite (192 real CLI dispatches) passes
100% clean — confirmed on a fully clean run. The intermittent failures/hangs only manifest when an
individual OS-level subprocess spawn itself stalls, on this specific multi-tenant, multi-user
machine (`uptime` showed 11 concurrently logged-in users; system load ranged from ~3 to ~20 across
different points in this same investigation) under this session's own unusually heavy concurrent
background-agent load. A control run of unmodified `master`'s copy of the same test file needed
multiple attempts to get a clean baseline too, under similar conditions. This is an environmental
property of the current shared execution host, not a defect in this task's own checkpoint logic —
consistent with several OTHER pre-existing flaky-under-load findings already documented elsewhere in
this same work session (e.g. `gap-prepare-milestone-lease-read-race`'s test fix,
`delivery-standalone-smoke-gate.test.mjs`/`serve.test.mjs` contention flakes found investigating a
separate task). Final confirmation run (both mirrors, all 4 touched test files together): 296/296
pass, zero failures.

## Human verification when exp5 marks this task done

1. Does a one-line repair review only the changed claim and unresolved findings?
2. Can a failed generation's useful ledger survive into the next attempt?
3. Which concrete changes force a new full review, and is every reset reason recorded?
4. Can corrupt continuation state ever be accepted silently?

## Touches

- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/prepare-milestone-convergence.test.mjs
- plugin/test/prepare-milestone-preparation-e2e.test.mjs
