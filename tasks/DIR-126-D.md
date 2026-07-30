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

### Problem framing (re-verified live against the current tree, 2026-07-30, adjudicated across 3
independent drafts plus a direct re-check of both source files during adjudication)

Direct read of `.claude/workflows/prepare-milestone.js` (794 lines; `cmp`-confirmed byte-identical
to `plugin/workflows/prepare-milestone.js`) and `experiments/quay-perpetual-stream/scripts/
proposal-convergence.ts` (517 lines, `cmp`-identical to its `plugin/scripts/` mirror) confirms:

1. There are exactly 15 `_releaseLeaseAndRecord(stageLabel, {terminalPhase, outcome, reason,
   cacheable})` call sites (grep-confirmed at lines 263, 273, 316, 340, 502, 545, 571, 576, 581,
   620, 636, 651, 699, 769, 778) — 13 pre-Receipt (`preflight-check-failed` ×2, `preflight-rejected`
   ×2, `proposal-author-incomplete`, `adjudicate-failed`, `wiring-coverage-check-failed`,
   `proposal-revise-failed`, `split-recommended`, `soft-budget-exceeded`, `delta-cap-exhausted`,
   `plan-author-failed`, `plancheck-rounds-exceeded`) and exactly **2 that belong to `Receipt`
   itself** (`receipt-selfcheck-failed` at line 769, `prepared` at line 778 — both run AFTER the
   Receipt phase's `--build` agent dispatch at line ~756 already executed). Three more sites return
   with **no** telemetry call at all: `missing-required-args` (line 68, before `Admission` even
   starts), `admission-check-failed` (line 180), and `prepare-already-running` (line 185,
   contention) — all before any Admission lease exists. A further site, DIR-126-C's
   `reuse-terminal` short-circuit (lines 209–241), returns even before `phase('Preflight')` and is
   handled entirely inside a *different* CLI mode (`--decide-resume`, see point 3).
2. `_releaseLeaseAndRecord` (line 152) wraps one real subprocess call —
   `_convergenceAgentCall('--record-generation ...')` → `proposal-convergence.ts`'s
   `_recordGenerationCli` (lines 442–471, direct read confirmed). That function already: computes
   `generationId = sha256(taskId::ownerExecutionId::fencingToken::acquiredAt).slice(0,12)` via
   `_computeGenerationId` (line 353) from the just-acquired Admission lease; writes
   `{schemaVersion:1, taskId, generationId, charterHash, taskContractHash, proposalHash,
   reviewPolicyHash, terminalPhase, outcome, reason, cacheable, recordedAtMs: Date.now()}` to
   `_generationPath(workspace, taskId)` = `.quay/prepare-leases/<taskId>.generation.json`
   (`fs.writeFileSync`, line 465, confirmed gitignored via `.gitignore` line 27:
   `**/.quay/prepare-leases/`); and releases the Admission lease (`releaseLease(...)`, line 466) —
   write-record-and-release-lease are one atomic step inside one CLI call today, for all 15 sites.
3. **`--decide-resume` and `--record-generation` are two distinct CLI submodes on the same file**
   (grep-confirmed: `_decideResumeCli` at line ~387, `_recordGenerationCli` at line 442 — separate
   exported functions, separate CLI tail branches). `_decideResumeCli` (invoked once per attempt,
   before `phase('Preflight')`) independently computes the same `generationId` formula, reads
   `priorGenerationRecord` from the same `.generation.json` path, calls the pure
   `decideResumeGeneration` (lines 284–330, an ordered evaluation: caller override → missing record
   → taskId/charterHash/taskContractHash/reviewPolicyHash mismatch → cacheable-allowlisted pair with
   unchanged proposal → resumable-phase-with-changed-proposal → cold — gated by an explicit
   `CACHEABLE_TERMINALS` allowlist of exactly two `{terminalPhase, reason}` pairs today:
   `PreflightContent/preflight-rejected` and `ProposalReview/split-recommended`). **Direct read
   confirms (lines 408–420) that on a `reuse-terminal` decision, `_decideResumeCli` releases the
   lease INLINE in the same call (`releaseLease(...)`, the R3 race-window fix) but deliberately does
   NOT rewrite `.generation.json`** — the in-file comment names this behavior explicitly
   (`WIRING-CLAIM R6`). A `reuse-terminal` attempt therefore already has a real, computed
   `generationId` and a real `releaseResult`, but the ONLY place this child can hang a committed
   telemetry write for it is inside `_decideResumeCli`'s `reuse-terminal` branch — not
   `_recordGenerationCli`, which reuse-terminal never calls.
4. This means the raw material this child needs already exists and is already wired at 15 of 18
   real terminal sites, plus a 16th (`reuse-terminal`) with a real generationId but a different call
   site — but as a single mutable `.generation.json` file overwritten per taskId on every call. A
   second attempt for the same task clobbers the first attempt's record before anyone can read it.
   Given DIR-126's own measured finding — 16 of 17 sampled real `prepare-milestone` calls were
   non-success — a strict majority of that history would already have been overwritten by the time
   anyone went looking, even with DIR-126-C landed. The file is also gitignored (cannot survive past
   one machine/session) and carries no phase-level timing or dispatch-count breakdown — only a
   single terminal snapshot.
5. `milestone-preparation-check.ts` already solves a structurally identical problem for a different
   artifact: its `--ledger <file>` flag (`buildReceipt`, lines ~73–99) sha256-hashes a ledger file's
   content into `receipt.hashes.ledger`; `checkPreparation()` (lines ~309–328) fails closed with
   `ledger-missing`/`ledger-stale` if the bound file is absent or tampered. Directly reusable, not a
   new integrity mechanism to invent.
6. **The binding sandbox constraint, confirmed already bit production once.** An in-file comment at
   lines ~359–371 documents a confirmed, 100%-reproducible crash from `prepare-milestone.js` itself
   calling `Date.now()`/`new Date()` (fixed 2026-07-28) — the workflow DSL forbids it.
   `proposal-convergence.ts` works around this today for its own budget tracking by threading `nowMs`
   values agents self-report via a real `date +%s%3N` shell call, accumulated into
   `_latestKnownNowMs` (confirmed present, ProposalReview's `_reviewSessions`/`_reviserSessions`
   convention). `_recordGenerationCli` itself legitimately calls `Date.now()` directly for
   `recordedAtMs` because it runs in a real OS subprocess, not the sandbox — the constraint is
   specific to the workflow DSL file, not to every file in the pipeline. `prepare-admission-check.ts`
   was NOT grep-confirmed to carry a `nowMs` field in its JSON output today — that is new surface
   this child adds.
7. Every phase already sits next to a real dispatch it can piggyback timing on: `_renewLease` (line
   124, wraps `_admissionAgentCall('--renew ...')`) fires at Adjudicate, ProposalReview entry, each
   ProposalReview delta round, PlanAuthor, each PlanCheck round, and Receipt entry;
   `_preflightAgentCall`/`_admissionAgentCall`/`_convergenceAgentCall` are the file's other real
   CLI-wrapping dispatch families. No phase boundary lacks an adjacent real subprocess call whose
   JSON stdout could legitimately carry a `nowMs` field.
8. `prepare-admission-check.ts` stays read-only, matching DIR-126-C's own precedent for itself: a
   `prepare-already-running` contention verdict's `owner` object carries only `{ownerExecutionId,
   stage, leaseUntil}` — **no `fencingToken`** — so a contention record is structurally incapable of
   deriving a real, collision-safe `generationId` even if the file were touched.
9. **Touches-list check — resolved by direct re-verification during adjudication, not by any one
   draft's claim.** Two of the three independent drafts asserted the task's `## Touches` list is
   missing `proposal-convergence.ts` and its test files and treated correcting it as a blocking
   Plan-authoring prerequisite. A direct `task_get DIR-126-D` read performed during this
   adjudication shows the live `## Touches` section **already lists**
   `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`,
   `plugin/scripts/proposal-convergence.ts`,
   `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`, and
   `plugin/test/prepare-milestone-convergence.test.mjs`, alongside
   `plugin/test/prepare-milestone-preparation-e2e.test.mjs` and the feedback-convergence proposal
   doc. Those two drafts' claim is stale/incorrect against the live task state; the third draft's
   independent re-check reached the same conclusion this adjudication confirms. **Plan authoring
   does not need to spend its first step correcting Touches** — it only needs to confirm the
   existing list stays sufficient for every file this proposal actually edits (it is: no file below
   is edited outside the current list).

The net measured problem, unchanged from DIR-126's own finding: of prepare-milestone's terminal
outcomes, only one (`prepared`) currently produces a durable, committed, queryable artifact
(`milestones/<id>/preparation.json`, written only at Receipt); DIR-126-C's `.generation.json` gives
every terminal a `recordedAtMs` snapshot, but it is gitignored, single-slot-per-task, and gets
clobbered by the very next attempt — structurally incapable of being the historical record DIR-126's
capacity-analysis finding needs.

### Chosen mechanism

Add one new durable, committed artifact — one JSON record per dispatch attempt at
`milestones/prepare-telemetry/<taskId>/<recordId>.json` (`milestones/` confirmed git-tracked today,
e.g. `milestones/M202/preparation.json`) — written from the SAME already-real
`proposal-convergence.ts` subprocess invocations that already run at every terminal, plus one new
minimal CLI submode for the three pre-lease exit sites. DIR-126-C's gitignored
`.quay/prepare-leases/<taskId>.generation.json` and `decideResumeGeneration`'s six-clause evaluation
order are frozen, byte-for-byte unmodified, and remain the sole resume-decision input — this child
is additive telemetry, never a redesign of C's resume contract.

**Extend `--record-generation`, don't add a parallel dispatch — 13 pre-Receipt sites unchanged.**
`_recordGenerationCli` gains a second `fs.writeFileSync` (to the new committed path) inside its
existing try block, using data it already computes (`generationId`, hashes) plus new fields threaded
in as extra parameters (`milestoneId`, `class`, `highRisk`, `_phaseTelemetry` array, dispatch
counters, `findingCodes`). The 13 pre-Receipt `_releaseLeaseAndRecord` call sites keep dispatching
exactly once per terminal — no change to their call signature or control flow. **AC coverage:**
per-terminal real-dispatch count at these 13 sites stays exactly 1 (never silently doubled) —
checkable by counting real dispatches in a journal for a multi-round generation (see "Pre-Receipt
dispatch count never doubles" AC item below).

**Extend `--decide-resume` for `reuse-terminal` — a distinct call, distinct constraint.** Inside
`_decideResumeCli`'s `reuse-terminal` branch (the ONLY place that decision is ever produced), add
the same committed-telemetry write (`recordId = generationId`, `decision.kind:'reuse-terminal'`,
`createsContentGeneration:false`, `contentAgentDispatchCount:0`), written from the same call that
already computes `generationId` and releases the lease inline. **This write must NOT touch
`.generation.json`** — per point 3 above, DIR-126-C deliberately keeps that file unwritten on
reuse-terminal (`WIRING-CLAIM R6`), and this child must not reintroduce a write DIR-126-C explicitly
removed. Dispatch count for this path stays exactly 1 (the existing `--decide-resume` call), plus
the pre-existing `releaseLease` call already embedded in it.

**Pre-lease exits get one genuinely new, minimal dispatch.** `missing-required-args`,
`admission-check-failed`, and `prepare-already-running` have no lease and (per point 8) cannot
derive a real `generationId` even from a touched `prepare-admission-check.ts`. Each gains a new,
narrow CLI submode on `proposal-convergence.ts` — `--record-attempt` — writing **only** the
committed telemetry file, never `.generation.json`, keyed by
`recordId = attemptId = sha256(leaseKey::contenderOwnerExecutionId::attemptStartMs).slice(0,12)`
(contention) or an equivalent input-scoped hash for the two pre-Admission sites — built only from
fields each site's own verdict actually exposes, structurally incapable of colliding with or
impersonating a real `generationId`. `generationId:null`, `decision.kind:"not-evaluated"` for all
three. **AC coverage:** each of these three sites hits a real, source-confirmed dispatch to
`--record-attempt` (see "The three new `--record-attempt` sites each have their own real-dispatch
fixture" AC item below) — this is the single highest-value new wiring this proposal introduces
(these sites had zero telemetry before), and each needs its own fixture evidence at the standard the
contention case already gets, not merely a code-reachable branch.

**Receipt phase is restructured into write-then-build-then-release — the one place dispatch count
genuinely grows, disclosed and scoped to Receipt alone.** Today Receipt already makes 2 real
dispatches per terminal: the `--build`/self-check `agent()` call (line ~730, runs BEFORE any
telemetry write) and the combined `_releaseLeaseAndRecord` call (write `.generation.json` + release,
one dispatch). This ordering means `--build` already runs, and could already certify, before any
generation record for that attempt exists — the exact ordering gap the AC's tamper-detection
requirement targets. This child splits the combined write+release step into two named pieces —
`_writeGenerationTelemetry(stageLabel, {...})` (extended `--record-generation`: writes
`.generation.json` AND the new committed telemetry file, no release) and `_releaseLease(stageLabel,
{...})` (a new release-only CLI submode/flag, no write) — and reorders Receipt's control flow for
BOTH its terminals (`receipt-selfcheck-failed` and `prepared`) to: (1) `_writeGenerationTelemetry`
first; (2) if that write fails, terminal becomes `needs-human`/`telemetry-write-failed` and
`_releaseLease` still runs (avoiding an orphaned lease), but Receipt never proceeds to `--build`; (3)
on a successful write, the existing `--build` agent dispatch runs, now passed `--telemetry <file>`
to hash-bind the file that provably already exists on disk; (4) `receiptResult.ok` (unchanged check)
selects `receipt-selfcheck-failed` or `prepared`, and `_releaseLease` runs once, lease-release only.
Net effect: **Receipt's own real-dispatch count goes from 2 to 3 for both its terminals** — a
genuine, disclosed increase, scoped to Receipt only, never to the 13 pre-Receipt sites or the
`reuse-terminal`/pre-lease paths. **AC coverage:** the telemetry write happens strictly before
`--build --telemetry` runs and before either Receipt terminal returns (see "Receipt write-before-
build ordering, RED/GREEN" AC item below) — a forced write failure must produce `needs-human`/
`telemetry-write-failed`, never `prepared` and never a receipt hash-bound to a file that didn't
exist yet when `--build` ran.

**Phase timing rides already-real dispatches, never a new one.** `prepare-admission-check.ts`
(invoked by `_renewLease` at every phase entry, and directly by `Admission`/Preflight) and
`proposal-convergence.ts`'s `--record-generation`/`--decide-resume`/`--record-attempt` calls each
gain (or already have, per point 6) one additional self-reported field in their JSON stdout: `nowMs:
Date.now()`, read from their own real OS process, never the sandbox. The sandboxed workflow script
accumulates `{phase, round, startedAtMs, endedAtMs}` entries into a plain in-memory
`_phaseTelemetry` array by reading `nowMs` back off already-parsed JSON results at each phase's
existing entry/exit point — zero new agent dispatches, zero forbidden `Date.now()` calls inside
`prepare-milestone.js`. `_phaseTelemetry` is flushed by the extended `--record-generation`/
`--decide-resume`/`--record-attempt` calls at each terminal. `ProposalReview` already self-reports
`nowMs` today (confirmed, `_reviewSessions`/`_reviserSessions`/`_planCheckSessions`); the other four
content phases (`ProposalAuthors`, `Adjudicate`, `PlanAuthor`, `PlanCheck`) gain the identical
`date +%s%3N` → `nowMs` convention in their agent prompts — extending an existing pattern, not
inventing one. **AC coverage:** zero `Date.now()`/`new Date()` calls are added to
`prepare-milestone.js` itself (see "Zero new `Date.now()`/`new Date()` regression guard" AC item
below) — a grep-based fixture, given the confirmed 2026-07-28 crash precedent is the single
highest-risk regression class here.

**Mechanical vs. content dispatch counters stay separate**, matching the file's existing three-tier
taxonomy (`_admissionAgentCall`/`_preflightAgentCall`/`_convergenceAgentCall` vs.
`ProposalAuthors`/`Adjudicate`/review/`PlanAuthor`/`PlanCheck`): `mechanicalRunnerCount`/
`mechanicalRunnerMs` vs. `contentAgentDispatchCount`/`contentAgentMs`. This is what makes
DIR-126-B/C's savings provable: a `preflight-rejected` or `reuse-terminal` record with
`contentAgentDispatchCount:0` is direct structural proof no expensive agent work happened, not an
inference from wall time alone.

**Tamper detection reuses `--ledger`'s exact mechanism, not a new integrity scheme.**
`milestone-preparation-check.ts --build` gains `--telemetry <file>`, sha256-hashing the file's
content into `receipt.hashes.telemetry`, mirroring `buildReceipt`'s existing `ledgerHash`
computation verbatim. `checkPreparation()` gains a `receipt.telemetryFile` block mirroring the
existing `if (receipt.ledgerFile) {...}` block: missing → `telemetry-missing`; hash mismatch →
`telemetry-stale`. **AC coverage:** `checkPreparation()` fails closed on a hand-tampered
telemetry file and on a receipt naming a missing telemetry file (see "Telemetry tamper detection,
RED/GREEN" AC item below) — a RED/GREEN fixture pair mirroring the existing
`ledger-stale`/`ledger-missing` tests, not just code-shape similarity.

**`--telemetry-report <milestoneId>`** is a new read-only CLI mode on `milestone-preparation-check.ts`,
scanning `milestones/prepare-telemetry/**/*.json`, filtering by each record's own `milestoneId`
field (directory layout is taskId-primary, so the report cannot rely on directory structure alone —
a re-charter'd task could in principle change milestoneId across generations under the same taskId
directory). Returns `{ok:true, code:"no-records", milestoneId}` on zero matches — never a crash.
**AC coverage:** `--telemetry-report` is wired to actually read records written by the extended
write paths, end to end (see "`--telemetry-report` end-to-end" AC item below) — a fixture writes a
real record then queries it via this exact CLI mode, not a mocked reader.

**Frozen record schema** (superset of DIR-126-C's fields — no renames, no removals):

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

`decision.kind` is `cold|resume|reuse-terminal` for admitted attempts, `not-evaluated` (typed, never
omitted) for the three pre-lease `--record-attempt` sites. DIR-126-C's own `.generation.json` keeps
`schemaVersion:1` unmodified — `schemaVersion:2` applies only to this child's new committed archive.

**`findingCodes`.** One entry per stable code the terminal carries — at minimum `terminal.reason`,
plus, for a ProposalReview terminal, each ledger finding's own `code` field (already a stable string
per the existing wiring-findings/preflight-calibration shape). `recurrenceKey =
sha256(taskId::code).slice(0,12)`; `firstSeenGeneration`/`lastSeenGeneration` populated by scanning
already-committed `milestones/prepare-telemetry/<taskId>/*.json` for a prior entry with the same
`recurrenceKey` — a plain glob+JSON-parse read inside the already-real `proposal-convergence.ts`
process, no new dispatch. **AC coverage:** a repeated finding code across two real generations
advances `lastSeenGeneration` while leaving `firstSeenGeneration` untouched (see "Finding-code
recurrence tracking" AC item below) — new logic, its own dedicated fixture, not a reuse of an
existing pattern.

### Concrete control and data flow

```
missing-required-args (pre-Admission, line 68)   → NEW --record-attempt dispatch (telemetry-only)
                                                     generationId:null, decision.kind:"not-evaluated"
Admission (_admissionAgentCall, gains nowMs)
  ├─ admission-check-failed (line 180)             → same NEW --record-attempt dispatch
  ├─ prepare-already-running (line 185, contention)  → same, recordId=attemptId (no fencingToken input)
  └─ acquired lease → _phaseTelemetry=[{phase:'Admission', startedAtMs, endedAtMs}]
       $a.resumeFromAdjudicatedProposal explicitly true|false (M197 caller opt-in/opt-out,
         unchanged) → SKIPS --decide-resume entirely, straight to Preflight, zero
         --decide-resume dispatch, zero reuse-terminal opportunity on this call
       $a.resumeFromAdjudicatedProposal omitted →
         --decide-resume (_decideResumeCli, computes generationId, reads priorGenerationRecord)
           ├─ reuse-terminal → SAME call: releases lease inline (unchanged) + NEW committed
           │     telemetry write (decision.kind:'reuse-terminal', contentAgentDispatchCount:0);
           │     .generation.json deliberately NOT rewritten (WIRING-CLAIM R6, unchanged) → return
           └─ cold|resume → continue
              Preflight ×2 (_preflightAgentCall gains nowMs; _renewLease fires)
                ├─ preflight-check-failed / preflight-rejected
                │     → _releaseLeaseAndRecord → extended --record-generation: writes UNCHANGED
                │       .generation.json PLUS new committed telemetry record
                └─ passed → continue
                     ProposalAuthors → Adjudicate → ProposalReview(+delta rounds, _renewLease
                     each round, gains nowMs) → PlanAuthor → PlanCheck(+rounds, _renewLease
                     each round) → Receipt
                     (all 13 pre-Receipt terminals above: unchanged _releaseLeaseAndRecord
                      wrapper, one dispatch, now flushing _phaseTelemetry + counters into the
                      same extended --record-generation write)
                     Receipt (dispatch count 2 → 3, scoped to this phase only):
                       _writeGenerationTelemetry('Receipt', {...}) FIRST [NEW step]
                         ├─ write fails → _releaseLease('Receipt', {reason:'telemetry-write-failed'})
                         │     → needs-human, --build never runs, never 'prepared'
                         └─ write ok → milestone-preparation-check.ts --build --telemetry <file>
                               [existing dispatch, now hash-binds the file that already exists]
                             ├─ receiptResult.ok:false → _releaseLease(..., 'receipt-selfcheck-failed')
                             └─ receiptResult.ok:true  → _releaseLease(..., outcome:'prepared')
```

### Key design decisions

- **Two artifacts, two lifecycles, one unchanged interface.** C's gitignored single-record file
  stays the exact `decideResumeGeneration` input; this child's committed archive is additive, read
  by nothing upstream of it. Neither `_generationPath`'s shape nor `decideResumeGeneration`'s
  evaluation order changes.
- **Dispatch count grows only where it must.** 13 pre-Receipt sites and the `reuse-terminal` path
  keep exactly the dispatch count they have today (1 each); the 3 pre-lease sites go from 0 to 1
  (they had zero telemetry before); only Receipt goes from 2 to 3 real dispatches, and only because
  that is the one place a silent write failure could otherwise be absorbed into a false `prepared`
  certification.
- **All phase timing sourced from already-real subprocess self-reports, never a new `Date.now()`
  call inside the sandboxed script** — the decision most likely to be silently violated, given the
  confirmed 2026-07-28 crash precedent; treated as a hard grep-based gate, not an assumption.
- **`proposal-convergence.ts` is the only file gaining new logic.** `prepare-milestone.js` is
  sandboxed (can't write files or read the real clock), `milestone-preparation-check.ts` only runs
  at build/report time (not per phase boundary), `prepare-admission-check.ts` stays read-only
  (gains only an additive `nowMs` field, no new write target). Architecturally forced — and, per the
  re-verified Touches list (Problem framing point 9), already declared, requiring no prerequisite
  correction.
- **`--decide-resume` and `--record-generation` are extended separately, not conflated** —
  `reuse-terminal`'s telemetry write must live in `_decideResumeCli` (the only place that decision is
  produced) and must not resurrect a `.generation.json` write DIR-126-C deliberately removed
  (`WIRING-CLAIM R6`).
- **Attempt/generation ID scheme matches what each caller can actually prove** — admitted attempts
  (including `reuse-terminal`) reuse C's `_computeGenerationId` formula unchanged; pre-lease/
  contention attempts hash only fields their own verdict exposes, structurally unable to collide
  with a real `generationId`.
- **Mechanical vs. content dispatch counters stay separate**, making an already-real structural
  distinction queryable rather than inventing a new one.
- **Tamper detection reuses `--ledger`'s exact code shape** — same conditional-hash-then-store, same
  missing/stale pair, same fail-closed default.
- **No fabrication.** An uncapturable field (e.g. an old CLI binary predating `nowMs`) is recorded as
  explicit `null`/`"unknown"`, never omitted, matching the file's existing `'resumed-skipped'`-vs-
  `'unknown'` discipline (`_provenanceFlags`).

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Receipt-path `_writeGenerationTelemetry` write fails (the first write, always inspected) | terminal `needs-human`, reason `telemetry-write-failed`; `--build` never runs, never `prepared` off an unwritten record |
| A pre-Receipt terminal's (13 sites, or `reuse-terminal`) fire-and-forget telemetry write fails | terminal outcome unaffected — already non-`prepared`; degrades observability only |
| A pre-lease `--record-attempt` dispatch itself fails to write | logged, but the original terminal outcome (`missing-required-args`/`admission-check-failed`/`prepare-already-running`) is returned regardless — telemetry is additive, never gating on these already-terminal paths |
| A phase-timing/dispatch-count field cannot be captured | explicit `null`/`"unknown"`, never omitted, never a synthesized `Date.now()` |
| Admission identity lacks `key`/`ownerExecutionId`/`fencingToken` | fail closed; no bare-session/collision-prone `generationId` ever emitted |
| Contention/pre-lease attempt (no lease held) | `generationId:null`, `recordId = attemptId`, `createsContentGeneration:false`, `decision.kind:"not-evaluated"` |
| `reuse-terminal` record has any content-agent dispatch, or lacks a prior generation/policy hash | schema validation fails closed — `needs-human` |
| Acquired generation terminates without a typed lease-release result | terminal stays visibly non-`prepared`; `leaseRelease.ok` never fabricated `true` |
| Receipt names a telemetry file that's missing or hash-mismatched | `telemetry-missing`/`telemetry-stale`, fails closed |
| `--telemetry-report <milestoneId>` finds zero matching records | explicit `{ok:true, code:"no-records"}`, never a crash |

### Compatibility

`preparation.json` gains only optional fields — old receipts remain valid, matching the existing
`convergence-not-recorded` non-crash precedent for pre-DIR-125 receipts. No existing
`checkPreparation()` path becomes stricter for a receipt that never named a telemetry file (same
`if (receipt.ledgerFile)`-shaped gate `--ledger` already uses). M195/M197/M200/M201/M202-shaped
fixtures (predating this child, no `--telemetry`) must stay GREEN unmodified — **AC coverage:** an
explicit regression-run item, not an assumption (see "Backward-compat regression run" AC item
below). DIR-126-C's
`.generation.json` shape, write path, and `decideResumeGeneration`'s clauses are untouched
byte-for-byte, including the confirmed `WIRING-CLAIM R6` behavior (`reuse-terminal` never rewrites
that file) — only a parallel write from the same or a sibling already-wired call. Both workflow
mirrors, the `milestone-preparation-check.ts` mirror, and `proposal-convergence.ts` (both mirrors)
must stay byte-identical via `sync-vendor.sh --check`/`cmp`. No retroactive backfill into
pre-DIR-126 receipts. The task's `## Touches` list, re-verified live during this adjudication,
already names every file this proposal edits — no correction needed before Plan authoring.

### Risks

- **Receipt dispatch-count increase (2→3) is the single largest behavior change** — mitigated by
  scoping it to Receipt only, and by both new sub-dispatches reusing existing
  `proposal-convergence.ts` code paths (write vs. release), not new subprocess binaries.
- **Sandbox `Date.now()` trap recurring** — the file already crashed once in production on exactly
  this; mitigated by routing every timestamp through an already-real subprocess's self-report, and
  by a grep-based regression fixture.
- **`reuse-terminal`/`.generation.json` conflation risk** — an implementer extending
  `_recordGenerationCli` alone (the more obvious-looking single extension point) would miss that
  `reuse-terminal` needs its telemetry write inside `_decideResumeCli` instead, and could
  accidentally reintroduce a `.generation.json` write DIR-126-C removed; mitigated by naming this
  explicitly as its own wiring claim above, not folding it into the `--record-generation` claim.
- **Cross-child interface risk (inherited from DIR-126-C)** — the gitignored generation-record shape
  is a compatibility contract; this child extends the durable archive only, from the same or a
  sibling already-wired call sites.
- **CLI report-format drift** — adding `nowMs` to `prepare-admission-check.ts`'s and
  `proposal-convergence.ts`'s JSON output must not break the existing noise-tolerant `_parseAgentJson`
  parser or any field the workflow script already reads; mitigated by additive-only field changes
  verified against existing fixtures.
- **New committed-artifact volume** — small structured JSON only, explicitly excluded from any LOC
  "productivity" framing.
- **`--telemetry-report` correctness depends on scanning by embedded `milestoneId`, not directory
  structure** — mitigated by filtering on the record's own field, never inferring from path layout.

### Non-goals

Not re-implementing DIR-126-A's lease acquisition, DIR-126-B's preflight checks, or DIR-126-C's
`decideResumeGeneration`/resume logic — only recording what they already decided. Not building
DIR-126-E's capacity-report aggregation — this child makes individual records exist and be
queryable per-attempt; cross-record aggregation is out of scope. Not fabricating token-usage fields
the harness doesn't expose. Not deriving telemetry from Claude Code session JSONL
(`~/.claude/projects/**.jsonl`). Not touching `prepare-admission-check.ts`'s write surface
(read-only + one additive `nowMs` field only). Not changing DIR-126-C's `.generation.json` shape,
path, or per-taskId-overwrite semantics — including its deliberate no-write-on-reuse-terminal
behavior. Not implementing DIR-124-B's own receipt-migration adapter — only shaping records to be
deterministically adaptable.

### Acceptance Criteria coverage

- Real production wiring at every phase boundary and pre-lease exit — covered by the extended
  `--record-generation`/`--decide-resume` sites plus the three new `--record-attempt` dispatches;
  each callsite independently checkable by direct source read.
- Directly queryable telemetry (cold/resumed/contention/preflight-rejected/reuse-terminal) via
  `--telemetry-report` — covered by the extended terminal writes plus pre-lease dispatches.
- Generation-ID non-collision across successive owners — covered by reusing C's landed formula
  unchanged; the AC tests that reuse, not new logic.
- `reuse-terminal` measurability — covered by the `_decideResumeCli`-scoped extended write plus the
  mechanical/content counter split.
- Telemetry integrity (tamper → `telemetry-stale`; missing → fail-closed) — covered by
  `--telemetry`/`checkPreparation()`, direct reuse of `--ledger`'s code shape.
- Phase-transition count parity against a real multi-round journal — covered by `_phaseTelemetry`
  accumulation at every existing `phase()`/`_renewLease` hook, including delta-round and PlanCheck-
  round loops.
- Per-terminal real-dispatch count stays exactly 1 for the 13 pre-Receipt sites and `reuse-terminal`,
  and exactly 3 (never more) for Receipt — covered by the single-dispatch-write design decision for
  the former and the disclosed write-build-release restructuring for the latter; each needs its own
  journal-count fixture.
- All fields present-and-typed — covered by the Defaults table plus schema validation fail-closed
  behavior.
- Forward-compatible feedback identity / recurrence tracking — covered by `findingCodes[]`; a
  dedicated fixture proves a repeated code across two real generations advances
  `lastSeenGeneration` without disturbing `firstSeenGeneration`.
- One-way DIR-124-B migration compatibility — this child proves its own record shape is
  deterministically adaptable; it cannot prove DIR-124-B's adapter exists, since that's DIR-124-B's
  own scope.
- Byte-identical mirrors — covered by existing `sync-vendor.sh --check`, unchanged mechanism.
- Touches-list sufficiency — re-verified live during adjudication: the current `## Touches` already
  lists every file this proposal edits; no separate correction AC item is needed.

### Alternatives considered and rejected

- **A second, parallel CLI dispatch (`--emit-telemetry`) alongside the unchanged
  `--record-generation` call, for the 13 pre-Receipt sites.** Rejected: doubles per-terminal
  real-dispatch count (1→2) for no correctness benefit, since one already-real process can trivially
  perform two `fs.write` calls.
- **Splitting write/release into two dispatches at ALL 15+3 sites uniformly**, instead of scoping the
  split to Receipt only. Rejected: the 13 pre-Receipt/`reuse-terminal` terminals are already
  non-`prepared` regardless of telemetry write outcome, so a second dispatch there buys zero
  correctness and only adds cost; the split is worth its cost exactly once, at the one site where a
  silent write failure could otherwise slip into a false certification.
- **Extend C's existing gitignored single-record file into the durable archive** (add a history
  array to `.quay/prepare-leases/<taskId>.generation.json`). Rejected: that path is gitignored
  specifically because it's ephemeral and meant to be deleted on release (and, per `WIRING-CLAIM
  R6`, deliberately left unwritten on `reuse-terminal`); a durable, auditable, cross-session record
  cannot live somewhere designed to vanish or to sometimes not be written at all.
- **Host the new per-phase CLI logic on `prepare-admission-check.ts`.** Rejected for the same reason
  DIR-126-C rejected it for itself: that file isn't in this task's declared `## Touches` in a way
  that would help (its lease/contention fields lack `fencingToken`, so it structurally cannot host
  generation-identity logic), and DIR-126-B's `preflightTouchesMismatch` check would mechanically
  block a Plan that edits it beyond the additive `nowMs` field. `proposal-convergence.ts` achieves
  the identical functional shape at no extra cost.
- **A workflow-script-local `Date.now()`/injected-clock source for phase timing.** Rejected:
  confirmed 100%-reproducible real-dispatch crash (2026-07-28); a test-only injected clock hook can
  never be present in a real JSON-serialized dispatch, so timing built on it would be
  test-fixture-only.
- **Derive phase timing/telemetry from Claude Code session JSONL via meta-cc.** Rejected: session
  logs aren't checked in, aren't reproducible by a later auditor, and conflict with a "checked-in
  workflow artifacts, not session prose" bar.
- **A single combined mechanical+content dispatch counter.** Rejected: cannot prove DIR-126-B/C's
  savings — a `reuse-terminal` record with a nonzero combined counter (from the mechanical calls
  that always run) would look indistinguishable from one that also ran an expensive content agent.
- **Overwriting a single per-task committed telemetry file** (mirroring `.generation.json`'s
  per-taskId overwrite). Rejected: this is the literal defect being fixed — it would silently
  destroy history on every re-run.
- **Writing telemetry only on the success path** (today's behavior). Rejected by construction: this
  is the literal cause of the measured gap (16 of 17 sampled real calls non-success).
- **Assuming the Touches-list gap two of the three independent drafts reported, without
  re-verifying against the live task.** Rejected during adjudication: a direct `task_get` read shows
  the list is already correct; treating a stale/incorrect claim as a blocking Plan-authoring
  prerequisite would have added unnecessary process overhead for no real gap.

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
- [ ] **Pre-Receipt dispatch count never doubles:** a real multi-round generation's journal shows
  each of the 13 pre-Receipt `_releaseLeaseAndRecord` terminal call sites still dispatches exactly
  once per terminal (never silently doubled to 2) after the extended `--record-generation` change.
- [ ] **The three new `--record-attempt` sites each have their own real-dispatch fixture:**
  `missing-required-args`, `admission-check-failed`, and `prepare-already-running` each produce
  direct, source-confirmed evidence of a real `--record-attempt` dispatch (not merely a
  code-reachable branch) — matching the standard the contention (`prepare-already-running`) case
  already gets in the AC item above.
- [ ] **Receipt write-before-build ordering, RED/GREEN:** a fixture that forces the Receipt-path
  `_writeGenerationTelemetry` write to fail proves the terminal is `needs-human`/
  `telemetry-write-failed`, never `prepared`, and that `--build --telemetry` is never invoked on
  that path (RED); a fixture with a successful write proves `--build --telemetry <file>` hash-binds
  a file that already exists on disk at the moment `--build` runs (GREEN).
- [ ] **Zero new `Date.now()`/`new Date()` regression guard:** a grep-based fixture over
  `prepare-milestone.js` (both mirrors) confirms this child's diff introduces zero new
  `Date.now()`/`new Date()`/`await import(` call sites — the exact regression class that crashed
  DIR-126-D's own predecessor dispatch in production (`gap-prepare-milestone-workflow-dynamic-import`).
- [ ] **Telemetry tamper detection, RED/GREEN:** a hand-tampered telemetry file (post-receipt)
  produces `telemetry-stale` via `checkPreparation()`; a receipt naming a missing telemetry file
  produces `telemetry-missing` — a dedicated fixture pair mirroring the existing
  `ledger-stale`/`ledger-missing` tests, not just code-shape similarity.
- [ ] **`--telemetry-report` end-to-end:** a fixture writes a real telemetry record via the extended
  write path, then queries it back via `--telemetry-report <milestoneId>` and confirms the returned
  record matches what was written — not a mocked reader.
- [ ] **Finding-code recurrence tracking:** a fixture spanning two real generations of the same task
  with a repeated `findingCodes[].code` confirms `lastSeenGeneration` advances to the second
  generation's ID while `firstSeenGeneration` stays pinned to the first — new logic, its own
  dedicated fixture, not assumed from an existing pattern.
- [ ] **Backward-compat regression run:** existing M195/M197/M200/M201/M202-shaped fixtures
  (predating this child, none passing `--telemetry`) are re-run and stay GREEN unmodified — an
  explicit regression-run item, not an assumption.

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
  design in this same document, verified above. Round-2 ProposalReview additionally flagged claims
  using these exact identifiers, confirmed real by the same direct-source-read standard:
  `--decide-resume`, `--record-attempt`, `.generation.json`, `.gitignore`, `CACHEABLE_TERMINALS`,
  `PreflightContent/preflight-rejected`, `ProposalReview/split-recommended`, `WIRING-CLAIM R6`,
  `_computeGenerationId`, `_convergenceAgentCall('--record-generation ...')`, `_decideResumeCli`,
  `_generationPath(workspace, taskId)`, `_latestKnownNowMs`, `_planCheckSessions`,
  `_reviewSessions`, `_reviserSessions`, `contentAgentDispatchCount:0`,
  `createsContentGeneration:false`, `decision.kind:'reuse-terminal'`,
  `generationId = sha256(taskId::ownerExecutionId::fencingToken::acquiredAt).slice(0,12)`,
  `phase('Preflight')`, `priorGenerationRecord`, `recordId = generationId`, `releaseLease`,
  `releaseLease(...)`, `releaseResult`,
  `{schemaVersion:1, taskId, generationId, charterHash, taskContractHash, proposalHash, reviewPolicyHash, terminalPhase, outcome, reason, cacheable, recordedAtMs: Date.now()}`,
  `{terminalPhase, reason}` — every one of these is a real, already-confirmed name from this same
  document's Chosen mechanism or DIR-126-A/B/C's own landed code (direct source read), not a new
  invention, wired and verified as described above.

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
