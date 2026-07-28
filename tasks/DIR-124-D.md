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
- [ ] Before/after measurements show lower prompt bytes and duplicate-rule count; no migrated rule
  gains a second authoritative owner.
- [ ] DIR-118 remains an unimplemented policy extension, not a hidden branch in the registry.

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
