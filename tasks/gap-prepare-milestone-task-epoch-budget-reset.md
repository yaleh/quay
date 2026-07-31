---
id: gap-prepare-milestone-task-epoch-budget-reset
title: prepare-milestone budgets reset per workflow generation so repeated human
  repairs can bypass every convergence and cost cap
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

- [x] A durable epoch record accumulates attempts, full/delta reviews, content dispatches,
  observable agent time, terminal fingerprints, available tokens, overrides, and resets across
  multiple prepare-milestone workflow generations. Evidence: `.quay/prepare-epochs/<safeTaskIdSegment>.json`
  (`buildEpochRecord`/`_recordEpochDispatchCli` in `proposal-convergence.ts`); CLI round-trip test
  "--record-epoch-dispatch bootstraps a fresh epoch on first call ... then accumulates on a second
  call" and the real 2-generation DIR-126-D synthetic replay (`prepare-milestone-convergence.test.mjs`).
- [x] Editing Proposal, Plan, AC, or Touches content does not reset the epoch; fixtures prove all
  counters remain monotone after the same repair shapes used between DIR-126-D rounds. Evidence:
  "AC: editing Proposal/Plan/AC/Touches content does NOT reset the epoch" (real CLI test editing all
  four sections between two `--record-epoch-dispatch` calls, asserting monotone counters + unchanged
  epochId).
- [x] An authorized charter/scope or review-policy reset creates a new epoch, links it to the prior
  epoch, and records owner, reason, old/new identity hashes, and timestamp. Evidence: `--new-epoch`
  CLI mode (`_newEpochCli`); "AC: an authorized charter/scope reset creates a new epoch, links it to
  the prior epoch, and records owner/reason/old-new hashes/timestamp" (real CLI test).
- [x] A second identical terminal fingerprint or exhausted cumulative time/full-review cap returns
  human-decision-required before any additional content agent is dispatched. Evidence: `checkEpochCaps`
  pure-function tests (fingerprint/time/full-review boundaries) + workflow tests "a cumulative
  time-cap breach... stops BEFORE any content-agent dispatch", "a repeated-terminal-fingerprint...
  stops the NEXT generation before any content-agent dispatch", and "the full-review cap gates ONLY
  the full-review dispatch itself" — note the scoping actually built: each of the ~9 real
  content-agent dispatch sites (ProposalAuthors, Adjudicate, full review, each delta round, PlanAuthor,
  each PlanCheck round) is gated independently, at the moment it is about to run, against
  cumulative-so-far counters; the full-review cap specifically (`checkFullReviewCap`) is checked ONLY
  at the full-review dispatch site, so ProposalAuthors/Adjudicate can still run in a generation whose
  epoch has already exhausted its one-full-review allowance — this is the deliberate, "simple
  mechanical check at each real dispatch point" design the task's own note about the sibling task's
  round-1 REFUTATION argues for, not a lookahead/smart-classifier shortcut.
- [x] The cap-breach path releases a held Admission lease, writes final counters, and exposes only
  COMMIT, SPLIT, NEW-EPOCH, or bounded-override actions; a plain redispatch remains blocked. Evidence:
  `_epochBreachExit` (reuses the existing `_releaseLeaseAndRecord` choke point verbatim); all 4 new
  workflow-level epoch-breach tests assert `allowedActions` deep-equals
  `['COMMIT','SPLIT','NEW-EPOCH','OVERRIDE']`, `admissionReleases >= 1`, `epochDispatches >= 1`; the
  real DIR-126-D replay's generation 2 IS a plain cold redispatch and is blocked.
- [x] Ordinary and high-risk default-limit fixtures exercise the declared 90/150-minute ceilings;
  lower caller limits are honored and callers cannot silently raise policy maxima. Evidence:
  `checkEpochCaps` pure tests for the 89m/90m/120m/highRisk boundaries; CLI tests "a caller-lowered
  --ordinaryCapMinutes is honored... but a LATER call cannot silently raise it back" and "a caller
  CANNOT raise ordinaryCapMinutes above the compiled 90m default... on bootstrap" (both real CLI,
  asserting the persisted `policy.ordinaryCapMinutes` never exceeds `Math.min(prior, requested)`).
- [x] Missing token usage is reported as unknown while attempt, dispatch, and observable-time caps
  continue to work; no fabricated zero token value appears in the record or report. Evidence:
  `buildEpochRecord`'s `tokensObserved` defaults to `null` (never `0`); `--epoch-status`'s
  `tokenAccounting: "unknown"` field; test "missing tokensObserved (null) never affects any cap" and
  "tokensObserved is additive... never fabricated to 0 when the flag is simply absent".
- [x] One bounded override grants only its recorded additional allowance and cannot authorize a
  second override without a distinct human scope decision. **Revised after round-2 REFUTATION** (see
  Round 2 section below): an independent review found round 1's single safeguard (rejecting only a
  repeat of the MOST RECENT override) could be defeated by alternating between two canned
  (owner, reason) pairs, granting unbounded cumulative override minutes. Now enforced by TWO
  independent layers: a hard `maxOverrideCount` ceiling (the real boundary — no owner/reason text
  can talk past it) plus a strengthened distinctness check comparing against the FULL override
  history, not just the most recent entry. Evidence: `_overrideBudgetCli`'s `override-not-distinct`
  (any prior match, not just the last) and `override-count-cap-exceeded` (hard ceiling) codes; 3 new
  regression tests reproducing the exact exploit shape and confirming it's closed, plus the original
  "grants one bounded extension" test (unchanged, still passes).
- [x] Replaying DIR-126-D's attempt sequence stops at the configured human decision boundary well
  before eleven attempts and preserves enough evidence to explain exactly which cap fired. Evidence:
  two real-CLI-backed replay tests in `prepare-milestone-convergence.test.mjs` — the full-review-cap
  replay stops at attempt 2 (`epoch-full-review-cap-exceeded`), and the repeated-terminal-fingerprint
  replay stops at attempt 3 (`epoch-fingerprint-cap-exceeded`) — both read the real on-disk
  `.quay/prepare-epochs/*.json` record afterward to confirm the exact counters that caused the stop.
- [x] Existing Admission contention, stale-lease recovery, exact-terminal reuse, ProposalReview
  convergence, and successful prepared-path fixtures remain compatible in both mirrors. Evidence: full
  pre-existing suites re-run clean after this change — `prepare-milestone-convergence.test.mjs` 100/100
  (both mirrors, was 88/88 before this task), `prepare-milestone-preparation-e2e.test.mjs` 2/2,
  `proposal-convergence.test.mjs` 163/163, `prepare-admission-check.test.mjs` 83/83 (both mirrors);
  full `scripts/test.sh`: 770 tests, 764 pass, 3 fail (pre-existing `plugin-packaging.test.mjs`
  `tree-hygiene-check.sh` failures, confirmed via `git stash` to already fail on unmodified `master` —
  unrelated to this task, no file this task touches is referenced by that test), 3 skipped (live
  GitHub, expected without `QUAY_TEST_LIVE_GITHUB=1`).

## Round 2: independent review REFUTATION and fix (2026-07-31)

**Round 1** (implemented by a worktree-isolated subagent, commit `be0df6b1`) was sent for
independent adversarial review, given the high blast radius (this touches `prepare-milestone.js`'s
core Admission/dispatch control flow and is the safety circuit breaker for the whole Prepare
pipeline).

**Independent review verdict: REFUTED.** A real, reproduced exploit against `_overrideBudgetCli`
(`experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`): the "distinct owner+reason"
check compared a new override only against the MOST RECENT override on file, not the full history.
Alternating between two canned reason strings ("reason A"/"reason B"/"reason A"/...) defeated it
completely — reproduced live: 4 calls alternating between two strings, all 4 accepted, +240 minutes
of additional time budget granted with zero genuine new human scope decisions. Since override
minutes are summed with no independent ceiling, this let the cumulative observable-time cap (the
actual DIR-126-D-incident-closing mechanism) be extended indefinitely by anyone who can invoke the
CLI. The reviewer also flagged (CONCERNS-level, non-blocking) that the wiring-coverage-check
content-agent dispatch site had no epoch cap check immediately before it, unlike every other real
dispatch site in the file.

**Fix (by the orchestrating session directly, not delegated)**: two independent layers instead of
one text-based heuristic, applying the same lesson `gap-prepare-milestone-cross-generation-review-
state-reset`'s own round-1 REFUTATION already taught this batch of work (a fallible judgment call is
not a substitute for a hard mechanical bound):
1. A hard `maxOverrideCount` ceiling (3, in `DEFAULT_EPOCH_POLICY` + `prepare-milestone.js`'s inline
   mirror) — the real security boundary. No owner/reason text, however creative, can grant a 4th
   override once reached.
2. Strengthened distinctness: a new override is rejected if its (owner, reason) matches ANY prior
   override on the epoch's full history, not just the most recent one — closes the exact 2-string-
   alternation bypass on top of the hard ceiling.
Also closed the secondary CONCERNS finding: added the missing `_checkEpochCapsInline(false)` check
immediately before the wiring-coverage-check dispatch, matching every other content-agent call site
in the file.

**Verification**: 3 new regression tests directly reproduce the exploit (the exact alternating-
reason sequence, a full-history-distinctness probe, and a genuinely-distinct-reasons-still-hit-the-
hard-ceiling probe) and confirm all three fail closed. 1 new mechanical WIRING-CLAIM-style test
confirms the wiring-coverage-check dispatch is now immediately preceded by a real cap check. Found
and fixed one cross-check test needing an update (`DEFAULT_EPOCH_POLICY`'s new `maxOverrideCount`
field wasn't yet reflected in the existing mirror-drift cross-check's hardcoded expected literal).
Full suite after the fix: `proposal-convergence.test.mjs` + `prepare-milestone-convergence.test.mjs`
+ `prepare-milestone-preparation-e2e.test.mjs` + `prepare-admission-check.test.mjs` (both mirrors):
436/436, zero failures. Byte-identity re-confirmed on both touched mirror pairs (`cmp`, zero output).

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on master under human-steered discipline with a versioned policy and byte-identical
  canonical/plugin implementation mirrors. Round-2 fix verified (independent review's specific
  REFUTATION finding closed, confirmed via real reproduction of the exploit before and after).
  Byte-identical mirrors verified (`diff`/`cmp` zero output on both
  `.claude/workflows/prepare-milestone.js` <-> `plugin/workflows/prepare-milestone.js` and
  `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` <->
  `plugin/scripts/proposal-convergence.ts`) and the policy is versioned (`EPOCH_SCHEMA_VERSION`,
  `DEFAULT_EPOCH_POLICY`). Landed by the orchestrating session.
- [x] A real repeated-terminal preparation sequence reaches human-decision-required and a further
  generic redispatch is mechanically rejected with zero new content-agent work. Evidence: "DoD: a REAL
  repeated-terminal sequence (3 real generations, same terminal, real CLI-persisted fingerprint)..."
  in `prepare-milestone-convergence.test.mjs` — 3 real sequential workflow dispatches, real
  `--epoch-status`/`--record-epoch-dispatch` CLI calls (no mocked counters), generations 1-2 both
  independently reach a real fresh Preflight rejection (`preflight-rejected`), generation 3 (a plain
  cold redispatch, no special flags) is mechanically rejected at Admission
  (`epoch-fingerprint-cap-exceeded`) with `preflightContent`/`authors`/`adjudicator` all `0` — zero new
  content-agent work, confirmed against the real on-disk epoch record.
- [ ] A separately authorized real scope reset starts a new linked epoch and is independently
  audited against the old counters and decision record. PARTIALLY evidenced, left UNCHECKED: the
  `--new-epoch` CLI (real, tested end-to-end) produces a durable, inspectable `resets[]` entry
  (owner/reason/`fromEpochId`/old+new identity hashes/timestamp) that ANY later reviewer or tool can
  mechanically check against the prior epoch's own counters — but this session did not build a
  SEPARATE independent-audit tool/step that itself cross-verifies a reset's legitimacy (e.g. an
  out-of-band script comparing the resets ledger against real git history of the charter file); the
  test coverage asserts the record's own internal self-consistency, not an independent second-party
  audit of it. Whether the durable record alone satisfies "independently audited" is a judgment call
  for the reviewing session.

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
