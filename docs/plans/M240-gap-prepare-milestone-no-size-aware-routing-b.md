# M240 Plan — execution manifest + execute-milestone Verify consumption

- **Milestone:** M240
- **Task:** `gap-prepare-milestone-no-size-aware-routing-B` — "Fast-lane execution manifest +
  execute-milestone Verify consumption": replace the standalone prose Plan with a derived,
  hash-bound **execution manifest** for fast-lane tasks, and make `execute-milestone.js`'s Verify
  phase consume it (real Verify-phase consumption, closing the split-review finding that AC5's
  "Verify consumes the plan" claim had no `execute-milestone.js` touch).
- **Charter:** `experiments/quay-perpetual-stream/charters/M240-gap-prepare-milestone-no-size-aware-routing-B.md`
  (GATE-HASH-REF `5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93`)
- **Base revision:** `2330cf6a` (current HEAD short-sha at Plan authoring, 2026-08-01)
- **Class:** development · capability-growth (method-infra surface; a NEW mirrored module pair +
  a NEW mirrored fixture pair + a narrow prepare-path branch + a narrow execute Verify-path
  branch, all byte-identical across the canonical/plugin mirrors)
- **Prepared-gate note:** authored for the M195/DIR-117-B enforced-by-default Prepared gate.
  Manually authored (2026-08-01) after the just-adjudicated task body; the task's
  `## Proposal` / `## Acceptance Criteria` (5 AC checkbox items, AC1..AC5) are the authoritative
  contract, and this Plan is the mechanical stage spec that `milestone-preparation-check.ts`'s
  `validatePlanStructure` parses (DIR-117 iteration-2 item 3 — every stage carries
  `### Stage <N>: <title>` + `- AC:` + `- Files:` + `- Command:`/`- Check:`).
- **Dependencies:**
  - `gap-prepare-milestone-no-size-aware-routing-A` (M239, in flight) — `estimateTaskSize` +
    versioned `PrepareRoutingDecision` (`fast-lane` | `full-lane`) emitted by
    `prepare-milestone.js`'s Preflight at `milestones/M<NN>/routing-decision.json`. THIS child
    consumes the decision: when the route is `fast-lane`, prepare derives the hash-bound execution
    manifest in place of the checked Plan. The derivation module and all fixtures drive a
    directly-constructed `PrepareRoutingDecision` fixture and do NOT require A's production router;
    only the Stage-6 real-dispatch evidence requires A's router to have landed. If the real
    fast-lane route is not producible at execute time, this milestone halts (needs-human) rather
    than fabricating a transitional duplicate or a second estimator.
  - In the default (no-isolation) serial path this dispatch must never run concurrently with
    another execute-milestone/prepare-milestone dispatch against the shared checkout (DIR-123 /
    DIR-027 hygiene).

## Grounded facts (repo-runtime contract)

- Canonical test discovery runs `packages/*/test/*.test.mjs` + `plugin/test/*.test.mjs` via
  `scripts/test.sh` (the glob lives in that script only, ADR-019/DIR-109). The
  `experiments/quay-perpetual-stream/test/` copies are the byte-identical mirror. New
  `*execution-manifest*` modules live in BOTH `experiments/quay-perpetual-stream/scripts/` and
  `plugin/scripts/`, edited to byte-identity (the established no-import/mirror discipline of
  `prepare-milestone.js` / `prepare-milestone-size-estimate.ts`).
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (mirror
  `plugin/scripts/milestone-preparation-check.ts`; both byte-identical) owns the
  ENFORCED-BY-DEFAULT Prepared gate: `checkPreparation()` (line 813) returns `{ ok, code, message }`
  and fails closed with `plan-not-checked` (task `## Plan` still `N/A` via `NA_PLAN_RE`, line 831),
  `plan-reference-mismatch` (task `## Plan` does not reference `receipt.planFile`, line 834),
  `receipt-malformed` (no `hashes`/`planFile`, lines 821/824), `plan-stale` (line 847), plus
  `proposal-stale`/`charter-stale`/`source-*` and the `review`/`planCheck` finding gates (success
  only at `F_i = 0`, `plancheck-rounds-exceeded` at >3). It also owns `buildReceipt()` (line 79;
  hashes the `planFile` text into `hashes.plan`, records `planFile` verbatim — artifact-agnostic)
  and `parsePlanStages` (line 719) / `validatePlanStructure` (line 744, fails `plan-no-stages` line
  747). `validatePlanStructure(planText, acCount)` runs at line 942 in `checkPreparation`, with
  `acCount = countBoxes(extractSection(taskText, 'Acceptance Criteria'))` (lines 940-941). This
  task extends the plan-reference/shape path so a fast-lane receipt (`receipt.fastLane === true`)
  accepts the manifest as the plan artifact.
- `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` (mirror
  `plugin/scripts/prepare-admission-check.ts`) owns the Preflight CLI `--preflight` /
  `--preflight-plan` modes; `--preflight-plan` routes through `preflightInvalidPlanCommand`
  (line 748) which also calls `validatePlanStructure` (line 750). For a fast-lane task whose plan
  artifact is the manifest, `--preflight-plan --fast-lane` must call `validateManifestShape`
  instead, so the manifest's schema-validated structure passes the shape gate.
- `.claude/workflows/prepare-milestone.js` (mirror `plugin/workflows/prepare-milestone.js`, both
  1732 lines today) has phases `Preflight` → `PlanAuthor` → `PlanCheck` → `Receipt`. Real anchors:
  `_slug`/`_planFile` derivation at lines 1406-1407 (`const _planFile = docs/plans/${_milestoneId}-${_slug}.md`),
  PlanAuthor prompt at line 1416, the task `## Plan` splice instruction at line 1431,
  `--preflight-plan` dispatch at line 1454, and the `--build` Receipt dispatch at line 1617. The
  fast-lane branch slots in at the PlanAuthor decision point immediately after `_planFile`
  (1407) and before the PlanAuthor prompt (1416): declare `_routingDecision` by reading
  `milestones/M<NN>/routing-decision.json` with a `?? { route: 'full-lane' }` default, branch on
  `_routingDecision?.route === 'fast-lane'`.
- `.claude/workflows/execute-milestone.js` (mirror `plugin/workflows/execute-milestone.js`, both
  1257 lines today) Phase Verify (step 4) assembles `allVerifyResults = [_ceiling, _gateHash,
  _lineBgt, _dogfood, _dmEntry, _composite].filter(Boolean)` (line 205) and fails closed with
  `verifyFailed = allVerifyResults.length < 6 || allVerifyResults.some(c => !c.ok)` (line 216) →
  `{ outcome: 'needs-human', reason: 'it0-checks-failed', phase: 'Verify', verifyJournal,
  verifyCacheUpdates }` (line 219). The Prepared phase (step 5) reads `$a.preparationReceiptFile`
  (line 235; missing → `preparation-receipt-missing`). The manifest Verify branch adds a SEVENTH
  `allVerifyResults` entry ONLY for `fastLane: true` receipts via `runManifestVerify`, preserving
  the `< 6` invariant on the non-fast-lane path.
- Tests are run with the Node built-in runner (`scripts/test.sh` / `node --test`); expected exit
  codes are asserted per stage below. The upstream gate suites this milestone must not break live at
  `plugin/test/`: `execute-milestone-preparation-gate.test.mjs`, `execute-milestone-build-phase-gate.test.mjs`,
  `prepare-milestone-preparation-e2e.test.mjs` (and the experiments mirror
  `milestone-preparation-check.test.mjs`).
- No `*execution-manifest*` file exists in either tree today (confirmed by filesystem scan of both
  `experiments/quay-perpetual-stream/` and `plugin/`) — this is genuinely new surface, and the RED
  fixtures fail on module-import before any assertion runs.

## Complete touch set

- `experiments/quay-perpetual-stream/scripts/execution-manifest.ts` — NEW: `ExecutionManifest`
  schema + `deriveExecutionManifest()` + `validateManifestShape()` + `contentHash` self-hash.
- `plugin/scripts/execution-manifest.ts` — byte-identical mirror.
- `experiments/quay-perpetual-stream/scripts/execution-manifest-verify.ts` — NEW:
  `runManifestVerify(manifestPath, receipt)` — the Verify-path consumption predicate with stable
  reason codes, importable in-process.
- `plugin/scripts/execution-manifest-verify.ts` — byte-identical mirror.
- `experiments/quay-perpetual-stream/test/execution-manifest.test.mjs` — NEW RED/GREEN fixtures
  (schema, derivation, hash-binding, no-Proposal/Plan-copy).
- `plugin/test/execution-manifest.test.mjs` — byte-identical mirror (canonical discovery).
- `experiments/quay-perpetual-stream/test/execution-manifest-verify.test.mjs` — NEW RED/GREEN
  fixtures (AC1/AC3/AC4/AC5 — the Verify-path negative control).
- `plugin/test/execution-manifest-verify.test.mjs` — byte-identical mirror (canonical discovery).
- `.claude/workflows/prepare-milestone.js` — fast-lane branch at the PlanAuthor decision point:
  declare `_routingDecision` (`?? { route: 'full-lane' }` default), dispatch `execution-manifest.ts
  --derive`, splice the task `## Plan` to the manifest path, pass `--fast-lane` at Receipt.
- `plugin/workflows/prepare-milestone.js` — byte-identical mirror.
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` — extend
  `checkPreparation()`/`buildReceipt()` so a fast-lane receipt's `planFile` is the manifest path and
  the shape floor runs `validateManifestShape` for `receipt.fastLane === true`.
- `plugin/scripts/milestone-preparation-check.ts` — byte-identical mirror.
- `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` — add `--fast-lane` to
  `--preflight-plan` so a fast-lane manifest (schema-validated structure) passes the shape gate.
- `plugin/scripts/prepare-admission-check.ts` — byte-identical mirror.
- `.claude/workflows/execute-milestone.js` — Verify-phase manifest branch (seventh
  `allVerifyResults` entry for `fastLane: true` receipts).
- `plugin/workflows/execute-milestone.js` — byte-identical mirror.
- `tasks/gap-prepare-milestone-no-size-aware-routing-B.md` — task body (`## Plan` reference to this
  plan file, checklist updates on Land).
- `docs/plans/M240-gap-prepare-milestone-no-size-aware-routing-b.md` — this Plan (authoritative
  plan path; the receipt references THIS file).
- `experiments/quay-perpetual-stream/charters/M240-gap-prepare-milestone-no-size-aware-routing-B.md`
  — charter (referenced, not modified).

`prepare-milestone-size-estimate.ts` is deliberately NOT touched (A's file). All committed files
fall under the task's declared `## Touches` globs. Touch-set reconciliation for AC2.2: the task
body's AC2.2 evidence names a "milestone-preparation-check.test.mjs fast-lane receipt fixture",
but `milestone-preparation-check.test.mjs` exists ONLY at
`experiments/quay-perpetual-stream/test/` (there is NO `plugin/test/` mirror — confirmed via
find) and is NOT matched by either `## Touches` test glob
(`experiments/quay-perpetual-stream/test/*execution-manifest*.test.mjs` /
`plugin/test/*execution-manifest*.test.mjs`). The AC2.2 fast-lane receipt fixture therefore
lives in `experiments/quay-perpetual-stream/test/execution-manifest.test.mjs` and its
byte-identical `plugin/test/execution-manifest.test.mjs` mirror — both already in the touch set —
importing `buildReceipt`/`checkPreparation` from the local `milestone-preparation-check.ts`
mirror. No committed file falls outside the declared touch set.

## Ordered stages

### Stage 1: RED — execution-manifest fixtures and the Verify-path negative control
- AC: 4, 5
- Files: `experiments/quay-perpetual-stream/test/execution-manifest.test.mjs`, `plugin/test/execution-manifest.test.mjs`, `experiments/quay-perpetual-stream/test/execution-manifest-verify.test.mjs`, `plugin/test/execution-manifest-verify.test.mjs`
- Command: `scripts/test.sh plugin/test/execution-manifest.test.mjs plugin/test/execution-manifest-verify.test.mjs`
- Kind: code
- Expected exit: **MUST exit non-zero (RED)** — the fixtures import `execution-manifest.ts` /
  `execution-manifest-verify.ts`, none of which exist yet, so the import fails before any assertion
  runs (AC5 RED on import-missing). Do not proceed to Stage 2 until this exits non-zero.
- Dependencies: none (pure fixture surface; drives a directly-constructed full-schema
  `PrepareRoutingDecision` fixture `{ route, codeScale, proofScale, sizeTier, thresholdsRef,
  materialInputHashes, runIdentityBinding: { declared: true, enforced: false, bindingTask:
  'DIR-124-B' }, decisionHash }` — AC1.1 — so progress is not blocked on A's landing).

Fixture matrix (each a distinct case, asserted with real pasted output at GREEN, not
asserted-as-expected):
- valid fast-lane manifest → `validateManifestShape` passes and `deriveExecutionManifest` emits a
  hash-bound manifest (AC1/AC2/AC5-positive);
- missing AC→stage mapping (an AC index in the task checklist absent from every stage's mapping)
  → `runManifestVerify` returns `ok:false` / `manifest-ac-mapping-missing` (AC4);
- duplicate AC→stage row → fails (`duplicate-ac-mapping`);
- Proposal/Plan section-body prose pasted into the manifest or any stage → rejected
  (`no-second-authority`, AC2.5);
- touch-set entry not a real file in the workspace → fails (`touch-not-real`);
- evidence mapping references a stage with no command → fails (`stage-missing-command`);
- manifest bytes mutated after derivation → `contentHash` self-check mismatch fails closed
  (`hash-mismatch`, AC1 hash-binding);
- fast-lane-marked receipt with no manifest file → `runManifestVerify` appends
  `{ check: 'execution-manifest-verify', ok: false, reason: 'manifest-missing' }` (AC4.2);
- every mirror of every fixture is byte-identical and the canonical `plugin/test/*.test.mjs`
  discovery runs them (asserted at GREEN; RED only needs the import failure).

### Stage 2: implementation — `execution-manifest.ts`: schema, derivation, hash-binding, shape validation
- AC: 2
- Files: `experiments/quay-perpetual-stream/scripts/execution-manifest.ts`, `plugin/scripts/execution-manifest.ts`
- Command: `scripts/test.sh plugin/test/execution-manifest.test.mjs`
- Kind: code
- Expected exit: **exit 0 (GREEN) on the schema/derive/validation subset** — valid-manifest,
  missing-AC-mapping-schema-side, duplicate-mapping, copied-requirement-text, touch-not-real,
  stage-missing-command, hash-mismatch fixtures pass (AC2.5 `no-second-authority` +
  `routingDecisionRef` + `manifest-derived-stale`). The Verify-path fixtures in
  `execution-manifest-verify.test.mjs` remain RED until Stage 4 (they import
  `execution-manifest-verify.ts`, which does not exist yet).
- Dependencies: Stage 1 RED fixtures exist.
- Symbols:
  - `ExecutionManifest` — versioned (`schemaVersion: 1`, `kind: 'execution-manifest'`) hash-bound
    shape: `{ schemaVersion, kind, taskId, milestoneId, runIdentity, routingDecisionRef,
    baseCommit, derivedFrom, stages[]: { index, title, acIndices[], files[], command,
    dependencies[] }, acToStage, touchSet[], acToEvidence, verificationCommands,
    finalVerification, rollback, contentHash }`. Stores AC INDICES and file/stage references, never
    copied task/charter/Proposal/Plan prose (no second requirement authority, AC2).
  - `deriveExecutionManifest({ routingDecision, task, charterFile, baseCommit, workspace })` —
    deterministic, side-effect-free derivation consumed by the prepare fast-lane path; takes the
    `PrepareRoutingDecision` (A/M239 contract) directly, NEVER re-routes, NEVER reads the
    Proposal/Plan sections. `derivedFrom` = sha256 of task `## Proposal` section + `## Touches`
    section + charter text + `routing-decision.json` content.
  - `validateManifestShape(manifest)` — mechanical schema checker with stable reason codes:
    `manifest-malformed`, `manifest-no-stages`, `manifest-ac-not-mapped`, `duplicate-ac-mapping`,
    `touch-not-real`, `stage-missing-command`, `no-second-authority`, `manifest-derived-stale`,
    `hash-mismatch`.
  - `contentHash = sha256(canonicalJSON({ ...manifest minus contentHash }))` — mirrors A's
    `buildRoutingDecision` `decisionHash` self-hash pattern (AC1).
  - Reuses `countBoxes(extractSection(taskText, 'Acceptance Criteria'))` imported from
    `task-schema.ts` — single-source section/box parsing (AC2.5).

### Stage 3: implementation — prepare fast-lane path derives the manifest; Prepared gate accepts it as the plan artifact
- AC: 1, 2
- Files: `.claude/workflows/prepare-milestone.js`, `plugin/workflows/prepare-milestone.js`, `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`, `plugin/scripts/milestone-preparation-check.ts`, `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`, `plugin/scripts/prepare-admission-check.ts`, `experiments/quay-perpetual-stream/test/execution-manifest.test.mjs`, `plugin/test/execution-manifest.test.mjs`
- Command: `scripts/test.sh plugin/test/prepare-milestone-preparation-e2e.test.mjs experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs plugin/test/execution-manifest.test.mjs`
- Kind: code
- Expected exit: **exit 0 (GREEN)** on the upstream suites (the M201/DIR-126-B Preflight and the
  DIR-117 plan-shape gate are untouched on the full-lane path), PLUS a new fast-lane receipt
  fixture that must pass, added to BOTH `execution-manifest.test.mjs` mirrors (the AC2.2 evidence
  fixture is reconciled onto these files, NOT `milestone-preparation-check.test.mjs` — that file
  is experiments-only and falls outside this task's `## Touches` globs; see the "Complete touch
  set" reconciliation): a `buildReceipt` with `--fast-lane` records `planFile` = manifest path,
  `hashes.plan` = sha256(manifest bytes), `fastLane: true`, and `touches` = the manifest's
  `touchSet`; `checkPreparation` on that receipt runs `validateManifestShape` (not
  `validatePlanStructure`) and returns `ok:true, code:'prepared'`; a malformed/missing manifest
  fails closed with `receipt-malformed`/`manifest-malformed` (AC2.2). The fixture imports
  `buildReceipt`/`checkPreparation` from the local `../scripts/milestone-preparation-check.ts`
  mirror (the same in-process import style `milestone-preparation-check.test.mjs` already uses,
  verified runnable via `node --test`). If the fast-lane fixture drops the task `## Plan` splice,
  `plan-reference-mismatch` must fire (RED side, AC1.2).
- Dependencies: Stage 2 module exists.
- Behavior (both prepare-milestone.js mirrors): at the PlanAuthor decision point, immediately after
  `_slug`/`_planFile` (lines 1406-1407) and before the PlanAuthor prompt (line 1416):
  - declare `_routingDecision` by reading `milestones/M<NN>/routing-decision.json` with
    `?? { route: 'full-lane' }` (pre-A-landing and full-lane → byte-for-byte today's path, no
    ReferenceError, no behavior change; AC1.1/AC1.4);
  - if `_routingDecision?.route === 'fast-lane'` (AC1.3): set `_planFile =
    milestones/M<NN>/execution-manifest.json`; dispatch `execution-manifest.ts --derive --task
    tasks/<id>.md --charter <charter> --workspace . --routing milestones/M<NN>/routing-decision.json
    --out <_planFile> --baseCommit <HEAD>` (AC1.5; non-zero/`manifest-derive-failed` → revision-needed,
    no silent fallback to a prose plan); splice the task `## Plan` to the manifest path (the same
    splice the PlanAuthor prompt uses, line 1431 — REQUIRED or `plan-reference-mismatch` fails
    closed; AC1.2); PlanCheck = exactly ONE grounded round (F_i = 0); the `--build` dispatch (line
    1617) gains `--fast-lane` alongside `--plan ${_planFile}` (AC2.1).
  - `milestone-preparation-check.ts` `checkPreparation`/`buildReceipt` and
    `prepare-admission-check.ts` `--preflight-plan --fast-lane` branch on `receipt.fastLane === true`
    / the `--fast-lane` flag, replacing ONLY the markdown-shape checks (`validatePlanStructure` /
    `NA_PLAN_RE`) with `validateManifestShape`; the freshness/hash/provenance/ledger/telemetry/
    convergence checks (lines 838-935) run unchanged (AC2.2/AC2.3). `proofScale: 'unknown'` routes
    full-lane; the fast-lane branch never engages for it (AC2.4).

### Stage 4: implementation — execute-milestone.js Verify-phase manifest branch (both mirrors)
- AC: 1, 3
- Files: `.claude/workflows/execute-milestone.js`, `plugin/workflows/execute-milestone.js`, `experiments/quay-perpetual-stream/scripts/execution-manifest-verify.ts`, `plugin/scripts/execution-manifest-verify.ts`
- Command: `scripts/test.sh plugin/test/execute-milestone-preparation-gate.test.mjs plugin/test/execute-milestone-build-phase-gate.test.mjs plugin/test/execution-manifest-verify.test.mjs`
- Kind: code
- Expected exit: **exit 0 (GREEN)** on the upstream gate suites (the DIR-117 preparation gate and
  the M208 Build-phase gate are untouched; the legacy `allVerifyResults.length < 6` invariant must
  hold for non-fast-lane tasks), PLUS a grep that each mirror has exactly one manifest Verify branch
  and `scripts/test.sh plugin/test/execution-manifest-verify.test.mjs` now passes the in-process
  `runManifestVerify` fixtures (the negative control from Stage 1 flips GREEN here — AC3.1 drives
  the REAL workflow mirrors).
- Dependencies: Stage 2 module + `execution-manifest-verify.ts` implemented this stage.
- Behavior (both execute-milestone.js mirrors): in the Verify phase (step 4), read
  `$a.preparationReceiptFile`; if the receipt marks `fastLane: true` and `planFile` resolves to a
  manifest, invoke `runManifestVerify(manifestPath, receipt)` (imported from
  `execution-manifest-verify.ts`, AC4.1) and append its result as a SEVENTH `allVerifyResults`
  entry (line 205). A fast-lane-marked task with NO manifest file must APPEND
  `{ check: 'execution-manifest-verify', ok: false, reason: 'manifest-missing' }` — never a silent
  skip (AC4.2). Any manifest check failure flips `verifyFailed` (line 216) →
  `{ outcome: 'needs-human', reason: 'it0-checks-failed', phase: 'Verify', verifyJournal,
  verifyCacheUpdates }` (line 219) — zero Build/Audit/Gate/Land dispatch. A complete manifest
  passes and Verify proceeds to Build. `runManifestVerify` re-validates shape independently
  (Verify runs BEFORE Prepared, so it must not trust `checkPreparation` to have run), re-checks
  `contentHash` self-consistency + receipt `hashes.plan` binding + touch-set file reality. This is
  REAL Verify-phase consumption (AC1/AC3) — the `execute-milestone.js` touch closes the split-review
  finding.

### Stage 5: GREEN — execution-manifest-verify RED/GREEN full flip, mirror byte-identity, full suite
- AC: 1, 2, 3, 4, 5
- Files: `experiments/quay-perpetual-stream/test/execution-manifest.test.mjs`, `plugin/test/execution-manifest.test.mjs`, `experiments/quay-perpetual-stream/test/execution-manifest-verify.test.mjs`, `plugin/test/execution-manifest-verify.test.mjs`, `experiments/quay-perpetual-stream/scripts/execution-manifest.ts`, `plugin/scripts/execution-manifest.ts`, `experiments/quay-perpetual-stream/scripts/execution-manifest-verify.ts`, `plugin/scripts/execution-manifest-verify.ts`
- Command: `scripts/test.sh plugin/test/execution-manifest.test.mjs plugin/test/execution-manifest-verify.test.mjs && diff experiments/quay-perpetual-stream/scripts/execution-manifest.ts plugin/scripts/execution-manifest.ts && diff experiments/quay-perpetual-stream/scripts/execution-manifest-verify.ts plugin/scripts/execution-manifest-verify.ts && diff experiments/quay-perpetual-stream/test/execution-manifest.test.mjs plugin/test/execution-manifest.test.mjs && diff experiments/quay-perpetual-stream/test/execution-manifest-verify.test.mjs plugin/test/execution-manifest-verify.test.mjs && scripts/test.sh`
- Kind: code
- Expected exit: **every `&&` segment exits 0** — both new suites run GREEN via the canonical
  `plugin/test/*.test.mjs` discovery (the missing-AC→stage fixture fails Verify with
  `manifest-ac-mapping-missing`; the complete manifest passes — AC4 RED/GREEN, AC5); every mirror
  `diff` is empty (byte-identical modules and tests, AC3.2); and the full `scripts/test.sh` suite
  stays green (no regression in the `execute-milestone-*` gate tests, the prepare e2e, or the
  composite suite — AC1 Verify-path wiring proven in-process).
- Dependencies: Stages 2, 3, 4 complete.

### Stage 6: real-callsite evidence, negative control, and a fresh independent audit
- AC: 1, 3
- Files: `tasks/gap-prepare-milestone-no-size-aware-routing-B.md`, `experiments/quay-perpetual-stream/charters/M240-gap-prepare-milestone-no-size-aware-routing-B.md`, `.claude/workflows/execute-milestone.js`
- Command: a real fast-lane task dispatch (routed fast-lane by gap-size-A's `PrepareRoutingDecision`)
  whose prepare derives a hash-bound execution manifest and whose execute-milestone Verify reads it
  (grep each mirror for the manifest branch + the real dispatched journal pasted, not asserted); a
  production-equivalent negative control that omits one AC→stage mapping and is stopped by Verify
  with `manifest-ac-mapping-missing` BEFORE any Build/Audit/Gate/Land dispatch; then a fresh
  independent audit agent verifies the production call graph, manifest content hash, touch-set
  reality, and Verify-path consumption. Real output pasted, not asserted.
- Kind: prose
- Expected exit: real dispatch journal + negative-control stop + audit notes pasted; the task's DoD
  checkboxes and Human-verification answers recorded, with a fresh `quay gate`/DoD run at Land.
  If the real fast-lane route is not producible (gap-size-A not yet landed), this milestone halts
  (needs-human) rather than fabricating a transitional duplicate.
- Dependencies: Stages 1-5 complete; A's router landed on `master` for the real-dispatch evidence.

## AC → stage mapping (complete)

- **AC1** (hash-bound manifest + execute Verify consumes it) → Stages 3, 4, 5, 6.
  Sub-items AC1.1 (routing-decision consumption + full-schema fixture) → Stage 1 fixture + Stage 3
  declaration; AC1.2 (`## Plan` splice, `plan-reference-mismatch` RED/GREEN) → Stage 3; AC1.3 (route
  enumeration) → Stage 3; AC1.4 (decision-point location) → Stage 3; AC1.5 (`--derive` dispatch)
  → Stage 3 + Stage 6 real dispatch.
- **AC2** (schema-validated structure, no Proposal/Plan copy) → Stages 2, 3, 5.
  Sub-items AC2.1 (receipt-side fast-lane) → Stage 3; AC2.2 (checkPreparation fast-lane branch) →
  Stage 3 — fast-lane receipt fixture added to both `execution-manifest.test.mjs` mirrors
  (reconciled from the task body's `milestone-preparation-check.test.mjs` reference: that file is
  experiments-only and outside `## Touches` — see "Complete touch set"); AC2.3 (preflight-plan
  fast-lane branch) → Stage 3; AC2.4 (proofScale `unknown` → full-lane) → Stage 3; AC2.5 (derive
  consumes the decision, no re-route, no Proposal/Plan read) → Stage 2.
- **AC3** (execute-milestone.js both mirrors real Verify-path branch) → Stages 4, 5, 6.
  Sub-items AC3.1 (Verify seventh entry) → Stage 4 + Stage 6 journal; AC3.2 (gate mirrors
  byte-identical) → Stage 5 `diff`.
- **AC4** (RED/GREEN: missing AC→stage mapping fails Verify; complete passes) → Stages 1, 5, 6.
  Sub-items AC4.1 (runManifestVerify importable) → Stage 4; AC4.2 (manifest-missing fail-closed)
  → Stage 1 fixture + Stage 4 wiring.
- **AC5** (execution-manifest-verify.test.mjs RED/GREEN) → Stages 1 (RED on import-missing), 5
  (GREEN).

Mechanical coverage: every AC checkbox index 1..5 appears in at least one stage's `- AC:` list
(AC1: 3,4,5,6; AC2: 2,3,5; AC3: 4,5,6; AC4: 1,5,6; AC5: 1,5), so `validatePlanStructure`'s
`plan-ac-not-mapped` cannot fire for this Plan.

## Line budget

~350-450 added lines of module code across `execution-manifest.ts` (~200) and
`execution-manifest-verify.ts` (~150), mirrored; plus ~500-650 lines of test fixtures across the
two test file pairs (mirror-counted once). ~40-60 lines of workflow wiring across the two
`prepare-milestone.js` mirrors (the `_routingDecision` declaration + fast-lane branch) and ~30-50
across the two `execute-milestone.js` mirrors (the seventh-entry branch), plus a narrow (~40) edit
in each of `milestone-preparation-check.ts` / `prepare-admission-check.ts`. Well within the
small-milestone norm for a capability-growth method-infra surface. Stage 6 is prose-only (real
dispatch + audit evidence), no budgeted code.

## Guardrails / rollback / real-landing verification

- **Guardrail (no second requirement authority):** the manifest and its stages store AC indices and
  file/stage references, never copied task/charter/Proposal/Plan prose (AC2). `validateManifestShape`
  rejects copied Proposal/Plan section-body text with `no-second-authority`; the task `## Proposal`
  and charter remain the sole requirement authorities.
- **Guardrail (fail-closed):** `runManifestVerify` returns `ok:false` → Verify fails closed with a
  stable reason code (`manifest-missing`, `manifest-ac-mapping-missing`, `duplicate-ac-mapping`,
  `touch-not-real`, `stage-missing-command`, `hash-mismatch`, `manifest-derived-stale`) and
  dispatches zero Build/Audit/Gate/Land work. The existing 6 it0 entries and the
  `allVerifyResults.length < 6` invariant stay upstream and untouched for non-fast-lane tasks; the
  manifest branch is a conditional-append (six for full-lane, seven for fast-lane), never a
  threshold change.
- **Guardrail (dependency):** the manifest derivation consumes gap-size-A's `PrepareRoutingDecision`;
  if the real fast-lane route is not producible at execute time, the milestone halts (needs-human)
  rather than inventing a transitional duplicate or a standalone estimator (AC1.3/A2.4 discipline).
  B's own `_routingDecision` read with `?? { route: 'full-lane' }` makes the pre-A-landing state a
  genuine no-op, so B's prepare path runs even before A lands.
- **Rollback:** all changes land as ordinary commits; revert is `git revert` of the Land commit.
  Because the Verify branch is fail-closed, a regression surfaces as blocked/REFUTED milestones, not
  silent acceptance — no special rollback machinery is introduced.
- **Real-landing verification (task DoD):** one real fast-lane task's prepare derives a hash-bound
  execution manifest and its execute-milestone Verify consumes it (grep + real dispatched journal
  pasted); a production-equivalent negative control (one AC→stage mapping omitted) is stopped by
  Verify before any Build/Audit/Gate/Land dispatch; a fresh independent audit verifies the
  production call graph, the manifest content hash, touch-set reality, and Verify-path consumption.
- **Serialization:** in the default (no-isolation) path this dispatch must never overlap another
  execute-milestone/prepare-milestone dispatch on the shared checkout (DIR-123 / DIR-027 hygiene).
  It inherits the worktree-isolation wiring already present in the working tree's
  `prepare-milestone.js` mirrors.

## Plan-check stopping rule

Standardized stopping rule: at most **3** Plan-check rounds; success only at **F_i = 0** (zero
unresolved findings). This Plan is authored to pass `validatePlanStructure` on the first check —
every one of the task's 5 `## Acceptance Criteria` checkbox indices (1..5) appears in at least one
stage's `- AC:` list (AC1: Stages 3/4/5/6; AC2: Stages 2/3/5; AC3: Stages 4/5/6; AC4: Stages
1/5/6; AC5: Stages 1/5), every stage names real files and a mechanical `- Command:`/`- Check:`,
and any grounded Plan-check finding is resolved within the 3-round cap.
