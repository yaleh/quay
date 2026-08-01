# M238 Plan — Build evidence manifest + mechanical BuildEvidenceGate

- **Milestone:** M238
- **Task:** `gap-build-evidence-manifest-missing` — Build returns a verdict and sparse iteration
  metadata but no canonical, hash-bound evidence manifest for independent Audit.
- **Charter:** `experiments/quay-perpetual-stream/charters/M238-gap-build-evidence-manifest-missing.md`
  (GATE-HASH-REF `5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93`)
- **Base revision:** `65f414c4` (current HEAD short-sha at Plan authoring, 2026-08-01)
- **Class:** development · capability-growth (method-infra surface; one production module set
  mirrored through the canonical/plugin path, plus a narrow `execute-milestone.js` wiring edit in
  both mirrors)
- **Prepared-gate note:** authored for the M195/DIR-117-B enforced-by-default Prepared gate.
  Manually authored (2026-08-01) after the just-adjudicated task body; the task's `## Proposal` /
  `## Acceptance Criteria` are the authoritative contract, and this Plan is the mechanical stage
  spec that milestone-preparation-check.ts's `validatePlanStructure` parses.
- **Dependencies:** consumes, does not duplicate:
  - `gap-build-phase-null-result-not-gated` (M208, landed `de5c79a`) — the positive Build result
    gate `buildResult?.outcome !== 'done'` in both `execute-milestone.js` mirrors. This milestone
    adds a DISTINCT gate step AFTER it, never replaces it.
  - `gap-build-phase-iteration-evidence-path-not-single-sourced` (landed `f8cc145`) —
    `gate_resolve_milestone_root` from `experiments/quay-perpetual-stream/scripts/gate-script-lib.sh`
    is the canonical milestone-root resolver every iteration-artifact reference must route through.
  - `DIR-119-D2` (M210, in flight) — the composite Build evidence mapping (`mapEvidenceToTasks` /
    `PhaseEvidence` in `composite-build.ts`) feeds the singleton/composite collector.
  - `DIR-124-B` (M236) — the hash-bound Build `StageReceiptEnvelope` this milestone binds exactly
    one `evidenceManifestRef` into. HARD PRECONDITION (task DoD): the installed receipt identity is
    consumed, never re-invented; if the `*stage-receipt*` module is not installed at execute time
    this milestone must not proceed.
  - `gap-execute-milestone-build-admission-and-verification-fuse` — the hash-bound
    `BuildAdmissionDecision` this milestone consumes (exactly one) to plan one evidence row per
    charter AC before editing. Also a hard precondition (task DoD).
  - NOT a dependency — `DIR-124-D` (execution-policy registry, `status: todo`, no module installed
    anywhere in the repo): M238 deliberately does NOT consume it and does NOT stub it. AC7's "bound
    execution policy" is satisfied by a self-contained deferral-policy contract owned by this
    milestone's `build-evidence-gate.ts` — a narrow, evidence-gate-only authorization rule, NOT a
    stub of or substitute for DIR-124-D's future general registry. This is the AC7 dependency-order
    resolution: instead of hard-chaining M238 behind an in-flight `todo` directive, the deferral
    policy stays local to the gate module, so M238 applies the same no-transitional-duplicate
    discipline Stage 5 applies to DIR-124-B, exercised by deliberate NON-consumption rather than a
    hard stop.
  - In the serial path this dispatch must never run concurrently with another execute-milestone
    dispatch against the shared checkout.

## Grounded facts (repo-runtime contract)

- Canonical test discovery runs `plugin/test/*.test.mjs` via `scripts/test.sh`; the
  `experiments/quay-perpetual-stream/test/` copies are the byte-identical mirror (AC12). New
  `*build-evidence*` modules live in BOTH `experiments/quay-perpetual-stream/scripts/` and
  `plugin/scripts/`, edited to byte-identity (same discipline as `composite-build.ts` /
  `composite-reconcile.ts`, which are byte-identical real files in both trees today).
- `plugin/scripts/sync-vendor.sh --check` is the vendored-plugin drift gate (`packages/quay` →
  `plugin/vendor/quay`); it must stay clean (AC12 "vendor-sync").
- `experiments/quay-perpetual-stream/scripts/composite-build.ts` already exports
  `mapEvidenceToTasks(phases, evidence)` and `PhaseEvidence { phaseId, files[], commits[], tests[] }`
  and the CLI modes `--plan-json` / `--map-evidence-json` — the collector consumes these as the
  composite input surface (M189/DIR-119-B and M210/DIR-119-D2 work).
- `gate_resolve_milestone_root <M-NN|NN>` (in `gate-script-lib.sh`) is the single-sourced
  milestone-root resolver already used by Audit/Land and (since `f8cc145`) by the Build-phase
  EVIDENCE instruction; the manifest's artifact resolver must delegate to it.
- `execute-milestone.js` (both `.claude/workflows/` and `plugin/workflows/`, byte-identical) binds
  the Build dispatch to ONE `buildResult` at line 437:
  `const buildResult = (_isComposite && _taskIds.length > 1) ? await _compositePhaseDagBuild() : await agent(...)`.
  The legacy width-1 / singleton shape calls `agent(...)` directly; the composite / concurrent shape
  dispatches per-phase Build agents INSIDE `_compositePhaseDagBuild()` (defined ~line 283), so
  "exactly one Build `agent()` call" is not literally true per call shape. But every shape converges
  on the SAME `buildResult` and flows through the SAME single positive-result gate
  `if (buildResult?.outcome !== 'done')` at line 490 (M208, landed `de5c79a`) — that single result
  plus single positive gate is the material claim the BuildEvidenceGate slots after. The gate is
  inserted after line 490's block (whose only exit on a non-done outcome is the `needs-human` early
  return) and before the first Audit `agent()` dispatch (the composite Audit manifest-read helper
  begins ~line 568), so it is reachable by every Build path.
- Tests are run with the Node built-in runner under `--experimental-strip-types` for `.ts` sources
  and plain `node --test` / `scripts/test.sh` for `.mjs` fixtures; expected exit codes are asserted
  per stage below.

## Complete touch set

- `experiments/quay-perpetual-stream/scripts/build-evidence-manifest.ts` — NEW: `BuildEvidenceManifest`
  schema + `planEvidenceRows()` + shape validation + `manifestRefForReceipt()`.
- `plugin/scripts/build-evidence-manifest.ts` — byte-identical mirror.
- `experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts` — NEW: `collectBuildEvidence()`
  + `resolveIterationArtifact()` (canonical milestone-root resolver).
- `plugin/scripts/build-evidence-collector.ts` — byte-identical mirror.
- `experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts` — NEW: `runBuildEvidenceGate()`
  with stable reason codes + policy-authorized weaker-evidence deferral.
- `plugin/scripts/build-evidence-gate.ts` — byte-identical mirror.
- `experiments/quay-perpetual-stream/test/build-evidence-manifest.test.mjs` — NEW RED/GREEN fixtures.
- `plugin/test/build-evidence-manifest.test.mjs` — byte-identical mirror.
- `experiments/quay-perpetual-stream/test/build-evidence-gate.test.mjs` — NEW RED/GREEN fixtures.
- `plugin/test/build-evidence-gate.test.mjs` — byte-identical mirror.
- `experiments/quay-perpetual-stream/scripts/composite-build.ts` — collector input wiring
  (`PhaseEvidence` → `mapEvidenceToTasks`), both mirrors.
- `plugin/scripts/composite-build.ts` — byte-identical mirror.
- `.claude/workflows/execute-milestone.js` — BuildEvidenceGate step after the M208 positive Build
  gate, manifest written under the milestone root, bounded index fed to the Audit prompt.
- `plugin/workflows/execute-milestone.js` — byte-identical mirror.
- `tasks/gap-build-evidence-manifest-missing.md` — task body (Plan reference, checklists on Land).
- `docs/proposals/quay-prepare-execute-feedback-convergence.md` — producer/observer-independence
  rationale already carried here; update only if the implementation reveals a delta.
- `docs/proposals/quay-execute-milestone-build-efficiency.md` — same, evidence-transfer note.
- `docs/plans/M238-gap-build-evidence-manifest-missing.md` — this Plan (authoritative plan path;
  the task Touches list still carries the older `docs/plans/M238-gap-evidence-manifest.md` name —
  the receipt references THIS file; Stage 8 corrects that stale Touches path so the task's
  authoritative touch set is complete).

### Stage 1: RED — build-evidence fixtures and the full negative-control matrix

- Kind: code
- AC: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
- Files: `experiments/quay-perpetual-stream/test/build-evidence-manifest.test.mjs`, `plugin/test/build-evidence-manifest.test.mjs`, `experiments/quay-perpetual-stream/test/build-evidence-gate.test.mjs`, `plugin/test/build-evidence-gate.test.mjs`
- Command: `node --experimental-strip-types --test plugin/test/build-evidence-manifest.test.mjs plugin/test/build-evidence-gate.test.mjs` — MUST exit non-zero (RED): the fixtures import `build-evidence-manifest.ts` / `build-evidence-collector.ts` / `build-evidence-gate.ts`, none of which exist yet, so the import fails before any assertion runs.

Fixture matrix (Requested-action item 8, each a distinct case, asserted with real pasted output at
GREEN, not asserted-as-expected):

- missing planned AC row → `planEvidenceRows` validation fails (`missing-planned-ac`);
- duplicate AC mapping (two rows for one AC index) → fails (`duplicate-ac`);
- copied requirement text (AC prose pasted into the manifest or a planned row) → rejected (`no-second-authority`, AC2/AC11);
- source-grep evidence substituted for a `real-workflow` requirement → gate rejects (`weaker-than-required`, AC5);
- mocked workflow substituted for a real journal → gate rejects (`weaker-than-required`, AC5);
- authorized weaker-evidence deferral → accepted ONLY with the self-contained deferral-policy signature defined by `build-evidence-gate.ts` (AC7; see Dependencies for why this is not DIR-124-D), visible in manifest/receipt/Audit prompt, Build-producer-only authorship rejected;
- `changedFiles` contradicting `git` → validation fails (AC3);
- failing test omitted from `testsRun`/`testResults` → gate rejects (`unreferenced-required-evidence` / `pending-required-row`, AC6);
- stale candidate commit (manifest bound to a commit other than the checked-out candidate) → fails closed (`stale-candidate`, AC8);
- missing / out-of-root iteration evidence (absolute path, `..`, symlink escape) → fails closed (`out-of-root-ref`, AC8);
- fabricated runtime evidence (agent-authored) → tagged `observed:false` claim, never a fact (AC4), and the audit fixture catches the false claim against the raw artifact (AC10);
- changing manifest bytes or candidate commit invalidates the DIR-124-B receipt (`hash-mismatch`, AC9);
- valid singleton manifest → passes (AC1);
- valid composite manifest (multiple `PhaseEvidence` sources) → passes, same schema (AC1);
- every manifest entry carries `{source, observed}` and never copies task/charter/Proposal/Plan text (AC4/AC11);
- mirrors of every fixture are byte-identical and the canonical `plugin/test/*.test.mjs` discovery runs them (AC12 — asserted at GREEN, RED only needs the import failure).

Import strategy (pins Stage 2's partial-GREEN claim; M212/M214 dynamic-import precedent):
`build-evidence-manifest.test.mjs` statically imports ONLY `build-evidence-manifest.ts`. Its
collector-dependent fixtures (changedFiles-contradiction, stale-candidate, out-of-root,
fabricated-runtime, valid singleton/composite) resolve the collector through a dynamic
`const mod = await import("../scripts/build-evidence-collector.ts")` namespace inside their
subtests — a static import of a not-yet-existing module would fail ESM module LINKING and take the
whole file down (ERR_MODULE_NOT_FOUND), which is exactly the Stage-2 contradiction being ruled out.
In Stage 1 the static import of `build-evidence-manifest.ts` (absent) already fails the file's load
→ RED. In Stage 2 (manifest module exists, collector still absent) the file links, the
manifest-module-only fixtures pass, and ONLY the collector subtests fail at their dynamic import
(RED) — a mechanically achievable partial GREEN. `build-evidence-gate.test.mjs` statically imports
ONLY `build-evidence-gate.ts` and is not run until Stage 4, so it needs no dynamic indirection. The
Stage-5 receipt-binding fixture likewise resolves the DIR-124-B `*stage-receipt*` module via dynamic
import, so a not-yet-installed contract fails only that subtest, never the file.

### Stage 2: implementation — `build-evidence-manifest.ts`: schema, admission consumption, planner

- Kind: code
- AC: 1, 2, 11
- Files: `experiments/quay-perpetual-stream/scripts/build-evidence-manifest.ts`, `plugin/scripts/build-evidence-manifest.ts`
- Command: `node --experimental-strip-types --test plugin/test/build-evidence-manifest.test.mjs` — the manifest-module-only subset flips GREEN (missing-planned-AC, duplicate-AC, copied-requirement-text → no-second-authority, and the `{source, observed}` schema-property fixtures pass). The collector-dependent fixtures (changedFiles-contradiction, stale-candidate, out-of-root, fabricated-runtime, valid singleton/composite) remain RED: their dynamic `await import("../scripts/build-evidence-collector.ts")` throws ERR_MODULE_NOT_FOUND in those subtests ONLY, so the file still links and the manifest subset is GREEN — this stage's partial GREEN is mechanically real (dynamic-import strategy in Stage 1), not a load-failure fiction. The gate and receipt-binding fixtures also remain RED until Stages 4-5.

Symbols:

- `BuildEvidenceManifest` — versioned (`schemaVersion`) shape with `runIdentity`,
  `buildAdmissionRef`, `baseCommit`, `candidateCommit`, `changedFiles[]`, `testsRun[]`,
  `testResults[]`, `plannedAcEvidence[]`, `acEvidence[]`, `runtimeEvidence[]`,
  `deferredOrUnmet[]`, `iterationArtifactRefs[]` — exactly the canonical schema in the Proposal,
  defined ONCE in this module.
- `planEvidenceRows({ admission, charterAc, requiredEvidenceClass })` — consumes exactly ONE
  hash-bound `BuildAdmissionDecision` (from `gap-execute-milestone-build-admission-and-verification-fuse`)
  and materializes one planned row per charter AC with `{ acIndex, requiredClass, intendedCommand }`.
  The row stores an AC INDEX/ref, never AC prose (no second requirement authority, AC11).
- `validateManifestShape(manifest)` — structural validation; missing/duplicate rows and copied
  requirement text fail here with stable reason codes.
- `manifestRefForReceipt()` — produces the `evidenceManifestRef = { hash, path, candidateCommit }`
  the DIR-124-B receipt binds (implemented in Stage 5, exported here).

### Stage 3: implementation — `build-evidence-collector.ts`: deterministic post-Build collection + canonical artifact resolver

- Kind: code
- AC: 3, 4, 5, 8
- Files: `experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts`, `plugin/scripts/build-evidence-collector.ts`, `experiments/quay-perpetual-stream/scripts/composite-build.ts`, `plugin/scripts/composite-build.ts`
- Command: `node --experimental-strip-types --test plugin/test/build-evidence-manifest.test.mjs` — the SAME file, no further edit: with `build-evidence-collector.ts` now present, the collector-dependent fixtures flip GREEN through their already-present dynamic imports (changedFiles-match AND changedFiles-contradiction both pass — the mechanically `git`-derived fields catch the agent-authored contradiction; plus stale-candidate, out-of-root, fabricated-runtime `observed:false` tagging, and valid singleton/composite). The gate and receipt-binding fixtures remain RED until Stages 4-5.

Symbols:

- `collectBuildEvidence({ plannedRows, buildResult, workspace, milestoneRoot, git })` —
  deterministic, side-effect-free collection. Derives `baseCommit` / `candidateCommit` /
  `changedFiles` mechanically (`git rev-parse HEAD~0`, `git diff --name-only`) so an agent-authored
  contradiction cannot survive (AC3). Reconciles every planned row to one final disposition
  `satisfied|deferred|unmet|superseded` plus a raw evidence reference (AC5). Tags every entry
  `{ source, observed: boolean }` — mechanically observed facts (`observed:true`) are separated
  from agent-declared AC/runtime/deferred claims (`observed:false`), which are preserved as
  attributed claims, never upgraded to facts (AC4).
- Composite input: consumes `composite-build.ts`'s `PhaseEvidence` / `mapEvidenceToTasks` (M189/
  M210 installed surface) so singleton and composite Build reach the SAME collector and the SAME
  manifest schema (AC1).
- `resolveIterationArtifact({ ref, milestoneRoot, candidateCommit })` — routes every iteration
  artifact through `gate_resolve_milestone_root` (source `gate-script-lib.sh`); rejects out-of-root
  (`..`, absolute, symlink escape), missing, duplicate, or candidate-mismatched references with
  stable reason codes (AC8).

### Stage 4: implementation — `build-evidence-gate.ts`: mechanical BuildEvidenceGate + policy-authorized deferral

- Kind: code
- AC: 5, 6, 7, 8
- Files: `experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts`, `plugin/scripts/build-evidence-gate.ts`
- Command: `node --experimental-strip-types --test plugin/test/build-evidence-manifest.test.mjs plugin/test/build-evidence-gate.test.mjs` — gate fixtures flip GREEN (source-grep-for-real-workflow, mocked-workflow-for-real-journal, authorized-deferral, missing/pending/unmet/unreferenced-required, weaker-than-required, stable-reason-code fixtures pass); the receipt-binding fixture remains RED until Stage 5.

Symbols:

- `runBuildEvidenceGate(manifest, { policy, evidenceClasses })` → `{ ok, reason, reasonCode,
  disposition }` with STABLE reason codes: `missing-planned-ac`, `duplicate-ac`,
  `pending-required-row`, `unmet-required-row`, `weaker-than-required`,
  `unreferenced-required-evidence`, `out-of-root-ref`, `stale-candidate`, `hash-mismatch`.
- Evidence-class lattice `source < unit < integration < real-workflow < cross-generation`: a
  required `real-workflow` row satisfied by source grep or mocked execution is rejected; a required
  `cross-generation` row satisfied by same-generation evidence is rejected (AC5).
- A weaker-than-required disposition may proceed ONLY with a policy-authorized deferral signed by
  the evidence-gate's self-contained deferral policy (defined in THIS module, not DIR-124-D — see
  Dependencies), which remains visible in the manifest's `deferredOrUnmet[]` rows, the DIR-124-B
  receipt (via the manifest ref), and the Audit prompt; a Build-producer self-exemption has no
  authority (AC7). The deferral policy is a local contract of `build-evidence-gate.ts` scoped to
  weaker-evidence authorization only — it is NOT a general execution-policy registry (DIR-124-D's
  future, exclusive scope), so M238 neither consumes nor duplicates DIR-124-D. Gate `ok:false` →
  zero downstream dispatch (AC6).

### Stage 5: implementation — DIR-124-B Build receipt binds exactly one manifest

- Kind: code
- AC: 9
- Files: `experiments/quay-perpetual-stream/scripts/build-evidence-manifest.ts`, `plugin/scripts/build-evidence-manifest.ts`
- Command: `node --experimental-strip-types --test plugin/test/build-evidence-manifest.test.mjs` — the receipt-binding fixture flips GREEN: the fixture builds a real `StageReceiptEnvelope` (consumed from the installed DIR-124-B `*stage-receipt*` module) with `evidenceManifestRef`, mutates the manifest bytes / candidate commit, and asserts the receipt validation fails closed (`hash-mismatch`).

Behavior: the workflow passes `manifestRefForReceipt()` output into DIR-124-B's Build
`StageReceiptEnvelope` so the receipt hash-binds EXACTLY one manifest (AC9). The receipt carries the
reference hash, never a copy of manifest content (AC11 adjacency). This stage is a HARD STOP if the
DIR-124-B `*stage-receipt*` module is not yet installed — consuming a not-yet-installed contract by
inventing a transitional duplicate is explicitly prohibited by the task's DoD.

### Stage 6: implementation — production wiring in both `execute-milestone.js` mirrors + Audit bounded-index consumption

- Kind: code
- AC: 1, 6, 10
- Files: `.claude/workflows/execute-milestone.js`, `plugin/workflows/execute-milestone.js`
- Command: `node --experimental-strip-types --test plugin/test/execute-milestone-build-phase-gate.test.mjs plugin/test/execute-milestone-preparation-gate.test.mjs` — MUST stay GREEN (the M208 positive Build gate and the DIR-117 preparation gate are upstream and untouched); plus a grep that each mirror has exactly one BuildEvidenceGate invocation between the Build result gate and the first Audit `agent()` dispatch.

Behavior: after the existing `buildResult?.outcome !== 'done'` gate (M208) passes, the workflow
runs `runBuildEvidenceGate(...)`; on `ok:false` it returns
`{ outcome: 'needs-human', reason: <reasonCode>, phase: 'BuildEvidenceGate', verifyCacheUpdates }`
and dispatches ZERO Audit/Gate/Land work (AC6). On `ok:true` it writes the manifest under the
canonical milestone root and feeds its `evidenceManifestRef` + the bounded index into the Audit
agent's prompt. The single `buildResult` (whether produced by a direct `agent(...)` call or by
`_compositePhaseDagBuild()`'s per-phase agents) feeds the single positive-result gate, so singleton,
composite, and concurrent Build paths all reach BuildEvidenceGate (AC1). Audit is instructed to
treat the manifest as an index ONLY and to inspect referenced raw artifacts independently (AC10).

### Stage 7: GREEN — full suite, mirror byte-identity, canonical discovery, vendor-sync

- Kind: code
- AC: 1, 12
- Files: `experiments/quay-perpetual-stream/test/build-evidence-manifest.test.mjs`, `plugin/test/build-evidence-manifest.test.mjs`, `experiments/quay-perpetual-stream/test/build-evidence-gate.test.mjs`, `plugin/test/build-evidence-gate.test.mjs`, `experiments/quay-perpetual-stream/scripts/build-evidence-manifest.ts`, `plugin/scripts/build-evidence-manifest.ts`, `experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts`, `plugin/scripts/build-evidence-collector.ts`, `experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts`, `plugin/scripts/build-evidence-gate.ts`
- Command: `scripts/test.sh plugin/test/build-evidence-manifest.test.mjs plugin/test/build-evidence-gate.test.mjs && diff experiments/quay-perpetual-stream/scripts/build-evidence-manifest.ts plugin/scripts/build-evidence-manifest.ts && diff experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts plugin/scripts/build-evidence-collector.ts && diff experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts plugin/scripts/build-evidence-gate.ts && diff experiments/quay-perpetual-stream/test/build-evidence-manifest.test.mjs plugin/test/build-evidence-manifest.test.mjs && diff experiments/quay-perpetual-stream/test/build-evidence-gate.test.mjs plugin/test/build-evidence-gate.test.mjs && bash plugin/scripts/sync-vendor.sh --check && scripts/test.sh` — every `&&` segment exits 0.

The canonical `plugin/test/*.test.mjs` discovery (via `scripts/test.sh`) runs both new suites GREEN;
every mirror `diff` is empty (byte-identical modules and tests, AC12); `sync-vendor.sh --check`
reports no drift; and the full `scripts/test.sh` suite stays green (no regression in the
`execute-milestone-*` gate tests or the composite suite).

### Stage 8: real-callsite evidence, negative control, and a fresh independent audit

- Kind: prose
- AC: 10
- Files: `tasks/gap-build-evidence-manifest-missing.md`, `docs/proposals/quay-prepare-execute-feedback-convergence.md`, `docs/proposals/quay-execute-milestone-build-efficiency.md`, `experiments/quay-perpetual-stream/scripts/composite-build.ts` (real-callsite WITNESS ONLY — the singleton/composite dispatch path this stage's live dispatch exercises and audits; NOT an edit target — composite-build.ts's edits are entirely Stage 3's)
- Command: a real non-fixture milestone dispatch (one singleton and one composite candidate) that emits a manifest and a Build receipt bound to it; a production-equivalent negative control that omits/downgrades one required evidence row and is stopped by BuildEvidenceGate BEFORE any Audit agent dispatch; then a fresh independent audit agent verifies the production call graph, manifest/receipt hashes, canonical path resolution, and observer independence, and independently checks at least one referenced raw artifact to catch a deliberately false producer claim. Real output pasted, not asserted; the task's DoD checkboxes and Human-verification answers recorded, with a fresh `quay gate`/DoD run at Land. In the same task-body edit, the task's stale `## Touches` plan path `docs/plans/M238-gap-evidence-manifest.md` is corrected to this file's path (`docs/plans/M238-gap-build-evidence-manifest-missing.md`) — precedent a3582cb3 "fix: plan paths into Touches sections" — so the task's authoritative touch set is complete and consistent with this Plan's path.

## Line budget

~450-550 added lines of module code (`build-evidence-manifest.ts` ~200, `build-evidence-collector.ts`
~170, `build-evidence-gate.ts` ~140), plus ~600-800 lines of test fixtures across the two test files
(mirror-counted once). ~30-50 lines of workflow wiring across the two `execute-milestone.js`
mirrors. Well within the small-milestone norm for a capability-growth method-infra surface.

## Guardrails / rollback / real-landing verification

- **Guardrail (no second requirement authority):** the manifest and its planned rows store AC
  indices and references, never copied task/charter/Proposal/Plan prose (AC2/AC11). The existing
  `it0-dod-check.mjs` meta-enforcer and `anti-gaming-guard.sh` remain the arbiters; the manifest's
  own `satisfied` disposition has NO authority over independent Audit (AC10).
- **Guardrail (fail-closed):** `BuildEvidenceGate` returns `ok:false` → `needs-human` with a stable
  reason code and dispatches zero Audit work. Any structural incompleteness, evidence-class
  incompatibility, or missing/unverified reference stops before Audit. The M208 positive Build
  result gate stays upstream and untouched.
- **Rollback:** all changes land as ordinary commits; revert is `git revert` of the Build commit.
  Because the gate is fail-closed, a regression surfaces as blocked/REFUTED milestones, not silent
  acceptance — no special rollback machinery is introduced.
- **Real-landing verification (task DoD):** one real non-fixture milestone emits a manifest, a
  DIR-124-B Build receipt bound to it, and an independent Audit that follows its references; a real
  or production-equivalent negative control is stopped by BuildEvidenceGate before any Audit
  dispatch; a fresh audit verifies the production call graph, manifest/receipt hashes, canonical
  path resolution, and observer independence. The halt clause covers the FIVE named dependencies in
  Dependencies (M208, M210 evidence-path, DIR-119-D2, DIR-124-B, admission-fuse): if any of those
  installed production paths is absent at execute time, the milestone halts (needs-human) rather
  than inventing a transitional duplicate. DIR-124-D is deliberately NOT among them (see
  Dependencies) — M238 does not consume it, so its absence neither halts the milestone nor is
  papered over by a stub.
- **Serialization:** in the default (no-isolation) path this dispatch must never overlap another
  execute-milestone dispatch on the shared checkout (DIR-123 convention).

## Plan-check stopping rule

Standardized stopping rule: at most **3** Plan-check rounds; success only at **F_i = 0** (zero
unresolved findings). This Plan is authored to pass `validatePlanStructure` on the first check —
every one of the task's 12 `## Acceptance Criteria` indices appears in at least one stage's `- AC:`
list, and every stage names real files and a mechanical `- Command:` — and any grounded Plan-check
finding is resolved within the 3-round cap.
