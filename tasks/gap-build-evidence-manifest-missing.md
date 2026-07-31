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
  buildAdmissionRef
  baseCommit
  candidateCommit
  changedFiles[]
  testsRun[]
  testResults[]
  plannedAcEvidence[]
  acEvidence[]
  runtimeEvidence[]
  deferredOrUnmet[]
  iterationArtifactRefs[]
}
```

Before editing, BuildAdmission creates the hash-bound planned evidence rows. After Build, the
collector reconciles every planned row with actual commands/artifacts and a final disposition. A
mechanical `BuildEvidenceGate` rejects structurally incomplete or evidence-class-incompatible
manifests before Audit. This reduces Acceptance Audit's evidence-discovery cost and makes omissions
visible without turning the producer's verdict into truth. Task, charter, Proposal, and Plan remain
authoritative; Audit must verify referenced raw artifacts independently.

This is a narrow evidence-transfer task, not a Build/Audit redesign. It depends on
[[gap-build-phase-null-result-not-gated]], [[gap-build-phase-iteration-evidence-path-not-single-sourced]],
[[DIR-119-D2]], [[DIR-124-B]], and
[[gap-execute-milestone-build-admission-and-verification-fuse]]. [[DIR-124-C]] consumes the result
through its Build adapter.

## Plan

N/A — resolve through a human-steered milestone after all named dependencies are done. The task is
not SELECTable before then because it must bind a real candidate commit, canonical artifact paths,
and the installed DIR-124-B receipt identity rather than inventing transitional duplicates.

## Finding

The current Build boundary communicates an outcome and limited iteration/commit metadata. Audit
therefore spends semantic-agent time rediscovering changed files, test commands, runtime evidence,
and deferred claims from prose and the working tree. More importantly, there is no single
machine-checkable place where an omitted AC evidence reference, a weaker-than-required evidence
class, or a missing iteration artifact is visible before Audit begins. A post-hoc index alone is
insufficient: without a pre-Build plan and a mechanical pre-Audit gate, M203's static-call-count
evidence could again be presented for clauses that require real workflow journals after broad
tests have already consumed most of Build.

The combined Prepare/Execute feedback proposal identifies this as the remaining evidence-transfer
gap between hash-bound stage receipts and independent review. A manifest is valuable only as an
index: accepting its conclusions without rechecking raw artifacts would collapse producer and
observer independence.

## Requested action

1. Define and schema-validate the canonical manifest above in one production module mirrored
   through the existing vendor-sync path.
2. Consume exactly one hash-bound `BuildAdmissionDecision` from
   [[gap-execute-milestone-build-admission-and-verification-fuse]]. Materialize one planned row per
   charter AC before editing, with required evidence class (`source`, `unit`, `integration`,
   `real-workflow`, or `cross-generation`) and the intended command/artifact; never copy the AC text
   into a second authority.
3. Implement a deterministic post-Build collector for singleton and composite candidates. Derive
   Git fields and artifact existence mechanically; reconcile every planned row with actual
   commands/artifacts and `satisfied|deferred|unmet|superseded` disposition; preserve
   agent-declared AC/runtime/deferred entries as attributed claims, not verified facts.
4. Resolve every iteration artifact through the canonical milestone-root resolver. Reject
   out-of-root, missing, duplicate, or candidate-mismatched references.
5. Hash-bind the BuildAdmission reference and manifest reference into DIR-124-B's Build
   `StageReceiptEnvelope`.
6. Add a mechanical `BuildEvidenceGate` between Build and Audit. Reject a missing planned AC row,
   pending/unmet required row, missing raw reference, or actual evidence weaker than the required
   class with stable reason codes. A weaker class may proceed only through an explicit,
   policy-authorized disposition that remains visible to Audit; a Build self-exemption has no
   authority.
7. Make Acceptance Audit consume the manifest as a bounded index, then independently inspect raw
   diffs, commands/results, and runtime evidence. A manifest PASS field, if any, has no authority.
8. Add RED/GREEN fixtures for a missing planned AC, duplicate AC mapping, source grep substituted
   for real-workflow evidence, mocked workflow substituted for a real journal, an authorized
   deferral, missing changed files, omitted failing tests, stale candidate commit,
   missing/out-of-root iteration evidence, fabricated runtime evidence, and valid singleton and
   composite manifests.

## Acceptance Criteria

- [ ] Singleton and composite Build produce the same versioned manifest schema through real
  production callsites.
- [ ] Exactly one hash-bound BuildAdmission decision supplies one planned evidence row per charter
  AC before editing; missing/duplicate rows and copied requirement text fail validation.
- [ ] `baseCommit`, `candidateCommit`, and `changedFiles` are mechanically derived and match Git;
  an agent-authored contradiction fails validation.
- [ ] Test/result, AC, runtime, deferred, and iteration entries identify their evidence source and
  distinguish mechanically observed facts from producer claims.
- [ ] Every planned row has one final disposition and raw evidence reference. Evidence-class
  compatibility rejects source grep or mocked execution for a `real-workflow` requirement and
  rejects same-generation evidence for a `cross-generation` requirement.
- [ ] `BuildEvidenceGate` runs after every reachable singleton/composite Build and before Audit;
  missing, pending, unmet, weaker-than-required, or unreferenced required evidence dispatches zero
  Audit work and returns a stable typed result.
- [ ] An explicit weaker-evidence deferral is accepted only when authorized by the bound execution
  policy, remains visible in the manifest/receipt/Audit prompt, and cannot be authored solely by the
  Build producer.
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

- [ ] All five dependencies are done and their installed production paths are used, not duplicated.
- [ ] One real non-fixture milestone emits a manifest, a Build receipt bound to it, and an
  independent Audit that follows its references.
- [ ] A real or production-equivalent negative control omits or downgrades one required evidence row
  and is stopped by BuildEvidenceGate before any Audit agent dispatch.
- [ ] A fresh audit verifies the production call graph, manifest/receipt hashes, canonical path
  resolution, and observer independence.

## Human verification when exp5 marks this task done

1. Does the manifest reduce evidence search without asking Audit to trust Build?
2. Can Build omit or fabricate a changed file, test failure, or runtime claim without detection?
3. Can Build reach Audit with source/static evidence when the AC requires a real workflow journal?
4. Is there one manifest schema and one canonical artifact-root resolver?

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
- `docs/proposals/quay-execute-milestone-build-efficiency.md`
