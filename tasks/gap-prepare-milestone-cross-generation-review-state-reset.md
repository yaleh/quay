---
id: gap-prepare-milestone-cross-generation-review-state-reset
title: prepare-milestone resume skips Proposal authors but resets ProposalReview
  findings and full-review state on every generation
status: todo
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

- [ ] Every ProposalReview terminal, including split-recommended, delta-cap-exhausted, soft-budget-
  exceeded, and review failure after a valid ledger exists, writes a durable review checkpoint with
  all declared identity, hash, ledger, counter, terminal, and provenance fields.
- [ ] Corrupt, cross-task, stale-policy, and wrong-charter checkpoint fixtures fail closed with
  distinct reason codes and dispatch zero delta reviewers from untrusted state.
- [ ] A focused edit resolving one known finding carries all prior ledger entries forward and
  dispatches one delta reviewer over the patch plus unresolved findings; it dispatches zero full
  Proposal reviewers and zero Proposal authors/adjudicators.
- [ ] Wording-only edits preserve stable finding IDs and dispositions and do not reopen a completed
  mechanism/split decision.
- [ ] New mechanism, production touch-set, charter, and review-policy changes each start a new scope
  epoch with an explicit reset reason and exactly one admitted full review.
- [ ] The novelty scan catches a new wiring/mechanism claim introduced inside an otherwise focused
  repair and routes it to review instead of incorrectly preserving the old pass.
- [ ] Exact unchanged stable-terminal reuse remains compatible with DIR-126-C and consumes zero
  content agents; changed compatible repair selects delta continuation rather than terminal reuse.
- [ ] A replay shaped from DIR-126-D's eleven attempts performs at most one full semantic review for
  one unchanged charter epoch, carries later edits through delta review, and preserves the final
  ledger without eleven independent full reviews.
- [ ] Receipt/checkpoint tampering, mirror sync, lease release, zero-finding, and existing DIR-125/
  DIR-126-C regression suites remain green.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on master under human-steered discipline with canonical/plugin mirrors synchronized.
- [ ] A real human-repaired preparation attempt resumes from a prior non-success review checkpoint;
  journal evidence proves no full reviewer or Proposal author/adjudicator was redispatched.
- [ ] A real scope-change control proves the same mechanism does not incorrectly reuse stale review
  approval.

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
