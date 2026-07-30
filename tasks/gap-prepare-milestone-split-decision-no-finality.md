---
id: gap-prepare-milestone-split-decision-no-finality
title: prepare-milestone split recommendations use an unstable scalar count and
  have no hash-bound human decision finality
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

Replace ProposalReview's ungrounded scalar mechanism count with a typed, stable mechanism
inventory, and persist an explicit human COMMIT-or-SPLIT decision against the reviewed scope. A
repairable mechanical finding cluster must get a bounded focused-revision opportunity before a
split recommendation becomes terminal. Once a human decision is recorded, later preparation
attempts may reopen it only after a declared scope epoch changes, not because another reviewer
counts the same call sites differently.

## Plan

N/A -- execute as a human-steered control-plane milestone. This changes the semantics of a
preparation stop decision and therefore requires golden replay of both legitimate split cases and
the observed DIR-126-D oscillation before production cutover.

## Finding

DIR-126-D/M203 ran prepare-milestone 11 times without reaching prepared: one Admission rejection,
one Preflight rejection, and nine ProposalReview split recommendations. Across the semantic review
runs, reviewers reported materially different mechanism counts for substantially the same scope,
including 8, 8, 4, and 6. The current task now explicitly describes two independently landable
mechanisms, while A.1-A.5 are required call-site variants of one complete terminal-write contract;
the scalar reviewer output still has no machine-readable basis for preserving that distinction.

The behavior follows directly from current code:

1. The full reviewer returns only a numeric mechanismCount; it does not return mechanism IDs,
   ownership, proof surfaces, dependency edges, or reasons each item can ship independently.
2. The split check treats any finite value greater than two as sufficient evidence for
   split-multi-mechanism.
3. Three blocking findings sharing a subsystem trigger split-subsystem-blocking-cluster even when
   they are multiple symptoms of one parser/root-cause defect.
4. The split check runs before the focused reviser/delta-review loop, so repairable wiring-format
   findings cannot converge inside the generation.
5. A human COMMIT decision is not stored as a hash-bound preparation artifact. The next full
   reviewer can reopen the same question with a different count and force another complete attempt.

This is not a request to weaken safety review or auto-accept a large task. It is a request to make
the split decision evidence-bearing, stable, and terminal until its actual scope changes.

## Requested action

1. Replace the scalar mechanismCount review result with a mechanism inventory. Every entry must
   carry a stable ID, production owner, proof surface, dependency set, independently-shippable
   boolean, and rationale. Derive the count from qualifying inventory entries rather than trusting
   a separately supplied integer.
2. Define one grouping rule: call-site variants required to satisfy one atomic behavior contract
   are one mechanism unless a strict subset can ship with independent user value and a complete
   safety contract. Add a fixture covering DIR-126-D's A.1-A.5 variants as one grouped mechanism.
3. Give blocking findings stable root-cause identities before applying the subsystem-cluster
   threshold. Multiple findings from one parser, sentence-boundary, or missing-AC root cause count
   once for split purposes while remaining individually visible in the ledger.
4. Allow one bounded focused revision before a repairable wiring/mechanical cluster can terminate
   as split-recommended. Immediate split remains valid for independently evidenced semantic scope
   clusters or safety boundaries that cannot be repaired without changing the charter.
5. Persist a split-decision artifact containing task ID, charter hash, scope hash, review-policy
   hash, mechanism-inventory hash, decision, reason, authorizing session, and timestamp. A COMMIT
   decision suppresses repeat split adjudication for the same hashes; a SPLIT decision prevents
   further content-agent dispatch until the split or an explicit scope reset occurs.
6. If independent reviewers produce incompatible inventories for the same hashes, return
   split-assessment-unstable and request one human decision. Do not turn disagreement into another
   automatic prepare-milestone redispatch.

## Acceptance Criteria

- [ ] ProposalReview returns a typed mechanism inventory with stable IDs, ownership, proof
  surfaces, dependencies, independently-shippable decisions, and rationale; the split count is
  mechanically derived from that inventory and no production branch trusts a bare reviewer integer.
- [ ] RED/GREEN fixtures classify DIR-126-D's A.1-A.5 terminal-write call-site variants as one
  atomic mechanism and its read-only report as a second mechanism; renaming or reordering entries
  does not change the inventory hash or count.
- [ ] A genuine three-mechanism fixture still produces split-multi-mechanism, with each counted
  mechanism independently shippable and backed by a distinct proof surface.
- [ ] Three wiring findings with one rootCauseKey remain three ledger entries but count as one
  independent split-cluster member; three independently rooted semantic blockers still trigger the
  subsystem split threshold.
- [ ] A repairable wiring cluster receives exactly one focused revision and delta review before a
  terminal split decision; a non-repairable safety/scope split fixture still stops immediately.
- [ ] A hash-bound human COMMIT decision causes a second attempt with unchanged task/charter/scope/
  policy hashes to skip split adjudication; a material scope change invalidates that decision and
  records the invalidation reason.
- [ ] A hash-bound human SPLIT decision dispatches zero new Proposal/Plan content agents until the
  task graph changes or an explicit authorized scope reset is recorded.
- [ ] Replaying the observed unstable count sequence 8 -> 8 -> 4 -> 6 returns one
  split-assessment-unstable human decision point, not four terminal generations.
- [ ] Existing zero-finding, legitimate split, receipt, lease-release, and fail-closed review tests
  remain green in both workflow mirrors.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on master under human-steered discipline with byte-identical workflow/script mirrors.
- [ ] A real preparation attempt consumes a recorded COMMIT or SPLIT decision and journal evidence
  confirms the same split question is not sent to another full reviewer.
- [ ] Independent audit confirms that decision finality is invalidated by real scope change but not
  by wording-only Proposal or AC edits.

## Human verification when exp5 marks this task done

1. Can the reviewer show which mechanisms it counted and why each can ship independently?
2. Can five required call sites of one atomic contract still be mislabeled as five mechanisms?
3. Does a human COMMIT or SPLIT decision actually prevent another identical adjudication?
4. Are legitimate safety and independently shippable scope splits still fail-closed?

## Touches

- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/prepare-milestone-convergence.test.mjs
