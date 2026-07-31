---
id: DIR-124-D
title: Single-source milestone execution policy and subtract duplicate prompt
  and OUTER-LOOP control rules
status: todo
labels:
  - directive
  - human-steered
parent: DIR-124
children: []
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

## Proposal

Move stable task routing, required gates, test profiles, audit profiles, learning barriers, and
resource claims out of workflow prompts into one versioned execution-policy registry consumed by
the [[DIR-124-C]] kernel. Cut over production callers, then delete or reduce superseded
workflow/OUTER-LOOP representations.

This is a subtractive crystallization task. Creating a registry while retaining all old prompt
branches as independently maintained truth fails the directive.

## Plan

N/A — depends on DIR-124-C. Resolve profile-by-profile with golden replay and explicit deletion
receipts so each cutover has one authoritative owner throughout.

## Finding

The live Build prompt hard-codes a development/capability-growth class route. Required gates,
preparation behavior, testing rules, composite behavior, and learning/concurrency constraints are
distributed across workflow metadata, prompt paragraphs, OUTER-LOOP, inherited-core, task text, and
scripts. Some descriptions already disagree with execution.

This duplication raises both descriptive length and run-to-run instability. It also makes policy
changes deform orchestration code, preventing the kernel from remaining stable.

**Scope addition (2026-07-31, prompt-quality review of `prepare-milestone.js`/`execute-milestone.js`
during M208/M209 dispatch):** direct read of both live workflow files found two further concrete
instances of the same "duplication raises descriptive length and prevents one stable owner" class
this directive already targets, neither previously named in scope:

- **`meta.description`/`phases[].detail` as an unbounded changelog.** `prepare-milestone.js`'s
  `meta.description` is 1033 characters; roughly two-thirds is historical `STATUS (M<NN>/DIR-<NNN>):`
  prose appended once per landed change and never subtracted (`execute-milestone.js`'s own
  description, 601 characters, has the same shape). `phases[].detail` entries carry the same
  `DIR-126-A/M200:`-style source-commit prefix instead of a pure operational description. This field
  is the single most user-visible text the Workflow tool renders (task-notification summary,
  `/workflows` listing) and currently functions as an append-only history rather than a description.
- **`ProposalReview`'s single `agent()` call performs seven orthogonal jobs in one dispatch
  (~3300-character prompt):** substantive Proposal review, mechanism-claim wiring-coverage
  extraction (redundant with the already-separate `checkWiringCoverage()` sub-step this same phase
  also runs), DIR-125 typed-finding classification (six dispositions plus `rootCauseKey`/
  `repairable`), a typed mechanism-inventory extraction with anti-laundering `proofSurface`
  uniqueness, session-id capture, and clock capture. No other `agent()` call in either workflow
  combines more than two of these concerns; ProposalReview is the outlier.

Both are the same root cause this directive already targets (stable rules/roles distributed across
prompt prose instead of one executable or single-role owner) — extending this directive's scope,
rather than filing a new directive, keeps one authoritative place for "subtract duplicate workflow
prompt control text."

## Requested action

1. Define a versioned `ExecutionPolicy`/profile registry mapping task kind/class and candidate shape
   to preparation, Build, verification, Audit, Gate, learning/generation, and resource profiles.
2. Resolve policy once before stage execution and bind the selected policy version/hash into
   RunIdentity and every receipt.
3. Move required Gate selection and canonical test command/profile ownership into executable
   registry entries/adapters; do not fork `scripts/test.sh` or existing canonical gate logic.
4. Represent resource claims needed by DIR-124-E, including agent, CPU, memory, full-suite,
   browser/integration port, package-build, and integration-writer classes.
5. Add schema validation, unknown-kind fail-closed behavior, deterministic policy resolution, and
   compatibility profiles for intentional legacy singleton behavior.
6. Delete workflow inline branches and stale OUTER-LOOP claims after their profile cutover.
   Narrative driver text should point to executable policy rather than restate it.
7. Measure before/after prompt bytes, duplicate-rule count, policy-resolution variance, and change
   propagation radius.
8. Reserve an extension mechanism for DIR-118 wiring-required policy, but do not implement its
   post-Land audit or lifecycle semantics.
9. For each check/profile, record its required/optional status, earliest stage with complete
   inputs, blocking-policy calibration state, and false-positive evidence. A required invariant
   remains mandatory even when its recent blocking yield is zero.
10. Define the authorization path for a confirmed FindingEnvelope to move from task-specific to
    profile/global scope. The registry may carry an explicitly approved detector candidate and
    policy hash; it must not auto-enable global fail-closed behavior from one Audit finding.
11. Expose measured cost, blocking-yield, and false-positive-cost inputs for DIR-124-E ordering.
    Policy determines what must run; the scheduler may optimize when it runs, never whether a
    required invariant runs.
12. Replace `prepare-milestone.js`'s and `execute-milestone.js`'s `meta.description` with a
    concise (target: under 250 characters), purely operational summary in both mirrors; strip every
    `STATUS (M<NN>/DIR-<NNN>):`-shaped historical entry and every `phases[].detail` source-commit
    prefix. Migrate the removed history verbatim into a new `docs/references/workflow-changelog.md`
    (one dated section per workflow) so no information is discarded, only relocated to a place that
    is not the primary user-facing summary text.
13. Split `ProposalReview`'s round-0 full-review `agent()` call into narrower, single-purpose
    dispatches: retain substantive review + DIR-125 typed findings in the review agent; extract
    typed mechanism-inventory derivation into its own agent call (parallel to the already-separate
    `checkWiringCoverage()` sub-step); move clock capture (`date +%s%3N`) to a mechanical
    (non-content) command rather than a content-agent instruction. No dispatch introduced by this
    split may exceed roughly 2000 prompt characters or combine more than two orthogonal review
    responsibilities. Preserve the existing finding-ledger merge point (`_upsertFindings`) as the
    single place results from the split dispatches are combined.

## Acceptance Criteria

- [ ] One versioned registry is the production owner of task routing, required gates, test/audit
  profiles, learning barriers, and resource claims.
- [ ] Policy identity/hash is present in RunIdentity and receipts, and a policy change invalidates
  affected receipts deterministically.
- [ ] Unknown/ambiguous task kind, missing required profile, and incompatible composite policy each
  fail closed in RED/GREEN tests.
- [ ] The kernel and workflow shims contain no independently maintained copies of migrated policy.
- [ ] OUTER-LOOP and workflow metadata accurately point to the executable registry and no longer
  claim removed `building`, worktree, gate-count, or cache/resume behavior.
- [ ] Canonical test and gate logic is reused, not copied into policy data.
- [ ] Every registered check declares required/optional status, earliest complete-input stage, and
  calibration state; mutation tests prove a required zero-recent-hit check cannot be skipped.
- [ ] Finding promotion is versioned and authorized: one finding cannot silently activate a
  profile/global fail-closed detector, and an approved activation changes the policy hash and
  invalidates affected receipts.
- [ ] Cost/yield inputs are observable but cannot override safety ownership or required-check
  semantics.
- [ ] Before/after measurements show lower prompt bytes and duplicate-rule count; no migrated rule
  gains a second authoritative owner.
- [ ] DIR-118 remains an unimplemented policy extension, not a hidden branch in the registry.
- [ ] Both workflow mirrors' `meta.description` are each under 250 characters and contain zero
  `STATUS (M<NN>/DIR-<NNN>):`-shaped historical entries; `phases[].detail` entries contain zero
  source-commit prefixes; grep-confirmable in both `.claude/workflows/` and `plugin/workflows/`.
  `docs/references/workflow-changelog.md` contains every removed STATUS entry, attributable to its
  originating milestone/commit.
- [ ] `ProposalReview`'s round-0 dispatch is split so no single `agent()` call in either workflow
  combines substantive review, wiring-coverage extraction, typed mechanism-inventory derivation,
  and clock capture in one prompt; each split dispatch's prompt is under ~2000 characters
  (measured, not estimated). The existing `_deriveMechanismInventory()` validation and
  `_upsertFindings` merge point are reused unchanged, not reimplemented per-dispatch.

## Definition of Done

Standard exp5 DoD clauses apply.

- [ ] Real singleton, composite, failure, and learning-class replays resolve and execute the
  expected profiles.
- [ ] Mutation tests prove deleting or corrupting a required registry entry fails execution rather
  than falling back to stale prompt behavior.
- [ ] A source-of-truth audit finds one executable owner per migrated rule.
- [ ] Net subtraction is reported: added registry/validation mass versus deleted duplicate
  workflow/driver prose and branches.

## Human verification when exp5 marks this DIR done

1. Can a new task class be added without editing orchestration state-machine code?
2. Does changing a profile invalidate exactly the receipts whose semantics changed?
3. Were old prompt and OUTER-LOOP copies actually removed?
4. Is the canonical test/gate implementation still single-sourced?

## Touches

- `experiments/quay-perpetual-stream/scripts/*execution-policy*`
- `experiments/quay-perpetual-stream/scripts/*workflow-kernel*`
- `experiments/quay-perpetual-stream/test/*execution-policy*`
- `plugin/scripts/*execution-policy*`
- `plugin/scripts/*workflow-kernel*`
- `plugin/test/*execution-policy*`
- `.claude/workflows/execute-milestone.js`
- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
- `docs/references/workflow-changelog.md`
