---
id: DIR-124-B
title: Single-source milestone RunIdentity, stage journal, hash-bound receipts,
  Verify cache, and explicit resume
status: done
labels:
  - directive
  - human-steered
parent: DIR-124
children:
  - DIR-124-B1
  - DIR-124-B2
  - DIR-124-B3
  extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

**ADR-022 关闭（2026-08-09，manager 代写，人 17:4x 裁定关闭，随父任务 DIR-124 一并关闭）**

原标题：Single-source milestone RunIdentity, stage journal, hash-bound receipts, Verify cache, and
explicit resume。Touches 直指 `.claude/workflows/execute-milestone.js`——**已被 ADR-022
（2026-08-03 accepted）物理删除**。

实测：本任务体对 `execute-milestone.js`/`composite-` 等关键词命中 16 处（含子任务 B1-B4 均已 split
出去，各自独立 M-number，同样面临同一根因）。

意见：见父任务 `DIR-124` 关闭说明。RunIdentity/StageReceipt/journal/resume 这类概念若仍有价值，
应对照当前 fast-mode 的 worktree-per-task 执行模型重新设计，而不是复用这份为已删除引擎写的契约。

全文见 git 历史（`git log -p -- tasks/DIR-124-B.md`）。

## Proposal

Establish the canonical information-transfer substrate between milestone stages: ONE typed
`RunIdentity`, ONE append-only stage journal under the canonical milestone root, ONE hash-bound
`StageReceiptEnvelope`/`FindingEnvelope` contract, Verify-cache persistence moved INTO that store,
and retry/resume as an explicit validation-driven computation. This is DIR-124's C2 layer: it
implements `docs/proposals/quay-milestone-workflow-git-crystallization.md` sections 5.1/5.3/7
(safety invariants 3, 6, 11) — a runnable substrate on which DIR-124-C/D/E can later extract the
kernel, registry, and scheduler, and on which DIR-124-F (reassigned 2026-08-01 to the
GroundTruthRegistry runtime contract) can build. It consumes [[DIR-124-A]]'s stage-event
observability, [[DIR-123]]'s worktree isolation, and the resolved
`gap-build-phase-iteration-evidence-path-not-single-sourced`. It deliberately does NOT implement
[[DIR-118]]'s post-Land Wiring Audit or `done`-promotion policy.

### Problem framing (grounded in current code)

**The Verify cache loop is OPEN, not folklore.** In both `execute-milestone.js` mirrors
(`.claude/workflows/execute-milestone.js` and `plugin/workflows/execute-milestone.js`,
`cmp`-identical): `cacheFingerprints = $a.cacheFingerprints` and `priorVerifyCache =
$a.priorVerifyCache` (L77–78); the per-check lookup `_cached(label)` (L121–128) reuses
`priorVerifyCache[label].result` on fingerprint equality alone; `verifyCacheUpdates` is built
(L208–211) and returned from the full needs-human/done exit surface (grep-verified: 16 return
sites). The callers — OUTER-LOOP.md and the concurrent fan-in — have ZERO
`verifyCacheUpdates`/`priorVerifyCache` references (grep-verified). The cache loop is structurally
open: a result "looks reusable" while proving another filesystem state. The lookup validates ONLY
fingerprint equality — no base/candidate commit, workflow source, or runtime-generation binding — so
a cached PASS from a stale materialized workflow body (the documented CLAUDE.md M176
`Workflow({name})` stale-script-cache defect) or a wrong base is indistinguishable from a valid
reuse. Crystallization safety invariant 3 ("No receipt is valid outside its bound base, candidate,
inputs, workflow source, and runtime generation") is violated at the only stage that has a cache
today.

**Resume is folklore, not a durable transition.** OUTER-LOOP.md documents
`resumeFromAdjudicatedProposal` for prepare, but the execute side has no persisted stage history.
The known `Workflow({name})` stale-materialization defect cannot be rejected because nothing records
which checked-in workflow generation actually produced a stage's result.

**Other stages transfer evidence through prompt output, mutable files, staging state, and
task/dashboard text with no common binding** to base commit, candidate commit, workflow source,
material inputs, or runtime generation.

**Useful crystal nuclei exist but are unjoined.**

- The Build evidence manifest (`build-evidence-manifest.ts`, M238) already carries `runIdentity
  {milestoneId, taskIds, composite, attempt, sessionId}`, `baseCommit`, `candidateCommit`, and
  exports `manifestRefForReceipt()` whose doc comment literally says "for DIR-124-B receipt
  binding" — but nothing consumes that reference today.
- The preparation receipt (`milestone-preparation-check.ts`, M191/DIR-117 + DIR-125) hash-binds
  proposal/charter/Plan/sources/ledger/telemetry/mechanism-inventory into
  `milestones/M<NN>/preparation.json`, and its finding ledger (`proposal-ledger.json`, M192) already
  has FindingEnvelope-shaped fields (`id`/`subsystem`/`severity`/`blocking`/`disposition`/
  `evidence`/`claimRef`/`rootCauseKey`/`firstSeenRound`/`lastSeenRound`) — but it is Prepare-only.
- DIR-126-D telemetry (`milestones/prepare-telemetry/<taskId>/<recordId>.json`, schema v2:
  `recordId`/`attemptId`/`generationId`, admission lease, `hashes`, `decision`, `terminal`,
  `leaseRelease`) is committed and read-only.
- DIR-124-A1a (M248, landed) supplies `workflow-event-schema.mjs` v1 (SCHEMA_VERSION `"1"`; 20
  required fields — `schemaVersion`, `runId`, `candidateId`, `taskId`, `stage`, `attempt`, `timing`,
  `agentLabel`, `commandIdentity`, `executionCwd`, `worktreePath`, `baseCommit`, `candidateCommit`,
  `outcome`, `waitReason`, `resourceClaim`, `observedWrites`, `isolationMode`, `dispatchMode`,
  `recordedAtMs`; `VALID_STAGES`) with `validateEvent`, `parseEventStream`, `emitEvent`, and a
  `--emit-event` CLI appending to the GITIGNORED `.workflow-events/<runId>.jsonl` — transient
  observability, not durable cross-workflow receipt state.
- `proposal-convergence.ts` already computes `recurrenceKey = sha256(taskId::code).slice(0,12)`
  with first/last-generation tracking — the recurrence-key concept has live precedent.
- The workflow DSL has no ESM `import` capability; all new production callsites must be literal bash
  `node --experimental-strip-types <abs path>/<script>.ts <mode>` invocations dispatched via
  `agent()` (precedent: `milestone-preparation-check.ts` L250/L252, `composite-audit.ts
  --combine-json` L634).
- Session identity already exists via `echo $CLAUDE_CODE_SESSION_ID` (DIR-093 pattern; 5 echoes in
  the live workflow) — the "cannot be forged" property of `runId` is a wiring fact, not prose.

**Base-revision drift to reconcile.** The Plan (`docs/plans/M236-dir-124-b.md`) was authored
against base `65f414c4`; an independent review re-verified its grounded facts against `427c5ad7`;
the live HEAD at this writing is `69c9d076` (DIR-124-A2 landed + size-B direct-execute prep
artifacts + later work). Every grounded fact in this Proposal was re-verified against the live tree;
the Plan MUST re-ground its grounded-facts section before dispatch.

### Chosen mechanism

Four new script families (both mirrors, byte-identical) + additive wiring in both
`execute-milestone.js` mirrors, all under the task's own `## Touches` globs (`*run-identity*`,
`*stage-receipt*`, `*workflow-journal*`, `*workflow-resume*`). None exist at base (`ls` empty —
verified). Concretely:

1. **`run-identity.ts`** — the canonical `RunIdentity` factory and the ONE identity-minting entry
   point. Typed fields: `runId` (derived from `$CLAUDE_CODE_SESSION_ID` + a per-dispatch nonce —
   never caller-forged), `candidateId`, `taskIds`, `attempt`, `baseCommit`, `candidateCommit`
   (bound when the Build candidate-generation commit exists, re-checked at Audit/Gate/Land),
   `workflowSourcePath`, `workflowSourceHash`, `workflowSourceCommit`, `runtimeGeneration`,
   `taskHash`, `charterHash`, `planHash`, `materialInputHashes`. The SAME factory produces a
   singleton width-1 shape and a composite shape — identical envelope type (AC1). CLI `--create
   <json>` is the workflow callsite; embedded `--selftest`.

2. **`stage-receipt.ts`** — the versioned contract module: `FindingEnvelope`, `StageEvent`,
   `StageReceiptEnvelope`, `ReceiptValidationResult`. `FindingEnvelope` carries occurrence identity,
   stable `recurrenceKey`, observer/earliest-detectable stage, subsystem/claim reference,
   severity/blocking, evidence references, material input hashes, first/last generation,
   disposition/resolution, and the `task-specific|profile|global` generalization (Requested-action
   item 1, AC2). `buildReceiptEnvelope`/`bindReceipt` bind base/candidate commits, workflow source
   path/hash/commit, runtime generation, and every material input hash (AC3). `validateReceipt` is
   the fail-closed validator with ONE distinct code per AC6 hazard class (wrong base, wrong
   candidate, modified Plan, stale named-workflow materialization, wrong runtime generation, missing
   artifact, moved candidate commit, tampered receipt). `validateEvidenceManifestRef` hash-validates
   a bounded Build evidence-manifest reference (`{path, sha256}` against the file it names) WITHOUT
   copying authoritative task/Proposal/charter/Plan content; `rejectDuplicateAuthority` is the
   negative that rejects a receipt embedding copied requirements (AC10, extends
   `validateManifestShape`'s `no-second-authority` precedent). `migratePrepareLedger` is the one-way
   Prepare finding-ledger adapter (`proposal-ledger.json` entries → `FindingEnvelope`s with source
   hashes preserved, AC9). CLI `--validate-receipt` / `--evidence-manifest-ref` /
   `--migrate-prepare-ledger`.

3. **`workflow-journal.ts`** — `StageJournalStore`: the append-only durable journal at
   `milestones/M<NN>/stage-journal.jsonl` + `receipts/*.json` under the CANONICAL milestone root
   resolved via `gate_resolve_milestone_root` (the same single-sourced resolver Build/Audit/Land
   use — never a new path convention; rule ≥130 → top-level `milestones/M<NN>`). Atomic write
   (write-temp-then-rename / line-safe framed append), torn-write rejection (a partial trailing
   record is surfaced, never silently parsed). `persistVerifyCache(updates)` /
   `loadValidatedVerifyCache(runIdentity)` implement Requested-action items 3–4: cache lookup
   validates exact check input, base/candidate state, workflow source, and runtime generation BEFORE
   reuse (AC5). One-way migration adapters `migrateDir124AEvent(event)` (AC8 — maps the PINNED
   DIR-124-A 20-field schema field-for-field into a `StageEvent`, appended to the SAME journal so no
   dual authoritative event format remains) and `migrateDir126DTelemetry(record)` (AC9 — consumes
   the committed prepare-telemetry record, preserving `recordId`/`generationId`/hashes, no reverse
   writer). CLI `--append-stage`, `--persist-verify-cache`, `--load-validated-verify-cache`,
   `--migrate-dir124a`, `--migrate-dir126d`.

4. **`workflow-resume.ts`** — `resumePlan({journal, receipts, candidateState})` →
   `{earliestInvalidStage, plan}`. Determines the earliest invalid/incomplete stage from VALIDATED
   receipts, reuses only validated prior receipts, increments the attempt identity (new attempt =
   prior max + 1), and records a per-stage reason for reuse or invalidation (`reused-valid` |
   `invalidated-by-<code>`). A receipt whose prompt/label strings match but whose inputs differ is
   NEVER silently reused (AC7). CLI `--resume-plan <json>`.

5. **Workflow wiring** (both `execute-milestone.js` mirrors, additive): mint `_runIdentity` at
   `phase('Verify')` entry via `run-identity.ts --create`; per-boundary append + green-boundary
   receipt at all seven phases (Verify L66, Prepared L234, Build L389, Audit L673, Gate L769,
   Reconcile L866, Land L908); replace the Verify cache LOOKUP (L121–128) with a
   `--load-validated-verify-cache` callsite and CLOSE the loop by persisting `verifyCacheUpdates`
   through `--persist-verify-cache`; on dispatch with a journal present, run `--resume-plan` and
   start at the earliest invalid stage; expose the migration adapters as reachable one-way
   callsites; declare DIR-118 extension fields as inert optional fields (AC11). All new production
   callsites are bash `node --experimental-strip-types <abs path>/<script>.ts <mode>` invocations
   via `agent()` — no new DSL import mechanism.

### Concrete control and data flow

```
OUTER-LOOP / concurrent fan-in dispatch
  │  $a = {taskIds|milestoneCandidate, charterFile, ...}
  ▼
execute-milestone.js (both mirrors, byte-identical)
  phase('Verify') entry
   ├─ run-identity.ts --create {sessionId: $(echo $CLAUDE_CODE_SESSION_ID),
   │       taskIds, attempt: <journal max+1|1>, baseCommit: $(git rev-parse HEAD)}
   │     → const _runIdentity = {runId, candidateId, taskIds, attempt, baseCommit, ...}
   ├─ if journal exists: workflow-resume.ts --resume-plan → {earliestInvalidStage, plan}
   │       → resume starts at earliestInvalidStage, reuses only validated receipts
   ├─ Verify cache LOOKUP replaced by workflow-journal.ts --load-validated-verify-cache
   │     (validates check input + base/candidate + workflow source + runtime generation)
   │     → per-check reuse; non-validated checks dispatch fresh agents
   │     → verifyCacheUpdates persisted via workflow-journal.ts --persist-verify-cache
   │       (the needs-human/done exit sites keep their return shape; the CALLER no longer
   │        owns the loop)
   ▼
   each phase boundary (Verify/Prepared/Build/Audit/Gate/Reconcile/Land):
   ├─ workflow-journal.ts --append-stage '<StageEvent>'   (append-only, atomic)
   └─ on green: stage-receipt.ts build+bind/--validate-receipt
         → milestones/M<NN>/receipts/*.json  (hash-bound envelope)
   Build integrate: bind _runIdentity.candidateCommit
   Audit/Gate/Land: re-check candidateCommit (moved-candidate hazard)
   ▼
   milestones/M<NN>/stage-journal.jsonl + receipts/*.json   ← CANONICAL DURABLE CONTRACT
      (committed milestone artifacts, resolved via gate_resolve_milestone_root; durable
       across process/session restart; auditable post-Land)

One-way migration inputs (never reverse-written):
   .workflow-events/<runId>.jsonl          → --migrate-dir124a  → StageEvent (AC8)
   milestones/prepare-telemetry/...        → --migrate-dir126d  → StageEvent (AC9)
   milestones/M<NN>/proposal-ledger.json   → --migrate-prepare-ledger → FindingEnvelope (AC9)
```

### Key design decisions

**DD1 — Durable committed store under the canonical milestone root, not the gitignored
`.workflow-events/`.** DIR-124-A's `.workflow-events/` stream is transient local observability
(gitignored, per-run, best-effort). B's journal/receipts must survive process/session restart and be
independently auditable post-Land (AC4, DoD 2/4), so they live at `milestones/M<NN>/stage-journal.jsonl`
+ `receipts/*.json` as committed pipeline-generated milestone artifacts (same commit policy as
`preparation.json`). The store resolves its root ONLY via `gate_resolve_milestone_root` — the exact
single-sourced resolver the `gap-build-phase-iteration-evidence-path-not-single-sourced` fix
mandated for Build; a second hand-derived path convention is the bug class this milestone must not
reintroduce.

**DD2 — One canonical `RunIdentity`, one factory, singleton and composite alike (AC1).** Identity
minting is a single entry point called once at dispatch; composite width changes `taskIds`
cardinality, never the envelope type. `runId` is `$CLAUDE_CODE_SESSION_ID` + per-dispatch nonce —
never a caller-asserted string (harness-sourced, not prompt-derived; the "cannot be forged" property
is mechanical). `candidateCommit` is bound at Build-integrate (the SOLE commit-creator) and
re-checked at Audit/Gate/Land so a moved candidate commit fails closed.

**DD3 — Receipts bind EVERYTHING (AC3, safety invariant 3).** Every receipt mechanically records
base/candidate commits, workflow source path/hash/commit (`git log -1 --format=%H -- <path>` +
`sha256sum <path>`), runtime generation, and material input hashes (task/Proposal/charter/Plan
files). This directly defeats the M176 stale-named-workflow defect: a stale materialized workflow
body is literally different file content, so `workflowSourceHash` differs from the journal's recorded
value and the receipt fails closed — no reliance on prompt/label identity.

**DD4 — `runtimeGeneration` is derived from the installed workflow source.** Defined as the workflow
source hash at dispatch (optionally a monotonic journal counter bumping when that hash changes). A
wrong runtime generation is therefore a DISTINCT fail-closed code from "wrong workflow source hash"
only in that a generation can be identified per-source-version; the fixed derivation is pinned by
fixtures so the definition cannot drift.

**DD5 — Verify cache becomes store-driven and per-check (AC5).** Reuse requires fingerprint match
AND base/candidate/workflow-source/runtime-generation equality, validated by the store at load time.
An unchanged run reuses all valid receipts; changing ONE check's material input reruns ONLY that
check. The store owns the loop; the workflow's exit sites keep their return contract, so no caller
change is required to close the loop.

**DD6 — Explicit resume is a computation, not folklore (AC7).** `resumePlan` walks validated
receipts forward, identifies the earliest invalid/incomplete stage, and emits a per-stage
reuse/invalidation reason list. Resume never guesses from prompt or label strings; it only trusts
receipts that pass `validateReceipt` against the current candidate state.

**DD7 — One-way migration adapters only (AC8/AC9, G4).** `migrateDir124AEvent`,
`migrateDir126DTelemetry`, and `migratePrepareLedger` are schema mappers + hash/provenance
preservers, NEVER schema authors and NEVER reverse writers. Source hashes are preserved so a later
swap is detectable. After migration there is exactly ONE authoritative journal format. The AC8
adapter is pinned to the LANDED DIR-124-A 20-field schema (field-for-field; the pin is the
negotiation surface if a later A-schema revision differs, re-grounded at the real migration step). A
migration input that is absent (e.g. no A1a event stream yet because A1b/A1c emission is not landed)
is a recorded-provenance no-op, never a guessed shape — the AC8 real exercise stays gated on the
stream existing.

**DD8 — Receipts never copy authoritative content (AC10, G5).** A receipt stores hashes + a bounded
evidence-manifest reference only; `rejectDuplicateAuthority` is a permanent negative control against
embedded task/Plan/Proposal/charter text. The `build-evidence-manifest.ts` `manifestRefForReceipt`
`{hash, path, candidateCommit}` becomes the consumable reference.

**DD9 — Workflow DSL import-less dispatch.** All new production callsites are bash
`node --experimental-strip-types <abs path>/<script>.ts <mode>` via `agent()`, the established,
tested pattern. No new DSL import mechanism.

**DD10 — DIR-118 extension fields exist but are inert (AC11).** `StageReceiptEnvelope`/
`FindingEnvelope` declare forward-compatible optional fields DIR-118 will later need
(wiring-required semantics), but no wiring reads or acts on them. `landed-awaiting-wiring` is
grep-forbidden in both mirrors; no post-Land Wiring Audit dispatch, no `done`-promotion enforcement.
DIR-118 still owns that policy; B's substrate lands inert so the lifecycle policy can be added later
without another control-plane rewrite.

**DD11 — One authoritative schema family, versioned by explicit bump.** `FindingEnvelope`/
`StageEvent`/`StageReceiptEnvelope`/`ReceiptValidationResult` live in `stage-receipt.ts`; a schema
change is a new envelope version, never silent field drift. All stage events and receipts flow
through the one store; DIR-124-A events and DIR-126-D/Prepare-ledger records enter only through the
one-way adapters, so no dual authoritative event format remains.

### Defaults and failure behavior

- **Cold dispatch (no journal):** normal full dispatch; first green boundaries seed the journal. An
  empty journal is valid input, never a crash.
- **Cache miss** (no prior, no fingerprint, or ANY binding mismatch) → fresh agent dispatch, never
  a reuse.
- **Torn/partial write:** surfaced by the store, never silently parsed; the write is atomic
  (temp-then-rename / line-safe framed append) so no partial success state is observable (AC4).
- **Failed `--persist-verify-cache`:** store unchanged; Verify falls back to fresh agent dispatch —
  a cache write failure NEVER yields a stale reuse (fail-safe direction).
- **Cache load failure:** treated as "no valid receipt" → full fresh dispatch for that check; a
  store bug cannot cause silent stale reuse.
- **Tampered receipt:** sha256/HMAC mismatch → `invalid`; each AC6 hazard (wrong base, wrong
  candidate, modified Plan, stale named-workflow materialization, wrong runtime generation, missing
  artifact, moved candidate commit, tampered receipt) returns its own distinct
  `ReceiptValidationResult` failure code; `resumePlan` maps any of them to `invalidated-by-<code>`.
- **Non-vacuous receipts:** a receipt with empty `materialInputHashes` is not reusable.
- **Duplicate authority:** a receipt embedding copied authoritative content is rejected by
  `rejectDuplicateAuthority`.
- **Missing artifact (evidence-manifest ref):** hash validation fails closed with a distinct code.
- **One-way adapters:** attempting a reverse write errors; the adapters never edit `.workflow-events/`,
  `prepare-telemetry/`, or `proposal-ledger.json`. An absent migration input is a recorded-provenance
  no-op, never a guessed shape.
- **Post-Land real evidence (DoD 1–4, real halves of AC4/AC5/AC7) cannot be produced by a pre-Land
  iteration-0** — the iteration-0 Audit's `it0-dod-check.sh` clause 0 HARD-blocks unchecked
  checklist boxes → the Audit verdict is REFUTED-by-construction (the exact interaction that REFUTED
  base milestone M210). Resolved path: Stages 1–7 land human-steered under a declared EXTERNAL
  needs-human reason (Clause-9-valid: evidence-timing); `done` is reached ONLY via the post-Land
  Stage-8 real proof (real interrupted-and-resumed + stale-receipt-rejected exercise, M214
  precedent) + re-promote. This is the named, acknowledged lifecycle terminal, not an oversight.

### Compatibility

- **Behavior-preserving on the legacy dispatch path.** Every new callsite is additive (mints
  identity, appends journal, persists cache, computes resume plan); the legacy Verify cache surface
  and phase order are untouched. The four existing golden-replay `plugin/test/execute-milestone-*.test.mjs`
  files stay green UNMODIFIED against the edited workflow (G2 regression guard), and the mirror
  `diff` must stay clean (G3).
- **Coexists with DIR-124-A's event stream.** A1's `.workflow-events/` remains the transient
  observability layer; B's journal is the durable contract. AC8's migration is one-way INTO B's
  journal, so during the transition both exist but only B is authoritative for receipts; after
  migration no dual authoritative event format remains.
- **Coexists with the preparation receipt.** `preparation.json`/`proposal-ledger.json` remain the
  Prepare authority; B's `migratePrepareLedger` READS them one-way (AC9) — no dual-write, no reverse
  dependency. `milestone-preparation-check.ts`, `prepare-milestone.js`, `proposal-convergence.ts`,
  `prepare-admission-check.ts`, and `gate-script-lib.sh` are NOT touched.
- **Build evidence manifest is a hash-referenced input, never copied** (AC10);
  `manifestRefForReceipt` is consumed, not duplicated.
- **Worktree isolation is bound, not assumed.** Receipts record whatever isolation was used; a
  resume under a different candidate state revalidates candidateCommit/base before reuse. Legacy
  (no-isolation) and worktree-isolated dispatch consume the same substrate.
- **New plugin tests** enter `scripts/test.sh`'s default glob by location alone; no glob hand-editing.
- **A4 conformance (DIR-124-A4) stays green**: the wiring may touch `meta.phases[]` detail strings
  only if the driver changes in a way the metadata must mirror; the driver/metadata conformance
  check and A1 mirror parity remain enforcement surfaces.

### Mechanism-claim wiring coverage (DIR-117)

Each new call/dispatch/ownership/enforcement relationship below is a CLAIM that needs a matching
Acceptance Criteria item and AC-level proof (fixture, grep, real dispatch) — not prose assertion:

- **CLAIM-B1:** `execute-milestone.js` (both mirrors) invokes `run-identity.ts --create` at Verify
  entry and owns identity minting; `runId` is derived from the harness `$CLAUDE_CODE_SESSION_ID`
  echo (a wiring fact, not prose). → AC1, AC3.
- **CLAIM-B2:** `execute-milestone.js` appends a `StageEvent` via `workflow-journal.ts
  --append-stage` at each of the seven phase boundaries. → AC4.
- **CLAIM-B3:** a hash-bound `StageReceiptEnvelope` is written on green boundaries; `bindReceipt`
  binds base/candidate commits, workflow source path/hash/commit, runtime generation, and material
  input hashes. → AC3.
- **CLAIM-B4:** the Verify cache LOOKUP (L121–128) is replaced by `workflow-journal.ts
  --load-validated-verify-cache` (validating check input + base/candidate + workflow source +
  runtime generation before reuse) and `verifyCacheUpdates` are persisted via `--persist-verify-cache`
  — the caller no longer owns the loop. → AC5.
- **CLAIM-B5:** `workflow-resume.ts --resume-plan` is invoked on dispatch when a journal exists and
  returns `{earliestInvalidStage, plan}`; the workflow starts at the earliest invalid stage. → AC7.
- **CLAIM-B6:** `workflow-journal.ts --migrate-dir124a` maps DIR-124-A events one-way into the SAME
  journal. → AC8.
- **CLAIM-B7:** `workflow-journal.ts --migrate-dir126d` and `stage-receipt.ts
  --migrate-prepare-ledger` map prepare-telemetry records and `proposal-ledger.json` entries one-way
  with source hashes preserved. → AC9.
- **CLAIM-B8:** `stage-receipt.ts`'s `validateEvidenceManifestRef` hash-validates a Build
  evidence-manifest reference; `rejectDuplicateAuthority` rejects a receipt embedding copied
  authoritative content. → AC10.
- **CLAIM-B9:** `validateReceipt` returns a distinct fail-closed code for each of the eight AC6
  hazards (wrong base, wrong candidate, modified Plan, stale named-workflow materialization, wrong
  runtime generation, missing artifact, moved candidate commit, tampered receipt). → AC6.
- **CLAIM-B10:** the store resolves its root via `gate_resolve_milestone_root` (the SAME
  single-sourced resolver Build/Audit/Land use) — no new path convention. → AC4 (durability at the
  correct path).
- **CLAIM-B11:** the store's atomic write rejects torn/partial writes. → AC4.
- **CLAIM-B12:** `FindingEnvelope` recurrence does not permit reuse when material input hashes
  differ; a same-`recurrenceKey`-different-hash fixture must fail. → AC2.
- **CLAIM-B13:** DIR-118 extension fields are declared but inert; `landed-awaiting-wiring` is
  grep-forbidden in both mirrors; no post-Land Wiring Audit or `done`-promotion enforcement is
  wired. → AC11.
- **CLAIM-B14:** all four script pairs and both workflow mirrors remain byte-identical after wiring.
  → AC1/AC6 cross-cutting (mirror parity, G3).

### AC coverage (all 11 task AC indices)

| AC | Mechanism |
|---|---|
| 1 | DD2 + CLAIM-B1: one `RunIdentity` factory + one receipt envelope for singleton AND composite |
| 2 | `FindingEnvelope` (recurrenceKey, generalization, observer/earliest stage, claim ref, severity, evidence refs, material input hashes, first/last generation, disposition) + recurrence-does-not-permit-reuse negative control (CLAIM-B12); generalization is descriptive metadata, never a reuse predicate |
| 3 | `bindReceipt`: base/candidate commits + workflow source path/hash/commit + runtime generation + material input hashes (CLAIM-B1/B3) |
| 4 | Durable committed store at `milestones/M<NN>/`, atomic write, torn-write rejection, restart survival (CLAIM-B2/B10/B11) |
| 5 | Store-driven Verify cache: `--load-validated-verify-cache` + `--persist-verify-cache`, per-check granularity (CLAIM-B4) |
| 6 | Eight-hazard fail-closed matrix as fixed RED/GREEN test set, one distinct code each (CLAIM-B9) |
| 7 | `resumePlan` earliest-invalid-stage computation + per-stage reuse/invalidation reasons; never prompt/label reuse (CLAIM-B5) |
| 8 | `migrateDir124AEvent` one-way, pinned to the landed 20-field schema, single journal after migration (CLAIM-B6) |
| 9 | `migrateDir126DTelemetry` + `migratePrepareLedger` one-way with preserved source hashes; no dual-write/reverse dependency (CLAIM-B7) |
| 10 | `validateEvidenceManifestRef` hash-bound manifest reference + `rejectDuplicateAuthority` duplicate-authority negative (CLAIM-B8) |
| 11 | Inert DIR-118 extension fields only; no wiring-required lifecycle state (CLAIM-B13) |

### Risks

- **R1 — Perturbing the Verify hot path.** A store-load bug could force unnecessary re-runs or
  (worse) stale reuse. Mitigation: fail-closed load (no valid receipt → fresh dispatch), store write
  failures leave the store unchanged, and the AC6 hazard matrix is fixed RED/GREEN so a silent-reuse
  regression is a test failure.
- **R2 — Dual authoritative event formats if migration is partial.** Mitigation: G4 single-journal
  guard — all stage events and receipts flow ONLY through `StageJournalStore`; adapters are one-way;
  a reverse-write attempt errors; AC8's "no dual authoritative event format remains" is an explicit
  post-migration assertion.
- **R3 — Runtime-generation definition drift.** Mitigation: fixed derivation (installed workflow
  source hash, optionally journal-monotonic), pinned by fixtures; AC6's "wrong runtime generation"
  is a named hazard with its own code.
- **R4 — M176 stale-script-cache during THIS milestone's real proof.** M236 patches
  `execute-milestone.js` itself. Mitigation: Stage-8 real proof runs from a FRESH post-Land session,
  verifies the materialized body carries the new callsites (grep ≥1), and uses `Workflow({scriptPath})`
  as the documented fallback (M214 Stage-6 precedent). This is also the FIRST real consumer of the
  very mechanism it builds (receipts reject a stale materialized workflow).
- **R5 — DIR-124-A completeness/shape.** A1a (schema module) is landed, but A1b/A1c emission is
  `todo`, so a real A1a event stream may not exist for the AC8 real migration exercise; and a later
  A-schema revision could differ from the pinned field set. Mitigation: the structural half is
  written against the LANDED 20-field schema (a real, current contract, not a projection); the pin IS
  the contract; the adapter is re-grounded to the landed schema before the AC8 real proof — never
  assumed; the real exercise is gated on the stream existing; no invented shape.
- **R6 — Committed journal bloat.** Mitigation: receipts store hashes + bounded manifest refs only,
  never copied content (G5); journal is per-milestone and small (~7 events + 7 receipts per run).
- **R7 — Resume silently reusing a stale receipt because a hazard class is not enumerated.**
  Mitigation: the eight-hazard AC6 matrix is exhaustive-by-fiat and each hazard must return its
  distinct code; an unclassified mismatch is a test failure, not a review comment (G6).
- **R8 — Post-Land real proof timing.** DoD 2–4 and the real halves of AC4/AC5/AC7 are post-Land by
  construction; a pre-Land iteration-0 cannot produce them. Mitigation: the lifecycle-feasibility
  path (REFUTED-by-construction → external needs-human → human-steered Land → post-Land Stage-8
  re-promote) is named explicitly and is the single source of truth for reaching `done`.
- **R9 — Base drift (`65f414c4` → `427c5ad7` → `69c9d076`).** The Plan's grounded-facts section is
  authored against `65f414c4`. Mitigation: re-ground every grounded fact against the live HEAD
  before dispatch; the wiring's line anchors are advisory and must be re-verified at the edit step.
- **R10 — High-curvature driver edit (the task's own highRisk flag).** Mitigation: additive-only
  wiring (DD5/D6), golden-replay regression, stages ≤5 land with zero production callers (fully
  rollbackable pre-wiring).
- **R11 — Attempt/first-seen generalization ambiguity in `FindingEnvelope`**
  (`task-specific|profile|global`, `first/last generation`). Mitigation: recurrence key + material
  input hashes decide reuse; generalization is descriptive metadata, never a reuse predicate.

### Non-goals

1. **DIR-118 behavior:** no `landed-awaiting-wiring` state, no post-Land Wiring Audit dispatch, no
   `done`-promotion enforcement (AC11).
2. **Stage scheduling / pipeline reordering** (DIR-124-C's scope).
3. **Kernel extraction / Stage Adapter ABI** (DIR-124-D's scope).
4. **Versioned execution-policy registry** (DIR-124-E scope) and the rolling effect-lease child
   (that decision stays at DIR-124-E close-out with a distinct id).
5. **GroundTruthRegistry runtime contract** (DIR-124-F, reassigned 2026-08-01).
6. **Editing `prepare-milestone.js`, `proposal-convergence.ts`, `milestone-preparation-check.ts`,
   `prepare-admission-check.ts`, `gate-script-lib.sh`, `composite-*.ts`, or the four existing
   golden-replay test files** — all read-only inputs; editing them is a Plan violation, not an
   implementation choice (G1).
7. **Unifying the journal with `.quay/gate-events.jsonl` or the A1 `.workflow-events/` stream** —
   each stays its own system; B's journal is the durable receipt/finding contract, A1's stream stays
   transient observability.
8. **Copying authoritative task/Proposal/charter/Plan content into receipts.**
9. **Making worktree isolation the default** (DIR-123's opt-in-then-prove posture; receipts bind
   whatever isolation was used).
10. **Reverse migration or dual-write from B's journal back into any Prepare/DIR-126-D writer.**

### Alternatives considered and rejected

- **Alt1 — Extend the A1 `.workflow-events/` stream into the durable journal.** Rejected: A1's
  stream is gitignored, per-run, best-effort, and fire-and-forget by design (DD10 of A1); receipts
  must survive process/session restart and be post-Land-auditable, which requires committed durable
  state. Keeping A1 transient and B committed also keeps the one-way migration (AC8) a real,
  testable boundary instead of a rename.
- **Alt2 — Have the CALLER persist `verifyCacheUpdates` (close the loop at OUTER-LOOP.md / fan-in).**
  Rejected: this keeps the cache semantics in caller folklore, couples every future caller to the
  cache contract, and still lacks base/candidate/workflow-source/runtime-generation binding. Moving
  persistence + validation INTO the store makes the loop closed by construction and the binding
  mechanical.
- **Alt3 — Reuse the `Workflow` engine cache (`resumeFromRunId`).** Rejected: the M144/M176 defects
  are precisely the engine cache keying on (prompt, opts) only and being blind to external-state
  changes; the substrate must live at the domain layer where hashes and commits are visible.
- **Alt4 — A single monolithic `stage-substrate.ts`/`workflow-store.ts` with identity+journal+receipt
  +resume in one file.** Rejected: the four families map one-to-one onto the four `## Touches`
  globs, keep each responsibility independently testable and landable, and mirror the repo's
  established script-family granularity. A monolith would defeat the isolation DIR-124-A's
  split-or-commit discipline exists to protect.
- **Alt5 — Resume by re-running from a saved run snapshot (checkpoint restore).** Rejected: snapshot
  restore re-establishes state without PROVING it — the whole finding is that a result can look
  reusable while proving another state. `resumePlan` revalidates receipts against current candidate
  state and records why each earlier stage was reused or invalidated, which a snapshot cannot
  explain.
- **Alt6 — Trust prompt/label identity for cache reuse.** Rejected: exactly the M176
  stale-materialization hazard. Every reuse must be receipt-validated against current workflow
  source hash and material input hashes (AC6/AC7).
- **Alt7 — Copy the DIR-126-D telemetry / Prepare ledger into the journal instead of
  hash-referencing.** Rejected: AC9 requires preserved source hashes and one-way migration; copying
  bodies would create a second authoritative copy (G5). The adapters map fields and preserve hashes,
  never duplicate content.
- **Alt8 — Bump the A1 schema in place (modify `workflow-event-schema.mjs`) instead of an adapter.**
  Rejected: A1's v1 schema is pinned by A2's replay corpus and A5's metrics; mutating it in place
  would break the before-state boundary. The one-way adapter preserves A1's schema while making B's
  `StageEvent` the sole cross-workflow receipt/finding contract (AC8).
- **Alt9 — Add ESM `import` support to the workflow DSL to call the scripts directly.** Rejected: no
  such capability exists (documented at execute-milestone.js L28); the established
  `node --experimental-strip-types <abs> <mode>` agent-dispatch pattern is the tested, documented
  mechanism (DD9).
- **Alt10 — Make receipts optional / advisory.** Rejected: safety invariant 3 makes binding
  mandatory; an unbounded receipt is descriptive evidence, not a reusable proof (crystallization
  §5.3). Empty `materialInputHashes` is a validation failure.
- **Alt11 — Implement DIR-118 wiring-required semantics now (since extension fields are being
  added).** Rejected: AC11 explicitly forbids it; DIR-118 owns that policy, and B's substrate must
  land inert so the lifecycle policy can be added later without another control-plane rewrite.
- **Alt12 — Standalone JSON-schema files or a native/server component.** Rejected: the repo has no
  build step and prefers zero-dependency single-source TS modules with embedded validation
  (`workflow-event-schema.mjs`, `build-evidence-manifest.ts` precedent); a server would add an
  availability failure mode the journal cannot tolerate.

## Touches
- tasks/DIR-124-B.md（自身文件）
