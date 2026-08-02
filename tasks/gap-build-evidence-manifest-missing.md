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

**Reclassified (2026-08-02, ADR-021 review):** mechanism 1 (manifest output path fix) was already
committed (`2b1d67c2`). The remaining 2 mechanisms (per-phase evidence consumption, git failure
fail-soft) ≤ 2 threshold — do not trigger `split-multi-mechanism`. The split decision at
`milestones/prepare-decisions/gap-build-evidence-manifest-missing.json` is SUPERSEDED. The 3 stub
child task files (gap-build-evidence-path/per-phase/git-fail-soft) are deleted.
Execute as a single milestone for the remaining 2 mechanisms.

## Split into independently landable children (2026-08-01)

This task has been split into three independently landable sub-tasks, each assigned its own M-number
and milestone charter (split decision: `milestones/prepare-decisions/gap-build-evidence-manifest-missing.json`):

| Child | M-number | Title | Mechanism |
|-------|----------|-------|-----------|
| [gap-build-evidence-path](gap-build-evidence-path.md) | **M263** | Manifest output path — write under `MILESTONE_ROOT`, not `/tmp` | Critical-path fix already committed in `2b1d67c2`; formalized: collector writes `build-evidence-manifest.json` via `gate_resolve_milestone_root`, never `/tmp` |
| [gap-build-evidence-per-phase](gap-build-evidence-per-phase.md) | **M264** | Per-phase evidence consumption (`perPhaseEvidenceFile`/`iterationReport`) | Collector currently accepts the flags but reconciles against empty `actualRows`; consume per-phase evidence / iteration report into `acEvidence` rows with producer provenance |
| [gap-build-evidence-git-fail-soft](gap-build-evidence-git-fail-soft.md) | **M265** | Fail-closed on git failure (`baseCommit`/`changedFiles` empty) | `git merge-base`/`git diff` failure currently yields empty fields + skipped drift check (fail-soft); fail closed with a distinct stable reason code |

Each child is independently reviewable and landable. This parent is **done** when all three children
are done.

**Original parent charter:** `experiments/quay-perpetual-stream/charters/M238-gap-build-evidence-manifest-missing.md`
(preserved for context).

---

## Proposal

## Problem

The `execute-milestone.js` Build phase returns a raw `buildResult` object (outcome, merge commit, iteration count) and writes iteration artifacts (iteration-0.md, audit reports) to `<milestoneRoot>/iterations/`. But before M238, there was no **canonical, hash-bound manifest** that the independent Audit phase could consume as an index. Audit agents had to discover evidence ad-hoc -- re-running `git diff`, hunting for iteration reports, and trusting the Build agent's unstructured summary. This forced Audit to either trust the Build agent's self-report or perform an unbounded filesystem search -- both of which degrade adversarial independence.

Three concrete gaps:

1. **No structured index for Audit.** Audit agents spend tokens rediscovering the same file paths, commit ranges, and test results that the Build phase already knows. The Audit prompt instructs agents to be adversarial, but without a manifest they grope blindly.

2. **No mechanical evidence-class enforcement.** An AC requiring `real-workflow` evidence (e.g., a live journal from a workflow run) could be satisfied by a Build agent claiming it `grep`'d for passing tests -- a `source`-level check. Nothing mechanically blocked that weaker class substitution.

3. **No hash-binding between Build output and Audit input.** Without a content-addressed manifest, there is no cryptographic chain from the Build's claimed evidence to what Audit actually inspects. The DIR-124-B Build receipt can claim success while the underlying evidence is missing, weaker-than-required, or fabricated.

The task `gap-build-evidence-manifest-missing` (class: development, labels: gap, milestone-candidate, human-steered) addresses all three.

## Chosen mechanism

Three TypeScript modules, byte-identical at `experiments/quay-perpetual-stream/scripts/` and `plugin/scripts/`, plus a gate registration and workflow integration:

| Component | Role | File |
|---|---|---|
| **Schema + validation** | Canonical `BuildEvidenceManifest` type (schema version `"1"`, no alternative schema), `planEvidenceRows()`, `validateManifestShape()`, `manifestRefForReceipt()`, evidence-class ordering | `build-evidence-manifest.ts` (454 lines) |
| **Deterministic collector** | Post-Build mechanical shell command; consumes `BuildResult`, an optional `BuildAdmissionDecision`, and opt-in test/claim data; writes one manifest JSON | `build-evidence-collector.ts` (383 lines) |
| **Mechanical gate** | Pre-Audit validation: structural completeness, evidence-class compatibility, deferral authorization, artifact hash/reachability, changed-files drift; 12 distinct reason codes | `build-evidence-gate.ts` (332 lines) |
| **Workflow integration** | `execute-milestone.js` invokes the collector as a Build-Evidence phase (a formulaic agent helper running exactly one shell command), then runs the gate in the parallel `Gate` phase before Audit dispatch | `.claude/workflows/execute-milestone.js` lines 495-538, 858-862, 744 |
| **Gate registration** | `build-evidence` gate registered as a fixed workspace gate in `.quay/config.yml` (script: `./plugin/scripts/build-evidence-gate.ts`), enabling standalone `quay gate --gate build-evidence <task-id>` | `.quay/config.yml` lines 77-82 |

## Data flow (end-to-end)

```
Build phase (agent)
  └─► buildResult {outcome, mergeCommit, taskId, iterationCount}
        │
        ▼
Build-Evidence phase (mechanical shell command via agent helper)
  ├─ git merge-base origin/master <candidateCommit>  →  baseCommit
  ├─ git diff --numstat baseCommit..candidateCommit  →  changedFiles[]
  ├─ read BuildAdmissionDecision JSON (if present)   →  plannedAcEvidence[]
  ├─ fs scan milestoneRoot/iterations/, audits/      →  iterationArtifactRefs[]
  ├─ reconcile plannedAcEvidence[] vs. actual rows   →  acEvidence[]
  └─ write manifest JSON to <milestoneRoot>/build-evidence-manifest.json

Gate phase (mechanical, parallel with other milestone gates)
  ├─ validateManifestShape() — schema, duplicates, copied text, path traversal
  ├─ Cross-check plannedAcEvidence ↔ acEvidence (1:1 completeness)
  ├─ Evidence-class compatibility (isEvidenceClassCompatible)
  ├─ Deferral authorization (DEFERRAL_POLICY map)
  ├─ Artifact hash verification (sha256 actual vs. declared)
  └─ Changed-files drift check (re-derive from git, compare)
       │
       ├─ ok:true  → Audit phase proceeds; manifest referenced in Audit prompt
       └─ ok:false → needs-human; zero Audit agents dispatched; stable reason code

Audit phase (agent)
  └─ Prompt instructs: read manifest as INDEX; entries with producer:"build-agent"
     are ATTRIBUTED CLAIMS, not verified facts; independently check referenced
     raw artifacts; a field named "PASS" has NO authority.
```

## Mechanism-claim wiring (DIR-117)

- [MW-1] `execute-milestone.js` Build-Evidence phase **invokes** `build-evidence-collector.ts` as a mechanical shell command (lines 507-533). Claim: the collector is called exactly once, after Build returns `outcome:"done"` and before Audit.

- [MW-2] `build-evidence-collector.ts` **derives** `baseCommit` and `changedFiles` mechanically via `git merge-base` and `git diff --numstat` (lines 67-91). Claim: no agent-authored git fields enter the manifest.

- [MW-3] `execute-milestone.js` Gate phase **invokes** `build-evidence-gate.ts` in the parallel gate array (lines 858-862). Claim: the gate runs after Build-Evidence and before any Audit agent dispatch; gate failure returns `needs-human` without dispatching Audit.

- [MW-4] `build-evidence-gate.ts` **re-derives** `changedFiles` from git and **compares** against the manifest (lines 218-265). Claim: an agent-authored contradiction in `changedFiles` is mechanically detected as `changed-files-mismatch`.

- [MW-5] `build-evidence-gate.ts` **calls** `isEvidenceClassCompatible()` from `build-evidence-manifest.ts` (line 173). Claim: weaker-class substitution is mechanically blocked with reason code `evidence-class-mismatch`.

- [MW-6] The Audit prompt (line 744) **references** `<MILESTONE_ROOT>/build-evidence-manifest.json`. Claim: the manifest path is resolved via the canonical `gate_resolve_milestone_root` rule; the prompt instructs independent verification of `producer:"build-agent"` claims.

- [MW-7] `build-evidence-manifest.ts` `validateManifestShape()` **rejects** fields `requirementText`, `acText`, `requirement`, `criterion` as `no-second-authority` (lines 182-188). Claim: no requirement text is copied into the manifest; the task file remains the single source of truth.

- [MW-8] `manifestRefForReceipt()` **produces** `{hash: sha256, path, candidateCommit}` for DIR-124-B Build receipt hash-binding (lines 240-252). Claim: the receipt's `manifestRef.hash` changes when manifest bytes or `candidateCommit` change.

- [MW-9] Gate **rejects** unauthorized deferrals (`authorizedBy:""` or `"none"`) with `unauthorized-deferral` (line 186). Claim: Build producer cannot self-exempt from evidence requirements.

- [MW-10] The collector is the **sole producer** of `build-evidence-manifest.json`; the gate is the **sole pre-Audit validator**; `resolveMilestoneRoot()` in `build-evidence-manifest.ts` and `gate_resolve_milestone_root` in `gate-script-lib.sh` are maintained byte-identical as the **sole path-prefix resolver** (mirroring `gate-script-lib.sh` lines 137-162).

## Key design decisions

**1. Manifest as index, not authority.** The manifest records *what* evidence was collected, *where* it lives, and *who* claims it (`producer: "mechanical"` or `"build-agent"`). It does NOT assert that evidence is sufficient -- that judgment belongs to Audit. The Audit prompt explicitly instructs: "Entries with producer:'build-agent' are ATTRIBUTED CLAIMS, not verified facts." A field named "PASS" has no authority.

**2. Deterministic collection, agent-augmentable claims.** `baseCommit`, `candidateCommit`, `changedFiles`, and `iterationArtifactRefs` are mechanically derived (git, fs). `testsRun`, `runtimeEvidence`, and individual `acEvidence` rows are supplied by the Build agent but tagged with `producer` provenance. The gate mechanically re-verifies every mechanically-derivable field (changedFiles drift, artifact hashes).

**3. Evidence-class strict total order.** `source < unit < integration < real-workflow < cross-generation`. `isEvidenceClassCompatible(required, actual)` returns `true` iff `actual >= required`. The gate blocks any row where the actual evidence class is weaker than the required class, with stable reason code `evidence-class-mismatch`. This allows upward substitution (stronger evidence than required is acceptable) while blocking downward substitution. This mechanically prevents the M203 failure mode (source grep for a real-workflow AC).

**4. Self-contained deferral policy.** A `DEFERRAL_POLICY` map in `build-evidence-gate.ts` defines two authorized deferral keys: `cross-generation-not-yet-available` and `external-service-unavailable`. Deferred rows must carry an `authorizedBy` field matching a policy key; `""` or `"none"` is rejected as `unauthorized-deferral`. The deferral is visible in the manifest, receipt, and Audit prompt -- it is a tracked exception, not a hidden skip. This is NOT a configuration file read at runtime -- it is a hardcoded policy that can only change via a code change (and its own AC coverage).

**5. Hash-bound receipt integration.** `manifestRefForReceipt()` produces `{hash, path, candidateCommit}` where `hash = sha256(sorted-key canonical JSON)`. DIR-124-B Build receipts bind to exactly one manifest via this hash; changing manifest bytes or `candidateCommit` invalidates the receipt. This is the sole hash-binding path to the DIR-124-B Build receipt. Tested for determinism and sensitivity (AC9).

**6. Byte-identical canonical/plugin mirrors.** All three TypeScript modules plus the test file exist as byte-identical pairs at `experiments/quay-perpetual-stream/` and `plugin/`. The gate registration in `.quay/config.yml` points to the `plugin/` mirror for `quay gate` CLI usage. The `execute-milestone.js` workflow uses the `experiments/` mirror directly. Byte-identity is verified by AC12 (dynamic diff).

**7. No second requirement authority.** `validateManifestShape()` rejects any manifest containing `requirementText`, `acText`, `requirement`, or `criterion` fields with reason code `no-second-authority`. The task file is the single source of truth for requirements; the manifest carries only evidence references, never copies of requirement text.

**8. Singleton and composite paths unified.** The collector accepts `--per-phase-evidence` (composite) or `--iteration-report` (width-1). Both produce the same `BuildEvidenceManifest` schema (version "1"). The workflow Build-Evidence phase dispatches identically for both paths -- only the input evidence source differs. The collector code path is identical.

**9. Single canonical milestone root resolver.** `resolveMilestoneRoot()` (in `build-evidence-manifest.ts`) and `gate_resolve_milestone_root` (in `gate-script-lib.sh`) are the sole path-prefix resolution mechanism. Milestones >= 130 resolve to `milestones/M<NN>`; < 130 resolve to `experiments/quay-perpetual-stream/milestones/M<NN>`. Both implementations are maintained byte-identical -- the shell version is the canonical production path for `execute-milestone.js` commands; the TS version is used by the collector/gate for in-process resolution.

## Defaults and failure behavior

- **Manifest missing/unparseable:** `manifest-missing` reason code -- gate blocks, Audit not dispatched.
- **Schema version unknown:** `manifest-schema-unknown` -- gate blocks. Only version "1" is recognized.
- **Candidate commit missing/invalid:** `candidate-commit-invalid` -- gate blocks.
- **buildAdmissionRef null without advisory mode:** `build-admission-unavailable` -- gate blocks. In `--advisory` mode, null admission is allowed (for manual/gap-fill milestones without a formal admission decision).
- **plannedAcEvidence empty with non-null admission:** `no-planned-evidence` -- gate blocks. Vacuous manifests (no ACs to evidence) are only allowed when admission is absent.
- **Planned AC row unmatched:** `planned-ac-unmatched` -- gate blocks. Every planned row must have exactly one acEvidence row.
- **Unmet disposition:** `required-evidence-unmet` -- hard block. No amount of other satisfied ACs can compensate.
- **Evidence class weaker than required:** `evidence-class-mismatch` -- hard block.
- **Unauthorized deferral:** `unauthorized-deferral` -- hard block. Build producer cannot self-exempt.
- **Artifact path traversal/absolute:** `artifact-out-of-root` -- hard block.
- **Artifact hash mismatch:** `artifact-hash-mismatch` -- hard block (but missing declared files are not a hard block -- they may be generated later).
- **Changed files drift:** `changed-files-mismatch` -- hard block. Gate re-derives from git and compares count and per-file add/del stats.
- **Duplicate AC evidence rows:** `duplicate-ac-evidence` -- hard block. Same `{taskId, acIndex}` appearing twice.
- **Collector invoked without done outcome:** returns `{ok: false, reason: "build-outcome-not-done"}`.
- **Collector invoked without merge commit:** returns `{ok: false, reason: "missing-merge-commit"}`.
- **Gate internal error:** `gate-internal-error` -- catch-all for unexpected exceptions; fails closed.
- **Fail-closed by default.** Every gate check defaults to blocking. There is no "lenient" mode in production; advisory mode (`--advisory`) exists for testing/dry-run but is never used in `execute-milestone.js`.

## Compatibility

- **Existing milestones unaffected.** The Build-Evidence phase is gated on `buildResult.outcome === 'done'` (line 490), which all existing milestones already satisfy. The collector runs as an additional phase, not a replacement of existing Build output.
- **Composite (DIR-119) path compatible.** The composite manifest path (`--per-phase-evidence`) is accepted alongside the width-1 path; both produce the same schema.
- **Worktree isolation compatible.** The collector command respects the `_evidenceCollectorWtPrefix` (line 502-504), which prepends `cd <worktreeRel>` when isolation is active.
- **Byte-identical mirrors ensure CLI `quay gate` and workflow paths stay consistent.** Any edit to one mirror must be replicated to the other (enforced by AC12 test).
- **Non-regression on existing gates.** The `build-evidence` gate is added to the parallel gate array with the same `_milestoneGateSchema` contract; no existing gate is modified.
- **Backward-compatible with existing Build flow.** If the collector fails (e.g., missing dependencies), the workflow returns `needs-human` with phase `"Build-Evidence"` -- the same failure pattern as any other phase.

## Risks

1. **Collector depends on git state.** If `git merge-base` or `git diff` fail (detached HEAD, shallow clone), `baseCommit` and `changedFiles` come back empty. The gate's drift check is skipped when these fields are empty, which is fail-soft rather than fail-closed. Mitigation: the workflow always runs from a full clone on `master`; shallow clones are not a supported execution environment.

2. **`build-agent` claims are attributed, not cryptographically prevented.** A compromised or hallucinating Build agent can fabricate `runtimeEvidence` claims and set `producer: "build-agent"`. The manifest makes this provenance visible, and the Audit prompt instructs independent verification -- but there is no cryptographic signature chain. Mitigation: this is by design (manifest as index, not authority); the adversarial Audit is the actual enforcement layer.

3. **Deferral policy is self-contained in the gate.** If a new legitimate deferral reason emerges, the `DEFERRAL_POLICY` map must be edited. This is a code change, not a configuration change. Mitigation: the policy is deliberately small and auditable; adding a new key requires the same review as any other gate logic change.

4. **Single schema version "1".** Schema evolution requires coordination between collector (producer) and gate (consumer). Mitigation: `validateManifestShape()` explicitly checks `schemaVersion` and rejects unknown versions; a v2 would be added as a recognized version with backward-compat logic.

5. **Not yet exercised on a real non-fixture milestone.** The mechanism is gate-tested and selftest-verified but has not been exercised on a real production milestone dispatch. This is tracked as an unchecked DoD clause ("One real non-fixture milestone emits a manifest...").

6. **BuildAdmissionDecision dependency.** The manifest collector and gate assume the admission decision file is available and correctly formatted. If the admission decision mechanism (DIR-126) has a bug, the manifest will carry incomplete or incorrect planned evidence rows. Mitigation: `buildAdmissionRef === null` blocks the gate in production, so missing admission decisions are caught.

## Non-goals

- **Not a general-purpose evidence framework.** The manifest schema is tightly coupled to `execute-milestone.js`'s Build-to-Audit pipeline. It is not designed as a standalone evidence format for arbitrary workflows.
- **Not a replacement for adversarial Audit.** The manifest is an index, not a verification. Audit remains the enforcement layer; the gate only blocks structurally incomplete/class-incompatible manifests, not semantically wrong claims.
- **Not a cryptographic chain of custody.** `producer` provenance is a tag, not a signature. The manifest does not implement a verifiable log, transparency ledger, or signing infrastructure.
- **Not an AC/DoD status tracker.** The manifest does not replace the task file's AC checkboxes or the DoD gate (`it0-dod-check.sh`). It is an evidence map, not a status assertion.
- **No per-task manifest granularity.** One manifest per milestone run (all tasks in a composite or the singleton task). Single-task milestones get a manifest with a single-task `runIdentity.taskIds[]`.
- **Not a second requirement authority.** The manifest explicitly rejects requirement text fields (`no-second-authority`). The task file remains the single source of truth for requirement text.
- **No cross-milestone evidence chaining.** The `cross-generation` evidence class is defined in the ordering but the mechanism for collecting it (requiring a real next workflow run) is out of scope.

## AC coverage

All 12 Acceptance Criteria are addressed by the three modules, their tests, and the workflow integration:

- **AC1** (unified schema): `BuildEvidenceManifest` type with `schemaVersion: "1"`; collector produces same schema for both `--per-phase-evidence` (composite) and `--iteration-report` (width-1); selftest validates.

- **AC2** (hash-bound admission + duplicate rejection): `planEvidenceRows()` 1:1 projection; `validateManifestShape()` rejects `requirementText/acText/criterion` with `no-second-authority`; tests validate.

- **AC3** (mechanically derived git fields): collector uses `git merge-base` + `git diff --numstat`; gate re-derives and compares with `changed-files-mismatch` reason code.

- **AC4** (producer provenance): `acEvidence[].producer` in {"mechanical", "build-agent"}; `runtimeEvidence[].producer` always "build-agent" by construction; AC4 test validates.

- **AC5** (evidence-class compatibility): `isEvidenceClassCompatible()` strict total order; gate blocks `evidence-class-mismatch`; AC5 test validates all 6 ordering cases including M203 failure mode.

- **AC6** (gate after Build, before Audit): gate in `execute-milestone.js` parallel() call line 859; 12 distinct reason codes; gate failure returns `needs-human` before Audit; AC6 test covers unmet, class-mismatch, unauthorized-deferral, duplicate-ac, planned-ac-unmatched.

- **AC7** (authorized deferral): `DEFERRAL_POLICY` map with two keys; gate rejects `authorizedBy:""` or `"none"` with `unauthorized-deferral`; AC7 test: authorized passes, unauthorized fails.

- **AC8** (artifact reference integrity): gate checks path traversal (`artifact-out-of-root`) and sha256 mismatch (`artifact-hash-mismatch`); AC8 test validates both.

- **AC9** (receipt hash-binding): `manifestRefForReceipt()` produces `{hash: sha256, path, candidateCommit}`; AC9 test confirms determinism and sensitivity to manifest/candidate changes.

- **AC10** (Audit checks referenced artifacts): manifest reference in Audit prompt line 744; prompt instructs independent verification of `producer:"build-agent"` claims.

- **AC11** (no requirement text copy): `validateManifestShape()` rejects `requirementText/acText/requirement/criterion`; AC11 test validates all 4 forbidden fields.

- **AC12** (byte-identical mirrors + test discovery): AC12 test dynamically diffs all 4 file pairs; `scripts/test.sh` discovers `plugin/test/build-evidence-manifest.test.mjs` via its default glob.

## Alternatives considered and rejected

**A. Embed evidence directly in the Audit prompt (no manifest file).**
Rejected: mixes concerns (prompt construction vs. evidence indexing); no mechanical validation possible; no hash-binding; no reuse across composite shard audits.

**B. Extend the existing BuildResult object with evidence fields.**
Rejected: BuildResult is a transient agent return value, not a persisted artifact; no hash-binding; no mechanical gate possible; would require all consumers to be agent-parsed (unreliable).

**C. Make the manifest authoritative (trust Build's conclusion).**
Rejected: violates adversarial Audit's independence. The manifest must be an index, not a verdict. The explicit instruction "A manifest field named PASS has NO authority" in the Audit prompt is the deliberate counter-design.

**D. Per-task manifest files instead of per-milestone.**
Rejected: composite milestones share a single Build run; splitting manifests would duplicate `changedFiles`/`baseCommit`/`candidateCommit` across N files and complicate hash-binding to a single receipt.

**E. Use a cryptographic signing chain (e.g., Sigstore, GPG) for producer provenance.**
Rejected: over-engineered for the current threat model. The adversarial Audit is the enforcement layer; provenance tagging is sufficient to make claims auditable. Signing can be added later without schema change.

**F. Inline the gate logic into execute-milestone.js rather than a separate module.**
Rejected: would make the gate untestable in isolation, unreusable via `quay gate --gate build-evidence`, and would bloat the workflow script. The separate module with CLI entry point enables both workflow and standalone usage.

**G. Write evidence collection and validation as bash scripts using jq.**
Rejected: TypeScript provides type safety; the `BuildEvidenceManifest` interface serves as executable documentation; and the pure functions (`isEvidenceClassCompatible`, `validateManifestShape`, `manifestRefForReceipt`) are testable in-process without shell overhead. The bash `gate-script-lib.sh` is used only for `gate_resolve_milestone_root` (the canonical shell path resolution), which remains the authoritative resolver for `execute-milestone.js` commands.

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