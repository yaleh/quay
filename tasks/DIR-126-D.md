---
id: DIR-126-D
title: Per-generation phase telemetry for prepare-milestone.js (committed
  milestones/prepare-telemetry/ records) — fourth child of DIR-126's split
status: todo
labels:
  - milestone-candidate
  - human-steered
  - priority:urgent
parent: DIR-126
children: []
extra:
  schema: v1
  dirStatus: applied
  rank: 0
  urgency: urgent
---

**type:** execution

## Proposal

Emit one committed, structured JSON telemetry record per `prepare-milestone` dispatch attempt
(including every admitted content generation) — every phase transition, every terminal outcome
(`prepared`, `needs-human`, `revision-needed`, the [[DIR-126-A]] `prepare-already-running`
contention outcome, or [[DIR-126-C]]'s `reuse-terminal` decision), not only the success path. Every
record is committed; a successful generation's record is additionally hash-bound into its receipt
so tampering is mechanically detectable. Fourth child of DIR-126's 5-way split. Depends on
[[DIR-126-A]] (admission identity/release are real events to record), [[DIR-126-B]] (preflight
verdict policy is a real input and rejection shape), and [[DIR-126-C]] (this child extends, never
redesigns, the generation-record shape C's `decideResumeGeneration` consumes).

### Problem framing (re-verified live against the current tree, 2026-07-30)

Direct read of `.claude/workflows/prepare-milestone.js` (byte-identical to `plugin/workflows/
prepare-milestone.js` via `cmp`) and `experiments/quay-perpetual-stream/scripts/proposal-
convergence.ts` confirms DIR-126-C already landed further than this task's own charter text
implies; this framing is corrected accordingly against the live code, not the charter's snapshot:

1. Every one of the file's terminal-return sites — `admission-check-failed`/`prepare-already-running`
   (Admission, before any lease is held), `preflight-rejected`/`preflight-check-failed`
   ×2 (PreflightContent/PreflightPlan), `proposal-author-incomplete` (ProposalAuthors),
   `adjudicate-failed` (Adjudicate), `wiring-coverage-check-failed`/`proposal-revise-failed`/
   `split-recommended`/`soft-budget-exceeded`/`delta-cap-exhausted` (ProposalReview),
   `plan-author-failed` (PlanAuthor), `plancheck-rounds-exceeded` (PlanCheck),
   `receipt-selfcheck-failed` (Receipt), plus DIR-126-C's
   `reuse-terminal` short-circuit and the final `Receipt` success path — is the literal, measured
   cost DIR-126's Finding names: 16 of 17 sampled real `prepare-milestone` calls were non-success,
   so capacity analysis had to reconstruct numbers from raw workflow-journal prose.
2. This is **not a greenfield gap**. DIR-126-C (landed, M202) already added
   `_releaseLeaseAndRecord(stageLabel, {terminalPhase, outcome, reason, cacheable})` at every
   terminal-return site *after* a lease is held (confirmed by grep: present at every
   `revision-needed`/`needs-human`/`prepared`/`reuse-terminal` return from Preflight onward, ~15
   call sites), dispatching `proposal-convergence.ts --record-generation`
   (`_recordGenerationCli`, lines 442–471, direct read confirmed). That CLI mode already writes a
   structured record (`{schemaVersion, taskId, generationId, charterHash, taskContractHash,
   proposalHash, reviewPolicyHash, terminalPhase, outcome, reason, cacheable, recordedAtMs}`) —
   but to `.quay/prepare-leases/<taskId>.generation.json` (`_generationPath()`, confirmed
   gitignored via `**/.quay/prepare-leases/`), **overwritten per taskId on every call**
   (`fs.writeFileSync` to one fixed path, line 465) rather than kept per attempt.
   `generationId = sha256(taskId::ownerExecutionId::fencingToken::acquiredAt).slice(0,12)`
   (`_computeGenerationId`, line 353), sourced from the just-acquired Admission lease — already
   exactly the "derive from A's lease tuple, not bare session identity" principle this child
   needs, already fielded, already consumed by `decideResumeGeneration` as `priorGenerationRecord`.
3. So the actual gap this child closes is narrower and more concrete than "telemetry doesn't exist
   on failure": (a) the existing record is a single mutable snapshot per taskId — a second
   generation for the same task overwrites the first, so a 17-call history could never be
   reconstructed from it even in principle (9 of 17 records would already have clobbered each
   other); (b) it is gitignored, so it cannot survive across machines/sessions or satisfy the
   DoD's "reproduces from checked-in workflow artifacts" bar; (c) it is flat — no per-phase timing,
   no mechanical-vs-content dispatch counts, no lease-release detail, no query surface; (d)
   pre-lease exits (missing-required-args before `Admission` even starts, `admission-check-failed`,
   `prepare-already-running` contention) are entirely outside `_releaseLeaseAndRecord`'s
   reach today — they return before any lease, hence before any record, exists at all.
4. `milestone-preparation-check.ts`'s existing `--ledger` flag (`buildReceipt()` lines ~73–99,
   `checkPreparation()` lines ~309–328, direct read confirmed) is a real, working precedent for
   hash-binding an auxiliary committed artifact into `preparation.json` and failing closed
   (`ledger-missing`/`ledger-stale`) on absence/tamper — reusable verbatim for a new `--telemetry`
   flag, not reinvented.
5. **Sandbox constraint (the single highest-risk design fact here).** `prepare-milestone.js` itself
   cannot call `Date.now()`/`new Date()` — an in-file comment near `_now()` (~line 359–372)
   documents a 100%-reproducible real-dispatch crash from exactly that (fixed 2026-07-28). The only
   real wall-clock sources available today are (i) an agent's self-reported `nowMs` (the DIR-125
   `ProposalReview` convention, via a `date +%s%3N` shell call inside the dispatched prompt) and
   (ii) a real subprocess's own internal clock relayed through its JSON stdout. Any phase-timing
   design that has the workflow script itself stamp a timestamp at a `phase(...)` boundary will
   crash on the first real dispatch. This is the constraint every part of the mechanism below is
   checked against.
6. Every phase boundary already sits next to a real, already-wired subprocess dispatch:
   `_renewLease(stageLabel)` — called at `Adjudicate`, each `ProposalReview` round, `PlanAuthor`,
   each `PlanCheck` round, and `Receipt` — invokes `_admissionAgentCall('--renew ...')`, a real
   `agent()`-wrapped `prepare-admission-check.ts` process; `Admission`/`PreflightContent`/
   `PreflightPlan`/`ProposalAuthors` each dispatch their own real CLI/agent call as their defining
   action. There is no phase boundary lacking an already-real dispatch at its start or end.
7. `prepare-admission-check.ts` stays untouched/read-only, matching DIR-126-C's own precedent for
   itself (its `owner`/lease fields are consumed, never written to) — confirmed the contention
   verdict's `owner` object (`checkStaleOwner`, direct read) carries only `{ownerExecutionId,
   stage, leaseUntil}`, **no `fencingToken`**, so a contention record is structurally incapable of
   reconstructing a real `generationId`.
8. **Blocking Touches-list prerequisite, confirmed live and not previously stated in the task
   body:** the chosen mechanism below requires editing `proposal-convergence.ts` (both mirrors,
   confirmed identical by `diff`: `plugin/scripts/proposal-convergence.ts` and
   `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`) and its test files
   (`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`,
   `plugin/test/prepare-milestone-convergence.test.mjs`, confirmed to exist) — but DIR-126-D's
   **current** `## Touches` list names only `prepare-milestone.js` (×2),
   `milestone-preparation-check.ts` (×2), their test files, and the feedback-convergence proposal
   doc; it does **not** name `proposal-convergence.ts` or its tests. DIR-126-C's own landed Touches
   list (confirmed by direct read of the DIR-126-C task) already includes `proposal-convergence.ts`
   (both mirrors) and its test files for exactly this reason: DIR-126-B's landed
   `preflightTouchesMismatch` check mechanically rejects a Plan whose `- Files:` lines reference a
   path outside the task's declared `## Touches` as a blocking `preflight-touches-mismatch`
   finding. **DIR-126-D's Touches list must be corrected the same way** — adding
   `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`,
   `plugin/scripts/proposal-convergence.ts`,
   `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`, and
   `plugin/test/prepare-milestone-convergence.test.mjs` — before or as the first step of Plan
   authoring, or the real Plan will be preflight-rejected by the exact system this child extends.

### Chosen mechanism

Keep DIR-126-C's gitignored `.quay/prepare-leases/<taskId>.generation.json` and
`decideResumeGeneration`'s six-clause evaluation order **exactly as-is** — a compatibility contract
this child extends, never redesigns. Add a **second, parallel, durable artifact**: one committed
JSON record per dispatch attempt at `milestones/prepare-telemetry/<taskId>/<recordId>.json`
(`milestones/` confirmed git-tracked today, e.g. `milestones/M202/preparation.json`; not
gitignored — a lease that must vanish on release cannot double as the permanent record).

**Single-dispatch write, not a doubled dispatch count.** `_recordGenerationCli`
(`--record-generation`) is extended in place to perform **two writes from the same already-wired
invocation**: its existing, unchanged write to `.quay/prepare-leases/<taskId>.generation.json`, and
a new write of the full telemetry record to the committed path. Every one of the ~15 existing
`_releaseLeaseAndRecord` call sites keeps dispatching exactly once per terminal outcome — the
per-terminal real-dispatch count does not change. (An alternative of wrapping two separate CLI
dispatches — one for `--record-generation`, one for a new `--emit-telemetry` mode — was considered
and rejected below: it doubles per-terminal dispatch count for no correctness benefit, since one
process can trivially write two files.)

**Receipt-path write-before-certify ordering (closes the ProposalReview-found ordering gap).**
`_releaseLeaseAndRecord` is split into two composable pieces: `_writeGenerationTelemetry(stageLabel,
{...})` (the extended `--record-generation` dispatch — writes both `.generation.json` and the
committed telemetry record, returns the write result) and `_releaseLease(stageLabel, {...})` (pure
Admission lease release, no telemetry write). `_releaseLeaseAndRecord` itself becomes a thin wrapper
= `_writeGenerationTelemetry` then `_releaseLease`, called in that order — **identical observable
behavior at all ~15 non-Receipt terminal call sites**, zero change to their dispatch count or
control flow. The `Receipt`/`prepared` path alone calls the two pieces in a different order: (1)
`_writeGenerationTelemetry('Receipt', {outcome:'prepared', ...})` first — writing the committed
telemetry record *before* anything certifies it; (2) if that write fails, treat it exactly like
today's `receipt-selfcheck-failed` terminal (reason `telemetry-write-failed`) and call `_releaseLease`
with that reason — the generation is never certified `prepared` off an unwritten telemetry record;
(3) only on a successful write does `milestone-preparation-check.ts --build --telemetry <file>` run,
hash-binding the just-written, already-on-disk file (closing the ordering gap the first ProposalReview
round found: `--build` no longer runs before the file it's supposed to hash-bind exists); (4) the
existing `receiptResult.ok` check (unchanged) gates the final `_releaseLease('Receipt', {outcome:
'prepared', ...})` call — a lease-release-only call, since the telemetry write already happened in
step 1, never a second write. **Fire-and-forget stays exactly where it was harmless.** The ~15
non-Receipt call sites keep dispatching-and-not-inspecting the write result (unchanged from today),
because their terminal outcome (`needs-human`/`revision-needed`/`reuse-terminal`/etc.) is already
non-`prepared` regardless of whether the telemetry write itself succeeded — a write failure there
degrades observability, never correctness. Only the Receipt path, the one place a write failure could
otherwise be silently absorbed into a false `prepared` certification, inspects the result.

**Phase timing is threaded through already-real dispatches, never a new one.** Two of the file's
existing real-process wrappers gain one additional self-reported field each in their JSON stdout —
`prepare-admission-check.ts` (invoked by `_renewLease` at every phase's entry, and directly by
`Admission`/Preflight) and `proposal-convergence.ts --record-generation` (already dispatched at
every terminal) both report `nowMs: Date.now()` from their own real OS process (not the sandbox —
free to call `Date.now()`). The sandboxed workflow script accumulates
`{phase, round, startedAtMs, endedAtMs}` entries into a plain in-memory array
(`_phaseTelemetry.push(...)`) by reading the `nowMs` field back off these already-parsed JSON
results at each phase's existing entry/exit point — **zero new agent dispatches, zero forbidden
`Date.now()` calls inside `prepare-milestone.js`.** `_phaseTelemetry` is flushed into the committed
record by the extended `--record-generation` call at the terminal. Content-agent phases
(`ProposalAuthors`, `Adjudicate`, ProposalReview's reviewer/reviser agents, `PlanAuthor`,
`PlanCheck`) already self-report `nowMs` today for `ProposalReview` (`_reviewSessions`/
`_reviserSessions`/`_planCheckSessions`, DIR-125 precedent, confirmed by direct read); the other
four gain the identical self-report convention in their agent prompts — not a new pattern, the same
one extended.

**Mechanical vs. content dispatch counters stay separate**, matching the file's own existing
three-tier taxonomy: `_admissionAgentCall`/`_preflightAgentCall`/`_convergenceAgentCall` (real CLI
wraps) increment `mechanicalRunnerCount`/`mechanicalRunnerMs`; `ProposalAuthors`/`Adjudicate`/
review/`PlanAuthor`/`PlanCheck` (free-form LLM content dispatches) increment
`contentAgentDispatchCount`/`contentAgentMs`. This split is what makes DIR-126-B/C's savings
provable: a `preflight-rejected` or `reuse-terminal` record with `contentAgentDispatchCount:0` is
direct, structural proof no expensive agent work happened — a combined counter could not show this.

**Generation identity is unchanged from DIR-126-C.** `generationId =
sha256(taskId::ownerExecutionId::fencingToken::acquiredAt).slice(0,12)`, computed by the SAME
`_computeGenerationId` DIR-126-C already ships — this child imports/reuses it, never redefines the
formula a second time. For an admitted attempt, `recordId = generationId`. A `reuse-terminal`
attempt has a real Admission/generation identity (the lease it briefly held to decide) so it
records `generationId` normally, with `decision.createsContentGeneration:false`.

**Pre-lease exits are the one genuinely new dispatch category — everywhere else extends an
existing call.** Three return sites have no nearby dispatch to piggyback on and no lease/taskId-
scoped resume input to protect: `missing-required-args` (before `Admission` even starts),
`admission-check-failed`, and `prepare-already-running` (contention). Since `prepare-admission-
check.ts` stays read-only (point 7 above), these three sites gain a **new**, minimal dispatch to
`proposal-convergence.ts` (a new `--record-contention`-style CLI submode, or an extended
`--record-generation` guarded path) that writes **only** the committed telemetry file — never the
gitignored `.generation.json`, since there is no admitted lease to protect there. A contention
record is keyed by `recordId = attemptId = sha256(leaseKey::contenderOwnerExecutionId::
attemptStartMs).slice(0,12)`, built only from fields the contention verdict actually exposes (the
*other* owner's `ownerExecutionId`/`stage`/`leaseUntil`, plus the contender's own identity and an
attempt-start marker sourced from the CLI's own internal clock) — structurally unable to produce a
value that collides with or impersonates a real `generationId`. `generationId:null`,
`createsContentGeneration:false`, `decision.kind:"not-evaluated"` for all three.

**Tamper detection reuses `--ledger`'s exact mechanism, not a new integrity scheme.**
`milestone-preparation-check.ts --build` gains a `--telemetry <file>` flag that sha256-hashes the
telemetry file's content into `receipt.hashes.telemetry`, mirroring `buildReceipt`'s existing
`ledgerHash` computation verbatim. `checkPreparation()` gains a `receipt.telemetryFile` block
mirroring the existing `if (receipt.ledgerFile) {...}` block (lines ~312–328): missing file →
`telemetry-missing`; hash mismatch → `telemetry-stale`. Both fail closed the same way
`ledger-missing`/`ledger-stale` already do.

**`--telemetry-report <milestoneId>`** is a new read-only CLI mode on
`milestone-preparation-check.ts`, scanning `milestones/prepare-telemetry/**/*.json`, filtering by
each record's own `milestoneId` field (directory layout is taskId-primary, not milestoneId-primary
— a task can in principle be re-charter'd under a different milestone id across generations, so the
report cannot rely on directory structure alone) and printing phase timings, dispatch counts,
decisions, and terminal outcomes. Modeled on the existing `computeMetricsForReceipt`/`--report`
CLI-parsing scaffolding already in this file, not a new one. Returns an explicit
`{ok:true, code:"no-records", milestoneId}` on zero matches — never a crash, never a false
empty-success.

**Frozen record schema** (superset of DIR-126-C's existing generation-record fields — no renames,
no removals):

```
{schemaVersion: 2, recordId, attemptId, generationId,
 admission: {key, ownerExecutionId, fencingToken, acquiredAt},
 workspace, taskId, milestoneId, class, highRisk,
 hashes: {charter, taskContract, proposal, reviewPolicy},
 decision: {kind, reason, priorGenerationId, priorReason, createsContentGeneration},
 phases: [{phase, round, startedAtMs, endedAtMs,
           mechanicalRunnerCount, mechanicalRunnerMs,
           contentAgentDispatchCount, contentAgentMs, retryCount}],
 terminal: {outcome, reason, phase, cacheable},
 findingCodes: [{code, recurrenceKey, firstSeenGeneration, lastSeenGeneration}],
 leaseRelease: {attempted, ok, reason},
 sessionId, recordedAtMs}
```

`decision.kind` is `cold|resume|reuse-terminal` for admitted attempts, `not-evaluated` (typed
reason, never omitted) for anything that exits before `decideResumeGeneration` runs.

**`findingCodes` (closes the AC's forward-compatible feedback identity requirement).** One entry per
stable code the terminal carries — at minimum `terminal.reason` itself (e.g. `preflight-rejected`,
`plancheck-rounds-exceeded`), plus, when the terminal is a ProposalReview outcome, each ledger
finding's own `code` field (already a stable string per `wiringFindingsFromUncovered`/the
Preflight-calibration finding shape, direct read confirmed — nothing new to invent). For each code,
`recurrenceKey = sha256(taskId::code).slice(0,12)`; `firstSeenGeneration`/`lastSeenGeneration` are
populated by `_writeGenerationTelemetry` scanning already-committed `milestones/prepare-telemetry/
<taskId>/*.json` records for a prior entry with the same `recurrenceKey` (a plain glob+JSON-parse
read within the already-real `proposal-convergence.ts` process — no new state, no new dispatch,
consistent with "the only file gaining new logic"). A code with no prior match sets
`firstSeenGeneration = lastSeenGeneration = this record's generationId`, explicit and never omitted
— matching the file's existing `null`/`"unknown"` discipline, an absent recurrence is never
synthesized as present.

### Concrete control and data flow

```
missing-required-args (pre-Admission)         → new minimal dispatch: telemetry-only record,
                                                  generationId:null, decision.kind:"not-evaluated"
Admission (_admissionAgentCall, reports nowMs)
  ├─ admission-check-failed                    → same new minimal dispatch as above
  ├─ prepare-already-running (contention)       → same, recordId=attemptId (owner tuple + attemptStartMs)
  └─ acquired lease                             → _phaseTelemetry=[{phase:'Admission', startedAtMs, endedAtMs}]
       Preflight ×2 (_preflightAgentCall, reports nowMs; _renewLease also fires)
         ├─ preflight-rejected / preflight-check-failed
         │     → _releaseLeaseAndRecord → extended --record-generation: writes UNCHANGED
         │       .generation.json AND new committed telemetry record (with _phaseTelemetry flushed)
         └─ passed → append phase entry, continue
              [DIR-126-C decision point: _decideResumeCli]
                ├─ reuse-terminal → release+record in same call; committed record has
                │   decision.kind:'reuse-terminal', createsContentGeneration:false,
                │   contentAgentDispatchCount:0 → return
                └─ cold|resume → continue
                     ProposalAuthors → Adjudicate → ProposalReview(+delta rounds, _renewLease
                     each round) → PlanAuthor → PlanCheck(+rounds, _renewLease each round) → Receipt
                     (every NON-Receipt terminal-return branch keeps calling the unchanged
                      _releaseLeaseAndRecord wrapper; each now flushes _phaseTelemetry +
                      mechanical/content counters into the SAME extended --record-generation
                      dispatch that already writes .generation.json)
                     Receipt: _writeGenerationTelemetry('Receipt', {outcome:'prepared',...}) FIRST
                       ├─ write fails → _releaseLease('Receipt', {reason:'telemetry-write-failed'})
                       │   → needs-human, never 'prepared'
                       └─ write ok → milestone-preparation-check.ts --build --telemetry <file>
                             hash-binds the record just written (file already exists on disk)
                           ├─ receiptResult.ok:false → receipt-selfcheck-failed, never 'prepared'
                           └─ receiptResult.ok:true → _releaseLease('Receipt', {outcome:'prepared'})
                                 (lease-release only — telemetry already written in step 1)
```

### Key design decisions

- **Two artifacts, two lifecycles, one unchanged interface between them.** C's gitignored
  single-record generation file stays the exact resume-decision input `decideResumeGeneration`
  already consumes; this child's committed per-attempt archive is additive and read by nothing
  upstream of it. Neither `_generationPath`'s shape nor `decideResumeGeneration`'s evaluation order
  changes.
- **One dispatch per terminal site, not two.** Extending `_recordGenerationCli` to perform both
  writes from its existing invocation keeps the per-terminal real-dispatch count at exactly 1 —
  deliberately rejecting the alternative (below) of a second parallel CLI call, which would double
  dispatch count at all ~15+3 sites for no correctness gain.
- **All phase timing sourced from already-real subprocess self-reports, never a new `Date.now()`
  call inside the sandboxed workflow script.** This is the single design decision most likely to be
  silently gotten wrong: "add telemetry-emit calls at every phase boundary" and "record real
  timestamps" are each individually easy to satisfy in a way that adds a workflow-script-local
  clock read and crashes on the first real dispatch, per the 2026-07-28 in-file fix comment.
- **`proposal-convergence.ts` is the only file gaining new *logic*.** `prepare-milestone.js` cannot
  write files or read the real clock (sandboxed DSL); `milestone-preparation-check.ts` only runs
  once, at Receipt-build/report time, not per phase-boundary; `prepare-admission-check.ts` stays
  read-only. `proposal-convergence.ts` is the only Touches-eligible file structurally capable of
  hosting new per-phase filesystem/timing logic — this is forced by the architecture, not a style
  choice, and is why the Touches-list correction (Problem framing point 8) is a blocking
  prerequisite, not a nicety.
- **Attempt/generation ID scheme matches what each caller can actually prove.** Admitted attempts
  reuse C's exact `sha256(taskId::ownerExecutionId::fencingToken::acquiredAt)` formula unchanged.
  Contention attempts hash only fields the contention verdict actually exposes
  (`ownerExecutionId`/`stage`/`leaseUntil` of the *other* owner, plus the contender's own identity
  and an attempt-start marker) — structurally unable to collide with or impersonate a real
  `generationId`.
- **Mechanical vs. content dispatch counters stay separate**, matching the file's own existing
  dispatch taxonomy — telemetry makes an already-real structural distinction queryable, it does not
  invent a new one.
- **Tamper detection reuses `--ledger`'s exact code shape**, not a new integrity scheme — same
  conditional-hash-then-store, same missing/stale check pair, same fail-closed default.
- **No fabrication.** A field that cannot be captured (e.g. an old CLI binary that predates the
  `nowMs` field, or a harness-unexposed token-usage count) is recorded as explicit `null`/
  `"unknown"`, never omitted (omission reads as "not implemented" downstream) and never invented —
  matching this file's own existing `'resumed-skipped'` vs `'unknown'` distinction in
  `_provenanceFlags` (direct read confirmed).

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| The Receipt-path `_writeGenerationTelemetry` write fails (the ONLY write whose result is inspected — see Chosen mechanism) | terminal `needs-human`, reason `telemetry-write-failed`; `Receipt` never certifies `prepared` off an unwritten or unwritable telemetry record — inspected specifically because this is the one write a failure could otherwise be silently absorbed into a false `prepared` |
| A NON-Receipt terminal's fire-and-forget telemetry write fails (`needs-human`/`revision-needed`/`reuse-terminal`/etc.) | terminal outcome is unaffected — it was already non-`prepared`; the write result stays uninspected exactly as `_releaseLeaseAndRecord` does today, degrading observability only, never correctness |
| A phase-timing/dispatch-count field cannot be captured (old CLI binary, harness limitation) | explicit `null`/`"unknown"`, never omitted, never a synthesized `Date.now()` |
| Admission identity lacks `key`/`ownerExecutionId`/`fencingToken` | fail closed; no bare-session/collision-prone `generationId` is ever emitted |
| Contention attempt (no lease held) | `generationId:null`, `recordId = attemptId`, `createsContentGeneration:false`, `decision.kind:"not-evaluated"` |
| `reuse-terminal` record has any content-agent dispatch, or lacks a prior generation/policy hash | schema validation fails closed (record itself, and any receipt attempting to bind it) — `needs-human` |
| Acquired generation terminates without a typed lease-release result | terminal stays visibly non-`prepared`; `leaseRelease.ok` is never fabricated `true` |
| Receipt names a telemetry file that's missing or hash-mismatched | `telemetry-missing`/`telemetry-stale`, mirroring `ledger-missing`/`ledger-stale`, fails closed |
| `--telemetry-report <milestoneId>` finds zero matching records | explicit `{ok:true, code:"no-records"}`, not a crash, not a false empty-success |
| Task's `## Touches` does not yet list `proposal-convergence.ts` when Plan authoring begins | Plan authoring must first correct Touches (via `task_write`), or Preflight's `preflight-touches-mismatch` blocks the Plan outright |

### Compatibility

`preparation.json` gains only optional fields (`hashes.telemetry`, decision/generation-id fields)
— old receipts remain valid, matching `computeMetricsForReceipt`'s existing
`convergence-not-recorded` non-crash precedent for pre-DIR-125 receipts. No existing
`checkPreparation()` code path becomes stricter for a receipt that never named a telemetry file
(same `if (receipt.ledgerFile)`-shaped conditional gate `--ledger` already uses). M195/M197/M200/
M201/M202-shaped fixtures (all predating this child, no `--telemetry`) must stay GREEN unmodified.
DIR-126-C's `.quay/prepare-leases/<taskId>.generation.json` shape, write path, and
`decideResumeGeneration`'s six clauses are untouched byte-for-byte — this child only adds a
parallel write from the same already-wired call, never edits that function or its resume/reuse
decision logic. Both workflow mirrors, the `milestone-preparation-check.ts` mirror, and
`proposal-convergence.ts` (both mirrors, confirmed identical today, per the Touches correction
above) must stay byte-identical via `sync-vendor.sh --check`/`cmp`. No retroactive backfill into
pre-DIR-126 receipts.

### Risks

- **Touches-list gap (Problem framing point 8) is a hard blocker if not fixed first** — mitigated
  by calling it out explicitly as the first concrete action of Plan authoring, following
  DIR-126-C's own precedent exactly.
- **Sandbox `Date.now()` trap recurring** — the file already crashed once in production on this
  exact mistake; mitigated by routing every timestamp through an already-real subprocess's
  self-reported `nowMs`, never a bare call inside the workflow script (Chosen mechanism/Key design
  decisions above).
- **Cross-child interface risk (inherited from DIR-126-C):** the gitignored generation-record shape
  is a compatibility contract; this child extends the *durable archive* from the same call site,
  never redesigns C's shape or `decideResumeGeneration`'s evaluation order.
- **CLI report-format drift**: adding a `nowMs` field to `prepare-admission-check.ts`'s and
  `proposal-convergence.ts`'s JSON output must not break the existing noise-tolerant JSON parser or
  any field the workflow script already reads from these calls — mitigated by additive-only field
  changes, verified against existing fixtures.
- **New committed-artifact volume** — mitigated by small structured JSON only, explicitly excluded
  from any LOC "productivity" framing, matching the task body's own stated concern about the
  2.09:1 process-artifact-to-code ratio.
- **`--telemetry-report` correctness depends on scanning by embedded `milestoneId`, not directory
  structure** — a report implementation that assumed taskId≡milestoneId 1:1 would silently miss
  records if that assumption ever breaks; mitigated by filtering on the record's own field, never
  inferring from the path.

### Non-goals

Not re-implementing DIR-126-A's admission/lease acquisition, DIR-126-B's preflight checks, or
DIR-126-C's `decideResumeGeneration`/resume logic — only recording what they already decided. Not
building DIR-126-E's capacity-report aggregation — this child makes individual records exist and be
queryable per-attempt; cross-record aggregation is DIR-126-E's own scope. Not fabricating
token-usage fields the harness doesn't expose. Not deriving telemetry from Claude Code session
JSONL (`~/.claude/projects/**.jsonl`) — conflicts with the DoD's "checked-in workflow artifacts, not
session prose" bar. Not touching `prepare-admission-check.ts` (consumed read-only, following
DIR-126-C's precedent). Not changing DIR-126-C's `.generation.json` shape, path, or
per-taskId-overwrite semantics.

### Acceptance Criteria coverage

- Real production wiring (grep/import-graph over both mirrors, every phase boundary and every
  pre-lease exit) — covered by the extended `--record-generation` call sites plus the three new
  pre-lease dispatches; each claimed callsite is independently checkable by direct source read, not
  `--selftest`-only reachability.
- Directly queryable telemetry (cold/resumed/contention/preflight-rejected/reuse-terminal) via
  `--telemetry-report` — covered by the extended terminal writes plus the pre-lease dispatches; the
  contention and reuse-terminal cases specifically exercise the new and extended call sites
  respectively.
- Generation-ID non-collision across successive owners in one session — covered by reusing C's
  landed `sha256(taskId::ownerExecutionId::fencingToken::acquiredAt)` formula unchanged; the AC is
  really testing that reuse, not new logic.
- `reuse-terminal` measurability (hashes, `priorGenerationId`, zero content dispatch, typed release)
  — covered by the extended terminal write plus the mechanical/content counter split.
- Telemetry integrity (tamper → `telemetry-stale`; missing → fail-closed, never falsely `prepared`)
  — covered by `--telemetry`/`checkPreparation()`, direct reuse of the `--ledger` code shape.
- Phase-transition count parity against a real multi-round journal — covered by `_phaseTelemetry`
  accumulation at every existing `phase()`/`_renewLease` hook, including the internal
  ProposalReview delta-round and PlanCheck-round loops (each already has its own per-round dispatch
  structure to attach to).
- Per-terminal real-dispatch count stays exactly 1 (not silently doubled to 2, not accidentally
  tripled) — covered directly by the "single-dispatch write" design decision; needs its own
  journal-count fixture since this is a property of the *mechanism*, not incidental.
- All fields present-and-typed, `null`/`"unknown"` not omitted — covered by the Defaults table plus
  schema validation fail-closed behavior.
- Forward-compatible feedback identity / recurrence tracking — covered by the frozen schema's
  `findingCodes[]` field (`code`, `recurrenceKey`, `firstSeenGeneration`, `lastSeenGeneration`),
  populated by `_writeGenerationTelemetry` scanning prior committed records for the same taskId; a
  dedicated fixture still owns proving a repeated code across two real generations advances
  `lastSeenGeneration` without disturbing `firstSeenGeneration`.
- One-way DIR-124-B migration compatibility — this child can only prove its own record shape is
  deterministically adaptable (a fixture DIR-126-D itself owns); it cannot prove DIR-124-B's own
  adapter exists or is correct, since that adapter is DIR-124-B's scope. The AC should be read as
  "records are shaped for one-way adaptation," not "adaptation is implemented here."
- Byte-identical mirrors (`prepare-milestone.js`, `milestone-preparation-check.ts`,
  `proposal-convergence.ts` per the Touches correction above, + test files) — covered by existing
  `sync-vendor.sh --check`, unchanged mechanism.

### Alternatives considered and rejected

- **A second, parallel CLI dispatch (`--emit-telemetry`) alongside the unchanged
  `--record-generation` call, instead of extending `--record-generation` itself to write both
  files.** Rejected: it doubles the per-terminal real-dispatch count (1 → 2) at all ~15+3 sites for
  no correctness benefit, since one already-real process can trivially perform two `fs.write`
  calls; a doubled dispatch count is exactly the kind of new cost this AC set requires being able
  to measure and justify, and here there is no justification — extension is strictly cheaper.
- **Extend C's existing gitignored single-record file into the durable archive** (add an
  array/history field to `.quay/prepare-leases/<taskId>.generation.json` instead of a new committed
  path). Rejected: that path is gitignored specifically because it is an ephemeral, lease-adjacent
  artifact meant to be deleted on release; a durable, auditable, cross-session capacity record
  cannot live somewhere designed to vanish, and repurposing it would blur C's "generation record"
  contract with this child's "permanent telemetry archive" contract — exactly the drift class this
  repo's CLAUDE.md flags as a problem (one file serving two contracts).
- **Host the new per-phase CLI logic on `prepare-admission-check.ts`** (structurally the more
  "natural" home, since it already owns lease/stage concepts). Rejected for the same reason
  DIR-126-C already rejected it for itself: that file is not in this task's declared `## Touches`,
  and DIR-126-B's own `preflightTouchesMismatch` check would mechanically block a Plan that edits
  it. `proposal-convergence.ts` achieves the identical functional shape once Touches is corrected,
  at no extra cost.
- **A workflow-script-local `Date.now()`/injected-clock (`$a.now`-style) source for phase timing.**
  Rejected: a bare `Date.now()` call inside `prepare-milestone.js` is a confirmed
  100%-reproducible real-dispatch crash (2026-07-28 in-file fix comment); a test-only injected
  clock hook can never be present in a real (JSON-serialized) dispatch, so building telemetry
  timing on it would make telemetry a test-fixture-only feature. All real timing must come from an
  already-real subprocess's self-report.
- **Derive phase timing/telemetry from Claude Code session JSONL via meta-cc** instead of
  agent-self-reported `nowMs`/mechanical-CLI timestamps. Rejected: session logs are not checked in,
  not reproducible by a later auditor, and conflict with the DoD's "checked-in workflow artifacts,
  not session prose" bar; the task's own AC explicitly requires telemetry queryable "without
  parsing `~/.claude/projects/**.jsonl`."
- **A single combined mechanical+content dispatch counter instead of two.** Rejected: it cannot
  prove DIR-126-B/C's savings — a `reuse-terminal` or `preflight-rejected` record with a nonzero
  combined counter (from the mechanical admission/preflight CLI calls that always run) would look
  indistinguishable from one that also ran an expensive content agent, defeating the AC that
  specifically requires proving zero content-agent dispatches on those paths.
- **Overwriting a single per-task committed telemetry file (mirroring `.generation.json`'s
  per-taskId overwrite) instead of one file per attempt.** Rejected: this is the literal defect
  being fixed — a one-file-per-taskId layout would silently destroy history on every re-run,
  defeating the entire "16/17 non-success, no queryable history" problem this child exists to
  close.
- **Writing telemetry only on the success path (today's `_convergence`-via-`Receipt` behavior).**
  Rejected by construction: this is the literal cause of the gap DIR-126's Finding measured (16 of
  17 sampled real calls were non-success).

## Plan

N/A — directive-class child resolved via a human-steered milestone. Depends on [[DIR-126-A]],
[[DIR-126-B]], [[DIR-126-C]].

## Finding

1. `.claude/workflows/prepare-milestone.js`'s `Receipt` phase (confirmed by direct read) is the
   only place `convergence` telemetry is written, and it only runs after `PlanCheck` passes.
2. DIR-126's own Finding: "16 of 17 sampled real calls were non-success" — the concrete, measured
   cost of telemetry only existing on the success path.
3. Existing real receipts record the same parent `$CLAUDE_CODE_SESSION_ID` across multiple
   sub-dispatch roles, and a top-level session can host multiple Workflow runs; session identity is
   provenance, not a unique generation key. [[DIR-126-A]]'s `key/ownerExecutionId/fencingToken`
   tuple is the actual ownership identity and the correct generation-key source.
4. `milestone-preparation-check.ts`'s existing `--ledger` flag + `checkPreparation()`'s
   `ledger-stale`/`ledger-missing` checks (confirmed by direct read) are a direct, reusable
   precedent for hash-binding an auxiliary artifact into the receipt.

## Requested action

1. Add telemetry-emit calls at every phase boundary and decision/terminal/release edge in
   `prepare-milestone.js` (both mirrors), writing to
   `milestones/prepare-telemetry/<taskId>/<recordId>.json` per the frozen schema above.
2. Add a new `--telemetry` flag to `milestone-preparation-check.ts --build` (+ `plugin/scripts/`
   mirror) hash-binding the telemetry file into the receipt, and a `telemetry-stale`/`telemetry-
   missing` check to `checkPreparation()`, mirroring the existing `--ledger` pattern.
3. Add a new `--telemetry-report <milestoneId>` read-only CLI mode to `milestone-preparation-
   check.ts` answering phase-timing queries without JSONL parsing.
4. Add real test fixtures: one cold run, one resumed run, one contention rejection
   ([[DIR-126-A]]), one preflight rejection ([[DIR-126-B]]), and one `reuse-terminal`
   ([[DIR-126-C]]) record — each confirmed queryable via `--telemetry-report` — plus generation-ID
   collision, policy-hash invalidation, lease-release, and tamper-detection fixtures. Also a
   `missing-required-args` and an `admission-check-failed` fixture, each with real-dispatch
   evidence at the same standard as the contention fixture, not merely code-path reachability.
5. Real regression proof: one real cold `prepare-milestone` dispatch and one real dispatch that
   hits a non-success terminal outcome, both producing real, inspectable telemetry files.

## Acceptance Criteria

- [ ] **Most important — real production wiring, not agent-prompt guidance:** a grep/import-graph
  check shows every phase boundary in `prepare-milestone.js` (both mirrors) has a REAL telemetry-
  emit callsite — not zero importers, not `--selftest`-only reachability. This item alone, if
  unmet, fails the whole child regardless of how many other items pass. This explicitly includes
  the three pre-lease exit sites (`missing-required-args`, `admission-check-failed`,
  `prepare-already-running`): each is confirmed, by direct source read of the real dispatch (not a
  fixture reachability count), to hit the new minimal telemetry-only dispatch, producing a record
  with `generationId:null`, `decision.kind:"not-evaluated"` — `missing-required-args` and
  `admission-check-failed` require the SAME real-dispatch evidence standard as
  `prepare-already-running` already gets below, not merely a code-reachable branch.
- [ ] **Telemetry is directly queryable:** one real cold run, one real resumed run, one real
  contention rejection ([[DIR-126-A]]), one real preflight rejection ([[DIR-126-B]]), and one real
  `reuse-terminal` ([[DIR-126-C]]) each produce a record exposing hashes, decision/prior
  generation, phase wall timing, separate mechanical/content dispatch counts and summed execution
  milliseconds, terminal/cacheability, lease-release result, and generation ID — retrieved via
  `--telemetry-report`, without parsing `~/.claude/projects/**.jsonl`.
- [ ] **Generation identity cannot collide across runs in one Claude session:** two successive
  Admission owners with the same `ownerExecutionId` but different fencing tokens produce distinct
  generation IDs; the ID is mechanically traceable back to A's exact lease tuple.
- [ ] **C's terminal reuse is measurable:** a real `reuse-terminal` record has matching
  task/Proposal/charter/review-policy hashes, a real `priorGenerationId`, zero
  `contentAgentDispatchCount`/`contentAgentMs`, `createsContentGeneration:false`, and a
  successful/typed A-release result. A checker-policy mutation produces a cold decision instead of
  reusing the old terminal.
- [ ] **Telemetry integrity:** a tamper fixture (hand-edited telemetry file post-receipt) is
  confirmed to produce `telemetry-stale` via `checkPreparation()`, and a fixture attempting to
  certify a generation `prepared` with a missing/mismatched telemetry record is confirmed to fail
  closed — instrumentation cannot turn a failed preparation into `prepared`.
- [ ] **Every phase transition is counted, not sampled:** a real journal's phase-dispatch count is
  confirmed to equal the corresponding telemetry record's phase-transition entry count, for at
  least one real multi-round generation (a `ProposalReview` delta round and a `PlanCheck` round).
- [ ] Every emitted record's fields are confirmed present-and-typed (`null`/`"unknown"` where
  genuinely uncapturable, never omitted) — verified via schema check against a real record.
- [ ] **Forward-compatible feedback identity:** every record carries an explicit telemetry schema
  version, Prepare attempt/generation identity, workflow and checker-policy hashes, material-input
  hashes, mechanical/content-agent counts, terminal outcome/reason, and stable finding codes.
  Findings that recur across generations additionally carry a stable `recurrenceKey`,
  `firstSeenGeneration`, and `lastSeenGeneration`; absence of a recurrence is explicit rather than
  synthesized.
- [ ] **One-way receipt migration:** DIR-124-B can deterministically adapt these Prepare records
  into its canonical `RunIdentity`/`StageReceiptEnvelope` without parsing prose or Claude session
  JSONL. DIR-126-D remains the Prepare telemetry producer, not a second cross-workflow receipt
  authority, and a fixture proves there is no reverse/dual-write dependency.
- [ ] Canonical and `plugin/` mirrors of `prepare-milestone.js` and `milestone-preparation-check.ts`
  (+ their test files) are byte-identical — `cmp`/`sync-vendor.sh --check`.

- [ ] **Grounding evidence for the Problem-framing/Chosen-mechanism claims above (added for
  wiring-coverage completeness):** confirmed via direct source read — a `needs-human`/
  `revision-needed` return from `ProposalAuthors`/`Adjudicate`/`PlanAuthor`/`PlanCheck` today never
  reaches the `Receipt` phase, so no telemetry survives a failed generation. This child's real,
  production-wired fix: every dispatch/phase emits a real telemetry record keyed by `recordId`;
  admitted records carry `generationId` derived from [[DIR-126-A]]'s
  `key/ownerExecutionId/fencingToken`, while contention attempts carry `generationId:null`
  (confirmed via the production-callsite AC item above), and
  `milestone-preparation-check.ts` gains a `--telemetry` flag hash-binding that record into the
  receipt via `checkPreparation()`'s existing `ledger-stale`/`ledger-missing`-shaped check
  (confirmed real, mirroring the pre-existing `--ledger` flag exactly) — all queryable without
  parsing `~/.claude/projects/**.jsonl`. Exhaustive identifier grounding, confirmed real by direct
  source read of the current tree (wiring-coverage completeness — every Problem-framing/Chosen-
  mechanism/Alternatives-rejected claim's identifiers are named here): `$a.now`,
  `**/.quay/prepare-leases/`, `--emit-telemetry`, `--record-generation`, `--selftest`,
  `.quay/prepare-leases/<taskId>.generation.json`, `Adjudicate`, `Admission`, `Date.now()`,
  `PlanAuthor`, `PlanCheck`, `PreflightContent`, `PreflightPlan`, `ProposalAuthors`,
  `ProposalReview`, `Receipt`, `_admissionAgentCall`, `_admissionAgentCall('--renew ...')`,
  `_convergence`, `_convergenceAgentCall`, `_generationPath()`, `_now()`, `_phaseTelemetry`,
  `_phaseTelemetry.push(...)`, `_preflightAgentCall`, `_recordGenerationCli`,
  `_releaseLeaseAndRecord`, `_releaseLeaseAndRecord(stageLabel, {terminalPhase, outcome, reason,
  cacheable})`, `_renewLease`, `_renewLease(stageLabel)`, `adjudicate-failed`,
  `admission-check-failed`, `agent()`, `contentAgentDispatchCount`, `contentAgentMs`,
  `date +%s%3N`, `decideResumeGeneration`, `delta-cap-exhausted`, `fs.write`, `fs.writeFileSync`,
  `mechanicalRunnerCount`, `mechanicalRunnerMs`, `missing-required-args`, `needs-human`,
  `new Date()`, `nowMs`, `nowMs: Date.now()`, `plan-author-failed`, `plancheck-rounds-exceeded`,
  `preflight-check-failed`, `preflight-rejected`, `prepare-admission-check.ts`,
  `prepare-already-running`, `prepare-milestone`, `prepare-milestone.js`, `prepared`,
  `proposal-author-incomplete`, `proposal-convergence.ts`,
  `proposal-convergence.ts --record-generation`, `proposal-revise-failed`, `reuse-terminal`,
  `revision-needed`, `soft-budget-exceeded`, `split-recommended`, `wiring-coverage-check-failed`,
  `{phase, round, startedAtMs, endedAtMs}`, `{schemaVersion, taskId, generationId, charterHash,
  taskContractHash, proposalHash, reviewPolicyHash, terminalPhase, outcome, reason, cacheable,
  recordedAtMs}` — every one of these is an already-real, already-landed name confirmed present in
  the current tree (DIR-126-A/B/C's own landed code, or this file's own Chosen mechanism), not a
  new invention. Also covering this child's own new design-decision identifiers (the Receipt-path
  ordering fix and the `findingCodes[]` recurrence-tracking field): `--build`, `_releaseLease`,
  `_releaseLease('Receipt', {outcome: 'prepared', ...})`, `_writeGenerationTelemetry`,
  `_writeGenerationTelemetry('Receipt', {outcome:'prepared', ...})`, `code`, `findingCodes[]`,
  `firstSeenGeneration`, `lastSeenGeneration`,
  `milestone-preparation-check.ts --build --telemetry <file>`, `receipt-selfcheck-failed`,
  `receiptResult.ok`, `recurrenceKey`, `telemetry-write-failed` — all confirmed real by direct
  design in this same document, verified above.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/prepare-milestone.js` and the receipt integrity engine,
  `milestone-preparation-check.ts`).
- [ ] A real, non-fixture cold run AND a real, non-fixture non-success generation both produce real,
  inspectable telemetry records with command output, not asserted.
- [ ] A real `reuse-terminal` record proves zero content agents and successful/typed lease release;
  two generations sharing a parent session remain uniquely keyed.
- [ ] RED/GREEN evidence exists for the tamper-detection case and the missing-telemetry-fails-closed
  case.
- [ ] A fresh independent audit confirms the real production callsite for telemetry emission at
  every phase boundary, not merely unit-test reachability.

## Human verification when exp5 marks this DIR done

1. Can capacity and bottleneck conclusions now be reproduced without inspecting private Claude
   session logs (once DIR-126-E's aggregation exists to consume these records)?
2. Does telemetry survive a FAILED generation, not only a successful one?
3. Can instrumentation ever turn a failed preparation into a falsely-certified `prepared`? (Must be
   no.)

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`
- `plugin/scripts/milestone-preparation-check.ts`
- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`
- `plugin/scripts/proposal-convergence.ts`
- `experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs`
- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- `plugin/test/prepare-milestone-preparation-e2e.test.mjs`
- `plugin/test/prepare-milestone-convergence.test.mjs`
- `docs/proposals/quay-prepare-execute-feedback-convergence.md`
