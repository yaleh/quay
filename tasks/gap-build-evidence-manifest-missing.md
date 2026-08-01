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

### Problem framing (grounded in current code)

#### The evidence hand-off gap

`execute-milestone.js` Build phase (both mirrors at `.claude/workflows/` and `plugin/workflows/`,
byte-identical, 1204 lines each) produces a sparse return shape: `{ outcome, taskId, mergeCommit,
iterationCount }` (width-1 path, lines 479-484; composite path via `_compositePhaseDagBuild()` at
lines 283-385 returning the same shape at line 385). The Build agent also writes a prose iteration
report to `<MILESTONE_ROOT>/iterations/iteration-0.md` (width-1 lines 470-475; composite
`build-integrate` line 367). This prose report plus the `buildResult` object are the complete
evidence-transfer boundary.

The downstream Acceptance Audit agent (width-1 lines 693-747; composite per-shard dispatcher
`_compositePerShardAudit()` lines 561-670) receives only: `Build outcome:
${JSON.stringify(buildResult)}` interpolated into its prompt, plus verbatim `mergeCommit` for git
inspection. It must independently:

1. Discover changed files by running `git diff` / `git show` against `mergeCommit` (prompt-level
   instruction at line 699 "citing the concrete artifact/test output/diff")
2. Locate test commands and results from prose iteration report or re-run them
3. Re-derive which AC each piece of evidence addresses
4. Determine whether any AC is missing evidence entirely
5. Check whether evidence class (source grep vs. real workflow journal, etc.) matches what the AC
   actually requires

Every Audit agent is a fresh context -- it has NOT seen the Build. It rediscovers this evidence
from scratch on every milestone. M203's experience (static call-count evidence presented for
real-workflow-requiring clauses in the `acEvidence[].evidenceClass` field) demonstrates that
without a mechanical pre-Audit gate flagging evidence-class mismatch, a diligent semantic agent can
accept weaker-than-required evidence.

#### Current evidence collection infrastructure (composite path only)

The composite Build path already collects per-phase evidence: each `build-phase-<id>` worker returns
`{phaseId, outcome, files, tests}` (lines 342-348), and `build-integrate` collects these into a
`PhaseEvidence[]` JSON file at `/tmp/composite-build-evidence-<milestone>-<taskId>.json` (line 361)
and runs `composite-build.ts --map-evidence-json` (line 369) to produce `TaskEvidenceReport[]` JSON.
However, this is a `build-integrate` agent prompt instruction -- it is not a mechanical,
structurally-validated manifest, and it is not surfaced to Audit as a bounded index. The
`PhaseEvidence` interface (in `composite-build.ts`, lines 121-126) is `{phaseId: string, files:
string[], commits: string[], tests: string[]}`. The `mapEvidenceToTasks()` function (lines 136-157)
folds per-phase evidence into per-task `TaskEvidenceReport[]` by iterating phase->task mappings.
Both are already exported and used by the `--map-evidence-json` CLI mode, and represent the existing
evidence shapes the collector must consume without introducing a new taxonomy. But the mapping folds
into the iteration report prose and is not surfaced to Audit as a bounded, machine-readable index.
The width-1 path has no equivalent collection at all -- the single agent's evidence is purely prose.

#### What the gap costs

- **Discovery cost**: Audit agents spend turns rediscovering changed files, running `git diff`,
  finding test output, and matching evidence to ACs -- work Build already performed.
- **Omission invisibility**: A missing AC evidence reference is not visible until Audit reads all
  the prose and realizes it is absent. There is no `plannedAcEvidence[3]` row whose `disposition ===
  'unmet'` would flag it mechanically before Audit dispatch.
- **Evidence-class blindness**: Nothing mechanically checks that an AC requiring "real workflow
  journal" evidence actually got a real workflow run rather than a source grep. M203 demonstrated
  this exact failure mode -- static call-count evidence was accepted for clauses that required real
  workflow journals.
- **No hash binding**: The candidate commit is stated in prose only; no receipt binds it to the
  evidence collectively. A moved commit or a rewired manifest is undetectable.

#### Dependency context (as of 2026-08-01, confirmed via task store reads)

Five dependencies are named in the task body. Current status:

1. **`gap-build-phase-null-result-not-gated` (M208) -- DONE.** The Build null-result gate at lines
   490-493 now uses `buildResult?.outcome !== 'done'` as a positive-outcome check. A
   terminally-errored Build agent returns `needs-human` before any Audit dispatch -- a necessary
   precondition for a manifest that Audit will consume.

2. **`gap-build-phase-iteration-evidence-path-not-single-sourced` (M204) -- DONE.** Build's
   iteration report path is now resolved via `gate_resolve_milestone_root` (lines 470-475), the same
   single-sourced resolver Audit and Land use. The manifest collector reuses this same resolver for
   artifact references.

3. **`DIR-119-D2` (M210) -- PARTIALLY DONE.** The composite per-phase DAG dispatcher
   (`_compositePhaseDagBuild()`) and `--plan-json`/`--map-evidence-json` CLI modes in
   `composite-build.ts` are wired in production. A real composite dispatch proof run is not yet
   completed, but the code is landed and byte-identical across mirrors. The manifest collector
   consumes the same `PhaseEvidence[]` shape that `build-integrate` already collects via the JSON
   file at line 361, and calls the same `mapEvidenceToTasks()` function (line 136) for task-phase
   attribution.

4. **`DIR-124-B` (M236) -- TODO.** Will define `RunIdentity`, `StageReceiptEnvelope`, and
   hash-binding. This task designs the manifest's `runIdentity` and `buildAdmissionRef` fields to be
   a structural subset of DIR-124-B's contracts so integration is a field read, not a redesign. When
   DIR-124-B lands, the manifest's own receipt hash is set into `StageReceiptEnvelope.manifestHash`
   (AC10 of DIR-124-B: "A receipt can validate a hash-bound Build evidence-manifest reference").
   Explicit non-goal: this task does not implement `RunIdentity`/`StageReceiptEnvelope` itself.

5. **`gap-execute-milestone-build-admission-and-verification-fuse` (M248) -- TODO.** Will define
   `BuildAdmissionDecision` with `requiredEvidence[]` -- the planned evidence rows, one per charter
   AC with required evidence class. Until that dependency lands, the collector produces
   `buildAdmissionRef: null` and `plannedAcEvidence: []`, and the gate rejects with reason code
   `build-admission-unavailable` -- fail-closed, never vacuously complete.

#### The shared vs. composite dispatch surface

The manifest must serve both call shapes. The `execute-milestone.js` Build phase dispatches:

- **Width-1 / singleton**: one `agent()` call (line 439), returning `{outcome, taskId, mergeCommit,
  iterationCount}`. The single Build agent writes a prose iteration report plus any test artifacts.
- **Composite (width > 1)**: `_compositePhaseDagBuild()` returns the same shape via
  `build-integrate` agent (line 385). Internally it already collects `PhaseEvidence[]` at line 361.

The manifest collector is a post-Build, pre-Gate step. It reads: (a) the Build result
(`mergeCommit`), (b) the BuildAdmissionDecision file (when available), (c) git state (`git
merge-base`, `git diff --numstat`), (d) per-phase evidence JSON from composite builds or parsed
iteration report artifacts from width-1 builds, and (e) raw artifact references on disk. Its output
is the `BuildEvidenceManifest` JSON written to `<MILESTONE_ROOT>/build-evidence-manifest.json`,
resolved via `gate_resolve_milestone_root` -- the same single-sourced resolver M204 established as
the ONE authoritative path-prefix rule.

The collector's invocation is IDENTICAL across singleton and composite paths -- only the input
evidence shape differs (a single agent's iteration report vs. per-phase PhaseEvidence[]). The
manifest schema and validation are shared.

### Chosen mechanism

#### Architecture: three modules + one gate registration + workflow wiring

All new modules follow the existing byte-identical mirror pattern (DIR-119-D2/D3/D4 precedent),
authored in `experiments/quay-perpetual-stream/scripts/` and byte-copied to `plugin/scripts/`:

1. **`build-evidence-manifest.ts`** -- canonical TypeScript module defining: the
   `BuildEvidenceManifest` schema (versioned JSON shape), `BuildAdmissionDecision` consumption,
   `planEvidenceRows()` (1:1 projection of `requiredEvidence[]` to `plannedAcEvidence[]`),
   `validateManifestShape()` (structural validation rejecting duplicate AC mappings, copied
   requirement text, and schema violations), `isEvidenceClassCompatible(required, actual): boolean`
   (mechanical comparison against the strict total order), and `manifestRefForReceipt()` (produces
   `{hash, path, candidateCommit}` for DIR-124-B receipt binding). This is the single source of
   truth for the manifest shape; every production and test consumer imports from here.

2. **`build-evidence-collector.ts`** -- deterministic post-Build collection for both singleton and
   composite paths. Exported function `collectBuildEvidence(opts)` and a CLI mode (`--build-result
   <json> --admission-decision <path> --milestone-root <path> --workspace <path>
   [--per-phase-evidence <path>] [--iteration-report <path>] --output <path>`). Derives git fields
   mechanically (`git merge-base origin/master <candidate>`, `git diff --numstat
   <base>..<candidate>`). Reconciles every planned row with actual commands/artifacts to produce a
   final `disposition`. Tags entries with `producer` provenance (`"mechanical"` or
   `"build-agent"`). Resolves every iteration artifact through `gate_resolve_milestone_root` --
   never hand-derived.

3. **`build-evidence-gate.ts`** -- mechanical gate between Build and Audit. Exports a
   `GateFn`-conformant function `buildEvidenceGate(task, client)` compatible with the QENG gate
   registry interface. Validates: structural completeness, evidence-class compatibility against the
   strict total order `source < unit < integration < real-workflow < cross-generation`, reference
   integrity (in-root, hash-match, stale-candidate detection). Returns stable reason codes. Carries
   a self-contained weaker-evidence deferral policy (scoped to evidence-gate authorization only --
   NOT a stub for DIR-124-D's future general execution-policy registry).

4. **Gate registration**: `build-evidence` is registered as a workspace gate via `.quay/gates.yml`
   (resolved by `loadWorkspaceGates()` at `registry.ts` line 119), pointing to the TypeScript module
   that exports `buildEvidenceGate`. This follows the existing workspace-gate pattern rather than
   adding a new built-in -- the gate is experiment-specific infrastructure, not a product built-in
   like `dod` or `acceptance`.

5. **Workflow wiring** (minimal, additive edit to `execute-milestone.js` in both mirrors): see
   Concrete control and data flow below.

#### Why a mechanical collector, not an agent

The collector is a deterministic TypeScript script invoked via `node --experimental-strip-types`,
not a dispatched `agent()` call using LLM judgment. It runs git queries, reads files, computes
sha256, and performs structural reconciliation of planned vs. actual rows. This makes its behavior
deterministic, testable with RED/GREEN fixtures, and independent of the Build agent's context.

Design note on the agent wrapper: the collector itself is a deterministic TypeScript script with
zero LLM judgment. The `agent()` call wrapping it in `execute-milestone.js` is a workflow-DSL
necessity -- the Workflow engine dispatches steps through labeled agents and has no native
`exec`/`spawn` capability. The agent's prompt is a mechanical "run this exact command and return the
result" instruction, not a semantic task. The command string is fully determined by the workflow;
the agent adds no interpretation.

#### BuildEvidenceManifest schema (canonical)

```
BuildEvidenceManifest {
  schemaVersion: string               // "1"
  runIdentity: {
    milestoneId: string               // e.g. "M238"
    taskIds: string[]                 // all member task ids
    composite: boolean
    attempt: number
    sessionId: string                 // CLAUDE_CODE_SESSION_ID of Build dispatch
  }
  buildAdmissionRef: {
    decisionFile: string              // path to BuildAdmissionDecision JSON
    decisionHash: string              // sha256 of decision bytes
  } | null                           // null ONLY when dependency not yet landed (fail-closed at Gate)
  baseCommit: string
  candidateCommit: string
  changedFiles: {
    path: string
    additions: number
    deletions: number
  }[]
  testsRun: {
    command: string
    exitCode: number
    outputPath: string               // path to captured test output artifact
    scope: "affected" | "module" | "mirror" | "full-suite" | "integration"
  }[]
  plannedAcEvidence: {               // one row per charter AC, from BuildAdmissionDecision
    taskId: string
    acIndex: number
    requiredClass: "source" | "unit" | "integration" | "real-workflow" | "cross-generation"
    plannedCommand: string
    plannedArtifact: string
  }[]
  acEvidence: {                      // reconciled: every planned row matched to actual
    taskId: string
    acIndex: number
    disposition: "satisfied" | "deferred" | "unmet" | "superseded"
    evidenceClass: "source" | "unit" | "integration" | "real-workflow" | "cross-generation"
    producer: "mechanical" | "build-agent"
    actualCommand: string            // exact command run, or empty if deferred/unmet
    actualArtifact: string           // path to raw artifact (relative to milestone root)
    artifactHash: string             // sha256 of artifact bytes, or empty if deferred/unmet
    detail: string                   // mechanical observation or agent-attributed claim
  }[]
  runtimeEvidence: {                 // agent-declared, NOT mechanically verified
    producer: string                 // always "build-agent" by construction
    claim: string                    // what the agent asserts happened
    artifactRef: string              // supporting file reference, if any
  }[]
  deferredOrUnmet: {
    taskId: string
    acIndex: number
    reason: string
    authorizedBy: string             // execution policy reference, or "none"
  }[]
  iterationArtifactRefs: {
    path: string                     // relative to milestone root
    hash: string                     // sha256
    kind: "iteration-report" | "test-log" | "build-log" | "audit-artifact" | "other"
  }[]
}
```

Note: `EvidenceClass` is the enum `"source" | "unit" | "integration" | "real-workflow" |
"cross-generation"` with strict total order `source < unit < integration < real-workflow <
cross-generation`.

#### Mechanism-claim wiring (DIR-117)

Every new call/dispatch/ownership/enforcement relationship claimed below is flagged explicitly so
the review phase can check for a matching AC:

- **[Claim W1]** The post-Build collector (a mechanical TypeScript script invoked through a
  formulaic `agent()` helper, not a semantic agent) is invoked by `execute-milestone.js` between
  the Build result gate (`buildResult?.outcome !== 'done'` at lines 490-493) and the
  `phase('Gate')` dispatch (line 769) -- exactly once for both width-1 singleton and composite
  call paths. The collector invocation branches only to select the input evidence source
  (`--per-phase-evidence` for composite, `--iteration-report` for width-1), never the manifest
  schema. (Must have a matching AC proving the collector runs at this exact control-flow point.)

- **[Claim W2]** `BuildEvidenceGate` (a named gate `"build-evidence"` registered in
  `.quay/gates.yml`, invoked via `quay gate --gate build-evidence <task-id>`) runs between Build
  and Audit in the Gate phase -- dispatch position: after the existing vmeta-lag, dash-budget,
  tree, worktree, and split-or-commit gates in the `parallel()` array at lines 800-810. A gate
  failure returns `needs-human` via the existing `gatesFailed` check (line 812) before
  `phase('Audit')` is entered, dispatching zero Audit agents. (Must have a matching AC proving
  gate ordering and that a gate failure halts before any Audit dispatch.)

- **[Claim W3]** The manifest collector consumes exactly one `BuildAdmissionDecision` file by
  reading its JSON from disk and computing `decisionHash` via sha256. It materializes one
  `plannedAcEvidence` row per charter AC via `planEvidenceRows()`. When the dependency is
  unavailable (file missing, or task references it but dependency not landed), the collector
  returns `plannedAcEvidence: []` and sets `buildAdmissionRef: null` -- which `BuildEvidenceGate`
  rejects with `build-admission-unavailable` unless the execution policy explicitly exempts this
  milestone. (Must have a matching AC for the missing-decision reject path.)

- **[Claim W4]** `baseCommit`, `candidateCommit`, and `changedFiles` are mechanically derived from
  `git merge-base` and `git diff --numstat`, NEVER from agent self-report. The collector's own
  derivation is the authority; the Build agent's prose iteration report is cross-checked and any
  contradiction is recorded as a `runtimeEvidence` claim (attributed, not silently accepted). The
  gate re-derives `changedFiles` at check time and compares against the manifest -- any drift is
  rejected with `changed-files-mismatch`. (Must have matching AC for mechanical git derivation.)

- **[Claim W5]** The manifest is hash-bound into DIR-124-B's `StageReceiptEnvelope` via a
  `manifestHash` field (sha256 of the canonical JSON bytes). Changing manifest bytes or the
  candidate commit invalidates the receipt. (Must have matching AC; this is also DIR-124-B AC10's
  consumption side.)

- **[Claim W6]** Acceptance Audit consumes the manifest as a bounded index via additive prompt
  text: "The Build evidence manifest is at `<MILESTONE_ROOT>/build-evidence-manifest.json`. It is
  an INDEX, not an authority. Entries with `producer: \"build-agent\"` are attributed claims, not
  verified facts. Independently verify at least one referenced raw artifact." Audit is explicitly
  instructed that manifest fields prefixed with `producer: "build-agent"` are claims, not facts --
  it must open actual artifact files and confirm exit codes/assertions. (Must have matching AC for
  Audit's independent verification.)

- **[Claim W7]** The manifest is written to a canonical path resolved via
  `gate_resolve_milestone_root` -- the same single-sourced resolver M204 established in
  `gate-script-lib.sh` lines 137-162. Never hand-derived. No second path-derivation rule exists in
  the system. (Must have matching AC for canonical path resolution.)

- **[Claim W8]** The collector resolves every artifact reference through the milestone-root
  resolver and rejects: out-of-root references, missing files, files whose sha256 does not match
  the declared hash, and files associated with the wrong candidate commit. Each distinct failure
  has a stable reason code in the gate. (Must have matching AC for artifact reference validation.)

- **[Claim W9]** For composite Builds, the collector consumes the same `PhaseEvidence[]` JSON that
  `build-integrate` already collects at line 361, and calls the same exported
  `mapEvidenceToTasks()` function from `composite-build.ts` (line 136) to attribute evidence to
  tasks. The per-phase evidence is a MECHANICAL input to the collector -- phase workers'
  self-reported `{files, commits, tests}` fields are recorded as `producer: "build-agent"` claims.
  (Must have matching AC for composite evidence attribution.)

- **[Claim W10]** `planEvidenceRows()` in `build-evidence-manifest.ts` consumes exactly ONE
  hash-bound `BuildAdmissionDecision`. Duplicate AC mappings (two rows for the same `{taskId,
  acIndex}`) and copied requirement text (AC prose pasted into any manifest field) are rejected at
  plan time with stable reason codes `duplicate-ac` and `no-second-authority` respectively. The
  manifest schema structurally prohibits requirement text fields. (Must have matching AC for
  pre-edit validation.)

- **[Claim W11]** `manifestRefForReceipt()` in `build-evidence-manifest.ts` produces `{hash: sha256
  of manifest bytes, path: manifest path under milestone root, candidateCommit}`. The workflow
  passes this reference into DIR-124-B's Build `StageReceiptEnvelope` so the receipt hash-binds
  exactly one manifest. (Must have matching AC for receipt binding.)

- **[Claim W12]** The gate's self-contained deferral policy (defined in `build-evidence-gate.ts`)
  authorizes weaker-evidence deferrals. It is scoped exclusively to evidence-gate authorization --
  NOT a stub for DIR-124-D's future general execution-policy registry. A deferral entry with
  `authorizedBy: ""` or `"none"` is rejected as `unauthorized-deferral`. The Build producer cannot
  exempt itself from evidence requirements. (Must have matching AC for deferral authorization.)

#### BuildEvidenceGate: pre-Audit mechanical gate

Registered as a workspace gate in `.quay/gates.yml`, invoked as:

```
quay gate --gate build-evidence <primary-task-id> --manifest <milestone-root>/build-evidence-manifest.json
```

The gate reads the manifest JSON and checks:

| Condition | Reason code | Blocks? |
|---|---|---|
| Manifest file missing or unparseable | `manifest-missing` | YES |
| `schemaVersion` unknown | `manifest-schema-unknown` | YES |
| `candidateCommit` empty or not a valid SHA | `candidate-commit-invalid` | YES |
| `buildAdmissionRef` is null AND BuildAdmission dependency is required by execution policy | `build-admission-unavailable` | YES |
| `plannedAcEvidence.length === 0` (non-vacuous) | `no-planned-evidence` | YES |
| Any `plannedAcEvidence` row has no matching `acEvidence` row (by `{taskId, acIndex}`) | `planned-ac-unmatched` | YES |
| Any `acEvidence` row has `disposition === "unmet"` | `required-evidence-unmet` | YES |
| Any `acEvidence` row has `disposition === "satisfied"` but `evidenceClass` weaker than `requiredClass` | `evidence-class-mismatch` | YES |
| Any `acEvidence` row has `disposition === "deferred"` with `authorizedBy === "none"` or empty | `unauthorized-deferral` | YES |
| Any `iterationArtifactRefs` entry points to a path outside the milestone root | `artifact-out-of-root` | YES |
| Any `iterationArtifactRefs` entry has a path whose on-disk sha256 does not match declared `hash` | `artifact-hash-mismatch` | YES |
| More than one `acEvidence` row maps to the same `{taskId, acIndex}` (duplicate) | `duplicate-ac-evidence` | YES |
| `changedFiles` derived from git differs from manifest `changedFiles` | `changed-files-mismatch` | YES |

A gate PASS means zero blocking conditions. A gate FAIL returns the first blocking condition with
its reason code and detail. The Audit phase is NOT dispatched when the gate fails -- the workflow
returns `needs-human` via the existing `gatesFailed` path (lines 812-853).

The gate is NOT an acceptance gate (it does not evaluate whether ACs are met). It is a structural
completeness + evidence-class compatibility gate.

#### Weaker-evidence deferral: policy-authorized, not Build-self-exempt

When `evidenceClass` is weaker than `requiredClass` but the Build agent declares a legitimate reason
(e.g., "cross-generation proof requires the real next workflow run that has not yet occurred"), the
manifest records `disposition: "deferred"` with `authorizedBy` referencing a self-contained deferral
policy entry defined in `build-evidence-gate.ts`. The gate accepts this ONLY when `authorizedBy` is
a non-empty policy reference.

A Build agent self-declared deferral (`authorizedBy: ""` or `"none"`) is REJECTED by the gate with
reason code `unauthorized-deferral`. The Build producer cannot exempt itself from evidence
requirements.

The self-contained deferral policy is scoped exclusively to weaker-evidence authorization. It is NOT
a stub for or substitute for DIR-124-D's future general execution-policy registry. When DIR-124-D
lands, a follow-on milestone can re-wire the gate to consult the general registry while preserving
the same authorization surface for backward compatibility.

### Concrete control and data flow

#### Before (current, width-1 path)

```
Verify -> Prepared -> Build agent (one agent() call, lines 439-484)
                              |
                     Returns {outcome, taskId, mergeCommit, iterationCount}
                              |
                     Build null-result gate (lines 490-493)
                              |
                     Audit agent (lines 693-747)
                     Rediscovers: changed files via git diff,
                     test commands from iteration report prose,
                     AC-evidence mapping by reading task body
                              |
                     Gate phase (parallel, line 800):
                     vmeta-lag, dash-budget, tree, worktree, split-or-commit
                              |
                     Land
```

#### After (proposed, width-1 path)

```
Verify -> Prepared -> Build agent (unchanged prompt, lines 439-484)
                              |
                     Returns {outcome, taskId, mergeCommit, iterationCount}
                              |
                     Build null-result gate (lines 490-493, unchanged)
                              |
                     Build-Evidence phase (NEW):
                     Build Evidence Collector (deterministic shell command)
                     node .../build-evidence-collector.ts --build-result ... --milestone-root ... --output ...
                              |
                     build-evidence-manifest.json written to <MILESTONE_ROOT>/
                              |
                     Gate phase (parallel):
                     vmeta-lag, dash-budget, tree, worktree, split-or-commit,
                     build-evidence (NEW: quay gate --gate build-evidence <task-id>)
                              |
                     Audit agent (reads manifest as bounded index,
                     independently verifies raw artifacts)
                              |
                     Land
```

#### After (proposed, composite path)

```
Verify -> Prepared -> BuildAdmission -> build-plan -> build-phase-<id>[] -> build-integrate
                                                                                 |
                                                                    PhaseEvidence[] -> /tmp/composite-build-evidence-*.json
                                                                                 |
                                                                    Build-Evidence phase (NEW):
                                                                    Build Evidence Collector
                                                                    consumes PhaseEvidence[] +
                                                                    mapEvidenceToTasks() +
                                                                    BuildAdmissionDecision (when available)
                                                                                 |
                                                                      build-evidence-manifest.json
                                                                                 |
                                                                    Gate phase (parallel):
                                                                    ...existing gates + build-evidence
                                                                                 |
                                                                    audit-manifest-read -> audit-shard-<id>[] -> audit-combine
                                                                                 |
                                                                    Reconcile -> Land
```

#### Collector invocation (in execute-milestone.js, both mirrors)

After the Build null-result gate (line 493) and BEFORE `phase('Gate')` (line 769), the workflow
runs:

```js
// NEW: Build-Evidence phase -- deterministic shell command wrapped in a formulaic agent helper
phase('Build-Evidence')
const evidenceManifestFile = `/tmp/build-evidence-manifest-${_milestone}-${_primaryTaskId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
const collectorCmd = [
  `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts`,
  `--build-result '${JSON.stringify(buildResult)}'`,
  `--milestone-root $(source experiments/quay-perpetual-stream/scripts/gate-script-lib.sh && gate_resolve_milestone_root ${_milestone})`,
  `--workspace .`,
  `--output ${evidenceManifestFile}`,
  ...(perPhaseEvidenceFile ? [`--per-phase-evidence ${perPhaseEvidenceFile}`] : []),
  ...(admissionDecisionFile ? [`--admission-decision ${admissionDecisionFile}`] : []),
].join(' \\\n  ')

const collectorResult = await agent(
  `You are a MECHANICAL helper -- run EXACTLY the command below and capture its stdout.
Run:
${collectorCmd}
Then Read the output file and confirm it is valid JSON with a "schemaVersion" field.
Return {ok: <exit===0>, manifestPath: "${evidenceManifestFile}", manifest: <the parsed JSON>}.`,
  { label: 'build-evidence-collector', phase: 'Build-Evidence',
    schema: { type: 'object', required: ['ok', 'manifestPath'], properties: {
      ok: { type: 'boolean' }, manifestPath: { type: 'string' },
      manifest: { type: 'object', required: ['schemaVersion'], properties: {
        schemaVersion: { type: 'string' },
      } } } } }
)
if (!collectorResult?.ok) {
  return { outcome: 'needs-human', reason: 'build-evidence-collector-failed', phase: 'Build-Evidence', verifyCacheUpdates }
}
log(`Build evidence manifest written: ${collectorResult.manifestPath}`)
```

#### Gate phase integration

`BuildEvidenceGate` is added to the existing `parallel()` call at line 800, positioned after
`_splitOrCommitGates`:

```js
..._splitOrCommitGates,
() => agent(
  `${_gateWt}Run quay gate --gate build-evidence ${_primaryTaskId} --manifest $(source experiments/quay-perpetual-stream/scripts/gate-script-lib.sh && gate_resolve_milestone_root ${_milestone})/build-evidence-manifest.json.
   ${_typedMilestoneGateReturn} Non-zero = manifest structurally incomplete or evidence-class incompatible -> HARD BLOCK before Audit.`,
  { label: 'build-evidence', schema: _milestoneGateSchema },
),
```

#### Audit prompt integration

The Audit prompt gains an additive manifest reference paragraph (inserted before the existing charge
text at line 696):

```
MANIFEST REFERENCE (gap-build-evidence-manifest-missing): the Build evidence manifest is at
<MILESTONE_ROOT>/build-evidence-manifest.json. CONSUME IT AS AN INDEX: changedFiles, testsRun,
acEvidence[] with {taskId, acIndex, disposition, evidenceClass, actualArtifact}. Entries with
"producer":"build-agent" are ATTRIBUTED CLAIMS, not verified facts -- independently check the
referenced raw artifacts. A manifest field named "PASS" has NO authority.
```

This is additive prompt text. The existing AC/DoD audit charge (refute-first stance, concrete
artifact citation, mechanical gate run, session-ID capture) is unchanged.

### Key design decisions

1. **Manifest is an index, not an authority.** The manifest says "AC 3 evidence is at
   path/to/test.log with sha256 X" -- it does NOT say "AC 3 is satisfied." Audit must open
   `path/to/test.log`, read the exit codes/assertions, and decide for itself. The `disposition`
   field is the collector's mechanical observation (command ran, exit code 0, artifact exists), not
   a verdict on AC satisfaction.

2. **One schema, one canonical milestone-root resolver.** Singleton and composite Build paths
   produce the same `BuildEvidenceManifest` schema. The manifest is written to a single canonical
   path resolved via `gate_resolve_milestone_root` -- the same function at `gate-script-lib.sh`
   lines 137-162 that M204 established as the authoritative path-prefix rule, and the same resolver
   Audit/Land already use. No second path-derivation rule exists in the system.

3. **BuildAdmission is the sole source of planned evidence rows.** The collector never synthesizes a
   planned row from the task body, charter, or proposal. Every `plannedAcEvidence[]` entry is a 1:1
   projection of a `BuildAdmissionDecision.requiredEvidence[]` entry via `planEvidenceRows()`. When
   the BuildAdmission dependency is not yet available, the collector produces zero rows and the gate
   rejects the manifest -- fail-closed, never vacuously complete.

4. **Evidence-class compatibility is a mechanical comparison, not a semantic evaluation.** The five
   evidence classes form a strict total order: `source` (grep/static analysis) < `unit` (single
   module test) < `integration` (multi-module combined suite) < `real-workflow` (executed workflow
   dispatch with journal evidence) < `cross-generation` (evidence produced by a separate
   generation/run consuming this generation's output). `isEvidenceClassCompatible(required, actual)`
   returns `true` iff `actual >= required` in this ordering. This is a pure enum comparison -- no
   LLM judgment, no semantic interpretation.

5. **Git fields are mechanically derived and validated.** `baseCommit` and `candidateCommit` come
   from `git merge-base` and `buildResult.mergeCommit` respectively. `changedFiles` comes from `git
   diff --numstat`. The collector's derivation is authoritative; any contradiction with the Build
   agent's iteration report is recorded as an attributed claim. The gate validates that manifest
   `changedFiles` matches what `git diff` shows NOW.

6. **Build agent claims are attributed, never silently trusted.** Any evidence declared by the Build
   agent that the collector cannot mechanically observe is recorded in `runtimeEvidence[]` with
   `producer: "build-agent"`. Audit is explicitly instructed that these are claims, not facts.

7. **No requirement text duplication.** The manifest references ACs by `{taskId, acIndex}` only --
   it never copies AC text from the task body. The task file at `tasks/<taskId>.md` is the single
   source of truth for requirements. The manifest schema has no field for requirement text;
   `validateManifestShape()` structurally rejects any manifest bytes containing copied AC prose.

8. **Fail-closed on every unvalidatable state.** Missing manifest, missing BuildAdmission when
   required, missing planned AC row, duplicate AC mapping, weaker-than-required evidence,
   unauthorized deferral, out-of-root artifact, hash-mismatched artifact, and changed-files drift
   all fail closed BEFORE any Audit agent dispatch. Rejecting an incomplete manifest is cheaper than
   dispatching an Audit that silently accepts incomplete evidence.

9. **The collector is a deterministic shell command, not an LLM agent.** It runs as `node
   --experimental-strip-types .../build-evidence-collector.ts <args>`. Its behavior is pure: git
   queries + file reads + sha256 + structural reconciliation. No prompt interpretation, no semantic
   judgment. Fully testable with RED/GREEN fixture pairs. The `agent()` wrapper in
   `execute-milestone.js` is a workflow-DSL necessity, not a design choice -- the agent prompt is
   formulaic ("run EXACTLY this command"), not semantic.

10. **Composite evidence flows through existing infrastructure.** The collector consumes the same
    `PhaseEvidence[]` JSON that `build-integrate` already collects, and calls the same
    `mapEvidenceToTasks()` function from `composite-build.ts`. The collector is an ADDITIONAL
    consumer, not a replacement -- the existing iteration report and `--map-evidence-json` flow are
    unchanged.

11. **BuildEvidenceGate is a distinct gate, not folded into the M208 result gate.** The existing
    M208 gate checks whether the Build agent itself reported success (`outcome === 'done'`).
    BuildEvidenceGate checks whether the COLLECTED evidence is structurally complete and
    class-compatible. These are different concerns with different failure signals:
    `build-outcome-not-done` vs. `evidence-class-mismatch`. Keeping them separate makes the
    diagnostic surface explicit.

12. **Self-contained deferral policy, not DIR-124-D consumption.** DIR-124-D (execution-policy
    registry) is `status: todo` with no installed module. Blocking M238 on it would delay the
    evidence-transfer fix indefinitely. Instead, `build-evidence-gate.ts` carries its own narrow,
    evidence-gate-only deferral policy map keyed by policy name. This is explicitly scoped and does
    not duplicate DIR-124-D's future general registry. When DIR-124-D lands, a follow-on can
    re-wire the gate with zero change to the manifest schema or gate reason-code surface.

13. **Byte-identical mirroring through the existing vendor-sync path.** Following the precedent of
    `composite-build.ts`, `composite-contracts.ts`, and `composite-reconcile.ts`, new modules are
    authored in `experiments/quay-perpetual-stream/scripts/` and byte-copied to `plugin/scripts/`.
    `diff` between mirrors is mechanically checked. Tests under `plugin/test/` are discovered by
    `scripts/test.sh`'s canonical glob and `plugin/scripts/sync-vendor.sh --check` stays clean.

### Defaults and failure behavior

#### Default: successful Build, all evidence present and compatible

1. Build agent returns `{outcome: "done", mergeCommit: "<sha>"}`.
2. Build null-result gate (M208) passes.
3. Collector runs: derives git fields mechanically, reads BuildAdmissionDecision (when available),
   reconciles planned vs. actual rows, finds all artifacts at declared paths with matching hashes,
   all `evidenceClass >= requiredClass`.
4. Manifest written to `<MILESTONE_ROOT>/build-evidence-manifest.json`.
5. BuildEvidenceGate passes (all reason-code checks clear).
6. Existing gates pass.
7. Audit dispatched with manifest reference in prompt.

#### Failure: Build agent terminally errored

Covered by `gap-build-phase-null-result-not-gated` (M208) -- Build phase returns `needs-human` at
line 492 before any collector or Audit dispatch. The manifest is never produced. This path is
already proven in production.

#### Failure: collector script crashes or agent helper returns non-ok

`collectorResult.ok === false` or missing -> workflow returns `{outcome: "needs-human", reason:
"build-evidence-collector-failed", phase: "Build-Evidence"}`. Zero Audit agents dispatched.

#### Failure: Build admission unavailable (dependency not yet landed)

`buildAdmissionRef === null` -> `plannedAcEvidence: []`. Gate checks: if BuildAdmission is required
by execution policy -> reject with `build-admission-unavailable`. If the execution policy explicitly
exempts this milestone (e.g., pre-M248, policy says `build-evidence-gate: advisory`) -> gate passes
with a logged warning. Advisory mode is an explicit execution-policy toggle -- not a silent
fallthrough.

#### Failure: planned AC row unmatched

Gate scans `acEvidence[]` for a row matching each `plannedAcEvidence[]` entry by `{taskId,
acIndex}`. Any planned row with no matching actual row -> `planned-ac-unmatched` -> HARD BLOCK.

#### Failure: evidence class weaker than required

`requiredClass: "real-workflow"`, `evidenceClass: "source"` -> disposition `"unmet"`. Gate rejects
with `evidence-class-mismatch`. This is the exact failure mode M203 demonstrated.

#### Failure: unauthorized deferral

`disposition: "deferred"`, `authorizedBy: ""` or `"none"` -> Gate rejects with
`unauthorized-deferral`. The Build agent cannot self-exempt from evidence requirements.

#### Failure: artifact hash mismatch or out-of-root reference

Gate verifies every `iterationArtifactRefs[].path` is within the milestone root and its on-disk
sha256 matches the declared `hash`. Mismatch or traversal -> HARD BLOCK with distinct reason codes
`artifact-hash-mismatch` and `artifact-out-of-root`.

#### Failure: changed files drift

Gate re-derives `changedFiles` from `git diff --numstat base..candidate` and compares against the
manifest. Any difference -> `changed-files-mismatch` -> HARD BLOCK.

#### Advisory mode (execution policy toggle)

When the execution policy declares `build-evidence-gate: advisory`, the gate runs but does not block
-- it logs the reason codes and proceeds to Audit. This is the rollout path for existing milestones
pre-M248. Advisory mode is explicitly policy-authorized, not a silent default.

### Compatibility

#### Width-1 path (golden replay)

The existing width-1 Build agent prompt (lines 439-484) is UNCHANGED. The collector runs as an
additional step after the existing Build null-result gate, before the Gate phase. The Build agent's
contract (`{outcome, taskId, mergeCommit, iterationCount}`) is unchanged. The manifest reference in
the Audit prompt is additive text -- the existing AC/DoD audit charge is unchanged.

#### Composite path

The existing `_compositePhaseDagBuild()` (lines 283-386) is UNCHANGED. The `build-integrate` agent
already collects `PhaseEvidence[]` into `/tmp/composite-build-evidence-*.json` (line 361) and runs
`--map-evidence-json` (line 369). The collector consumes that same file -- it is an ADDITIONAL
consumer, not a replacement.

#### Existing tests

No existing test fixture exercises the manifest path (it does not exist yet). The
`execute-milestone-build-phase-gate.test.mjs` (M208),
`execute-milestone-preparation-gate.test.mjs` (DIR-117),
`prepare-milestone-preparation-e2e.test.mjs`, and `composite-build.test.mjs` suites continue to
pass unchanged.

#### Vendor-sync / plugin mirror

The collector, manifest, and gate modules plus test files are byte-identical across
`experiments/quay-perpetual-stream/` and `plugin/` mirrors, following the existing
mirror-maintenance pattern. The canonical test glob (`scripts/test.sh`) discovers both mirrors'
test files. `plugin/scripts/sync-vendor.sh --check` stays clean.

#### Migration path when DIR-124-B lands

When DIR-124-B's `RunIdentity` and `StageReceiptEnvelope` types land, the manifest's `runIdentity`
field is updated to match the canonical `RunIdentity` contract. The manifest schema version is
bumped to `"2"`. A v1 manifest is still structurally complete for Audit; the missing
`runIdentity.runId` field is treated as absent (Audit sees `runIdentity.runId` as undefined, not a
gate failure).

#### Migration path when BuildAdmission lands

When `gap-execute-milestone-build-admission-and-verification-fuse` (M248) lands, the
`--admission-decision` flag to the collector becomes a required parameter. Before M248, the
collector runs with `--admission-decision` omitted, produces `buildAdmissionRef: null`, and the
gate handles it per the execution policy toggle.

### Risks

1. **Build agent can still fabricate evidence claims.** The manifest records Build agent claims as
   `producer: "build-agent"` in `runtimeEvidence[]` -- attributed, not verified. The gate does NOT
   reject attributed claims; it only rejects missing/class-mismatched mechanical evidence.
   Mitigation: Audit is explicitly briefed that attributed claims are claims, not facts. The
   manifest makes the attribution explicit -- previously the claim was buried in prose with no
   mechanical flag. This is a NET improvement in observability, not a solved problem.

2. **The five evidence classes are a coarse taxonomy.** The ordering `source < unit < integration <
   real-workflow < cross-generation` captures broad categories but cannot distinguish between "unit
   test of a trivial helper" and "unit test of the core algorithm." Mitigation: this is a floor,
   not a ceiling. An AC that requires `integration` evidence can be satisfied by `real-workflow`
   evidence (higher class). The gate never downgrades evidence; it only rejects when actual <
   required. For ACs that genuinely need finer-grained classification, BuildAdmission's
   `requiredEvidence[]` carries the authoritative per-AC requirement.

3. **BuildAdmission dependency chain is long.** M248 depends on DIR-124-A, DIR-123, DIR-124-D, and
   gap-build-phase-null-result-not-gated -- five prerequisites. If M248 is not yet landed when M238
   executes, the manifest must operate in advisory mode or fail-closed. Mitigation: the gate
   rejects `build-admission-unavailable` unless the execution policy toggles advisory mode.

4. **Hash-binding to candidate commit creates a tight coupling.** If the candidate commit is
   rebased or amended after the manifest is written, the manifest's `candidateCommit` and
   `changedFiles` are stale. Mitigation: the collector runs IMMEDIATELY after `buildResult` is
   returned, before any other phase mutates the tree. Under worktree isolation (DIR-123), the
   worktree branch is untouched by other processes. The `changedFiles` mismatch check in the gate
   catches drift.

5. **The collector adds a process launch to the critical path.** Mitigation: it is a single `node`
   invocation reading git and JSON files -- milliseconds, not seconds. It does not run tests, does
   not shell out to npm, does not make network calls. The cost is negligible compared to the Build
   agent's typical duration.

6. **Manifest schema versioning adds a maintenance burden.** Mitigation: the schema is versioned
   from day one (`schemaVersion: "1"`). The gate rejects unknown versions. Consumers key off
   `schemaVersion` for migration logic. Standard API versioning practice.

7. **Dependency on in-flight modules (DIR-124-B, BuildAdmission).** Both M236 and M248 are
   in-flight. The manifest module's contracts (`manifestRefForReceipt`, `planEvidenceRows`) are
   pinned to the declared interfaces in their Plans. A materially different landing shape requires
   re-grounding. Mitigation: the gate module's entry points are narrow interfaces that act as
   explicit negotiation surfaces; a shape mismatch is a compile-time failure, not a silent runtime
   drift.

8. **DIR-124-D divergence.** If DIR-124-D lands a materially different deferral-policy shape from
   the self-contained policy in `build-evidence-gate.ts`, re-grounding is needed. Mitigation: the
   self-contained policy is explicitly scoped and namespaced; when DIR-124-D lands, a follow-on can
   re-wire the gate with zero change to the manifest schema or gate reason-code surface.

9. **The agent wrapper for the collector introduces a point of failure.** The collector command is
   deterministic, but the workflow-speaking agent that runs it could misinterpret the instructions.
   Mitigation: the agent prompt is a mechanical "run this exact command" instruction with a tight
   return schema. The command string is fully determined by the workflow, not by the agent. A
   failure here is a transient infrastructure error (agent crashed, timeout), not a semantic
   misinterpretation.

### Non-goals

1. **Not a Build/Audit redesign.** Build still produces a merge commit + iteration report. Audit
   still refutes-or-confirms independently. The manifest is an additive index between them.

2. **Not replacing Audit's independent verification.** The manifest `disposition` and `detail`
   fields are the collector's mechanical observations, not verdicts. Audit must still open
   referenced artifacts and decide for itself. A manifest `PASS` field (if any) has zero authority.

3. **Not creating a second requirement authority.** Task/charter/Proposal/Plan content is never
   copied into the manifest. The manifest references ACs by `{taskId, acIndex}` only. The task file
   remains the sole source of truth for requirements.

4. **Not implementing BuildAdmission, RunIdentity, or StageReceiptEnvelope.** These are owned by
   M248 and DIR-124-B respectively. This task designs for compatibility and consumes them when
   available, but does not implement them.

5. **Not changing Build agent prompts or contracts.** The Build agent's prompt and return schema
   are unchanged. Evidence collection is an external mechanical step.

6. **Not introducing per-phase worktree isolation for evidence collection.** Evidence files live in
   the same worktree (DIR-123) or shared checkout as the Build. The collector reads them where they
   are.

7. **Not adding retry or recovery logic.** A collector failure returns `needs-human`. The workflow
   does not retry.

8. **Not adding schema enforcement for Build agent return shape beyond `outcome`.** The collector
   consumes `mergeCommit` from the Build result; if absent, it fails with a clear error. Full
   schema validation of the Build result is DIR-124-A's scope.

9. **Not wiring the manifest into Reconcile or Land phases.** The manifest is a Build->Audit
   artifact. Reconcile and Land consume the Audit result, not the Build manifest directly. Land's
   CAPTURE step picks up the manifest file because it is under MILESTONE_ROOT, but Land does not
   read or validate it.

10. **Not adding cross-milestone evidence comparison or trend analysis.** The manifest is scoped to
    one Build of one milestone. Cross-milestone trends are DIR-124-A telemetry's scope.

11. **Not replacing the iteration report.** The human-readable iteration report (`iteration-0.md`)
    remains the canonical Build deliverable. The manifest is a machine-readable index of that report
    and its artifact references.

12. **Not implementing DIR-124-D execution-policy registry.** The self-contained deferral policy in
    `build-evidence-gate.ts` is scoped to evidence-gate authorization only.

### AC coverage mapping

Each AC from the task body is mapped to the concrete mechanism claim(s) that prove it:

- **AC1 (singleton and composite Build produce the same versioned manifest schema through real
  production callsites):** Claim W1 (collector invoked at same control-flow point for both paths) +
  Claim W9 (composite evidence through existing `PhaseEvidence[]` and `mapEvidenceToTasks()`). Both
  paths invoke the identical `build-evidence-collector.ts` with different input sources. The schema
  is the single `BuildEvidenceManifest` type.

- **AC2 (exactly one hash-bound BuildAdmission decision supplies one planned evidence row per
  charter AC before editing; missing/duplicate rows and copied requirement text fail validation):**
  Claim W3 (collector consumes exactly one BuildAdmissionDecision, projects `requiredEvidence[]`
  1:1 to `plannedAcEvidence[]`) + Claim W10 (`planEvidenceRows()` rejects duplicates and copied
  text at plan time). The manifest schema structurally prohibits requirement text fields.

- **AC3 (baseCommit, candidateCommit, and changedFiles are mechanically derived and match Git;
  agent-authored contradiction fails validation):** Claim W4. Collector runs `git merge-base` and
  `git diff --numstat`. Agent self-reported values are overwritten by mechanical derivation. Gate
  re-derives `changedFiles` and compares -- drift is rejected.

- **AC4 (test/result, AC, runtime, deferred, and iteration entries identify their evidence source
  and distinguish mechanically observed facts from producer claims):** The `producer` field on
  `acEvidence[]` entries is either `"mechanical"` (collector observed exit code/artifact
  existence/hash match) or `"build-agent"` (collector is relaying the agent's self-report).
  `runtimeEvidence[]` always has `producer: "build-agent"` by construction.

- **AC5 (every planned row has one final disposition and raw evidence reference; evidence-class
  compatibility rejects source grep/mocked execution for real-workflow requirements and rejects
  same-generation evidence for cross-generation requirements):** Every `acEvidence[]` row has
  required `disposition`. Evidence-class compatibility is the strict total order -- gate rejects
  any `evidenceClass < requiredClass`. Source grep for real-workflow: `"source" < "real-workflow"`
  -> reject. Same-generation for cross-generation: `"real-workflow" < "cross-generation"` ->
  reject.

- **AC6 (BuildEvidenceGate runs after every reachable singleton/composite Build and before Audit;
  missing, pending, unmet, weaker-than-required, or unreferenced required evidence dispatches zero
  Audit work and returns a stable typed result):** Claim W2. Gate is added to the existing
  `parallel()` call after `_splitOrCommitGates`. Gate failure returns a typed reason code. Workflow
  returns `needs-human` before `phase('Audit')` is entered. Zero Audit agents dispatched.

- **AC7 (explicit weaker-evidence deferral is accepted only when authorized by the bound execution
  policy, remains visible in the manifest/receipt/Audit prompt, and cannot be authored solely by
  the Build producer):** Claim W12. `authorizedBy` on deferred rows must be a non-empty policy key
  from the gate's self-contained deferral policy map. `authorizedBy: ""` or `"none"` is rejected.
  Deferral is visible in `deferredOrUnmet[]` and the individual `acEvidence[]` row.

- **AC8 (missing, duplicate, out-of-root, stale-candidate, or hash-mismatched artifact references
  fail closed with stable reason codes):** Claim W8. Gate checks every `iterationArtifactRefs[]`
  entry: path within milestone root, file exists, sha256 matches, candidate commit matches. Each
  failure has a distinct reason code.

- **AC9 (DIR-124-B Build receipt hash-binds exactly one manifest; changing manifest bytes or
  candidate commit invalidates the receipt):** Claim W5 (manifestHash in StageReceiptEnvelope) +
  Claim W11 (`manifestRefForReceipt()` produces `{hash, path, candidateCommit}`). Changing any
  manifest byte or candidate commit changes the sha256 -> receipt validation fails.

- **AC10 (Acceptance Audit demonstrably checks at least one referenced raw artifact and catches a
  deliberately false producer claim; never treats manifest conclusion as sufficient):** Claim W6.
  Audit prompt explicitly instructs independent verification of raw artifacts. RED fixture: plant a
  deliberately false claim in the manifest (e.g., `evidenceClass: "real-workflow"` but referenced
  artifact is empty) and confirm Audit catches it.

- **AC11 (task/charter/Proposal/Plan content is not copied into the manifest; no second requirement
  authority is created):** Manifest schema has no field for requirement text.
  `validateManifestShape()` rejects any manifest bytes containing copied AC prose. RED fixture:
  manifest with copied AC text fails validation with `no-second-authority` reason code.

- **AC12 (canonical/plugin modules and tests are byte-identical and pass vendor-sync plus canonical
  test discovery):** All new modules byte-identical across `experiments/` and `plugin/` mirrors.
  `diff` between mirrors is clean. `scripts/test.sh` discovers both mirrors' test files.
  `plugin/scripts/sync-vendor.sh --check` exits clean.

### Alternatives considered and rejected

1. **Post-hoc index alone, without pre-Build planned rows or mechanical pre-Audit gate.**
   Rejected. An index without planned rows cannot detect omissions -- it only describes what
   evidence WAS collected, not what was REQUIRED. Without a mechanical gate, the manifest is just
   more prose for Audit to evaluate. The pre-Build plan + post-Build reconciliation + pre-Audit
   gate combination is what makes omissions visible and class-mismatches mechanically rejectable.

2. **Making the manifest the producer's verdict (Build agent writes the manifest, declaring each AC
   satisfied).** Rejected. This collapses producer and observer independence -- the exact
   anti-pattern the separate Audit phase exists to prevent. The manifest MUST be mechanically
   collected from Build artifacts, not self-reported by the agent that produced them.

3. **Embedding requirement text in the manifest.** Rejected. This creates a second authority for
   requirements -- drift between task body and manifest copy is inevitable. The manifest references
   ACs by index only. The task body is the single source of truth.

4. **Separate manifest schemas for singleton vs. composite Build paths.** Rejected. Audit should
   not need to know whether the Build was width-1 or composite to consume the evidence index. One
   schema, one consumer.

5. **Running the collector inside the Build agent's own prompt (as part of the single Build agent
   call).** Rejected. The Build agent cannot mechanically verify its own work -- it produced the
   evidence and would be biased toward declaring it complete. The collector must be a separate
   invocation after Build returns, with no overlap in agent context.

6. **Skipping the manifest entirely and adding evidence-class requirements to the Audit prompt
   only.** Rejected. This is the current state: Audit must rediscover evidence and evaluate its
   class from prose alone. Without planned-vs-actual reconciliation, omissions are invisible. M203
   proved the semantic-agent-only approach is not reliable.

7. **Making the manifest a required field on the Build agent's return schema.** Rejected. This would
   require an LLM to produce valid, complete JSON matching a strict schema -- a reliability risk
   orthogonal to the Build task. A deterministic post-Build collector is testable; an LLM-produced
   JSON is not.

8. **Deferring all manifest logic to DIR-124-B (StageReceiptEnvelope).** Rejected. DIR-124-B
   defines the envelope and hash-binding infrastructure, not the manifest's evidence-specific
   content. The manifest is a content payload that fits inside a receipt envelope -- it has its own
   schema, collector, and gate logic that are evidence-specific. DIR-124-B's AC10 explicitly
   references a "hash-bound Build evidence-manifest reference" as a separate artifact.

9. **Adding evidence-class enforcement to Audit prompt prose only, not a mechanical gate.**
   Rejected. This is the exact gap this task exists to close -- prose instructions are paraphrased,
   skipped, or overridden by semantic agents. A mechanical gate with typed reason codes is
   deterministic and cannot be negotiated.

10. **Using the Build agent's self-reported changed files instead of mechanical git derivation.**
    Rejected. The Build agent can omit files, misreport paths, or fabricate. `git diff --numstat` is
    authoritative and cannot be forged by an agent prompt.

11. **Deferring the manifest until all five dependencies are done.** Rejected. The manifest can be
    implemented with fail-closed behavior for unavailable dependencies (advisory mode,
    `buildAdmissionRef: null` rejection). Waiting for M248 (which itself waits for DIR-124-A/D/E/D
    and DIR-123) would delay the evidence-transfer fix indefinitely.

12. **Storing the manifest in the task store or dashboard instead of the milestone root.**
    Rejected. The manifest is a Build artifact, not a task field or dashboard metric. It belongs
    with other Build artifacts under MILESTONE_ROOT. Land's mechanical CAPTURE step picks it up
    automatically because it is under MILESTONE_ROOT.

13. **Adding evidence fields to the existing buildResult return value.** Rejected. This would bake a
    flat, unversioned structure into the workflow DSL's return schema with no mechanical validation,
    no evidence-class lattice, no planned-vs-actual reconciliation, and no separation of mechanical
    facts from agent claims. The buildResult is a workflow-internal object; the manifest is a
    durable artifact consumed by Audit, receipts, and future cross-generation evidence queries.

14. **Consuming DIR-124-D for deferral authorization.** Rejected. DIR-124-D is `status: todo` with
    no installed module and no committed delivery timeline. Opening M238's deferral path to a
    general registry before it exists would force a stub (creating a transitional duplicate the DoD
    explicitly prohibits) or block M238 indefinitely. The self-contained deferral policy is the
    minimal surface needed for AC7.

15. **Embedding the full manifest in the DIR-124-B receipt.** Rejected. The receipt is a small,
    hash-bound envelope carrying references and provenance. Mixing a potentially large evidence
    index into it blurs the receipt's role as a lightweight stage-boundary artifact. Separation
    preserves single-responsibility design of both.

16. **Running BuildEvidenceGate inside the Build agent's own prompt.** Rejected. This would make the
    Build agent the judge of its own evidence completeness -- collapsing the independent
    verification the gate is designed to provide. The gate must be mechanical (deterministic code)
    and must run OUTSIDE the Build agent's context.

17. **Registering BuildEvidenceGate as a built-in product gate in
    `packages/quay/src/gate/registry.ts`.** Rejected. This gate is experiment-specific
    infrastructure, not a product built-in like `dod` or `acceptance`. Registering it as a
    workspace gate via `.quay/gates.yml` follows the existing pattern for workspace-specific gates
    and keeps the product surface clean. The gate's implementation is mirrored through the same
    vendor-sync path as the collector and manifest modules; the `.quay/gates.yml` entry points to
    the canonical path.

18. **Invoking the collector as a raw Bash tool call rather than through a mechanical agent
    wrapper.** Considered but rejected for the initial implementation. While a direct `Bash`
    invocation would be more deterministic, `execute-milestone.js`'s Workflow engine runs
    agent-labeled steps -- there is no `Bash`-equivalent in the workflow DSL. The agent wrapper
    with a tight "run this exact command" prompt is the available mechanism for injecting a
    deterministic shell command into the workflow DAG. A future refinement (DIR-124-A scope) could
    add a native `Script` block to the workflow DSL.

This is a narrow evidence-transfer task, not a Build/Audit redesign. It depends on
[[gap-build-phase-null-result-not-gated]], [[gap-build-phase-iteration-evidence-path-not-single-sourced]],
[[DIR-119-D2]], [[DIR-124-B]], and
[[gap-execute-milestone-build-admission-and-verification-fuse]]. [[DIR-124-C]] consumes the result
through its Build adapter.

## Plan

[`docs/plans/M238-gap-build-evidence-manifest-missing.md`](docs/plans/M238-gap-build-evidence-manifest-missing.md)

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

- `docs/plans/M238-gap-evidence-manifest.md`