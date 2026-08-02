---
id: DIR-124-F
title: "Runtime-contract ground-truth registry for PlanAuthor/PlanCheck:
  single-source repo facts + grounded-fact learning loop"
status: todo
labels:
  - directive
  - human-steered
parent: DIR-124
children:
  - DIR-124-F-core
  - DIR-124-F-plancheck
  - DIR-124-F-learn
extra:
  schema: v1
---

**type:** execution

## Reclassified split (2026-08-02, ADR-021 review)

The original 2026-08-01 split decision decomposed this task into 6 children (F1-F6, each ~80 lines,
7-9 AC). Per ADR-021 Principle 1 (meta-mechanism granularity), that was TOO FINE — implementation
steps, not architectural decisions. The 6 children are merged into **3** — each 1 mechanism,
atomic-but-meaningful:

| Child | M-number | Title | Mechanism | Merges |
|-------|----------|-------|-----------|--------|
| [DIR-124-F-core](DIR-124-F-core.md) | **M257** | Registry data + CLI + seed + validation | Versioned, hash-bound `ground-truth-registry.json` + `.ts` CLI (`--inject`/`--validate`/`--promote`/`--selftest`) seeded from the 8 `repo-ground-truth.md` sections with M205 correction; category whitelist enforcement | ← F1+F3+F4+F5 |
| [DIR-124-F-plancheck](DIR-124-F-plancheck.md) | **M258** | PlanCheck typed findings with `grounded-fact-gap` classification | Extend PlanCheck's output schema from `{findings: number}` to typed array with `classification ∈ {grounded-fact-gap, task-specific, other}`; legacy-scalar tolerance | ← F2 |
| [DIR-124-F-learn](DIR-124-F-learn.md) | **M259** | Learning-loop classification trust (agent-assisted + mechanically validated) | `grounded-fact-gap` promotes via the finding ledger with version bump; mechanically validated (category whitelist, duplicate exact-match, non-blocking); already-registered → injection defect | ← F6 |

**Dependency order:** F-plancheck (typed findings) is the prerequisite for F-learn. F-core has no
dependencies and can proceed first. Each child is 1 mechanism, independently reviewable and
landable. This parent is **done** when all three children are done.

**The 6 original stub files (DIR-124-F1..F6) are deleted.** Their content is preserved in the
proposal text of the three replacement children.

**Original parent charter:** `experiments/quay-perpetual-stream/charters/M232-dir-124-f.md`
(preserved for context).

---

## Proposal

Mechanize the recurring "grounded facts" problem: PlanAuthor/PlanCheck repeatedly fail on
the SAME repo-runtime-contract facts (CLI binary path, Node coverage output format, Touches
matching rules, provider runtime defaults, shared-module signatures), each task paying a
failed-PlanCheck-round + per-task grounding-fact fix. Build a **versioned, hash-bound
`GroundTruthRegistry`** of repo-invariant facts that `prepare-milestone.js` injects into the
PlanAuthor and PlanCheck prompts, and a **learning loop** that promotes `grounded-fact-gap`
PlanCheck findings into the registry (with a version bump) so a fact is never re-discovered
by a later task.

### Problem framing (grounded in current code)

The prepare-milestone pipeline is a no-import workflow DSL: `.claude/workflows/prepare-milestone.js`
and its byte-identical mirror `plugin/workflows/prepare-milestone.js` (1732 lines each,
`diff -q` clean, verified) cannot `import` or touch the filesystem directly (M203/DIR-126-D
confirmed). Every file-touching operation already goes through an `agent()`-wraps-a-real-CLI
dispatch (`_convergenceAgentCall` → proposal-convergence.ts, `_preflightAgentCall` /
`_admissionAgentCall` → prepare-admission-check.ts), returning `{raw}` stdout that the workflow
interpolates into prompt template strings.

Against this surface, the PlanAuthor prompt (lines 1415-1437) and the PlanCheck prompt (lines
1503-1511) currently carry ZERO repo-runtime-contract facts. PlanCheck returns scalar
`{findings: <count>, findingsDetail: <string>}` (schema line 1511), so there is no typed finding
to classify — the learning-loop prerequisite stated in Requested-action item 4 is real. PlanCheck
round 1 fails on the same fact classes every task: CLI path `quay.ts` vs `quay.js`
(`docs/references/repo-ground-truth.md` §1; confirmed: `packages/quay/bin/quay.ts`, no `quay.js`,
no build step), Node `--test --experimental-test-coverage` basename rows without `%` (§2),
Touches/`- Files:` mismatches (§3, with the M205 correction below), provider env defaults
(`QUAY_NATIVE_TASKS_DIR`, `QUAY_GITHUB_REPO` §4), shared-module signatures (§5), and the
`inherited-core.md` `evidenceSurface` (journal.jsonl `{type:"started"|"result", key:"v2:<hash>",
agentId[, result]}` vs `workflows/wf_*.json` `workflowProgress[]` `{type:"workflow_agent",
label, phaseIndex}`; `log()` output absent from journal.jsonl) — the sixth fact class (§6).

**Critical seeding correction (grounded in M205):** `docs/references/repo-ground-truth.md` §3's
first bullet ("parenthetical comments after a backticked path break the exact-path match") is
FALSE — `prepare-admission-check.ts` `_stripWrappingBacktick` (line 646) already strips backticks
AND one trailing ` (…)` annotation, and `_splitTopLevelCommas` splits at paren-depth 0. The real
recurring `preflight-touches-mismatch` cause is a Plan-stage `- Files:` line naming a file the
task's `## Touches` never declared (the "add the file to Touches" fix). Seeding must encode the
corrected fact, never copy the refuted bullet verbatim.

### Chosen mechanism

A versioned, schema-validated, hash-bound `GroundTruthRegistry`:

- **Registry DATA = a checked-in JSON data file** `experiments/quay-perpetual-stream/scripts/ground-truth-registry.json`
  (byte-identical mirror `plugin/scripts/ground-truth-registry.json`) — the single production
  owner of repo-invariant FACTS. Data file, not facts embedded in TS: the learning loop must
  mechanically WRITE new facts via `--promote`, and JSON gives a clean fact-table diff plus a
  meaningful content hash over canonicalized sorted facts (the proposal-convergence "pure module
  + CLI modes" precedent).
- **Validation/versioning/hashing/promotion = a TS CLI module**
  `experiments/quay-perpetual-stream/scripts/ground-truth-registry.ts` (byte-identical mirror
  `plugin/scripts/ground-truth-registry.ts`) that owns the registry shape
  `{schemaVersion: "ground-truth-v1", version: <int>, contentHash: <sha256 of canonicalized
  sorted facts>, facts: [{id, category, fact, adrRef?}]}`, the category whitelist, versioning,
  and a content hash recomputed and compared on every validate. The CLI is the ONLY way the
  no-import workflow can reach the registry.
- **Seed** from the 8 sections of `repo-ground-truth.md` (categories: cli-paths, coverage-format,
  touches-matching, provider-defaults, module-signatures, evidence-surface, subprocess,
  gate-resolution) + `inherited-core.md` `evidenceSurface` (category evidence-surface), with the
  M205 correction applied at seed time; `adrRef` points to the deciding ADR (e.g. ADR-020 for the
  github-default decision).
- **CLI surface:** `--inject [--categories <cat,...>]` (emit the subset as prompt-ready text;
  default = inject ALL — the registry is small and PlanCheck is whole-repo), `--validate
  [--receipt <preparation.json>]` (schema + category whitelist + hash + stale-version-vs-receipt),
  `--promote <fact-json>` (schema/category validate, append, version bump, recompute hash),
  `--record-receipt <preparation.json>` (write `hashes.groundTruth = {version, hash}` into the
  existing receipt after `--build`), `--version`, `--hash`, `--selftest`.
- `prepare-milestone.js` (both mirrors) gains a `_groundTruthAgentCall` sibling to
  `_convergenceAgentCall`/`_preflightAgentCall` that dispatches
  `node --no-warnings --experimental-strip-types experiments/quay-perpetual-stream/scripts/ground-truth-registry.ts <flags>`
  and returns `{raw}`.

### Concrete control/data flow

1. **Preflight** (before any content agent): dispatch `--validate` (with `--receipt
   <preparation.json>` when a prior receipt exists). Non-zero exit → `revision-needed` /
   `preflight-rejected` terminal, zero content-agent turns (fail-closed-5).
2. **PlanAuthor**: dispatch `--inject` → interpolate `raw` as a "GROUND-TRUTH REGISTRY v<N>
   (hash H)" block into the PlanAuthor prompt (lines 1415-1437).
3. **PlanCheck each round** (up to 3, F_i=0): dispatch `--inject` fresh (post-promotion) →
   interpolate into the PlanCheck prompt (lines 1503-1511). PlanCheck schema upgrades from
   `{findings: number, findingsDetail}` to `{findings: <typed array>, findingsDetail}`; each
   finding carries the DIR-125 shape `{subsystem, summary, severity, blocking, evidence,
   claimRef, disposition, rootCauseKey, repairable}` plus an explicit `classification` field ∈
   {`grounded-fact-gap`, `task-specific`, `other`}. `_planCheckFindings = typedFindings.length`.
4. **Learning loop**: merge typed findings into the finding-ledger via the existing
   `_upsertFindings` (line 886), hash-bound into the receipt by `--ledger`; then for each finding
   with `classification === "grounded-fact-gap"` that is NOT already registered (by id or exact
   fact text) dispatch `--promote <fact-json>` — the real production promotion path, version bump
   + hash recompute, ledger-disposition-tracked. An already-registered fact re-surfacing → a
   registry-injection defect (the injection failed to surface the fact), reported as a finding,
   never promoted twice. On a successful promote, refetch the subset and re-inject into the NEXT
   PlanCheck round.
5. **Receipt phase**: after `milestone-preparation-check.ts --build` (NOT modified — out of
   Touches), a `*ground-truth*`-scoped binding step writes `hashes.groundTruth = {version, hash}`
   into the current `preparation.json` (which already hash-binds ledger/telemetry/
   mechanismInventory) so the NEXT prepare's `--validate --receipt` detects staleness. The
   StageReceiptEnvelope coupling is declared-deferred to DIR-124-B and NOT implemented now.
6. **Template hygiene (item 0a)**: reject any non-`##`-heading content after `## Touches` at the
   real parse site (`task-schema.ts` `checkTouches`/`extractSection`, lines 368/411) so prose
   after Touches is not parsed as Touches globs (`touches-overbroad`), surfaced through
   `prepare-admission-check.ts`'s preflight detector shape (`{code, blocking, disposition,
   policyVersion}`); `_stripWrappingBacktick`'s one-annotation strip stays intact (M205).

### Key design decisions

- **JSON data file + TS CLI module**, NOT facts embedded in TS and NOT a bare JSON with no
  validator: the no-import workflow needs a dispatcher either way; a data file keeps `--promote`'s
  mechanical write path and content hash meaningful; the module is the single owner of
  validate/inject/promote/hash (single-source principle).
- **Injection is real registry-driven interpolation of CLI `{raw}`**, never a second hardcoded
  copy in the prompt — grep-confirmable that PlanCheck consults the registry.
- **Inject ALL by default** (v1; registry small, PlanCheck is whole-repo — "signatures, call
  sites, dependency order, commands"); `--inject --categories` is the growth escape valve, not
  the default, so a category-selection miss can never be the cause of an injection defect.
- **Categories** map 1:1 to the seed doc's sections; the whitelist is enforced at validate and
  promote.
- **Stale-version-vs-receipt is enforceable NOW** against the existing `preparation.json` (already
  hash-binds ledger/telemetry/mechanismInventory) via `hashes.groundTruth`; StageReceipt (B) is
  the declared, documented upgrade, not a current dependency (matches PRIORITY + AC3).
- **PlanCheck typed-findings is the new contract** (required by item 4's prerequisite), with a
  defensive legacy-scalar tolerance: a scalar return is tolerated exactly as ProposalReview
  tolerates legacy scalars (0 → pass; nonzero → ONE untyped blocking finding filed into `_ledger`;
  promotion requires typed findings — logged, never silent).
- **Classification is agent-assisted + mechanically validated**, not NLP: the PlanCheck agent
  labels `classification`; the workflow/CLI mechanically validates category whitelist, duplicate
  exact-match, and non-blocking eligibility. No fragile free-text extractor.
- **Promotion rides the existing finding ledger** ("via the proposal-convergence finding-ledger"):
  the grounded-fact-gap finding merges into `_ledger` (thus `milestones/M<NN>/proposal-ledger.json`,
  hash-bound into the receipt) with a `promoted` disposition marker — reviewable and hash-bound,
  not a silent side write.
- **Seed-doc migration**: `repo-ground-truth.md` and `inherited-core.md`'s `evidenceSurface`
  content become the registry's seeded content; the reference docs become a pointer/index, never
  a second divergent copy (DoD).
- **Mirror parity**: both workflow mirrors, both registry JSON + TS mirrors, and both test files
  byte-identical; vendor-sync clean (AC).

### Defaults and failure behavior

- Unknown category in a fact or an `--inject`/`--promote` request → non-zero exit → prepare fails
  closed pre-dispatch.
- Hash mismatch (tamper/drift) → `--validate` fails closed.
- Missing registry file / missing fact id referenced by `adrRef` → fail closed.
- Stale registry version vs a prior `preparation.json`'s recorded `hashes.groundTruth` → fail
  closed (the deterministic invalidation until B's envelope exists).
- A promotion bumps `version` and recomputes `hash`; the new version is picked up by the next
  `--inject`.
- A `grounded-fact-gap` finding whose fact is already registered (id or exact fact text) is NOT
  promoted again — flagged as a registry-injection defect (fail the injection, not the task).
- Legacy scalar PlanCheck return → tolerated as above, promotion skipped, logged never silent.
- Worktree isolation (`isolationMode:'worktree'`): the ground-truth CLI runs inside the worktree
  like every other content-phase dispatch; registry writes merge back at Land under the existing
  single-flight Land lock.
- Epoch accounting: `--inject`/`--validate`/`--promote` are non-content CLI dispatches; the
  existing epoch-cap checks gate only content-agent dispatch sites (one extra non-content dispatch
  per generation, one per promote).

### Compatibility

- PlanCheck schema change (scalar → typed array) is the only contract break. It affects: the e2e
  mock (`plugin/test/prepare-milestone-preparation-e2e.test.mjs:297` currently returns
  `{findings: 0, sessionId}` — must return `{findings: [], sessionId}`), the resume/cache path
  (`--decide-resume` keys off the result shape), and the `--plancheck-sessions` /
  `--plancheck-findings` provenance flags (count = typed array length, so
  `milestone-preparation-check.ts`'s `--check` reading `receipt.planCheck.findings` as a number
  stays valid).
- Mirror parity preserved after both injection and typed-findings edits; new registry JSON + TS +
  test files mirrored byte-identical; vendor-sync clean.
- `proposal-convergence.ts`'s finding-ledger contract is reused unchanged (promotion goes through
  `_upsertFindings`); no new ledger shape.
- `milestone-preparation-check.ts` is NOT modified (out of Touches); the version binding is a
  `*ground-truth*`-scoped write into the existing `preparation.json`.

### Risks

- **Touches gap (highest):** item 0a's template-hygiene gate edits `task-schema.ts` and
  `prepare-admission-check.ts`, which are NOT covered by the current `## Touches` globs
  (`*ground-truth*` only). The plan's `- Files:` lines naming those files would themselves trip
  `preflight-touches-mismatch`. Mitigation (MUST be recorded before PlanAuthor runs): the
  milestone amends the task's `## Touches` (task_write, early) to add `task-schema.ts`,
  `prepare-admission-check.ts`, the registry JSON data file, and both test mirrors; OR the hygiene
  gate is routed through a `*ground-truth*`-named file. Scoping items to `*ground-truth*`-only and
  then declaring `- Files:` lines for the preflight/task-schema files WITHOUT the amendment will
  trip the very gate this task fixes.
- **No-import constraint:** every registry interaction must be a CLI dispatch; a future author
  tempted to `import` the registry into the workflow will fail at runtime (M203-confirmed) —
  `_groundTruthAgentCall` is the mandated single gate.
- **Seed-doc drift:** after seeding, `repo-ground-truth.md` + `inherited-core.md` `evidenceSurface`
  must become generated/pointer views or carry a drift check, or the crystallization
  single-source principle is violated (DoD).
- **Stale seeded facts:** must encode the M205 correction, not the refuted parenthetical bullet.
- **Learning-loop misclassification:** an LLM may tag a task-specific fact as `grounded-fact-gap`;
  mitigated by the explicit `classification` field + mechanical promote validation + version-bump
  auditability.
- **Prompt bloat:** v1 injects all; mitigated by phase-specific category subsets if the registry
  grows.
- **Touches under-scoping** (first bullet) collides with the very `preflight-touches-mismatch`
  gate this milestone fixes — highest-severity operational risk.

### AC coverage (Requested-action item → falsifiable check)

- Item 0a → template-hygiene detector RED test (reject non-`##`-heading content after
  `## Touches`) + Touches amendment recorded (currently NO dedicated AC — coverage gap, see
  wiring claims).
- Item 1 → registry file exists, schema-validated, versioned, hash-bound, seeded from the 8
  sections + `evidenceSurface` with the M205 correction.
- Item 2 → both PlanAuthor and PlanCheck prompts receive the fetched subset (real injection; RED:
  fixture PlanAuthor omitting a registered fact yields a `grounded-fact-gap` PlanCheck finding;
  GREEN: fresh PlanAuthor with the fact registered produces a clean plan).
- Item 3 → version/hash binding is a DECLARED, deferred B upgrade; enforced NOW:
  `hashes.groundTruth` on the current receipt + fail-closed-5.
- Item 4 → typed PlanCheck findings with `grounded-fact-gap` classification + real (non-fixture)
  promote + version bump through the ledger.
- Item 5 → unknown-category and stale-version-vs-receipt fail closed before content dispatch.
- Item 6 → RED/GREEN fixtures in both trees; the DoD's "one real task prepares cleanly without
  manual grounded-facts (real dispatch evidence)" is an execution-phase (Build) proof on top.

### Mechanism-claim wiring coverage (DIR-117)

- CLAIM 1: both `prepare-milestone.js` mirrors dispatch `--inject` and interpolate `{raw}` into
  the PlanAuthor prompt → AC: real-injection check (fixture asserting the subset string with the
  live version appears in the PlanAuthor prompt).
- CLAIM 2: same, into EACH PlanCheck round's prompt → AC: same shape.
- CLAIM 3: PlanCheck emits typed findings with `grounded-fact-gap` classification (schema change
  from scalar) → the learning-loop prerequisite; needs a DEDICATED AC (absent from the current
  list — recommend adding "PlanCheck emits typed findings with classification").
- CLAIM 4: a `grounded-fact-gap` finding promotes into the registry with a version bump via the
  finding-ledger (`_upsertFindings`) → AC4; a grounded-fact-gap finding appears in
  `milestones/M<NN>/proposal-ledger.json` (hash-bound).
- CLAIM 5: the registry is the owner PlanCheck consults; per-task grounded-facts no longer needed
  → AC1 (grep-confirmable).
- CLAIM 6: registry version/hash bound into the current `preparation.json` receipt (fail-closed-5)
  and into the StageReceipt as deferred-to-B → AC3.
- CLAIM 7: unknown category / stale registry version vs receipt fails closed before content agents
  dispatch → AC6 (fail-closed RED test).
- CLAIM 8: template hygiene rejects non-`##` content after `## Touches` → item 0a has NO dedicated
  AC — a coverage gap the milestone MUST close (new AC or fold under AC6/AC1) or ProposalReview
  wiring-coverage will flag it uncovered.
- CLAIM 9: a registered fact re-surfacing as a finding is a registry-injection defect, not a task
  defect → fold into AC4.
- CLAIM 10: Touches coverage — the milestone's implementation files are covered by the task's
  `## Touches`; the current globs cover `*ground-truth*` + both workflow mirrors + docs, but item
  0a touches `task-schema.ts`/`prepare-admission-check.ts` (absent from Touches). The milestone
  MUST amend `## Touches` or scope every item strictly to `*ground-truth*` files; otherwise the
  Plan's `- Files:` lines trip the very `preflight-touches-mismatch` gate this task fixes. Needs
  an explicit AC/wiring note.

### Alternatives considered and rejected

- (a) Keep facts as per-task grounded-facts blocks (status quo) — rejected: per-task duplication,
  re-discovery cost, the exact root cause this task targets.
- (b) Prose doc the PlanAuthor is told to read — rejected: agents don't reliably read; no
  version/hash, no fail-closed, no learning loop; violates ADR-004 (hard checks over prose).
- (c) Plain JSON data file with no validator/CLI — rejected: no schema validation or fail-closed,
  and the no-import workflow still needs a dispatcher.
- (d) Facts embedded as a TS module imported directly into `prepare-milestone.js` — rejected
  decisively: the workflow DSL is M203-confirmed no-import; direct import is impossible; AND the
  learning loop must mechanically WRITE facts, which a module's source is awkward to mutate and
  whose diff is not a clean fact table.
- (e) Hardcoded registry subset in each prompt + registry file separately — rejected: two copies,
  violates single-source.
- (f) Workflow writes the registry JSON directly via fs for promotion — rejected: no-import
  constraint; promotion must be a `--promote` CLI dispatch.
- (g) Bind into StageReceipt now — rejected per PRIORITY: B is optional; the minimal
  versioned+hash-bound registry + fail-closed-5 works standalone; StageReceipt is
  declared-deferred.
- (h) PlanCheck findings only as a count + a separate free-text findingsDetail for classification
  — rejected: leaves classification to the LLM's unstructured prose, defeating the typed-finding
  prerequisite; the DIR-125 shape already exists at `_findingSchema` (line 1022) and is reused.
- (i) Per-task version sidecar (`.quay/ground-truth/<taskId>.version.json`) instead of
  `hashes.groundTruth` on the existing receipt — rejected: the task's own wording is "stale
  registry version vs RECEIPT"; the existing receipt already hash-binds ledger/telemetry/
  mechanismInventory; a second version store duplicates state. The receipt's `hashes.groundTruth`
  is the single binding, with the B envelope as the documented upgrade.

## Plan

N/A — resolved via a human-steered milestone. The resolving milestone authors a checked
`docs/plans/*.md` plan (DIR-117-B prepared-gate artifact) before implementation.

## Finding

The 2026-07-31 → 2026-08-01 product-task batch (DIR-099/100/101/103/104/105/112 + splits)
produced a recurring PlanCheck-failure pattern, each from a fact the PlanAuthor didn't know:

- CLI path `quay.ts` vs `quay.js` (5+ tasks);
- Node coverage output format (basename rows, no `%`, killed-child merges zero) (3+);
- Touches matching (directory entries don't satisfy exact-file; post-Touches content trips
  `touches-overbroad`) (4+); **correction (split review 2026-08-01):** the earlier
  "parentheticals break exact-path match" claim was FALSE — `_stripWrappingBacktick` (M205)
  already strips one trailing ` (…)` annotation, so a `loader.ts (new)` Touches entry matches;
  the real `preflight-touches-mismatch` cause was Plan-stage `- Files:` lines naming files the
  task's `## Touches` never declared;
- exact line/callsite counts (4+);
- runtime contract vs Proposal assumption (provider env defaults: native tasks_dir and
  github QUAY_GITHUB_REPO both default at runtime, so "required → error" is a false
  positive) (3+).

Each was fixed by adding per-task "grounded facts" to the task body — repo-invariant
knowledge duplicated across tasks. This is the exact "stable rules distributed across prose
instead of one executable owner" root cause DIR-124-D targets, for the FACTS category.
ADR-020 records the decision; this task mechanizes it.

## Requested action

0. **Template hygiene (mechanical, immediate):** fix the prepare-milestone preflight /
   task-schema checks so the recurring MECHANICAL preflight failures cannot happen:
   (a) reject any non-`##`-heading content after `## Touches` (parsed as Touches entries,
   `touches-overbroad`). NOTE (correction, split review 2026-08-01): the earlier claim that a
   `## Touches` entry's trailing parenthetical breaks exact-path matching is FALSE —
   `prepare-admission-check.ts`'s `_stripWrappingBacktick` (M205) already strips ONE trailing
   ` (…)` annotation after backtick-stripping, so `loader.ts (new)` matches cleanly. The real
   recurring `preflight-touches-mismatch` cause is a Plan-stage `- Files:` line referencing a
   file the task's `## Touches` never declared (fix: add the file to Touches) — NOT
   parentheticals. This removes the ~15% of batch cost from template-format mistakes before
   the registry matters.
1. Define a versioned `GroundTruthRegistry` (JSON or TS module) with schema-validated fact
   entries: `{ id, category, fact, adrRef? }`. Seed it from the five fact classes in
   `docs/references/repo-ground-truth.md` + migrate the `inherited-core.md`
   `evidenceSurface` content into the registry.
2. `prepare-milestone.js` (both mirrors) injects the relevant registry subset into the
   PlanAuthor and PlanCheck prompts — read from the registry, not re-typed per task.
3. Bind the registry version/hash into the StageReceipt **per [[DIR-124-B]] as a DECLARED,
   deferred upgrade** — consistent with the PRIORITY note: the minimal registry (a `version`
   field + content hash) works standalone; the StageReceipt binding is NOT a current
   dependency and is not enforced until B lands. A registry version change invalidates
   affected receipts deterministically ONCE the binding exists; until then, the registry's
   own version/hash is the fail-closed check (item 5) with no receipt coupling.
4. Learning loop — **prerequisite first**: PlanCheck today returns only
   `{findings: <count>, findingsDetail: <string>}` (no typed finding objects), so there is
   nothing to classify as `grounded-fact-gap`. This milestone must FIRST upgrade the PlanCheck
   phase to emit TYPED findings (a `grounded-fact-gap` classification on each finding object,
   per the DIR-125 typed-finding shape already used by ProposalReview — `{subsystem, summary,
   severity, blocking, disposition, rootCauseKey, repairable}`), THEN classify a typed PlanCheck
   finding as `grounded-fact-gap` when repo-invariant and not task-specific; promote it into the
   registry with a version bump (via the proposal-convergence finding-ledger). An
   already-registered fact re-surfacing as a finding is a registry-injection defect, not a task
   defect.
5. Fail-closed: a missing/unknown-category registry reference, or a stale registry version
   vs receipt, fails the PlanCheck/prepare before content agents dispatch.
6. RED/GREEN fixtures: a task whose plan omits a registered fact FAILS PlanCheck with a
   `grounded-fact-gap` finding; after the fact is registered, a fresh PlanAuthor produces a
   correct plan (proves the learning loop).

The resolving milestone is M232 (charter `experiments/quay-perpetual-stream/charters/
M232-dir-124-f.md`); its checked plan lands at `docs/plans/M232-dir-124-f.md`.

## Acceptance Criteria

- [ ] A versioned `GroundTruthRegistry` is the single production owner of the seeded facts;
  the per-task "grounded facts" blocks in the affected task bodies are NO LONGER needed for
  a clean PlanCheck (grep-confirmable: the registry, not task-body duplication, is what the
  PlanCheck consults).
- [ ] PlanAuthor and PlanCheck prompts are injected with the registry subset (both
  `prepare-milestone.js` mirrors) — real injection, not prompt prose.
- [ ] Registry version/hash is bound into the StageReceipt **as a declared, deferred upgrade
  to [[DIR-124-B]]** — NOT a current AC. What is enforced NOW (RED/GREEN): the registry is
  versioned + hash-bound, and a stale registry version vs receipt fails closed per item 5
  (fail-closed-5). The StageReceipt coupling itself is enforced only when B lands (documented
  upgrade path, matching the PRIORITY note that B is optional).
- [ ] A `grounded-fact-gap` PlanCheck finding promotes into the registry with a version
  bump via the finding-ledger — real production path, not fixture-only.
- [ ] A task that would previously fail PlanCheck on a seeded fact now passes on a fresh
  PlanAuthor attempt (the learning loop's payoff, shown on a real task).
- [ ] Unknown category / stale registry-version-vs-receipt fails closed before content
  agents dispatch.
- [ ] Mirror parity: `.claude/workflows/prepare-milestone.js` == `plugin/workflows/
  prepare-milestone.js`; vendor-sync clean.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] One real task that previously needed manual grounded-facts now prepares cleanly using
  the registry (real dispatch evidence).
- [ ] A fresh independent audit finds no refutation.
- [ ] `docs/references/repo-ground-truth.md` and `inherited-core.md`'s `evidenceSurface`
  are the registry's seeded content, not a second divergent copy.

## Human verification

1. Can a PlanAuthor produce a correct plan without any per-task grounded-facts block,
   purely from the injected registry?
2. Does a `grounded-fact-gap` finding actually update the registry (version bump), and does
   the next task benefit?

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*ground-truth*`
- `plugin/scripts/*ground-truth*`
- `experiments/quay-perpetual-stream/test/*ground-truth*.test.mjs`
- `plugin/test/*ground-truth*.test.mjs`
- `docs/references/repo-ground-truth.md`
- `experiments/quay-perpetual-stream/inherited-core.md`
- `adr/ADR-020-runtime-contract-ground-truth-registry.md`