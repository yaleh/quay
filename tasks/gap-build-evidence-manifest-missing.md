---
id: gap-build-evidence-manifest-missing
title: Build returns a verdict and sparse iteration metadata but no canonical,
  hash-bound evidence manifest for independent Audit
status: todo
labels:
  - gap
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

Add one versioned `BuildEvidenceManifest` shared by singleton and composite Build. The manifest is
a bounded, mechanically collected index of the candidate and its evidence:

```text
BuildEvidenceManifest {
  schemaVersion
  runIdentity
  baseCommit
  candidateCommit
  changedFiles[]
  testsRun[]
  testResults[]
  acEvidence[]
  runtimeEvidence[]
  deferredOrUnmet[]
  iterationArtifactRefs[]
}
```

It reduces Acceptance Audit's evidence-discovery cost and makes omissions visible without turning
the producer's verdict into truth. Task, charter, Proposal, and Plan remain authoritative; Audit
must verify referenced raw artifacts independently.

This is a narrow evidence-transfer task, not a Build/Audit redesign. It depends on
[[gap-build-phase-null-result-not-gated]], [[gap-build-phase-iteration-evidence-path-not-single-sourced]],
[[DIR-119-D2]], and [[DIR-124-B]]. [[DIR-124-C]] consumes the result through its Build adapter.

## Plan

N/A — resolve through a human-steered milestone after all named dependencies are done. The task is
not SELECTable before then because it must bind a real candidate commit, canonical artifact paths,
and the installed DIR-124-B receipt identity rather than inventing transitional duplicates.

## Finding

The current Build boundary communicates an outcome and limited iteration/commit metadata. Audit
therefore spends semantic-agent time rediscovering changed files, test commands, runtime evidence,
and deferred claims from prose and the working tree. More importantly, there is no single
machine-checkable place where an omitted AC evidence reference or missing iteration artifact is
visible before Audit begins.

The combined Prepare/Execute feedback proposal identifies this as the remaining evidence-transfer
gap between hash-bound stage receipts and independent review. A manifest is valuable only as an
index: accepting its conclusions without rechecking raw artifacts would collapse producer and
observer independence.

## Requested action

1. Define and schema-validate the canonical manifest above in one production module mirrored
   through the existing vendor-sync path.
2. Implement a deterministic post-Build collector for singleton and composite candidates. Derive
   Git fields and artifact existence mechanically; preserve agent-declared AC/runtime/deferred
   entries as attributed claims, not verified facts.
3. Resolve every iteration artifact through the canonical milestone-root resolver. Reject
   out-of-root, missing, duplicate, or candidate-mismatched references.
4. Hash-bind the manifest reference into DIR-124-B's Build `StageReceiptEnvelope`.
5. Make Acceptance Audit consume the manifest as a bounded index, then independently inspect raw
   diffs, commands/results, and runtime evidence. A manifest PASS field, if any, has no authority.
6. Add RED/GREEN fixtures for missing changed files, omitted failing tests, stale candidate commit,
   missing/out-of-root iteration evidence, fabricated runtime evidence, and a valid singleton and
   composite manifest.

## Acceptance Criteria

- [ ] Singleton and composite Build produce the same versioned manifest schema through real
  production callsites.
- [ ] `baseCommit`, `candidateCommit`, and `changedFiles` are mechanically derived and match Git;
  an agent-authored contradiction fails validation.
- [ ] Test/result, AC, runtime, deferred, and iteration entries identify their evidence source and
  distinguish mechanically observed facts from producer claims.
- [ ] Missing, duplicate, out-of-root, stale-candidate, or hash-mismatched artifact references fail
  closed with stable reason codes.
- [ ] The DIR-124-B Build receipt hash-binds exactly one manifest. Changing manifest bytes or
  candidate commit invalidates the receipt.
- [ ] Acceptance Audit demonstrably checks at least one referenced raw artifact and catches a
  deliberately false producer claim; it never treats the manifest's conclusion as sufficient.
- [ ] Task/charter/Proposal/Plan content is not copied into the manifest, and no second requirement
  authority is created.
- [ ] Canonical/plugin modules and tests are byte-identical and pass vendor-sync plus canonical
  test discovery.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] All four dependencies are done and their installed production paths are used, not duplicated.
- [ ] One real non-fixture milestone emits a manifest, a Build receipt bound to it, and an
  independent Audit that follows its references.
- [ ] A fresh audit verifies the production call graph, manifest/receipt hashes, canonical path
  resolution, and observer independence.

## Human verification when exp5 marks this task done

1. Does the manifest reduce evidence search without asking Audit to trust Build?
2. Can Build omit or fabricate a changed file, test failure, or runtime claim without detection?
3. Is there one manifest schema and one canonical artifact-root resolver?

## Touches

- `tasks/gap-build-evidence-manifest-missing.md`
- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*build-evidence*`
- `plugin/scripts/*build-evidence*`
- `experiments/quay-perpetual-stream/scripts/composite-build.ts`
- `plugin/scripts/composite-build.ts`
- `experiments/quay-perpetual-stream/test/*build-evidence*.test.mjs`
- `plugin/test/*build-evidence*.test.mjs`
- `docs/proposals/quay-prepare-execute-feedback-convergence.md`
