---
id: gap-prepare-milestone-task-epoch-budget-reset
title: prepare-milestone budgets reset per workflow generation so repeated human
  repairs can bypass every convergence and cost cap
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

Add a cumulative preparation-epoch budget keyed by task, charter, and review-policy identity. The
budget survives ordinary Proposal/AC repairs and counts attempts, full reviews, delta reviews,
content-agent dispatches, elapsed agent work, repeated terminal fingerprints, and available token
usage across workflow generations. Crossing a limit produces a durable human-decision-required
terminal; another generic redispatch cannot reset or override it.

## Plan

N/A -- implement after or alongside cross-generation review continuation, but keep the budget
record and admission decision independently testable. Initial limits must be policy-configurable,
fail closed, and calibrated from DIR-125/DIR-126 evidence rather than hidden in prompts.

## Finding

DIR-125 provides a 45-minute ordinary and 75-minute high-risk soft budget plus finite delta rounds,
but both counters live inside one prepare-milestone invocation. When that invocation returns
needs-human or split-recommended, a caller can edit the task and start a new generation with fresh
counters. DIR-126-D consequently accumulated roughly five hours of wall time, 9.5M aggregate
subagent tokens, and eleven attempts while every individual generation remained within its local
policy.

Single-flight admission prevents overlap, not sequential retry accumulation. Generation-aware
resume avoids some repeated phases, not unlimited generations. DIR-126-D/E telemetry can improve
measurement after landing, but a safety circuit breaker cannot depend on the task currently being
prepared successfully landing its own telemetry first.

The epoch identity must therefore exclude ordinary Proposal wording/content hashes: using those
hashes as the budget key would let the edit that follows every needs-human result reset the budget.
A new epoch requires an explicit scope-reset decision tied to a changed charter, review policy, or
authorized scope declaration.

## Requested action

1. Add a durable preparation-epoch record keyed by task ID, charter hash, and review-policy hash,
   plus an explicit epoch ID. Record attempts, full semantic reviews, delta reviews, content-agent
   dispatch count, observable agent milliseconds, available token usage, terminal fingerprints,
   overrides, and scope-reset history.
2. Read and update the epoch record at Admission and every content-agent boundary. Ordinary task,
   Proposal, Plan, AC, or Touches edits do not create a new epoch by themselves.
3. Enforce policy-configurable cumulative caps. The initial high-risk defaults must admit no more
   than one full semantic review per unchanged scope epoch, two consecutive occurrences of one
   terminal fingerprint, and 150 cumulative observable agent-minutes before human intervention;
   ordinary defaults must be no looser than 90 minutes. Missing token accounting remains explicit
   unknown and cannot disable the dispatch/time/attempt caps.
4. On cap breach, release any held lease, persist the final counters, and return
   human-decision-required with allowed actions: COMMIT the reviewed scope, SPLIT it, declare a new
   charter/scope epoch, or issue one bounded override with owner and reason. Do not return a generic
   retry recommendation.
5. Bind overrides and resets to the prior epoch record. An override has a finite additional budget,
   cannot recursively authorize another override, and remains visible to later capacity reports.
6. Expose a read-only budget-status command suitable for pre-dispatch checks and later DIR-126-E
   aggregation. Its result must distinguish observed values, estimated values, and unknown fields.

## Acceptance Criteria

- [ ] A durable epoch record accumulates attempts, full/delta reviews, content dispatches,
  observable agent time, terminal fingerprints, available tokens, overrides, and resets across
  multiple prepare-milestone workflow generations.
- [ ] Editing Proposal, Plan, AC, or Touches content does not reset the epoch; fixtures prove all
  counters remain monotone after the same repair shapes used between DIR-126-D rounds.
- [ ] An authorized charter/scope or review-policy reset creates a new epoch, links it to the prior
  epoch, and records owner, reason, old/new identity hashes, and timestamp.
- [ ] A second identical terminal fingerprint or exhausted cumulative time/full-review cap returns
  human-decision-required before any additional content agent is dispatched.
- [ ] The cap-breach path releases a held Admission lease, writes final counters, and exposes only
  COMMIT, SPLIT, NEW-EPOCH, or bounded-override actions; a plain redispatch remains blocked.
- [ ] Ordinary and high-risk default-limit fixtures exercise the declared 90/150-minute ceilings;
  lower caller limits are honored and callers cannot silently raise policy maxima.
- [ ] Missing token usage is reported as unknown while attempt, dispatch, and observable-time caps
  continue to work; no fabricated zero token value appears in the record or report.
- [ ] One bounded override grants only its recorded additional allowance and cannot authorize a
  second override without a distinct human scope decision.
- [ ] Replaying DIR-126-D's attempt sequence stops at the configured human decision boundary well
  before eleven attempts and preserves enough evidence to explain exactly which cap fired.
- [ ] Existing Admission contention, stale-lease recovery, exact-terminal reuse, ProposalReview
  convergence, and successful prepared-path fixtures remain compatible in both mirrors.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on master under human-steered discipline with a versioned policy and byte-identical
  canonical/plugin implementation mirrors.
- [ ] A real repeated-terminal preparation sequence reaches human-decision-required and a further
  generic redispatch is mechanically rejected with zero new content-agent work.
- [ ] A separately authorized real scope reset starts a new linked epoch and is independently
  audited against the old counters and decision record.

## Human verification when exp5 marks this task done

1. Can changing one sentence reset the cumulative budget? It must not.
2. Does the circuit breaker stop before dispatching another expensive reviewer?
3. Are the only recovery paths explicit human decisions with durable reasons?
4. Are unknown token values honest without weakening the enforceable caps?

## Touches

- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/prepare-milestone-convergence.test.mjs
- plugin/test/prepare-milestone-preparation-e2e.test.mjs
