---
id: gap-execute-milestone-build-admission-and-verification-fuse
title: execute-milestone has no size-aware Build admission, bounded verification
  ladder, or repeated-test failure fuse
status: needs-human
labels:
  - gap
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  disposition: "retired-mechanism: ADR-022 已删机制前提证伪, outer A1-处置 2026-08-12 撤出候选池交人裁决"
---

**type:** execution

## Proposal

Add a deterministic `BuildAdmission` decision before `execute-milestone` dispatches its Build
agent, then enforce a bounded verification ladder and repeated-failure fuse during Build. Route
each candidate as S/M/L from logical implementation surface, proof cost, and verification risk;
bind the selected route to DIR-124-D's versioned execution policy rather than leave it as prompt
advice.

The production transition becomes:

```text
Verify
  -> BuildAdmission(size, proof, resources, planned evidence)
  -> Build(checkpoints, test ladder, repeated-failure fuse)
  -> BuildEvidenceGate (owned by gap-build-evidence-manifest-missing)
  -> Audit
```

This task owns admission and in-Build control. [[gap-build-evidence-manifest-missing]] consumes its
hash-bound `BuildAdmissionDecision`, reconciles planned versus actual evidence, and owns the
post-Build gate. Independent Audit remains unchanged and cannot be replaced by Build self-report.

Dependencies: [[DIR-124-A]] supplies canonical stage/test telemetry; [[DIR-123]] supplies isolated
worktrees; [[DIR-124-D]] supplies the single execution-policy registry; and
[[gap-build-phase-null-result-not-gated]] supplies the positive Build-result boundary this task
extends. DIR-124-D's own prerequisite chain remains authoritative and is not duplicated here.

## Plan

N/A -- execute as a human-steered milestone after all named dependencies are installed. First run
the policy in advisory mode on at least ten real `execute-milestone` Builds, then enable the
verification fuse and time ceilings only after replay confirms the route is deterministic and does
not weaken required acceptance coverage.

## Finding

The 2026-07-29 through 2026-07-31 Claude Code sample in
`docs/proposals/quay-execute-milestone-build-efficiency.md` measured six completed workflows plus
M207 in progress. Build consumed 65.0% of completed-workflow critical-path time (40.8-minute mean,
38.1-minute median). Only 2/6 completed runs were first-pass landable; REFUTED runs averaged about
133 minutes from workflow start to final Land versus about 64 minutes for first-pass runs.

M207's Build took 120.9 minutes. Shell/tool wait was 79.5 minutes, and eight full or near-full
suite runs consumed 70.6 minutes. The repeated work diagnosed a Touches-external smoke-test timing
failure, clean-tree behavior, load/concurrency effects, and orphan processes. The diagnosis was
grounded, but the live workflow had no rule to stop equivalent full-suite redispatch, require a
smallest reproducer, separate an out-of-scope repair, or force a coordinator decision as elapsed
Build time crossed 45, 60, and 90 minutes.

Existing tasks provide the required substrate but not this policy. DIR-124-A records stage and
full-suite events; DIR-124-D owns test/resource profiles; DIR-124-E bounds aggregate full-suite
concurrency; DIR-123 isolates Git state; and the Build evidence manifest indexes evidence. None
currently estimates the individual Build route, limits one Build's full-suite escalation, or
opens a fuse after repeated equivalent failures.

## Requested action

1. Define a versioned, deterministic `BuildAdmissionDecision` with at least:
   `mechanismCount`, mirror-collapsed `logicalTouchCount`, `proofScale`, `verificationRisk`,
   `tier`, `softBudgetMs`, `decisionCeilingMs`, `requiredEvidence[]`, `fullSuitePolicy`,
   `resourceClaims[]`, `splitCheckpoint`, policy identity/hash, and material input hashes.
2. Implement initial S/M/L routing from the measured proposal:
   - S: one mechanism, at most four logical source/test surfaces, local proof only;
   - M: two mechanisms or five to eight logical surfaces, or integration/workflow wiring;
   - L: more than two mechanisms, more than eight logical surfaces, or CLI/workflow/receiver
     traversal with real-workflow/cross-generation proof.
   L signals override lower-tier signals. Canonical/plugin mirrors count once; task, Plan, report,
   audit, and generated evidence prose do not inflate implementation surface.
3. Resolve the selected route through DIR-124-D's `ExecutionPolicy` registry and bind its version,
   hash, inputs, and decision to RunIdentity/receipts. Unknown or ambiguous scope/proof inputs fail
   closed or route conservatively to L; no workflow prompt carries a second authoritative copy.
4. Enforce the verification ladder:
   baseline affected tests -> narrow RED/GREEN fixture -> affected module/mirror suites -> relevant
   combined suites -> one final full suite when the policy requires it. A failed level must reduce
   to the smallest reproducer before escalation resumes; returning to a full suite is not itself a
   diagnosis step.
5. Normalize a test-failure fingerprint from test file, test name, exit class, and top stack frame.
   After two equivalent full-suite fingerprints in one Build, stop full-suite redispatch, run one
   focused reproducer, and persist the opened-fuse decision. A coordinator override is bounded,
   policy-authorized, and records owner/reason; it cannot silently reset the fingerprint count.
6. For a failure outside declared Touches, allow at most one clean isolated-worktree/environment
   reproduction. Record exactly one disposition: `caused-by-change`, `pre-existing`,
   `environmental`, or `unknown`. An out-of-Touches repair becomes a separate task unless it is a
   deterministic regression caused by the candidate and blocks required acceptance.
7. Emit and enforce Build checkpoints at 30/45/60/90 minutes. At 45 minutes record completed
   mechanisms, green evidence, remaining work, and dominant blocker. At 60 minutes require an
   independently deliverable split, external-failure disposition, or explicit L continuation. At
   90 minutes prohibit another full-suite retry and require a coordinator continue/split/stop
   decision. Time alone never forces a semantically invalid split.
8. Add milestone-scoped temp/fixture directories and a Build-owned process group that terminates
   descendant test/server processes on exit. Consume, rather than duplicate, DIR-124-E's
   full-suite/CPU/memory/port resource claims.
9. Roll out instrument-only, advisory, enforced-fuse, then adaptive-routing modes. Use DIR-124-A
   telemetry from at least ten real post-change Builds and at least three terminal shapes to report
   tier calibration, full-suite count, repeated fingerprints, Build p50/p90, first-pass landable
   rate, Audit refutation class, escaped regression, and rollback rate.

## Acceptance Criteria

- [ ] Both `execute-milestone` mirrors have a real production callsite that runs `BuildAdmission`
  after Verify and before every reachable singleton and composite Build path; source/import-graph
  inspection plus a real journal show the versioned decision and that no Build agent starts before
  it succeeds.
- [ ] Deterministic fixtures classify the measured S/M/L boundaries, mirror-collapse logical
  Touches, make L signals override lower tiers, and route missing/ambiguous inputs conservatively.
- [ ] DIR-124-D is the sole executable owner of tier thresholds, budgets, test profiles, and
  override policy; changing its hash invalidates affected admission decisions/receipts.
- [ ] The production Build runner enforces the five-level test ladder. A required full suite runs
  at most once after relevant suites are green unless a bounded, recorded override applies.
- [ ] Two equivalent full-suite failure fingerprints open the fuse before a third full-suite
  dispatch. Fixtures cover normalized volatile paths/timestamps, a genuinely different failure,
  malformed output, process interruption, and override exhaustion.
- [ ] A Touches-external failure receives no more than one isolated reproduction and exactly one
  typed disposition; a non-caused repair cannot be committed into the current candidate.
- [ ] Real or clock-controlled execution exercises the 30/45/60/90-minute checkpoints, including
  an explicit cohesive-L continuation and an independently deliverable split; elapsed time alone
  never silently discards required work.
- [ ] Build exit terminates its descendant process group and leaves no milestone temp directory,
  server, or test process able to alter a later Build's resource/timing observations.
- [ ] Existing required tests, gates, and independent Audit remain non-skippable. A mutation that
  lowers wall time by omitting required evidence or Audit fails acceptance.
- [ ] At least ten real advisory/enforced-mode Builds and three terminal shapes produce a
  reproducible calibration report from DIR-124-A events without private session JSONL.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] All named dependencies are done and their installed production contracts are consumed rather
  than reimplemented.
- [ ] One real Build opens the repeated-failure fuse and stops before a third equivalent full-suite
  dispatch; one real S/M/L sample each follows its selected route.
- [ ] The measured completed-run Build median, first-pass landable rate, full-suite p50/p90, Audit
  refutations, escaped regressions, and rollbacks are reported by tier; missing fields remain
  explicit unknowns.
- [ ] A fresh independent audit traces BuildAdmission, execution-policy resolution, test-runner
  enforcement, process cleanup, and fuse/override call paths in production.

## Human verification when exp5 marks this task done

1. Can one Build execute a third equivalent full-suite failure without a recorded override? It
   must not.
2. Does S/M/L routing reflect logical implementation and proof surface rather than charter length
   or generated mirror/prose volume?
3. Can an out-of-Touches environmental failure silently expand the current candidate?
4. Do time checkpoints force an explicit decision without forcing a bad split or weakening Audit?

## Touches

- `tasks/gap-execute-milestone-build-admission-and-verification-fuse.md`
- `docs/proposals/quay-execute-milestone-build-efficiency.md`
- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*build-admission*`
- `plugin/scripts/*build-admission*`
- `experiments/quay-perpetual-stream/scripts/*execution-policy*`
- `plugin/scripts/*execution-policy*`
- `experiments/quay-perpetual-stream/test/*build-admission*.test.mjs`
- `plugin/test/*build-admission*.test.mjs`
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
