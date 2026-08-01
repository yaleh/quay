# M240 Plan — execution manifest + execute-milestone Verify consumption

- **Milestone:** M240
- **Task:** `gap-prepare-milestone-no-size-aware-routing-B` — "Fast-lane execution manifest +
  execute-milestone Verify consumption": replace the standalone prose Plan with a derived,
  hash-bound **execution manifest** for fast-lane tasks, and make `execute-milestone.js`'s Verify
  phase consume it.
- **Charter:** `experiments/quay-perpetual-stream/charters/M240-gap-prepare-milestone-no-size-aware-routing-B.md`
  (GATE-HASH-REF `5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93`)
- **Base revision:** `65f414c4` (current HEAD short-sha at Plan authoring, 2026-08-01)
- **Class:** development · capability-growth (method-infra surface; a NEW mirrored module pair +
  a NEW mirrored fixture pair + a narrow prepare-path branch + a narrow execute Verify-path
  branch, all byte-identical across the canonical/plugin mirrors)
- **Prepared-gate note:** authored for the M195/DIR-117-B enforced-by-default Prepared gate.
  Manually authored (2026-08-01) after the just-adjudicated task body; the task's
  `## Proposal` / `## Acceptance Criteria` are the authoritative contract, and this Plan is the
  mechanical stage spec that `milestone-preparation-check.ts`'s `validatePlanStructure` parses
  (DIR-117 iteration-2 item 3 — every stage carries `### Stage <N>: <title>` + `- AC:` + `- Files:`
  + `- Command:`).
- **Dependencies:**
  - `gap-prepare-milestone-no-size-aware-routing-A` (M239, in flight) — `estimateTaskSize` +
    versioned `PrepareRoutingDecision` (`fast-lane` | `full-lane`) emitted by
    `prepare-milestone.js`'s Preflight phase. THIS child consumes the decision: when the route is
    `fast-lane`, prepare derives the hash-bound execution manifest in place of the checked Plan.
    The derivation module and all fixtures drive a directly-constructed `PrepareRoutingDecision`
    fixture and do NOT require A's production router; the Stage-6 real-dispatch evidence requires
    A's router to have landed. If the real fast-lane route is not producible at execute time, this
    milestone halts (needs-human) rather than fabricating a transitional duplicate.
  - In the serial path this dispatch must never run concurrently with another execute-milestone
    dispatch against the shared checkout (DIR-123 convention).

## Grounded facts (repo-runtime contract)

- Canonical test discovery runs `plugin/test/*.test.mjs` via `scripts/test.sh`; the
  `experiments/quay-perpetual-stream/test/` copies are the byte-identical mirror. New
  `*execution-manifest*` modules live in BOTH `experiments/quay-perpetual-stream/scripts/` and
  `plugin/scripts/`, edited to byte-identity (same discipline as `composite-build.ts` /
  `composite-reconcile.ts`, which are byte-identical real files in both trees today).
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (mirror
  `plugin/scripts/milestone-preparation-check.ts`) owns the ENFORCED-BY-DEFAULT Prepared gate:
  `checkPreparation()` returns `{ ok, code, message }` and fails closed with
  `plan-not-checked` (task `## Plan` still `N/A` — `NA_PLAN_RE`), `plan-reference-mismatch`
  (task `## Plan` does not reference `receipt.planFile`), `receipt-malformed` (no
  `hashes`/`planFile`), `proposal-stale`/`charter-stale`/`plan-stale`/`source-*`, and the
  `review`/`planCheck` finding gates (success only at `F_i = 0`, `plancheck-rounds-exceeded` at
  >3). It also owns `buildReceipt()` (the receipt-builder this task names) and
  `parsePlanStages`/`validatePlanStructure` (the mechanical Stage-shape floor). This is the file
  whose plan-reference path must be extended so a fast-lane receipt accepts the manifest as the
  plan artifact.
- `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` (mirror
  `plugin/scripts/prepare-admission-check.ts`) owns the Preflight CLI `--preflight` /
  `--preflight-plan` modes; `--preflight-plan` runs `validatePlanStructure(planBody, acCount)`
  (imported from `milestone-preparation-check.ts`) and gates PlanCheck round 1. For a fast-lane
  task whose plan artifact is the manifest, this shape gate must accept the manifest's
  schema-validated structure instead of failing on "plan has no `### Stage <N>` blocks".
- `.claude/workflows/prepare-milestone.js` (mirror `plugin/workflows/prepare-milestone.js`,
  both 1546 lines) has phases `Preflight` → `PlanAuthor` → `PlanCheck` → `Receipt`.
  `PlanAuthor` writes `_planFile = docs/plans/${_milestoneId}-${_slug}.md`, then
  `--preflight-plan --taskId ... --workspace . --planFile ${_planFile}` gates PlanCheck round 1,
  and `Receipt` writes `milestones/${_milestoneId}/preparation.json` via `buildReceipt`. The
  fast-lane branch slots in at the PlanAuthor decision point: when the routing decision is
  `fast-lane`, derive the hash-bound execution manifest in place of the checked Plan.
- `.claude/workflows/execute-milestone.js` (mirror `plugin/workflows/execute-milestone.js`,
  both 1204 lines) Phase `Verify` (step 4) runs the 5 it0 systematic-explore checks
  (`ceiling-check`, `gate-hash`, `line-budget`, `dogfood-evidence`, `domain-misfit`) plus
  `composite-preflight` (DIR-119-B), collects them into `allVerifyResults`, and fails closed with
  `verifyFailed = allVerifyResults.length < 6 || allVerifyResults.some(c => !c.ok)` →
  `{ outcome: 'needs-human', reason: 'it0-checks-failed', phase: 'Verify', verifyJournal, verifyCacheUpdates }`.
  The manifest Verify branch adds a seventh entry ONLY when a hash-bound manifest is present
  (fast-lane), preserving the legacy `< 6` invariant on the non-fast-lane path.
- Tests are run with the Node built-in runner (`scripts/test.sh` / `node --test`); expected exit
  codes are asserted per stage below. The upstream gate suites this milestone must not break live
  at `plugin/test/`: `execute-milestone-preparation-gate.test.mjs`,
  `execute-milestone-build-phase-gate.test.mjs`, `prepare-milestone-preparation-e2e.test.mjs`
  (experiments mirror: `milestone-preparation-check.test.mjs`).
- No `*execution-manifest*` file exists in either tree today (confirmed by filesystem scan) — this
  is genuinely new surface, and the RED fixtures fail on module-import before any assertion runs.

## Complete touch set

- `experiments/quay-perpetual-stream/scripts/execution-manifest.ts` — NEW: `ExecutionManifest`
  schema + `deriveExecutionManifest()` + `validateManifestShape()` + `manifestHashRef()`.
- `plugin/scripts/execution-manifest.ts` — byte-identical mirror.
- `experiments/quay-perpetual-stream/scripts/execution-manifest-verify.ts` — NEW:
  `runManifestVerify()` — the Verify-path consumption predicate with stable reason codes.
- `plugin/scripts/execution-manifest-verify.ts` — byte-identical mirror.
- `experiments/quay-perpetual-stream/test/execution-manifest.test.mjs` — NEW RED/GREEN fixtures
  (schema, derivation, hash-binding, no-Proposal/Plan-copy).
- `plugin/test/execution-manifest.test.mjs` — byte-identical mirror.
- `experiments/quay-perpetual-stream/test/execution-manifest-verify.test.mjs` — NEW RED/GREEN
  fixtures (AC1/AC4/AC5 — the Verify-path negative control).
- `plugin/test/execution-manifest-verify.test.mjs` — byte-identical mirror.
- `.claude/workflows/prepare-milestone.js` — fast-lane branch at the PlanAuthor decision point:
  derive the manifest in place of the checked Plan when the routing decision is `fast-lane`.
- `plugin/workflows/prepare-milestone.js` — byte-identical mirror.
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` — extend
  `checkPreparation()`/`buildReceipt()` so a fast-lane receipt's `planFile` is the manifest path
  (no `plan-not-checked`/`receipt-malformed` fail-closed on the manifest path).
- `plugin/scripts/milestone-preparation-check.ts` — byte-identical mirror.
- `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` — extend
  `--preflight-plan` so a fast-lane manifest (schema-validated structure) passes the plan-shape
  gate instead of failing `plan-no-stages`.
- `plugin/scripts/prepare-admission-check.ts` — byte-identical mirror.
- `.claude/workflows/execute-milestone.js` — Verify-phase manifest branch (consumes the manifest
  when present; missing AC→stage mapping fails Verify).
- `plugin/workflows/execute-milestone.js` — byte-identical mirror.
- `tasks/gap-prepare-milestone-no-size-aware-routing-B.md` — task body (`## Plan` reference,
  checklists on Land).
- `docs/plans/M240-gap-prepare-milestone-no-size-aware-routing-b.md` — this Plan (authoritative
  plan path; the receipt references THIS file).

### Stage 1: RED — execution-manifest fixtures and the Verify-path negative control

- Kind: code
- AC: 4, 5
- Files: `experiments/quay-perpetual-stream/test/execution-manifest.test.mjs`, `plugin/test/execution-manifest.test.mjs`, `experiments/quay-perpetual-stream/test/execution-manifest-verify.test.mjs`, `plugin/test/execution-manifest-verify.test.mjs`
- Command: `scripts/test.sh plugin/test/execution-manifest.test.mjs plugin/test/execution-manifest-verify.test.mjs` — MUST exit non-zero (RED): the fixtures import `execution-manifest.ts` / `execution-manifest-verify.ts`, none of which exist yet, so the import fails before any assertion runs.

Fixture matrix (each a distinct case, asserted with real pasted output at GREEN, not
asserted-as-expected):

- valid fast-lane manifest → `validateManifestShape` passes and `deriveExecutionManifest` emits a
  hash-bound manifest (AC1/AC2/AC5-positive);
- missing AC→stage mapping (an AC index in the task checklist absent from every stage's mapping)
  → `runManifestVerify` returns `ok:false` / `manifest-ac-mapping-missing` (AC4);
- duplicate AC→stage row → fails (`duplicate-ac-mapping`);
- copied Proposal/Plan prose pasted into the manifest or any stage → rejected
  (`no-second-authority`, AC2);
- touch-set entry not a real file in the workspace → fails (`touch-not-real`);
- evidence mapping references a stage with no command → fails (`stage-missing-command`);
- manifest bytes mutated after derivation → `manifestHashRef` mismatch fails closed
  (`hash-mismatch`, AC1 hash-binding);
- fast-lane task whose Verify consumes the manifest passes end-to-end (AC1/AC5-GREEN fixture);
- every mirror of every fixture is byte-identical and the canonical `plugin/test/*.test.mjs`
  discovery runs them (asserted at GREEN; RED only needs the import failure).

### Stage 2: implementation — `execution-manifest.ts`: schema, derivation, hash-binding, shape validation

- Kind: code
- AC: 2
- Files: `experiments/quay-perpetual-stream/scripts/execution-manifest.ts`, `plugin/scripts/execution-manifest.ts`
- Command: `scripts/test.sh plugin/test/execution-manifest.test.mjs` — the schema/derive/validation
  subset flips GREEN (valid-manifest, missing-AC-mapping-schema-side, duplicate-mapping,
  copied-requirement-text, touch-not-real, stage-missing-command, hash-mismatch fixtures pass);
  the Verify-path fixtures in `execution-manifest-verify.test.mjs` remain RED until Stage 4.

Symbols:

- `ExecutionManifest` — versioned (`schemaVersion`) hash-bound shape with `runIdentity`,
  `routingDecisionRef`, `baseCommit`, `stages[]` (each `{ index, title, acIndices[], files[],
  command }`), `acToStage` mapping, `touchSet[]`, `acToEvidence` mapping, `verificationCommands`,
  `rollback`, `contentHash`. Stores AC INDICES and file/stage references, never copied
  task/charter/Proposal/Plan prose (no second requirement authority, AC2).
- `deriveExecutionManifest({ routingDecision, task, charterFile, baseCommit })` — deterministic,
  side-effect-free derivation consumed by the prepare fast-lane path; takes the `PrepareRoutingDecision`
  (gap-size-A/M239 contract) as input and materializes the ordered stage list + AC→stage/evidence
  mappings + bounded touch set + RED/GREEN verification commands.
- `validateManifestShape(manifest)` — structural validation; missing/duplicate mappings and copied
  requirement text fail here with stable reason codes.
- `manifestHashRef()` — the hash-bound `contentHash` reference the prepare receipt binds as the
  plan artifact.

### Stage 3: implementation — prepare fast-lane path derives the manifest; Prepared gate accepts it as the plan artifact

- Kind: code
- AC: 1, 2
- Files: `.claude/workflows/prepare-milestone.js`, `plugin/workflows/prepare-milestone.js`, `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`, `plugin/scripts/milestone-preparation-check.ts`, `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`, `plugin/scripts/prepare-admission-check.ts`
- Command: `scripts/test.sh plugin/test/prepare-milestone-preparation-e2e.test.mjs plugin/test/milestone-preparation-check.test.mjs` — MUST stay GREEN (the M201/DIR-126-B Preflight and the DIR-117 plan-shape gate are upstream and untouched on the full-lane path), PLUS a new fast-lane receipt fixture: a `buildReceipt` with `planFile` pointing at a hash-bound execution manifest must pass `checkPreparation` (no `plan-not-checked`/`receipt-malformed`), and the task `## Plan` reference check must accept the manifest path.

Behavior: at the `PlanAuthor` decision point in `prepare-milestone.js` (both mirrors), when the
`PrepareRoutingDecision` from gap-size-A's Preflight is `fast-lane`, the workflow derives the
hash-bound execution manifest via `deriveExecutionManifest(...)` in place of authoring the checked
`docs/plans/*.md` plan, and the `Receipt` phase binds `receipt.planFile` → the manifest path.
`checkPreparation()` in `milestone-preparation-check.ts` and `--preflight-plan` in
`prepare-admission-check.ts` are extended so the manifest's schema-validated structure satisfies
the plan-reference and plan-shape checks for fast-lane receipts (full-lane receipts continue to
require the checked Plan unchanged). The manifest is hash-bound and does NOT copy Proposal/Plan
content (AC2).

### Stage 4: implementation — execute-milestone.js Verify-phase manifest branch (both mirrors)

- Kind: code
- AC: 1, 3
- Files: `.claude/workflows/execute-milestone.js`, `plugin/workflows/execute-milestone.js`
- Command: `scripts/test.sh plugin/test/execute-milestone-preparation-gate.test.mjs plugin/test/execute-milestone-build-phase-gate.test.mjs` — MUST stay GREEN (the DIR-117 preparation gate and the M208 Build-phase gate are upstream and untouched; the legacy `allVerifyResults.length < 6` invariant must hold for non-fast-lane tasks), PLUS a grep that each mirror has exactly one manifest Verify branch invoked when a hash-bound manifest is present.

Behavior: in the `Verify` phase (step 4), when a hash-bound execution manifest is present (a
fast-lane task — `$a`/receipt marks fast-lane, or a manifest path is supplied), the workflow adds a
seventh entry to `allVerifyResults` via `runManifestVerify(...)` from `execution-manifest-verify.ts`.
A missing AC→stage mapping returns `{ ok: false, reason: 'manifest-ac-mapping-missing', phase:
'Verify' }` and fails closed exactly like the existing it0 checks (no Audit/Build/Gate/Land
dispatch); a complete manifest passes and Verify proceeds to Build. The branch is reachable by both
the legacy-singleton and the new-shape paths, and it reads the manifest — a REAL Verify-path
consumption (AC1/AC3), closing the split-review finding that AC5 claimed Verify consumption with no
`execute-milestone.js` touch.

### Stage 5: GREEN — execution-manifest-verify RED/GREEN full flip, mirror byte-identity, full suite

- Kind: code
- AC: 1, 4, 5
- Files: `experiments/quay-perpetual-stream/test/execution-manifest.test.mjs`, `plugin/test/execution-manifest.test.mjs`, `experiments/quay-perpetual-stream/test/execution-manifest-verify.test.mjs`, `plugin/test/execution-manifest-verify.test.mjs`, `experiments/quay-perpetual-stream/scripts/execution-manifest.ts`, `plugin/scripts/execution-manifest.ts`, `experiments/quay-perpetual-stream/scripts/execution-manifest-verify.ts`, `plugin/scripts/execution-manifest-verify.ts`
- Command: `scripts/test.sh plugin/test/execution-manifest.test.mjs plugin/test/execution-manifest-verify.test.mjs && diff experiments/quay-perpetual-stream/scripts/execution-manifest.ts plugin/scripts/execution-manifest.ts && diff experiments/quay-perpetual-stream/scripts/execution-manifest-verify.ts plugin/scripts/execution-manifest-verify.ts && diff experiments/quay-perpetual-stream/test/execution-manifest.test.mjs plugin/test/execution-manifest.test.mjs && diff experiments/quay-perpetual-stream/test/execution-manifest-verify.test.mjs plugin/test/execution-manifest-verify.test.mjs && scripts/test.sh` — every `&&` segment exits 0.

The canonical `plugin/test/*.test.mjs` discovery (via `scripts/test.sh`) runs both new suites GREEN
(the missing-AC→stage fixture fails Verify with `manifest-ac-mapping-missing`; the complete
manifest passes — AC4 RED/GREEN, AC5); every mirror `diff` is empty (byte-identical modules and
tests); and the full `scripts/test.sh` suite stays green (no regression in the
`execute-milestone-*` gate tests, the prepare e2e, or the composite suite — AC1 Verify-path wiring
proven in-process).

### Stage 6: real-callsite evidence, negative control, and a fresh independent audit

- Kind: prose
- AC: 1
- Files: `tasks/gap-prepare-milestone-no-size-aware-routing-B.md`, `experiments/quay-perpetual-stream/charters/M240-gap-prepare-milestone-no-size-aware-routing-B.md`, `.claude/workflows/execute-milestone.js`
- Command: a real fast-lane task dispatch (routed fast-lane by gap-size-A's `PrepareRoutingDecision`)
  whose prepare derives a hash-bound execution manifest and whose execute-milestone Verify reads it
  (grep each mirror for the manifest branch + the real dispatched journal pasted, not asserted); a
  production-equivalent negative control that omits one AC→stage mapping and is stopped by Verify
  with `manifest-ac-mapping-missing` BEFORE any Build/Audit/Gate/Land dispatch; then a fresh
  independent audit agent verifies the production call graph, manifest content hash, touch-set
  reality, and Verify-path consumption. Real output pasted, not asserted; the task's DoD checkboxes
  and Human-verification answers recorded, with a fresh `quay gate`/DoD run at Land. If the real
  fast-lane route is not producible (gap-size-A not yet landed), this milestone halts (needs-human)
  rather than fabricating a transitional duplicate.

## Line budget

~350-450 added lines of module code across `execution-manifest.ts` (~200) and
`execution-manifest-verify.ts` (~150), mirrored; plus ~500-650 lines of test fixtures across the
two test files (mirror-counted once). ~30-50 lines of workflow wiring across the two
`prepare-milestone.js` mirrors and ~30-50 across the two `execute-milestone.js` mirrors, plus a
narrow (~40) edit in each of `milestone-preparation-check.ts` / `prepare-admission-check.ts`.
Well within the small-milestone norm for a capability-growth method-infra surface.

## Guardrails / rollback / real-landing verification

- **Guardrail (no second requirement authority):** the manifest and its stages store AC indices and
  file/stage references, never copied task/charter/Proposal/Plan prose (AC2). `validateManifestShape`
  rejects copied requirement text with `no-second-authority`; the task `## Proposal` and charter
  remain the sole requirement authorities.
- **Guardrail (fail-closed):** `runManifestVerify` returns `ok:false` → Verify fails closed with a
  stable reason code (`manifest-ac-mapping-missing`, `duplicate-ac-mapping`, `touch-not-real`,
  `stage-missing-command`, `hash-mismatch`) and dispatches zero Build/Audit/Gate/Land work. The
  existing 5 it0 checks + composite-preflight and the `allVerifyResults.length < 6` invariant stay
  upstream and untouched for non-fast-lane tasks.
- **Guardrail (dependency):** the manifest derivation consumes gap-size-A's `PrepareRoutingDecision`;
  if the real fast-lane route is not producible at execute time, the milestone halts (needs-human)
  rather than inventing a transitional duplicate or a standalone estimator.
- **Rollback:** all changes land as ordinary commits; revert is `git revert` of the Land commit.
  Because the Verify branch is fail-closed, a regression surfaces as blocked/REFUTED milestones, not
  silent acceptance — no special rollback machinery is introduced.
- **Real-landing verification (task DoD):** one real fast-lane task's prepare derives a hash-bound
  execution manifest and its execute-milestone Verify consumes it (grep + real dispatched journal
  pasted); a production-equivalent negative control (one AC→stage mapping omitted) is stopped by
  Verify before any Build/Audit/Gate/Land dispatch; a fresh independent audit verifies the
  production call graph, the manifest content hash, touch-set reality, and Verify-path consumption.
- **Serialization:** in the default (no-isolation) path this dispatch must never overlap another
  execute-milestone dispatch on the shared checkout (DIR-123 convention).

## Plan-check stopping rule

Standardized stopping rule: at most **3** Plan-check rounds; success only at **F_i = 0** (zero
unresolved findings). This Plan is authored to pass `validatePlanStructure` on the first check —
every one of the task's 5 `## Acceptance Criteria` indices (1..5) appears in at least one stage's
`- AC:` list (AC1: Stages 3/4/5/6; AC2: Stages 2/3; AC3: Stage 4; AC4: Stages 1/5; AC5: Stages
1/5), every stage names real files and a mechanical `- Command:`/`- Check:`, and any grounded
Plan-check finding is resolved within the 3-round cap.
