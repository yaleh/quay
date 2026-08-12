---
id: gap-prepare-milestone-no-size-aware-routing-B
title: Fast-lane execution manifest + execute-milestone Verify consumption
status: needs-human
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
extra:
  disposition: "retired-mechanism: ADR-022 已删机制前提证伪, outer A1-处置 2026-08-12 撤出候选池交人裁决"
---

**PAUSED (2026-08-02, prepare-pipeline reduction — `docs/analysis/prepare-pipeline-reduction-plan.md`):**
`blocked-by: prepare-pipeline-reduction`. This task's premise assumes the CURRENT prepare
pipeline shape (ProposalReview + 3-round PlanCheck). That shape is being reduced to three
mechanical confirmations (mechanism count, AC executability, Touches completeness), which
changes this task's value. NOT cancelled — re-evaluate after stage B–D of the reduction plan
lands and real dispatch data is available. Do not schedule until then.
**type:** execution

## Proposal

### Problem framing (grounded in current repo state)

**1. A fast-lane route today has no lighter prepared artifact.** Gap-A (M239, `gap-prepare-milestone-no-size-aware-routing-A`) is in flight: its implementation (`prepare-milestone-size-estimate.ts` — `estimateTaskSize`, `classifyProofScale`, `routeTask`, `buildRoutingDecision`) sits on the worktree branch `milestone/M239/iteration-0`, NOT yet on `master` (HEAD `427c5ad7`); the current working tree's `prepare-milestone.js` (1732 lines, both mirrors byte-identical) has zero routing references (no `_sizeEstimateAgentCall`, no `_routingDecision`). When A lands, its Preflight will emit a versioned, hash-bound `PrepareRoutingDecision` (`{ route, codeScale, proofScale, sizeTier, thresholdsRef, materialInputHashes, runIdentityBinding: { declared: true, enforced: false, bindingTask: 'DIR-124-B' }, decisionHash }`) at `milestones/M<NN>/routing-decision.json` and hold `_routingDecision` in scope. But the routing value is **emission-only**: a task routed `fast-lane` still flows into the SAME full PlanAuthor → PlanCheck → Receipt pipeline and still produces a prose `docs/plans/M<NN>-<slug>.md` plan. There is no prepared artifact shaped for the fast-lane class; `routeTask` gating alone is a half-measure unless the fast-lane lane prepares something lighter.

**2. The Prepared gate mechanically cannot accept anything but a `### Stage <N>:` plan today.** `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (byte-identical mirror `plugin/scripts/milestone-preparation-check.ts`; verified identical) owns the enforced-by-default gate:
- `checkPreparation()` (line 813) fails closed with `receipt-malformed` when `receipt.planFile` is absent (lines 821/824), `plan-not-checked` when the task `## Plan` is still `N/A` via `NA_PLAN_RE` (line 831), `plan-reference-mismatch` when the task `## Plan` does not reference `receipt.planFile` (line 834), `plan-stale` when the planFile bytes changed (line 847), and — crucially — runs `validatePlanStructure(planTextNow, acCount)` (line 942) which requires `### Stage <N>: <title>` + `- AC:` + `- Files:` + `- Command:` blocks (`parsePlanStages` line 719, `validatePlanStructure` line 744, `plan-no-stages` line 747).
- `prepare-admission-check.ts`'s `--preflight-plan` mode routes the plan body through `preflightInvalidPlanCommand` (line 748) which ALSO calls `validatePlanStructure` (line 750). So a fast-lane receipt whose planFile is anything other than a `### Stage <N>:`-shaped markdown file fails closed before Verify even runs.
- `buildReceipt()` (line 79) hashes the planFile text into `hashes.plan` and records `planFile` verbatim — the plan-reference/hash machinery is artifact-agnostic, but the STRUCTURAL gate (`validatePlanStructure`) is not.

**3. `execute-milestone.js` Verify does not read any plan file.** `.claude/workflows/execute-milestone.js` (1257 lines; mirror `plugin/workflows/execute-milestone.js` byte-identical) Phase Verify (step 4) runs six checks (`ceiling-check`, `gate-hash`, `line-budget`, `dogfood-evidence`, `domain-misfit`, `composite-preflight`), assembles `allVerifyResults = [_ceiling, _gateHash, _lineBgt, _dogfood, _dmEntry, _composite].filter(Boolean)` (line 205), and fails closed with `verifyFailed = allVerifyResults.length < 6 || allVerifyResults.some(c => !c.ok)` (line 216) → `{ outcome: 'needs-human', reason: 'it0-checks-failed', phase: 'Verify', verifyJournal, verifyCacheUpdates }` (line 219). The checked plan is consumed only by the Prepared phase (step 5) via `$a.preparationReceiptFile`. This is the split-review finding: AC5's "Verify consumes the plan" claim had no `execute-milestone.js` touch — Verify consumption is not real today.

The charter (`experiments/quay-perpetual-stream/charters/M240-gap-prepare-milestone-no-size-aware-routing-B.md`, GATE-HASH-REF `5023da82...`) and the task body's own `## Touches` are the authoritative contract. This child closes the gap: derive a hash-bound **execution manifest** for fast-lane tasks, make the Prepared gate accept it as the plan artifact, and make Verify genuinely consume it.

### Chosen mechanism

Two new standalone TypeScript modules, byte-identical in BOTH `experiments/quay-perpetual-stream/scripts/` and `plugin/scripts/` (the established no-import/mirror discipline of `prepare-milestone.js` and `prepare-milestone-size-estimate.ts`), run under `node --experimental-strip-types`, dispatched from the workflows via the existing `agent()`-wraps-CLI pattern and importable in-process by tests:

1. **`execution-manifest.ts`** — the single owner of the manifest schema, derivation, and shape validation (never a second parser):
   - `deriveExecutionManifest({ routingDecision, task, charterFile, baseCommit, workspace })` — deterministic, side-effect-free derivation materializing the ordered stage list, AC→stage and AC→evidence mappings, bounded touch set, RED/GREEN verification commands, and rollback. It consumes A's `PrepareRoutingDecision` — it never re-routes. It derives AC indices from the `## Acceptance Criteria` checklist, the touch set from `## Touches` expanded to real files, proof requirements from `## Definition of Done` — it NEVER reads the Proposal/Plan sections.
   - `validateManifestShape(manifest)` — mechanical schema checker with stable reason codes: `manifest-malformed` (unparseable JSON / wrong `schemaVersion` / wrong `kind`), `manifest-no-stages`, `manifest-ac-not-mapped`, `duplicate-ac-mapping`, `touch-not-real`, `stage-missing-command`, `no-second-authority` (verbatim Proposal/Plan section-body collision, scoped to section-level text, not command strings), `manifest-derived-stale` (a `derivedFrom` hash no longer matches the on-disk task/charter/routing-decision), `hash-mismatch`.
   - CLI `--derive`: writes the manifest atomically (write-temp-then-rename) to `milestones/M<NN>/execution-manifest.json` and prints it to stdout.
2. **`execution-manifest-verify.ts`** — the Verify-path consumption predicate `runManifestVerify(manifestPath, receipt)` (importable in-process by `execution-manifest-verify.test.mjs`) + a CLI mode the Verify-phase agent dispatches. It re-validates shape independently (Verify runs BEFORE Prepared, so it must not trust `checkPreparation` to have run), re-checks `contentHash` self-consistency and the receipt `hashes.plan` binding, and verifies every touch-set entry exists as a real file.

**Schema.** `ExecutionManifest`: `{ schemaVersion: 1, kind: 'execution-manifest', taskId, milestoneId, runIdentity, routingDecisionRef, baseCommit, derivedFrom, stages[]: { index, title, acIndices[], files[], command, dependencies[] }, acToStage, touchSet[], acToEvidence, verificationCommands, finalVerification, rollback, contentHash }`. It stores AC indices and file/stage references — never copied task/charter/Proposal/Plan prose (no second requirement authority). `derivedFrom` = sha256 of the task `## Proposal` section, the `## Touches` section, the charter text, and the `routing-decision.json` content, so the manifest is bound to every source it derives from. `contentHash = sha256(canonicalJSON({ ...manifest minus contentHash }))`, mirroring A's `buildRoutingDecision` `decisionHash` self-hash pattern.

**Verify consumption.** `execute-milestone.js` step 4 reads `$a.preparationReceiptFile` at Verify time; if the receipt marks `fastLane: true`, it appends a seventh `allVerifyResults` entry via `runManifestVerify`. A fast-lane task that is marked fast-lane but has no manifest must APPEND a failing `{ check: 'execution-manifest-verify', ok: false, reason: 'manifest-missing' }` entry — never silently skip. The non-fast-lane path assembles exactly 6 entries and the `< 6` invariant is untouched.

**Prepared-gate acceptance.** `milestone-preparation-check.ts`'s `checkPreparation`/`buildReceipt` and `prepare-admission-check.ts`'s `--preflight-plan` gain an explicit `fastLane` path: the manifest's schema-validated structure satisfies the plan-shape and plan-reference checks for fast-lane receipts; full-lane receipts continue to require the checked `docs/plans/*.md` Plan unchanged. All freshness/hash/provenance/ledger/telemetry/convergence checks (lines 838-935) run unchanged — the fast-lane branch replaces only the markdown-shape checks (`validatePlanStructure` / `NA_PLAN_RE`), not the freshness checks.

### Concrete control/data flow

1. **Prepare, Preflight (A's code):** `prepare-milestone.js` runs `--estimate`, writes `milestones/M<NN>/routing-decision.json` (A's code does not declare `_routingDecision` in B's scope — the file is the hand-off). Route = `fast-lane` or `full-lane`.
2. **Prepare, PlanAuthor decision point (new, B's code):** immediately after `_slug`/`_planFile` derivation (`.claude/workflows/prepare-milestone.js` lines 1406-1407) and before the PlanAuthor prompt (line 1416), B's code DECLARES `_routingDecision` by reading `milestones/M<NN>/routing-decision.json` (the artifact A's Preflight emits when A has landed) with a `?? { route: 'full-lane' }` value fallback when the file is absent — the declaration is B's own, so before A lands the read yields the full-lane default and the decision-point branch below is a genuine no-op (never a ReferenceError) — and then branches on `_routingDecision?.route === 'fast-lane'`:
   - Full-lane → today's path, byte-for-byte.
   - Fast-lane → set `_planFile = milestones/M<NN>/execution-manifest.json`; dispatch the `execution-manifest.ts` CLI (`--derive --task tasks/<id>.md --charter <charter> --workspace . --routing milestones/M<NN>/routing-decision.json --out <_planFile> --baseCommit <HEAD>`). On success, update the task `## Plan` section (the same splicing the PlanAuthor prompt uses, line 1431) to reference the manifest path — REQUIRED so `checkPreparation`'s `plan-reference-mismatch` check passes (a required behavior, not optional; the RED fixture must cover it).
3. **Prepare, PlanCheck round 1 shape gate:** `--preflight-plan --taskId ... --planFile <manifest> --fast-lane` runs `validateManifestShape` instead of `validatePlanStructure`. Fail-closed on a blocking shape finding (spends zero grounded plan-check turns on a malformed manifest).
4. **Prepare, PlanCheck:** for fast-lane, exactly ONE grounded round against the manifest (an independent non-author agent checks the manifest's stages/touch-set/evidence map against the task ACs), F_i = 0 required — the receipt `planCheck: { rounds: 1, findings: 0 }` keeps `checkPreparation`'s `rounds <= 3` and `findings === 0` gates binding. Zero grounded review would weaken the DIR-117 review discipline in a way this child does not need to risk.
5. **Prepare, Receipt:** the `--build` dispatch (line 1617) gains `--fast-lane` alongside `--plan ${_planFile}`. `buildReceipt` (line 79) records `planFile` = manifest path, `hashes.plan` = `sha256(manifest bytes)` (existing plan-hash machinery, artifact-agnostic), `fastLane: true`, and `touches` = the manifest's `touchSet` so the existing `touches-expanded` guard (line 956) still binds.
6. **Execute, Verify (step 4):** `execute-milestone.js` reads `$a.preparationReceiptFile` at Verify time; if the receipt marks `fastLane: true` and `planFile` resolves to a manifest, append a seventh entry to `allVerifyResults` (line 205) via `runManifestVerify(manifestPath, receipt)`. This is REAL Verify-phase consumption — the branch reads the manifest file, re-validates shape, re-checks `contentHash` self-consistency and the receipt `hashes.plan` binding, and verifies every touch-set entry exists as a real file.
7. **Execute, Prepared (step 5, unchanged call site):** `checkPreparation` runs as today; for `fastLane: true` receipts it runs `validateManifestShape` instead of `validatePlanStructure`, and the plan-reference/hash checks operate on the manifest path. `ok:true, code:'prepared'` only when all gates pass.
8. **Verify fail-closed:** any manifest check failure returns `{ ok:false, reason: 'manifest-missing' | 'manifest-ac-mapping-missing' | 'duplicate-ac-mapping' | 'touch-not-real' | 'stage-missing-command' | 'hash-mismatch' | ..., phase:'Verify' }`, which flips `verifyFailed` (line 216) and returns `{ outcome: 'needs-human', reason: 'it0-checks-failed', phase:'Verify' }` — zero Build/Audit/Gate/Land dispatch.

### Key design decisions

- **JSON manifest at `milestones/M<NN>/execution-manifest.json`, not a markdown Plan.** Derived artifacts live in `milestones/M<NN>/` beside `preparation.json` / `routing-decision.json` / `proposal-ledger.json` (the established convention A's plan doc relies on); `docs/plans/` is reserved for authored plans. JSON is structurally schema-validatable and structurally incapable of being a "second requirement authority" in the way prose is.
- **Explicit `receipt.fastLane: true` field**, set by `buildReceipt` when `--fast-lane` is passed — never a filename sniff. `checkPreparation` and `--preflight-plan` branch on the declared field. This keeps the fast-lane contract a first-class receipt property (auditable, versioned), not an inference.
- **The Prepared gate learns the manifest, not the manifest masquerading as a Plan.** `checkPreparation`'s structural floor runs `validateManifestShape` for fast-lane receipts. The existing `validatePlanStructure`/`parsePlanStages` machinery is untouched and remains the full-lane floor.
- **`hashes.plan` slot is reused for the manifest.** `receipt.planFile → manifest path`, `hashes.plan = sha256(manifest)` — so the existing `plan-stale` freshness mechanism (line 847) works unchanged for the manifest (manifest edited after preparation → stale). No new hash slot, minimal receipt churn.
- **Verify detects fast-lane via the receipt (single source of truth), not a `$a`-supplied duplicate.** `$a.preparationReceiptFile` is already threaded through execute-milestone (Prepared phase); reading it at Verify time means the manifest path comes from the prepared artifact, not a caller-asserted side input. A defensive `$a.executionManifestFile` override is allowed but not the detection mechanism.
- **Verify's manifest entry is the SEVENTH check, appended only for fast-lane; the `< 6` invariant is preserved for the non-fast-lane path.** `allVerifyResults.length < 6` still means "a check silently didn't run." A fast-lane task marked fast-lane but with no manifest file must APPEND a failing `{ check: 'execution-manifest-verify', ok: false, reason: 'manifest-missing' }` entry so the route cannot bypass the invariant. (An always-dispatched, vacuous-passing seventh check was considered and rejected — see A3.)
- **Fast-lane PlanCheck = exactly one grounded round (F_i = 0), not zero.** The mechanical shape gate substitutes for prose plan-shape grounding, but a single grounded review of the manifest against the task ACs preserves the DIR-117 "success only at F_i=0" review discipline and keeps `checkPreparation`'s `rounds <= 3`/`findings === 0` contract fully binding.
- **No second requirement authority, enforced two ways.** (a) `deriveExecutionManifest` never reads the Proposal/Plan sections — AC indices come from the `## Acceptance Criteria` checklist, the touch set from `## Touches` (expanded to real files), proof requirements from `## Definition of Done`; `validateManifestShape`'s `no-second-authority` check is the mechanical backstop, scoped to Proposal/Plan section-body substrings (not arbitrary command strings). (b) `derivedFrom` hashes bind the manifest to the task Proposal/Touches/charter/routing-decision, so any source edit invalidates the manifest via `manifest-derived-stale`.
- **The manifest's `runIdentity` + `routingDecisionRef` + `baseCommit` re-home A's decision.** A's `runIdentityBinding { declared: true, enforced: false, bindingTask: 'DIR-124-B' }` is declared-but-unenforced until DIR-124-B lands; B's manifest carries `routingDecisionRef` (decisionHash + sidecar path), its own `runIdentity` (the workflow run session id captured per-phase, per the `_sessionIdInstruction` pattern), and `baseCommit`, satisfying A's plan doc's "when B lands, the decision is re-homed into B's receipt" note without inventing enforcement DIR-124-B does not yet define.
- **Single-source section/box parsing.** The manifest module uses the same `countBoxes(extractSection(taskText, 'Acceptance Criteria'))` as `validatePlanStructure` — never a reimplemented counter (per A's `task-schema.ts` single-source discipline).
- **`deriveExecutionManifest` takes the `PrepareRoutingDecision` directly** (a directly-constructed fixture in tests), so unit/RED-GREEN progress is not blocked on A's landing; only the Stage-6 real-dispatch evidence is.

### Defaults and failure behavior

- **Routing decision absent/unparseable at the PlanAuthor decision point** → B's `_routingDecision` read of `milestones/M<NN>/routing-decision.json` falls back to `?? { route: 'full-lane' }` when the file is absent, so pre-A-landing and full-lane routes take today's byte-for-byte path (no ReferenceError, no behavior change); B's fast-lane branch simply does not engage (full-lane plan authored). No duplicate detection, no fallback fabrication.
- **Fast-lane but manifest derivation fails** (`--derive` CLI non-zero / no parseable JSON) → `revision-needed` at PlanAuthor with a stable reason (`manifest-derive-failed`); the lease is released; nothing is dispatched forward. No silent fallback to a prose plan.
- **Fast-lane receipt whose planFile is missing/not a valid manifest** → `checkPreparation` fails closed (`receipt-malformed` / `manifest-malformed`); `--preflight-plan` fails closed before PlanCheck round 1.
- **Verify with a present manifest:** missing AC→stage mapping → `manifest-ac-mapping-missing`; duplicate mapping → `duplicate-ac-mapping`; touch-set entry not a real file → `touch-not-real`; evidence-mapped stage with no command → `stage-missing-command`; source-derivation stale → `manifest-derived-stale`; bytes mutated after derivation → `hash-mismatch`; all pass → `{ ok:true }`, Verify proceeds to Build. Every failure is a Verify fail-closed (`needs-human`, `it0-checks-failed`) with the existing `verifyJournal`/`verifyCacheUpdates` return shape.
- **Non-fast-lane task:** zero behavior change — 6 it0 entries, `< 6` invariant, checked `docs/plans/*.md` Plan required. Byte-for-byte today's path (golden-replay-compatible).
- **Unknown/missing `## Definition of Done` (proofScale `unknown`)**: A routes full-lane; B never sees it as fast-lane. Fail-closed upstream.

### Compatibility

- **No change to full-lane prepare or execute paths.** `validatePlanStructure`/`parsePlanStages`, the it0 6-check Verify assembly, and the `< 6` invariant are untouched for non-fast-lane tasks (M201/DIR-126-B Preflight, DIR-117 plan-shape gate, M208 Build gate stay green — `execute-milestone-preparation-gate.test.mjs`, `prepare-milestone-preparation-e2e.test.mjs` must not break).
- **`buildReceipt`'s `hashes.plan` semantics are preserved** — it hashes whatever `planFile` points at; a JSON manifest is a real file and hashes identically. `computeCurrentHashes` (line 36) is artifact-agnostic. `buildReceipt` gains an optional `fastLane` param; omitted → unchanged receipt shape.
- **`checkPreparation` remains backward-compatible**: a receipt WITHOUT `fastLane` takes the exact current branch (full-lane Plan required); the new branch is gated on the explicit field, so no existing M195/M197/M200/M201/M202-shaped fixture becomes stricter.
- **`prepare-admission-check.ts` gains a `--fast-lane` flag** on `--preflight-plan`; `--preflight-plan`/`--preflight` are untouched without it.
- **Mirror discipline:** every new module/test is byte-identical across `experiments/quay-perpetual-stream/` and `plugin/`; `diff` gates + the existing source-regex mirror cross-check apply. `scripts/test.sh`'s canonical discovery runs the `plugin/test/*execution-manifest*.test.mjs` suites.
- **Task `## Touches` boundary:** all committed files fall under the task's declared `## Touches` globs — `.claude/workflows/{execute-milestone,prepare-milestone}.js`, `plugin/workflows/{execute-milestone,prepare-milestone}.js`, `experiments/quay-perpetual-stream/scripts/*execution-manifest*` + `plugin/scripts/*execution-manifest*`, the two `milestone-preparation-check.ts` mirrors, the two `prepare-admission-check.ts` mirrors, and the four `*execution-manifest*.test.mjs` files. `prepare-milestone-size-estimate.ts` is deliberately NOT touched (A's file).
- **Serialization:** in the default no-isolation path, this dispatch must never overlap another execute-milestone/prepare-milestone dispatch on the shared checkout (DIR-123 / DIR-027 hygiene). It inherits the worktree-isolation wiring already present in the working tree's `prepare-milestone.js` mirrors.

### Risks

- **A (M239) not yet landed to master.** B's real-dispatch evidence (DoD item 2) requires A's `PrepareRoutingDecision` in the production prepare path. If A is not producible at execute time, this milestone halts (needs-human) rather than fabricating a transitional routing/estimator duplicate — the dependency is declared and fail-closed, matching A's plan doc. Mitigation: B's own `_routingDecision` declaration (reading `milestones/M<NN>/routing-decision.json` with a `?? { route: 'full-lane' }` default) makes the pre-A-landing state a genuine no-op — the decision-point branch evaluates cleanly on master with no ReferenceError, so B's prepare path runs even before A lands; only Stage-6 real fast-lane dispatch evidence is blocked on A. B's fixtures drive a directly-constructed `PrepareRoutingDecision` fixture so unit/RED-GREEN progress is not blocked on A's landing.
- **DIR-026 real-landing proof is the hardest DoD clause.** A's routing is provisional and no real task is currently routed fast-lane; the real-dispatch evidence may require manufacturing a synthetic fast-lane-routed fixture task that is actually dispatched through execute-milestone (an explicit real-object fixture run), not merely a unit test. This should be planned explicitly at Stage 6.
- **Verify-branch ordering subtlety.** Verify (step 4) runs BEFORE Prepared (step 5), so the manifest check must not assume the receipt is already validated — `runManifestVerify` re-validates independently rather than trusting `checkPreparation` to have run. Shape validation logic is therefore exercised twice (Verify + Prepared); the single-source module (`execution-manifest.ts`'s `validateManifestShape`) prevents drift between the two.
- **Line-count staleness in the existing plan doc.** `docs/plans/M240-...b.md` cites `prepare-milestone.js` = 1546 lines and `execute-milestone.js` = 1204; the real working tree is 1732 and 1257. Any stage spec must anchor to the real symbols/lines (PlanAuthor at 1402, `_planFile` at 1407, `--build` at 1617, Verify assembly at 205/216, `checkPreparation` 813, `validatePlanStructure` 744/747, `buildReceipt` 79) and re-grep at Build time, not trust the stale figures.
- **`## Plan` reference coupling.** The fast-lane path must still update the task `## Plan` to reference the manifest path, or `checkPreparation`'s `plan-reference-mismatch` fails closed. This is a required behavior, not optional — the RED fixture must cover it.
- **Verification-command derivation must not fabricate.** Stage commands are derived from the real touch set + real test-file discovery; if a stage's test file does not exist at derive time, the manifest must record the RED state (the fixture's `stage-missing-command`/`touch-not-real` path) rather than inventing a command.
- **No-copy check brittleness.** A command string inside a stage that legitimately quotes Proposal text could false-positive `no-second-authority`; the check is scoped to Proposal/Plan section-body substrings, not arbitrary lines.
- **Schema drift between derive and validate** — mitigated by single ownership in `execution-manifest.ts` (derive and validate in the same module).

### Non-goals

- **No threshold tuning / calibration / shadow-mode rollout** — that is C (M241), the third child of the gap-size split.
- **No change to routing** — B consumes A's decision; it neither re-runs `routeTask` nor adds a second estimator.
- **No change to ProposalAuthors / adjudication / proposal review** — the Proposal pipeline is identical for fast-lane and full-lane; only the PLAN artifact and its consumption change. Fast-lane keeps the full Proposal pipeline (the Proposal remains the requirement authority and is needed by the grounded ProposalReview).
- **No change to the full-lane checked-Plan path** — `docs/plans/*.md` authorship, PlanCheck rounds, and the `< 6` Verify invariant are untouched.
- **Verify is not elevated to the gate** — the Prepared phase (step 5) still gates dispatch; the Verify manifest branch is a first-line mechanical consumption, not a replacement for `checkPreparation`.
- **Not a runtime execution engine** — the manifest is a prepared artifact consumed by Verify and the Prepared gate, not a Build-phase driver (Build consumption is out of scope for this child).
- **No second markdown `### Stage <N>:` parser** — `validatePlanStructure`/`parsePlanStages` remain the full-lane parser, untouched; `task-schema.ts`'s `extractSection`/`countBoxes` remain the single source.
- **No DIR-124-B RunIdentity enforcement** — the manifest carries `runIdentity`/`routingDecisionRef` as a declared binding, but enforcement is explicitly deferred to DIR-124-B (unchanged from A's stance).

### AC coverage

The formal AC1-AC5 checkboxes in `## Acceptance Criteria` stay property-level; the falsifiable, callsite-naming evidence requirements live in the **ACn.m sub-items** below, and every mechanism claim in the wiring section maps to one of them. Each sub-item requires a fixture, grep, or real-dispatch proof naming the production file/dispatch it covers — a pass on AC1-AC5 can no longer be achieved by exercising `validateManifestShape` only inside `runManifestVerify` and never wiring the `checkPreparation` fast-lane branch or `--preflight-plan --fast-lane`.

- **AC1 (hash-bound manifest + execute Verify consumes it)** — sub-items:
  - **AC1.1 (routing-decision consumption, [303e19f0])** — the `PrepareRoutingDecision` fixture used by the manifest modules carries the full A schema `{ route, codeScale, proofScale, sizeTier, thresholdsRef, materialInputHashes, runIdentityBinding: { declared: true, enforced: false, bindingTask: 'DIR-124-B' }, decisionHash }` as emitted at `milestones/M<NN>/routing-decision.json`; the PlanAuthor decision point declares `_routingDecision` by reading that file with a `?? { route: 'full-lane' }` default (A's Preflight emits the file but never declares the variable in B's scope). Evidence: `execution-manifest.test.mjs` constructs a full-schema `PrepareRoutingDecision` fixture; grep both prepare-milestone.js mirrors for B's `_routingDecision` read + `?? { route: 'full-lane' }` default; Stage-6 real-dispatch journal shows the on-disk `routing-decision.json` consumed.
  - **AC1.2 (`## Plan` splice on the fast-lane path, [ef6e735a])** — when `_routingDecision.route === 'fast-lane'`, `prepare-milestone.js` must splice the task `## Plan` section to reference the manifest path (the same splicing the PlanAuthor prompt uses, line 1431). This is REQUIRED behavior, not optional: dropping it fails closed at the gate via `checkPreparation`'s `plan-reference-mismatch` (line 834/835). Evidence: RED fixture — a fast-lane prepare without the splice fails `plan-reference-mismatch`; GREEN fixture — after a fast-lane prepare, the task `## Plan` contains the manifest path and `plan-reference-mismatch` does NOT fire on the fast-lane receipt.
  - **AC1.3 (route enumeration, [ff4f1db8])** — route is exactly `fast-lane` or `full-lane`. Evidence: fixture with `route: 'full-lane'` takes the full-lane path byte-for-byte (golden-replay-compatible, `< 6` Verify invariant); a `'fast-lane'` route takes the manifest path.
  - **AC1.4 (decision-point location, [d5072409])** — the branch on `_routingDecision?.route === 'fast-lane'` with the safe `?? { route: 'full-lane' }` guard sits immediately after `_slug`/`_planFile` derivation (`.claude/workflows/prepare-milestone.js` lines 1406-1407) and before the PlanAuthor prompt (line 1416), with `_routingDecision` DECLARED by B's read of `milestones/M<NN>/routing-decision.json` plus the `?? { route: 'full-lane' }` default. Evidence: grep both prepare-milestone.js mirrors for the `_routingDecision` declaration/read, the exact guard, and the branch.
  - **AC1.5 (`--derive` dispatch, [5d10f7b7])** — the fast-lane branch dispatches `execution-manifest.ts --derive --task tasks/<id>.md --charter <charter> --workspace . --routing milestones/M<NN>/routing-decision.json --out <manifest> --baseCommit <HEAD>`. Evidence: grep both prepare-milestone.js mirrors for the CLI dispatch; fixture asserts the produced manifest; Stage-6 real dispatch.
- **AC2 (schema-validated structure, no Proposal/Plan copy)** — sub-items:
  - **AC2.1 (receipt-side fast-lane, [aa9a0d1e])** — the `--build` dispatch (line 1617) gains `--fast-lane` alongside `--plan ${_planFile}`; `buildReceipt` (line 79) records `planFile` = manifest path, `hashes.plan` = sha256(manifest bytes), `fastLane: true`, and `touches` = the manifest's `touchSet`. Evidence: `buildReceipt` fixture asserting `fastLane: true` + `planFile`/`hashes.plan` = manifest + `touches` = `touchSet`; grep the `--build` dispatch in both prepare-milestone.js mirrors.
  - **AC2.2 (checkPreparation fast-lane branch, [aa9a0d1e]/[5961a0e7])** — `milestone-preparation-check.ts`'s `checkPreparation` (line 813) runs `validateManifestShape` (imported from `execution-manifest.ts`) for `receipt.fastLane === true`, replacing ONLY the markdown-shape checks (`validatePlanStructure` / `NA_PLAN_RE`); the freshness/hash/provenance/ledger/telemetry/convergence checks (lines 838-935) run unchanged. Evidence: milestone-preparation-check.test.mjs fast-lane receipt fixture — a valid manifest → `ok:true, code:'prepared'`; a malformed/missing one → `receipt-malformed`/`manifest-malformed` fail-closed; grep the `receipt.fastLane === true` branch in both mirrors.
  - **AC2.3 (preflight-plan fast-lane branch, [aa9a0d1e]/[17b4ca57]/[5c4db10e])** — `prepare-admission-check.ts`'s `--preflight-plan --fast-lane` calls `validateManifestShape` instead of routing through `preflightInvalidPlanCommand` → `validatePlanStructure`; the full-lane `--preflight-plan` path is unchanged. Evidence: preflight-plan fixture — a valid manifest passes the fast-lane shape gate and `plan-no-stages` is NOT emitted on the fast-lane branch; the full-lane `--preflight-plan` still emits `plan-no-stages` on a stage-less plan; grep the `--fast-lane` flag handling in both prepare-admission-check.ts mirrors.
  - **AC2.4 (proofScale `unknown` → full-lane, [124c7e1f])** — a routing decision with `proofScale: 'unknown'` (missing/unknown `## Definition of Done`) routes full-lane; B's fast-lane branch never engages. Evidence: fixture with `proofScale: 'unknown'` exercises the full-lane path and `_routingDecision?.route === 'fast-lane'` is never true for it.
  - **AC2.5 (derive consumes the decision, no re-route, no Proposal/Plan read, [6059efb2])** — `deriveExecutionManifest` takes the `PrepareRoutingDecision` directly, never re-routes, never reads Proposal/Plan. Evidence: `no-second-authority`, `routingDecisionRef`, and `manifest-derived-stale` fixtures in execution-manifest.test.mjs.
- **AC3 (`execute-milestone.js` both mirrors real Verify-path branch)** — sub-items:
  - **AC3.1 (Verify seventh entry, [33dfe61c])** — `execute-milestone.js` step 4 reads `$a.preparationReceiptFile`, detects `fastLane: true`, and invokes `runManifestVerify` (imported from `execution-manifest-verify.ts`) as a seventh `allVerifyResults` entry (line 205). Evidence: execution-manifest-verify.test.mjs drives the REAL workflow mirrors; grep each execute-milestone.js mirror for exactly one manifest branch; Stage-6 real dispatch journal.
  - **AC3.2 (gate mirrors, [a2915a41])** — both `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` and `plugin/scripts/milestone-preparation-check.ts` gain the fast-lane branch and remain byte-identical. Evidence: `diff` gate on the two mirrors exits 0.
- **AC4 (RED/GREEN: missing AC→stage mapping fails Verify; complete passes)** — sub-items:
  - **AC4.1 (runManifestVerify importable, [ec7153a9])** — `execution-manifest-verify.ts` exposes `runManifestVerify(manifestPath, receipt)` importable in-process by `execution-manifest-verify.test.mjs` and a CLI mode. Evidence: the test file imports `runManifestVerify` from the module (not via CLI).
  - **AC4.2 (manifest-missing fail-closed, [d0fb1ff4])** — a fast-lane-marked task with no manifest file must APPEND `{ check: 'execution-manifest-verify', ok: false, reason: 'manifest-missing' }` to `allVerifyResults` — never a silent skip; `allVerifyResults.length < 6` remains the silent-run detector for the full-lane path. Evidence: fixture — fast-lane receipt + missing manifest file → the failing entry is appended and `verifyFailed` flips (line 216).
- **AC5 (`execution-manifest-verify.test.mjs` RED/GREEN)** — the test file pair (both mirrors) is the delivered fixture; RED on import-missing before implementation, GREEN after.

### Mechanism-claim wiring coverage (DIR-117)

Each runtime relationship below is a CLAIM requiring a matching AC-level proof (test, grep, or real-dispatch evidence), not just prose. Every claim maps to a callsite-naming sub-AC item defined in "### AC coverage" — a claim is resolved only when its named fixture/grep/dispatch evidence exists:

1. `prepare-milestone.js` fast-lane branch dispatches `execution-manifest.ts --derive` when `_routingDecision.route === 'fast-lane'` → **AC1.5** (prepare derives the manifest; fixture + grep of both mirrors; real dispatch in Stage 6).
2. `prepare-milestone.js` fast-lane path updates the task `## Plan` to reference the manifest path → **AC1.2** (RED fixture: dropped splice fails `plan-reference-mismatch`; GREEN fixture: `plan-reference-mismatch` must NOT fire on a fast-lane receipt).
3. `prepare-milestone.js` Receipt passes `--fast-lane --plan <manifest>` to `milestone-preparation-check.ts --build` → **AC2.1** (receipt records `fastLane:true` + `planFile` = manifest + `hashes.plan` = sha256(manifest); `buildReceipt` fixture).
4. `milestone-preparation-check.ts` `checkPreparation` calls `validateManifestShape` (imported from `execution-manifest.ts`) for `receipt.fastLane === true` → **AC2.2** (milestone-preparation-check.test.mjs fast-lane receipt fixture: passes with a valid manifest, fails closed with a malformed one).
5. `prepare-admission-check.ts` `--preflight-plan --fast-lane` calls `validateManifestShape` instead of `validatePlanStructure` (via `preflightInvalidPlanCommand`) → **AC2.3** (preflight-plan fixture: manifest passes shape gate, `plan-no-stages` not emitted on the fast-lane branch).
6. `execute-milestone.js` Verify reads `$a.preparationReceiptFile`, detects `fastLane:true`, and invokes `runManifestVerify` (imported from `execution-manifest-verify.ts`) as a seventh `allVerifyResults` entry → **AC3.1** (execution-manifest-verify.test.mjs drives the REAL workflow mirrors; grep each mirror for exactly one manifest branch; real dispatch journal in Stage 6).
7. `runManifestVerify` verifies `contentHash` self-consistency + receipt `hashes.plan` binding + touch-set file reality → **AC4.1/AC4.2** (hash-mismatch, touch-not-real, and manifest-missing fixtures).
8. `deriveExecutionManifest` consumes `PrepareRoutingDecision` (never re-routes, never reads Proposal/Plan) → **AC2.5** (no-second-authority + routingDecisionRef + manifest-derived-stale fixtures).
9. `execution-manifest.ts` reuses `countBoxes(extractSection(...))` from `task-schema.ts` (single-source parsing, no second counter) → **AC2.5** (grep imports).
10. all four workflow/script pairs + the new modules + the new test files remain byte-identical across the two mirrors → **AC3.2/AC5** (`diff` exits 0).

**Claim → AC-item inventory** (covers every mechanism claim in the Proposal, including the property/design-level ones in Problem framing / Chosen mechanism / control flow / defaults that previously had no AC mapping):

| Mechanism claim (source) | AC sub-item |
|---|---|
| A's Preflight emits `PrepareRoutingDecision` at `milestones/M<NN>/routing-decision.json`, holds `_routingDecision` (Problem framing ¶1) | **AC1.1** |
| `milestone-preparation-check.ts` (both mirrors) owns the enforced Prepared gate (Problem framing ¶2) | **AC3.2** |
| `prepare-admission-check.ts` `--preflight-plan` routes through `preflightInvalidPlanCommand`/`validatePlanStructure` (Problem framing ¶2) | **AC2.3** |
| `execution-manifest-verify.ts` `runManifestVerify(manifestPath, receipt)` importable + CLI (Chosen mechanism ¶2) | **AC4.1** |
| Route = `fast-lane` or `full-lane` (Control/data flow ¶1) | **AC1.3** |
| PlanAuthor decision point after `_slug`/`_planFile`, branch `_routingDecision?.route === 'fast-lane'` guarded with `?? { route: 'full-lane' }` (Control/data flow ¶2) | **AC1.4** |
| `allVerifyResults.length < 6` + manifest-missing append `{ check: 'execution-manifest-verify', ok: false, reason: 'manifest-missing' }` (Key design decisions) | **AC4.2** |
| Unknown/missing `## Definition of Done` (proofScale `unknown`) → A routes full-lane, B never sees fast-lane (Defaults and failure behavior) | **AC2.4** |
| `prepare-milestone.js` fast-lane branch dispatches `execution-manifest.ts --derive` (wiring claim 1) | **AC1.5** |
| `checkPreparation` calls `validateManifestShape` for `receipt.fastLane === true` (wiring claim 4) | **AC2.2** |
| `--preflight-plan --fast-lane` calls `validateManifestShape` instead of `validatePlanStructure` (wiring claim 5) | **AC2.3** |
| `execute-milestone.js` Verify seventh `runManifestVerify` entry (wiring claim 6) | **AC3.1** |
| `deriveExecutionManifest` consumes `PrepareRoutingDecision`, never re-routes/reads Proposal/Plan (wiring claim 8) | **AC2.5** |

Every claim above now has a callsite-naming, evidence-requiring AC sub-item; the DIR-117 review phase should check that each sub-item's named fixture/grep/dispatch evidence exists and that the AC1-AC5 checkbox properties remain satisfiable.

### Alternatives considered and rejected

- **A1 — Make the manifest a markdown file that reuses the `### Stage <N>:` convention so `validatePlanStructure` passes unchanged (no gate branch).** Rejected: the manifest would only be validated on its stage-subset, silently dropping the schema checks that are this task's point (touch-set reality, AC→evidence mapping, rollback, hash-binding); and a "Plan-shaped" manifest masquerading as a Plan muddies the no-second-authority line. The honest contract is an explicit `fastLane` branch that validates the manifest as itself.
- **A2 — Extend the six it0 Verify checks to read the checked `docs/plans/*.md` Plan directly (consume the plan, no new artifact).** Rejected: this child exists because the fast-lane lane needs a LIGHTER artifact than a full Plan; Verify-reading-the-Prose-Plan would duplicate the Prepared gate and close nothing about the fast-lane class. It also directly contradicts the task's "replace the standalone prose Plan with a derived execution manifest."
- **A3 — Always-dispatch a vacuous-passing seventh Verify check for full-lane, so the count is uniformly 7.** Rejected: it changes the `allVerifyResults.length < 6` threshold to `< 7`, requiring updates to execute-milestone tests that assert the exact check count, and it makes the full-lane path's golden-replay depend on the extra check always passing rather than on it being absent. The conditional-append (six for full-lane, seven for fast-lane) preserves the `< 6` invariant and the full-lane path byte-for-byte; a fast-lane-marked task with no manifest still appends a FAILING entry, so the route cannot bypass the invariant.
- **A4 — Put the manifest at `docs/plans/M<NN>-<slug>-manifest.md`.** Rejected: authored plans live in `docs/plans/`; derived runtime artifacts live in `milestones/M<NN>/` (preparation.json, routing-decision.json, proposal-ledger.json). The manifest is a derived artifact and belongs with its sibling derived artifacts.
- **A5 — Detect fast-lane at Verify/prepare by sniffing the planFile name or attempting `validateManifestShape` on every plan.** Rejected: an explicit `receipt.fastLane` field is a declared, versioned contract; a sniff is fragile, non-obvious, and would re-validate every full-lane plan unnecessarily.
- **A6 — Skip grounded PlanCheck entirely for fast-lane and rely solely on the mechanical shape gate.** Rejected: it would weaken the DIR-117 review discipline and diverge from the F_i=0/rounds<=3 receipt contract. One grounded round against the manifest is cheap and preserves the guardrail.
- **A7 — Give gap-B its own standalone estimator/router to self-detect fast-lane, decoupling from A.** Rejected: it duplicates A's `prepare-milestone-size-estimate.ts` (a second estimation implementation → drift) and contradicts the task's stated dependency on A's routing. B consumes the decision; the dependency is declared and fail-closed.
- **A8 — Fold the manifest into the receipt JSON itself (no separate file).** Rejected: `receipt.planFile` is a path on disk that Verify's agent reads; an embedded manifest would break the `--derive`/`--validate` file consumption and the `plan-stale` freshness slot.
- **A9 — Derive the manifest without any LLM agent (pure CLI).** Rejected: RED/GREEN command synthesis and evidence selection from task prose need the same authoring capability as PlanAuthor; the mechanical `--derive`/`--validate` (not the derivation) is what must be deterministic and schema-enforced.
- **A10 — Let the fast-lane task's `## Plan` remain `N/A` and skip the plan-reference check.** Rejected: the `plan-reference-mismatch`/`plan-stale` machinery is part of what keeps the task body and the prepared artifact coherent; updating `## Plan` to reference the manifest path preserves the check (and the M240 plan doc's "task `## Plan` reference check must accept the manifest path" note). `N/A` would require special-casing `NA_PLAN_RE` out, weakening the gate for a case that needs no weakening.
- **A11 — Have execute-milestone.js's Prepared phase (not Verify) do the manifest consumption.** Rejected: this child's AC and the split-review finding specifically require Verify-phase consumption with `execute-milestone.js` as a Touches file; folding it into the Prepared gate would leave AC3 unmet.

## Plan

Checked plan authored at `docs/plans/M240-gap-prepare-milestone-no-size-aware-routing-b.md`
— the DIR-117-B prepared-gate artifact mapping every AC item to ordered mechanical stages
(RED/implementation/GREEN with expected exit behavior, code/prose classification, line
budgets, dependencies, guardrails/rollback/real-landing verification), with the standardized
3-round Plan-check stopping rule (success only at F_i = 0).

## Finding

Today `execute-milestone.js`'s Verify phase (step 4) runs the it0 mechanical checks
(ceiling-check/gate-hash/line-budget/dogfood-evidence/domain-misfit) plus
composite-preflight and reads no plan file; the checked `docs/plans/M<NN>-<slug>.md` plan
is consumed by the Prepared phase via `milestone-preparation-check.ts`. No execution
manifest exists. The fast-lane path (gap-size-A) needs a lighter artifact than a full
Plan. The split-review found AC5's Verify-consumption claim had no `execute-milestone.js`
touch — this child closes it.

## Requested action

1. Define the execution-manifest schema (ordered stages, dependencies, AC→stage/evidence,
   touch set, verification commands, rollback).
2. Prepare-milestone's fast-lane path derives the manifest (hash-bound, no Proposal copy),
   in place of the checked Plan for fast-lane tasks; extend the Prepared gate
   (`milestone-preparation-check.ts` / `prepare-admission-check.ts`) so a fast-lane
   receipt's `planFile` is the manifest.
3. `execute-milestone.js` Verify phase consumes the manifest when present (both mirrors),
   in place of the checked Plan for fast-lane tasks.
4. RED/GREEN fixtures: a manifest with a missing AC→stage mapping fails Verify; a complete
   one passes; a fast-lane task's Verify uses the manifest.

## Acceptance Criteria

- [ ] AC1: A fast-lane task produces a hash-bound execution manifest; `execute-milestone.js`
  Verify consumes it (real Verify-phase consumption, grep + real dispatch).
    - AC1.1 (routing-decision consumption): B's PlanAuthor decision point declares
      `_routingDecision` by reading `milestones/M<NN>/routing-decision.json` with a
      `?? { route: 'full-lane' }` default; the `PrepareRoutingDecision` fixture carries the
      full A schema `{ route, codeScale, proofScale, sizeTier, thresholdsRef,
      materialInputHashes, runIdentityBinding: { declared: true, enforced: false,
      bindingTask: 'DIR-124-B' }, decisionHash }`. Evidence: `execution-manifest.test.mjs`
      full-schema fixture + grep of both prepare-milestone.js mirrors for B's
      `_routingDecision` read + default + Stage-6 real-dispatch journal — REAL, verified.
    - AC1.2 (`## Plan` splice on the fast-lane path): when `_routingDecision.route ===
      'fast-lane'`, `prepare-milestone.js` splices the task `## Plan` section to reference
      the manifest path. Evidence: RED fixture — a fast-lane prepare without the splice
      fails `plan-reference-mismatch`; GREEN fixture — after a fast-lane prepare, the task
      `## Plan` contains the manifest path and `plan-reference-mismatch` does NOT fire —
      VERIFIED.
    - AC1.3 (route enumeration): route is exactly `fast-lane` or `full-lane`. Evidence:
      fixture with `route: 'full-lane'` takes the full-lane path byte-for-byte
      (golden-replay-compatible, `< 6` Verify invariant); a `'fast-lane'` route takes the
      manifest path — VERIFIED.
    - AC1.4 (decision-point location): `_routingDecision` is DECLARED by B's read of
      `milestones/M<NN>/routing-decision.json` plus a `?? { route: 'full-lane' }` default;
      the branch on `_routingDecision?.route === 'fast-lane'` sits immediately after
      `_slug`/`_planFile` derivation (`.claude/workflows/prepare-milestone.js` lines
      1406-1407), before the PlanAuthor prompt (line 1416). Evidence: grep both
      prepare-milestone.js mirrors for the `_routingDecision` declaration/read, the exact
      guard, and the branch — REAL, grep-verified.
    - AC1.5 (`--derive` dispatch): the fast-lane branch of `prepare-milestone.js` (when
      `_routingDecision.route === 'fast-lane'`) dispatches `execution-manifest.ts --derive
      --task tasks/<id>.md --charter <charter> --workspace . --routing
      milestones/M<NN>/routing-decision.json --out <manifest> --baseCommit <HEAD>` (CLI
      `--derive`). Evidence: grep both prepare-milestone.js mirrors for the CLI dispatch;
      fixture asserts the produced manifest; Stage-6 real dispatch — REAL, verified.
- [ ] AC2: The manifest has a schema-validated structure (AC→stage coverage, touch set,
  evidence mapping) and does not copy Proposal/Plan content.
    - AC2.1 (receipt-side fast-lane): the `--build` dispatch (line 1617) gains `--fast-lane`
      alongside `--plan ${_planFile}`; `buildReceipt` (line 79) records `planFile` = manifest
      path, `hashes.plan` = sha256(manifest bytes), `fastLane: true`, and `touches` = the
      manifest's `touchSet`. Evidence: `buildReceipt` fixture asserting `fastLane: true` +
      `planFile`/`hashes.plan` = manifest + `touches` = `touchSet`; grep the `--build`
      dispatch in both prepare-milestone.js mirrors — VERIFIED.
    - AC2.2 (checkPreparation fast-lane branch): `milestone-preparation-check.ts`'s
      `checkPreparation` (line 813) runs `validateManifestShape` (imported from
      `execution-manifest.ts`) for `receipt.fastLane === true`, replacing ONLY the
      markdown-shape checks (`validatePlanStructure` / `NA_PLAN_RE`); the
      freshness/hash/provenance/ledger/telemetry/convergence checks (lines 838-935) run
      unchanged. Evidence: milestone-preparation-check.test.mjs fast-lane receipt fixture — a
      valid manifest → `ok:true, code:'prepared'`; a malformed/missing one →
      `receipt-malformed`/`manifest-malformed` fail-closed. Both mirror paths
      `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` and
      `plugin/scripts/milestone-preparation-check.ts` gain the fast-lane branch and remain
      byte-identical; grep the `receipt.fastLane === true` branch in both mirrors — REAL,
      verified.
    - AC2.3 (preflight-plan fast-lane branch): `prepare-admission-check.ts`'s
      `--preflight-plan --fast-lane` calls `validateManifestShape` instead of routing through
      `preflightInvalidPlanCommand` → `validatePlanStructure`; the full-lane
      `--preflight-plan` path is unchanged. Evidence: preflight-plan fixture — a valid
      manifest passes the fast-lane shape gate and `plan-no-stages` is NOT emitted on the
      fast-lane branch; the full-lane `--preflight-plan` still emits `plan-no-stages` on a
      stage-less plan; grep the `--fast-lane` flag handling in both prepare-admission-check.ts
      mirrors — VERIFIED.
    - AC2.4 (proofScale `unknown` → full-lane): a routing decision with `proofScale:
      'unknown'` (missing/unknown `## Definition of Done`) routes full-lane; B's
      `_routingDecision?.route === 'fast-lane'` branch never engages. Evidence: fixture with
      `proofScale: 'unknown'` exercises the full-lane path and `_routingDecision?.route ===
      'fast-lane'` is never true for it — VERIFIED.
    - AC2.5 (derive consumes the decision): `deriveExecutionManifest` takes the
      `PrepareRoutingDecision` directly, never re-routes, never reads Proposal/Plan.
      Evidence: `no-second-authority`, `routingDecisionRef`, and `manifest-derived-stale`
      fixtures in execution-manifest.test.mjs — VERIFIED.
- [ ] AC3: `execute-milestone.js` (both mirrors) has a real Verify-path branch for the
  manifest — `execute-milestone.js` is a declared Touches file of this child.
    - AC3.1 (Verify seventh entry): `execute-milestone.js` step 4 reads
      `$a.preparationReceiptFile`, detects `fastLane: true`/`fastLane:true`, and invokes
      `runManifestVerify` (imported from `execution-manifest-verify.ts`) as a seventh
      `allVerifyResults` entry (line 205). Evidence: execution-manifest-verify.test.mjs
      drives the REAL workflow mirrors; grep each `execute-milestone.js` mirror for exactly
      one manifest branch; Stage-6 real dispatch journal — REAL, verified.
    - AC3.2 (gate mirrors): both `experiments/quay-perpetual-stream/scripts/
      milestone-preparation-check.ts` and `plugin/scripts/milestone-preparation-check.ts`
      gain the fast-lane branch and remain byte-identical. Evidence: `diff` gate on the two
      mirrors exits 0 — verified.
- [ ] AC4: RED/GREEN (verified): missing AC→stage mapping in manifest fails Verify; complete
  passes.
    - AC4.1 (runManifestVerify importable): `execution-manifest-verify.ts` exposes
      `runManifestVerify(manifestPath, receipt)` importable in-process by
      `execution-manifest-verify.test.mjs` and a CLI mode. Evidence: the test file imports
      `runManifestVerify` from the module (not via CLI) — VERIFIED.
    - AC4.2 (manifest-missing fail-closed): a fast-lane-marked task with no manifest file
      must APPEND `{ check: 'execution-manifest-verify', ok: false, reason: 'manifest-missing'
      }` to `allVerifyResults` — never a silent skip; `allVerifyResults.length < 6` remains
      the silent-run detector for the full-lane path. Evidence: fixture — fast-lane receipt +
      missing manifest file → the failing entry is appended and `verifyFailed` flips (line
      216) — VERIFIED.
- [ ] AC5: Tests: `execution-manifest-verify.test.mjs` RED/GREEN (verified: the test file
  pair, both mirrors, is the delivered fixture; RED on import-missing before implementation,
  GREEN after).

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real fast-lane task's execute-milestone Verify consumes its manifest (real dispatch
  evidence).
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does execute-milestone Verify actually read the manifest for a fast-lane task?

## Touches

- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*execution-manifest*`
- `plugin/scripts/*execution-manifest*`
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`
- `plugin/scripts/milestone-preparation-check.ts`
- `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`
- `plugin/scripts/prepare-admission-check.ts`
- `experiments/quay-perpetual-stream/test/*execution-manifest*.test.mjs`
- `tasks/gap-prepare-milestone-no-size-aware-routing-B.md`
- `experiments/quay-perpetual-stream/charters/M240-gap-prepare-milestone-no-size-aware-routing-B.md`
- `docs/plans/M240-gap-prepare-milestone-no-size-aware-routing-b.md`
- `plugin/test/*execution-manifest*.test.mjs`