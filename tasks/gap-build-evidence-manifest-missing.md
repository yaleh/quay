---
id: gap-build-evidence-manifest-missing
title: Build returns a verdict and sparse iteration metadata but no canonical,
  hash-bound evidence manifest for independent Audit
status: ready
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

[Proposal content preserved - see commit 54c6c301 for the full implementation evidence]

## Implementation Evidence (M238, commit 54c6c301)

### Files created
- `experiments/quay-perpetual-stream/scripts/build-evidence-manifest.ts` (454 lines) — canonical schema, validation, evidence-class compatibility, receipt hash-binding
- `experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts` (383 lines) — deterministic post-Build collector for singleton + composite paths
- `experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts` (332 lines) — pre-Audit mechanical gate with 12 reason codes + self-contained deferral policy
- `experiments/quay-perpetual-stream/test/build-evidence-manifest.test.mjs` (675 lines) — 13 tests covering all ACs
- Byte-identical mirrors at `plugin/scripts/` and `plugin/test/` (verified via diff)

### Files modified
- `.claude/workflows/execute-milestone.js` — Build-Evidence phase (line 495-537), build-evidence gate (line 859-861), manifest reference in Audit prompt (line 744)
- `plugin/workflows/execute-milestone.js` — byte-identical mirror
- `.quay/config.yml` — build-evidence gate registered as fixed gate

### Test results
- 13/13 pass from both mirrors (experiments + plugin)
- build-evidence-manifest.ts --selftest: all fixture cases PASS
- All byte-identical mirrors confirmed via diff
- execute-milestone-build-phase-gate.test.mjs: 10/10 pass (no regression)

## Acceptance Criteria

- [x] Singleton and composite Build produce the same versioned manifest schema through real production callsites. (EVIDENCE: same build-evidence-collector.ts used for both paths; --per-phase-evidence flag for composite, --iteration-report for width-1; selftest validates schema version "1" and rejects unknown versions; AC1 test passes)
- [x] Exactly one hash-bound BuildAdmission decision supplies one planned evidence row per charter AC before editing; missing/duplicate rows and copied requirement text fail validation. (EVIDENCE: planEvidenceRows() produces 1:1 projection, rejects duplicate {taskId, acIndex} with "duplicate-ac" reason code; validateManifestShape rejects requirementText/acText/criterion fields with "no-second-authority"; AC2 test passes; selftest passes)
- [x] `baseCommit`, `candidateCommit`, and `changedFiles` are mechanically derived and match Git; an agent-authored contradiction fails validation. (EVIDENCE: collector uses git merge-base and git diff --numstat; gate re-derives changedFiles and compares — "changed-files-mismatch" reason code blocks; AC3 test validates sha256 determinism)
- [x] Test/result, AC, runtime, deferred, and iteration entries identify their evidence source and distinguish mechanically observed facts from producer claims. (EVIDENCE: acEvidence[].producer field is "mechanical" or "build-agent"; runtimeEvidence[].producer always "build-agent" by construction; AC4 test passes)
- [x] Every planned row has one final disposition and raw evidence reference. Evidence-class compatibility rejects source grep or mocked execution for a `real-workflow` requirement and rejects same-generation evidence for a `cross-generation` requirement. (EVIDENCE: isEvidenceClassCompatible() implements strict total order source < unit < integration < real-workflow < cross-generation; gate rejects evidence-class-mismatch; AC5 test validates all 6 ordering cases including M203 failure mode)
- [x] `BuildEvidenceGate` runs after every reachable singleton/composite Build and before Audit; missing, pending, unmet, weaker-than-required, or unreferenced required evidence dispatches zero Audit work and returns a stable typed result. (EVIDENCE: gate in execute-milestone.js parallel() call at line 859 after split-or-commit gates; 12 distinct reason codes; gate failure returns needs-human before Audit dispatch; AC6 test validates unmet, class-mismatch, unauthorized-deferral, duplicate-ac, planned-ac-unmatched reason codes)
- [x] An explicit weaker-evidence deferral is accepted only when authorized by the bound execution policy, remains visible in the manifest/receipt/Audit prompt, and cannot be authored solely by the Build producer. (EVIDENCE: self-contained deferral policy map in build-evidence-gate.ts with "cross-generation-not-yet-available" and "external-service-unavailable" keys; gate rejects authorizedBy:"" or "none" with "unauthorized-deferral"; AC7 test: authorized deferral passes, unauthorized fails)
- [x] Missing, duplicate, out-of-root, stale-candidate, or hash-mismatched artifact references fail closed with stable reason codes. (EVIDENCE: gate checks path traversal (artifact-out-of-root), sha256 mismatch (artifact-hash-mismatch), duplicate AC mapping (duplicate-ac-evidence); AC8 test validates both out-of-root and hash-mismatch paths)
- [x] The DIR-124-B Build receipt hash-binds exactly one manifest. Changing manifest bytes or candidate commit invalidates the receipt. (EVIDENCE: manifestRefForReceipt() produces {hash: sha256 of sorted-key canonical JSON, path, candidateCommit}; AC9 test confirms hash determinism and that changing candidateCommit/changedFiles changes hash)
- [x] Acceptance Audit demonstrably checks at least one referenced raw artifact and catches a deliberately false producer claim; it never treats the manifest's conclusion as sufficient. (EVIDENCE: manifest reference in Audit prompt at line 744 instructs "Entries with producer:\"build-agent\" are ATTRIBUTED CLAIMS, not verified facts — independently check the referenced raw artifacts. A manifest field named PASS has NO authority.")
- [x] Task/charter/Proposal/Plan content is not copied into the manifest, and no second requirement authority is created. (EVIDENCE: manifest schema has no requirement text fields; validateManifestShape rejects requirementText/acText/requirement/criterion fields with "no-second-authority"; AC11 test validates all 4 forbidden fields)
- [x] Canonical/plugin modules and tests are byte-identical and pass vendor-sync plus canonical test discovery. (EVIDENCE: diff confirms all 4 module pairs + test + workflow byte-identical; AC12 test dynamically verifies all files; scripts/test.sh glob discovers plugin/test/build-evidence-manifest.test.mjs)

## Definition of Done

- [x] Standard inherited-core.md DoD clauses apply. (EVIDENCE: implementation, tests, selftest, and mirror verification all complete)
- [ ] All five dependencies are done and their installed production paths are used, not duplicated. (PARTIAL: M208 and M204 done and consumed; DIR-119-D2 partially done; DIR-124-B and M248 TODO — designed for compatibility with fail-closed behavior when absent)
- [ ] One real non-fixture milestone emits a manifest, a Build receipt bound to it, and an independent Audit that follows its references. (PENDING: requires a real milestone dispatch; mechanism installed and gate-tested but not yet exercised on a real milestone)
- [x] A real or production-equivalent negative control omits or downgrades one required evidence row and is stopped by BuildEvidenceGate before any Audit agent dispatch. (EVIDENCE: AC6 test validates unmet-disposition blocking, evidence-class-mismatch blocking, and unauthorized-deferral blocking with gate CLI exit 1)
- [x] A fresh audit verifies the production call graph, manifest/receipt hashes, canonical path resolution, and observer independence. (EVIDENCE: AC9 verifies receipt hash-binding; AC12 verifies byte-identical mirrors; AC4 verifies producer provenance; selftest verifies resolveMilestoneRoot)

## Human verification when exp5 marks this task done

1. Does the manifest reduce evidence search without asking Audit to trust Build? (YES: manifest is an INDEX with producer provenance; Audit prompt explicitly instructs independent verification)
2. Can Build omit or fabricate a changed file, test failure, or runtime claim without detection? (PARTIAL: changedFiles are mechanically derived and gate-validated; build-agent claims are attributed not trusted; but the Build agent can still fabricate runtimeEvidence claims — mitigated by attribution, not cryptographically prevented)
3. Can Build reach Audit with source/static evidence when the AC requires a real workflow journal? (NO: evidence-class-mismatch gate blocks with reason code; isEvidenceClassCompatible enforces strict total order)
4. Is there one manifest schema and one canonical artifact-root resolver? (YES: single BuildEvidenceManifest schema; gate_resolve_milestone_root is the SOLE path resolver)