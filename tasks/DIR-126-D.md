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

Emit one committed, structured JSON telemetry record per `prepare-milestone` dispatch attempt —
every phase transition and every terminal outcome (`prepared`, `needs-human`, `revision-needed`,
[[DIR-126-A]]'s `prepare-already-running` contention, [[DIR-126-C]]'s `reuse-terminal`), not only
the success path. A successful generation's record is additionally hash-bound into its receipt so
tampering is mechanically detectable. Fourth child of DIR-126's 5-way split; depends on
[[DIR-126-A]] (admission identity/release), [[DIR-126-B]] (preflight verdict shape), and
[[DIR-126-C]] (the generation-record shape this child extends, never redesigns).

### Problem framing (reconciled from 3 independent drafts, re-verified live against the current
tree, 2026-07-30)

Direct read of `.claude/workflows/prepare-milestone.js` (794 lines; `cmp`-confirmed byte-identical
to `plugin/workflows/prepare-milestone.js`, last commit touching this file `7357a91`) and
`experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` (517 lines, `cmp`-identical to
its `plugin/scripts/` mirror) confirms:

1. There are exactly 15 `_releaseLeaseAndRecord(stageLabel, {terminalPhase, outcome, reason,
   cacheable})` call sites (grep-confirmed at lines 263, 273, 316, 340, 502, 545, 571, 576, 581,
   620, 636, 651, 699, 769, 778): 13 pre-`Receipt` (`preflight-check-failed` ×2,
   `preflight-rejected` ×2, `proposal-author-incomplete`, `adjudicate-failed`,
   `wiring-coverage-check-failed`, `proposal-revise-failed`, `split-recommended`,
   `soft-budget-exceeded`, `delta-cap-exhausted`, `plan-author-failed`,
   `plancheck-rounds-exceeded`) and exactly 2 belonging to `Receipt` itself
   (`receipt-selfcheck-failed`, `prepared`), both dispatched AFTER the Receipt phase's `--build`
   agent call (~line 730) already ran. Three more real return sites emit **no** telemetry call at
   all: `missing-required-args` (line ~68, before `Admission` even starts), `admission-check-failed`
   (~line 180), and `prepare-already-running` (~line 185, lease contention) — none of these hold an
   Admission lease. A further site, [[DIR-126-C]]'s `reuse-terminal` short-circuit (inside
   `_decideResumeCli`), returns before `phase('Preflight')` and belongs to a different CLI submode
   (`--decide-resume`) from the other 15 (`--record-generation`).
2. `_releaseLeaseAndRecord` (line 152) wraps exactly one real subprocess call —
   `_convergenceAgentCall('--record-generation ...')` → `_recordGenerationCli` (lines 442–471). That
   function already computes
   `generationId = sha256(taskId::ownerExecutionId::fencingToken::acquiredAt).slice(0,12)` via
   `_computeGenerationId` (line 353) from the just-acquired Admission lease; writes
   `{schemaVersion:1, taskId, generationId, charterHash, taskContractHash, proposalHash,
   reviewPolicyHash, terminalPhase, outcome, reason, cacheable, recordedAtMs: Date.now()}` to
   `_generationPath(workspace, taskId)` =
   `.quay/prepare-leases/<taskId>.generation.json` (`fs.writeFileSync`, confirmed gitignored —
   `.gitignore` line 27: `**/.quay/prepare-leases/`); and releases the Admission lease in the same
   call. Write-record-and-release-lease is one atomic step today, for all 15 sites.
3. `--decide-resume` and `--record-generation` are two distinct CLI submodes on the same file
   (`_decideResumeCli` ~line 387, `_recordGenerationCli` line 442). `_decideResumeCli` independently
   recomputes the identical `generationId`, reads the prior `.generation.json`, and calls the pure
   `decideResumeGeneration` (lines 284–330: caller override → missing record → hash mismatch →
   cacheable-allowlisted unchanged-proposal reuse → resumable-with-changed-proposal → cold), gated
   by the exported `CACHEABLE_TERMINALS` allowlist (exactly two pairs today:
   `PreflightContent/preflight-rejected`, `ProposalReview/split-recommended`). On a `reuse-terminal`
   decision, `_decideResumeCli` releases the lease **inline in the same call**
   (`releaseLease(..., reason: "reuse-terminal", ...)`, the R3 race-window fix) but deliberately does
   **not** rewrite `.generation.json` (`WIRING-CLAIM R6` — an in-file comment names this behavior
   explicitly). A `reuse-terminal` attempt therefore already has a real, computed `generationId`,
   but the only place this child can hang a committed telemetry write for it is inside
   `_decideResumeCli`'s `reuse-terminal` branch, not `_recordGenerationCli`, which `reuse-terminal`
   never calls.
4. Net: the raw material this child needs already exists and is wired at 15 of 18 real terminal
   sites, plus a 16th (`reuse-terminal`) with a real `generationId` at a different call site — but
   only as a single mutable, gitignored `.generation.json` overwritten per `taskId` on every call. A
   second attempt for the same task clobbers the first attempt's record before anyone can read it.
   Given DIR-126's own measured finding — 16 of 17 sampled real `prepare-milestone` calls were
   non-success — a strict majority of that history would already be unrecoverable even with
   [[DIR-126-C]] landed, because the one file that ever held it gets overwritten and was never
   committed. It also carries no phase-level timing or dispatch-count breakdown, only a single
   terminal snapshot.
5. `milestone-preparation-check.ts` already solves a structurally identical problem for a sibling
   artifact: its `--ledger <file>` flag (`buildReceipt`, ~lines 73–99) sha256-hashes a ledger file's
   content into `receipt.hashes.ledger`; `checkPreparation()` (~lines 309–328) fails closed with
   `ledger-missing`/`ledger-stale` if the bound file is absent or its hash no longer matches.
   Directly reusable, not a new integrity mechanism to invent.
6. **The sandbox has two confirmed, production-proven hard constraints**, both visible in the file's
   own comments and git history: (a) `Date.now()`/`new Date()` are forbidden — a confirmed,
   100%-reproducible crash from `prepare-milestone.js` itself calling the real clock, fixed at
   commit `f6db2a8` (2026-07-28); (b) dynamic `import()` is also forbidden — a confirmed crash on a
   real M203/DIR-126-D dispatch attempt, fixed at the current `HEAD` commit `7357a91`
   (`gap-prepare-milestone-workflow-dynamic-import`) by removing a resume-decision pre-check that
   relied on `await import('node:fs')` plus raw `${taskId}` interpolation. Both constraints are
   load-bearing for this proposal: nothing in `prepare-milestone.js` itself may call the real clock
   or dynamically import a module; every timestamp and every file write must ride an already-real
   `agent()`-wrapped subprocess dispatch. `proposal-convergence.ts` already works around the clock
   constraint for its own budget tracking by threading `nowMs` values agents self-report via a real
   `date +%s%3N` shell call, accumulated into `_latestKnownNowMs`; `_recordGenerationCli` itself
   legitimately calls `Date.now()` directly for `recordedAtMs` because it runs in a real OS
   subprocess, not the sandbox.
7. Every phase already sits next to a real dispatch it can piggyback timing on: `_renewLease` (wraps
   `_admissionAgentCall('--renew ...')`) fires at Adjudicate, ProposalReview entry, each
   ProposalReview delta round, PlanAuthor, each PlanCheck round, and Receipt entry;
   `_preflightAgentCall`/`_admissionAgentCall`/`_convergenceAgentCall` are the file's other real
   CLI-wrapping dispatch families. No phase boundary lacks an adjacent real subprocess call whose
   JSON stdout could legitimately carry a `nowMs` field.
8. `prepare-admission-check.ts` stays read-only, matching [[DIR-126-C]]'s own precedent for itself:
   a `prepare-already-running` contention verdict's `owner` object carries only
   `{ownerExecutionId, stage, leaseUntil}` — no `fencingToken` — so a contention record is
   structurally incapable of deriving a real, collision-safe `generationId` even if that file were
   touched.
9. **A second, independently significant finding, re-checked live before drafting this
   reconciliation:** the separately-filed `gap-decide-resume-generation-path-unsanitized-taskid`
   follow-up (filed 2026-07-30, `todo`, non-blocking) describes a defect in code that **no longer
   exists** in the current tree — commit `7357a91` deleted the local, workflow-side
   `await import('node:fs')` pre-check that used to compute a generation-record path via raw
   `${taskId}` interpolation; `--decide-resume` is now dispatched unconditionally whenever
   `$a.resumeFromAdjudicatedProposal` is omitted, delegating all path computation to the
   already-sanitized `_generationPath()`/`_leasePath()` in `proposal-convergence.ts`. Grep for
   `_generationPath`/`generation.json`/`generationRecordPath` inside `prepare-milestone.js` today
   returns only a comment reference, not a live computation. This proposal must not "fix" that
   already-moot local path logic, and must keep routing all generation-record path resolution
   through `proposal-convergence.ts`'s own already-sanitized functions, never re-adding a
   workflow-local path computation.
10. **Touches-list check, resolved by direct re-verification, not assumed from any one draft.** A
    direct `task_get DIR-126-D` read performed during this reconciliation confirms the live
    `## Touches` list already names `experiments/quay-perpetual-stream/scripts/
    proposal-convergence.ts`, `plugin/scripts/proposal-convergence.ts`, both mirrors of
    `prepare-milestone.js`, both mirrors of `milestone-preparation-check.ts`, and the associated
    test files. No file this proposal edits below falls outside that list — Plan authoring does not
    need to spend its first step correcting Touches.

The net measured problem, matching DIR-126's own finding: of `prepare-milestone`'s terminal
outcomes, only `prepared` currently produces a durable, committed, queryable artifact
(`milestones/<id>/preparation.json`, written only at Receipt); [[DIR-126-C]]'s `.generation.json`
gives every terminal a `recordedAtMs` snapshot, but it is gitignored, single-slot-per-task, and gets
clobbered by the very next attempt — structurally incapable of being the historical record DIR-126's
capacity-analysis finding needs.

### Chosen mechanism

Add one new durable, committed artifact — one JSON record per dispatch attempt at
`milestones/prepare-telemetry/<taskId>/<recordId>.json` (`milestones/` is confirmed git-tracked
today, e.g. `milestones/M202/preparation.json`) — written from the SAME already-real
`proposal-convergence.ts` subprocess invocations that already run at every terminal, plus one new
minimal CLI submode for the three pre-lease exit sites. [[DIR-126-C]]'s gitignored
`.generation.json` and `decideResumeGeneration`'s evaluation order stay byte-for-byte frozen and
remain the sole resume-decision input; this child is additive telemetry, never a redesign of C's
resume contract.

**WIRING CLAIM 1 — extend `--record-generation` in place; the 13 pre-Receipt sites keep exactly one
dispatch each.** `_recordGenerationCli` gains a second `fs.writeFileSync` (to the new committed
path) inside its existing try block, using data it already computes (`generationId`, hashes) plus
new fields threaded in as extra CLI parameters (`milestoneId`, `class`, `highRisk`, a
`_phaseTelemetry` array, dispatch counters, `findingCodes`). The 13 pre-Receipt
`_releaseLeaseAndRecord` call sites are unchanged in signature and control flow. **Ordering
decision:** the new `fs.writeFileSync` is placed AFTER the existing `releaseLease(...)` call
succeeds inside `_recordGenerationCli`'s try block, not before — today's landed catch already
returns `{ok:false}` without releasing the lease if anything in the try throws, so a new write
placed before release would risk leaving a lease held on a telemetry-write throw; placing it after
means a throw there can never prevent the lease release that already happens today, matching the
Defaults table's claim that a pre-Receipt write failure only "degrades observability" while the
terminal outcome (already decided before this call runs) stays unaffected. **AC coverage:**
per-terminal real-dispatch count at these 13 sites stays exactly 1, never silently doubled; a
dedicated fixture forces the new write to throw and confirms `releaseLease(...)` still ran and the
lease is not left held.

**WIRING CLAIM 2 — extend `--decide-resume`'s `reuse-terminal` branch separately; it is the only
call site that ever produces that decision.** Inside `_decideResumeCli`'s `reuse-terminal` branch,
add the same committed-telemetry write (`recordId = generationId`, `decision.kind:'reuse-terminal'`,
`createsContentGeneration:false`, `contentAgentDispatchCount:0`), written from the same call that
already computes `generationId` and releases the lease inline. This write must **not** touch
`.generation.json` — per point 3/`WIRING-CLAIM R6` above, [[DIR-126-C]] deliberately keeps that file
unwritten on `reuse-terminal`, and this child must not reintroduce a write C explicitly removed.
**AC coverage:** needs its own dedicated fixture distinct from WIRING CLAIM 1, since an implementer
extending only `_recordGenerationCli` would structurally miss this path.

**WIRING CLAIM 3 — pre-lease exits get one genuinely new, minimal dispatch.**
`missing-required-args`, `admission-check-failed`, and `prepare-already-running` hold no lease and
(per point 8) cannot derive a real `generationId`. Each gains a new, narrow CLI submode on
`proposal-convergence.ts` — `--record-attempt` — writing **only** the committed telemetry file,
never `.generation.json`, keyed by `recordId = attemptId = sha256(<fields the site's own verdict
actually exposes, e.g. leaseKey::contenderOwnerExecutionId::attemptStartMs>).slice(0,12)`,
structurally incapable of colliding with or impersonating a real `generationId`. `generationId:
null`, `decision.kind:"not-evaluated"` for all three. **AC coverage:** this is the single
highest-value new wiring this proposal introduces — these three sites had zero telemetry before —
each needs its own real-dispatch fixture (not merely a code-reachable branch), at the same
evidentiary standard the existing `prepare-already-running` contention case should be held to.

**WIRING CLAIM 4 — Receipt is restructured into write-then-build-then-release, the one place
dispatch count genuinely grows (2→3), disclosed and scoped to Receipt alone.** Today Receipt makes
2 real dispatches per terminal: the `--build`/self-check `agent()` call (runs BEFORE any telemetry
write) and the combined `_releaseLeaseAndRecord` call. This ordering means `--build` can already
run — and could already certify `prepared` — before any generation record for that attempt exists,
which is exactly the ordering gap the AC's tamper-detection requirement targets. Split the combined
step into `_writeGenerationTelemetry(stageLabel, {...})` (extended `--record-generation`: writes
`.generation.json` AND the new committed telemetry file, no release) and a new release-only submode
`_releaseLease(stageLabel, {...})` (no write). Reorder Receipt's control flow for both terminals to:
(1) `_writeGenerationTelemetry` first; (2) if that write fails, terminal becomes
`needs-human`/`telemetry-write-failed` and `_releaseLease` still runs (avoiding an orphaned lease),
but `--build` never runs; (3) on a successful write, `--build` runs, now passed
`--telemetry <file>` naming a file that provably already exists; (4) the existing
`receiptResult.ok` check selects `receipt-selfcheck-failed` or `prepared`, and `_releaseLease` runs
once. **AC coverage:** a dedicated RED/GREEN AC item — forced write failure → `needs-human`/
`telemetry-write-failed`, never `prepared`, `--build` never invoked; forced write success → `--build
--telemetry` provably runs against a file that already exists at call time.

**WIRING CLAIM 5 — phase timing rides already-real dispatches, never a new clock call or dynamic
import inside the sandbox.** `prepare-admission-check.ts` (invoked by `_renewLease` at every phase
boundary) and the extended `--record-generation`/`--decide-resume`/`--record-attempt` calls each
gain one additional self-reported field in their JSON stdout: `nowMs: Date.now()`, computed in the
real OS subprocess, never the sandbox. `prepare-milestone.js` accumulates
`{phase, round, startedAtMs, endedAtMs}` entries into a plain in-memory `_phaseTelemetry` array by
reading `nowMs` back off already-parsed results at each phase's existing entry/exit point — zero new
agent dispatches, zero new forbidden calls inside `prepare-milestone.js`. `ProposalReview` already
self-reports `nowMs` (confirmed, `_reviewSessions`/`_reviserSessions`/`_planCheckSessions`
convention); the other four content phases (`ProposalAuthors`, `Adjudicate`, `PlanAuthor`,
`PlanCheck`) gain the identical `date +%s%3N` → `nowMs` convention in their agent prompts — extending
an existing pattern, not inventing one. **AC coverage:** given the two confirmed production crash
precedents (point 6), this needs a hard grep-based regression-guard AC item: zero new
`Date.now()`/`new Date()`/`await import(` sites added to `prepare-milestone.js` (either mirror) by
this child's diff.

**Mechanical vs. content dispatch counters stay separate** — `mechanicalRunnerCount`/
`mechanicalRunnerMs` vs. `contentAgentDispatchCount`/`contentAgentMs`, matching the file's existing
three-tier taxonomy (`_admissionAgentCall`/`_preflightAgentCall`/`_convergenceAgentCall` vs.
`ProposalAuthors`/`Adjudicate`/review/`PlanAuthor`/`PlanCheck`). This is what makes
[[DIR-126-B]]/[[DIR-126-C]]'s savings provable: a `preflight-rejected` or `reuse-terminal` record
with `contentAgentDispatchCount:0` is direct structural proof, not an inference from wall time.

**WIRING CLAIM 6 — tamper detection reuses `--ledger`'s exact mechanism, not a new integrity
scheme.** `milestone-preparation-check.ts --build` gains `--telemetry <file>`, sha256-hashing its
content into `receipt.hashes.telemetry`, mirroring `buildReceipt`'s existing `ledgerHash`
computation verbatim. `checkPreparation()` gains a `receipt.telemetryFile` block mirroring the
existing `if (receipt.ledgerFile) {...}` block: missing → `telemetry-missing`; hash mismatch →
`telemetry-stale`. **AC coverage:** a dedicated RED/GREEN fixture pair mirroring the existing
`ledger-stale`/`ledger-missing` tests, not code-shape similarity alone.

**WIRING CLAIM 7 — `--telemetry-report <milestoneId>`**, a new read-only CLI mode on
`milestone-preparation-check.ts`, scans `milestones/prepare-telemetry/**/*.json`, filtering by each
record's own `milestoneId` field — never by directory structure alone, since the layout is
taskId-primary and a re-charter'd task could carry a different `milestoneId` across generations
under the same taskId directory. Returns `{ok:true, code:"no-records", milestoneId}` on zero
matches, never a crash. **AC coverage:** an end-to-end fixture — write a real record via the
extended write path, then read it back via this exact CLI mode, not a mocked reader.

**Frozen record schema** (superset of [[DIR-126-C]]'s fields — no renames, no removals):

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
omitted) for the three `--record-attempt` sites. [[DIR-126-C]]'s `.generation.json` keeps
`schemaVersion:1` unmodified; `schemaVersion:2` applies only to this child's new committed archive.

**WIRING CLAIM 8 — `findingCodes[]` recurrence tracking.** One entry per stable code the terminal
carries — at minimum `terminal.reason`, plus, for a ProposalReview terminal, each ledger finding's
own `code`. `recurrenceKey = sha256(taskId::code).slice(0,12)`; `firstSeenGeneration`/
`lastSeenGeneration` populated by scanning already-committed `milestones/prepare-telemetry/
<taskId>/*.json` for a prior entry with the same `recurrenceKey` — a plain glob+JSON-parse read
inside the already-real `proposal-convergence.ts` process, no new dispatch. **AC coverage:** new
logic, not a reuse of an existing pattern — a dedicated fixture: a repeated finding code across two
real generations advances `lastSeenGeneration` while `firstSeenGeneration` stays pinned to the
first.

### Concrete control and data flow

```
missing-required-args (pre-Admission)            → NEW --record-attempt (telemetry-only,
                                                     generationId:null, decision.kind:"not-evaluated")
Admission (_admissionAgentCall gains nowMs)
  ├─ admission-check-failed                      → same NEW --record-attempt dispatch
  ├─ prepare-already-running (contention)         → same, recordId=attemptId (no fencingToken input)
  └─ acquired lease → _phaseTelemetry=[{phase:'Admission', startedAtMs, endedAtMs}]
       $a.resumeFromAdjudicatedProposal explicit true|false → skips --decide-resume entirely
       $a.resumeFromAdjudicatedProposal omitted →
         --decide-resume (computes generationId, reads priorGenerationRecord)
           ├─ reuse-terminal → SAME call: releases lease inline (unchanged, WIRING-CLAIM R6 from
           │     [[DIR-126-C]]) + NEW committed telemetry write (decision.kind:'reuse-terminal',
           │     contentAgentDispatchCount:0); .generation.json deliberately NOT rewritten → return
           └─ cold|resume → continue
              Preflight ×2 (gains nowMs; _renewLease fires)
                ├─ preflight-check-failed / preflight-rejected
                │     → extended --record-generation: writes UNCHANGED .generation.json PLUS
                │       new committed telemetry record
                └─ passed → ProposalAuthors → Adjudicate → ProposalReview(+delta rounds, gains
                     nowMs) → PlanAuthor → PlanCheck(+rounds) → Receipt
                     (all 13 pre-Receipt terminals: unchanged _releaseLeaseAndRecord wrapper, one
                      dispatch, flushing _phaseTelemetry + counters into the same extended
                      --record-generation write)
                     Receipt (dispatch count 2 → 3, scoped here only):
                       _writeGenerationTelemetry('Receipt', {...}) FIRST [NEW]
                         ├─ write fails → _releaseLease('Receipt', {reason:'telemetry-write-failed'})
                         │     → needs-human, --build never runs, never 'prepared'
                         └─ write ok → milestone-preparation-check.ts --build --telemetry <file>
                               [existing dispatch, now hash-binds a file that already exists]
                             ├─ receiptResult.ok:false → _releaseLease(..., 'receipt-selfcheck-failed')
                             └─ receiptResult.ok:true  → _releaseLease(..., outcome:'prepared')
```

### Key design decisions

- Two artifacts, two lifecycles, one unchanged interface: C's gitignored single-record file stays
  the exact `decideResumeGeneration` input; this child's committed archive is additive, read by
  nothing upstream. Neither `_generationPath`'s shape nor `decideResumeGeneration`'s evaluation
  order changes.
- Dispatch count grows only where it must: 13 pre-Receipt sites and `reuse-terminal` keep their
  current count (1 each); the 3 pre-lease sites go 0→1 (they had zero telemetry before); only
  Receipt goes 2→3, because that is the one place a silent write failure could otherwise be absorbed
  into a false `prepared` certification.
- All phase timing sourced from already-real subprocess self-reports, never a new `Date.now()` call
  or dynamic `import()` inside the sandboxed script — treated as a hard grep-based gate given the
  two confirmed production incidents (point 6), not an assumption.
- `proposal-convergence.ts` is the only file gaining new logic — `prepare-milestone.js` is sandboxed
  (no fs, no real clock, no dynamic import), `milestone-preparation-check.ts` only runs at
  build/report time, `prepare-admission-check.ts` stays read-only (gains only an additive `nowMs`
  field). Architecturally forced, and already matches the current `## Touches` list (point 10) —
  requiring no prerequisite correction.
- `--decide-resume` and `--record-generation` are extended separately, not conflated — the
  `reuse-terminal` write must live in `_decideResumeCli` and must not resurrect a `.generation.json`
  write [[DIR-126-C]] deliberately removed.
- Attempt/generation ID scheme matches what each caller can actually prove: admitted attempts
  (including `reuse-terminal`) reuse C's `_computeGenerationId` formula unchanged; pre-lease/
  contention attempts hash only fields their own verdict exposes, structurally unable to collide
  with a real `generationId`.
- No fabrication: an uncapturable field is recorded as explicit `null`/`"unknown"`, never omitted,
  matching the file's existing provenance-flag discipline.
- The separately-filed `gap-decide-resume-generation-path-unsanitized-taskid` follow-up (point 9)
  describes code already deleted from the live tree — this proposal does not need to, and should
  not, "fix" it; any implementer encountering that gap task should close it as moot rather than
  re-adding a workflow-local path computation.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Receipt-path `_writeGenerationTelemetry` write fails | terminal `needs-human`, reason `telemetry-write-failed`; `--build` never runs, never `prepared` off an unwritten record |
| A pre-Receipt terminal's (13 sites, or `reuse-terminal`) telemetry write fails | terminal outcome unaffected (already non-`prepared`); degrades observability only |
| A pre-lease `--record-attempt` dispatch fails to write | logged, but the original terminal outcome is returned regardless — telemetry is additive, never gating on already-terminal paths |
| A phase-timing/dispatch-count field cannot be captured | explicit `null`/`"unknown"`, never omitted, never a synthesized `Date.now()` |
| Admission identity lacks `key`/`ownerExecutionId`/`fencingToken` | fail closed; no bare-session/collision-prone `generationId` ever emitted |
| Contention/pre-lease attempt (no lease held) | `generationId:null`, `recordId = attemptId`, `createsContentGeneration:false`, `decision.kind:"not-evaluated"` |
| `reuse-terminal` record has any content-agent dispatch, or lacks a prior generation/policy hash | schema validation fails closed — `needs-human` |
| Acquired generation terminates without a typed lease-release result | terminal stays visibly non-`prepared`; `leaseRelease.ok` never fabricated `true` |
| Receipt names a telemetry file that's missing or hash-mismatched | `telemetry-missing`/`telemetry-stale`, fails closed |
| `--telemetry-report <milestoneId>` finds zero matching records | explicit `{ok:true, code:"no-records"}`, never a crash |

### Compatibility

`preparation.json` gains only optional fields — old receipts remain valid, matching the existing
`convergence-not-recorded` non-crash precedent. No existing `checkPreparation()` path becomes
stricter for a receipt that never named a telemetry file (same `if (receipt.ledgerFile)`-shaped gate
`--ledger` already uses). M195/M197/M200/M201/M202-shaped fixtures (predating this child, no
`--telemetry`) must stay GREEN unmodified — needs its own explicit regression-run AC item, not an
assumption. [[DIR-126-C]]'s `.generation.json` shape, write path, and `decideResumeGeneration`'s
clauses stay untouched byte-for-byte, including `WIRING-CLAIM R6` (`reuse-terminal` never rewriting
that file). Both workflow mirrors, the `milestone-preparation-check.ts` mirror, and
`proposal-convergence.ts` (both mirrors) must stay byte-identical (`sync-vendor.sh --check`/`cmp`).
No retroactive backfill into pre-DIR-126 receipts. The task's `## Touches` list, re-verified live
during this reconciliation, already names every file this proposal edits — no correction needed
before Plan authoring.

### Risks

- Receipt dispatch-count increase (2→3) is the single largest behavior change here — mitigated by
  scoping it to Receipt only, reusing existing `proposal-convergence.ts` code paths for both new
  sub-dispatches (no new subprocess binary).
- Sandbox `Date.now()`/dynamic-`import()` trap recurring — this file has now crashed in production
  twice on exactly this class of mistake (`f6db2a8` for the clock; `7357a91` for `import()`);
  mitigated by routing every timestamp through an already-real subprocess self-report and a
  grep-based regression fixture covering both `Date.now()`/`new Date()` and `await import(`.
- `reuse-terminal`/`.generation.json` conflation risk — an implementer extending
  `_recordGenerationCli` alone (the more obvious single extension point) could miss that
  `reuse-terminal` needs its write inside `_decideResumeCli` instead, and could accidentally
  reintroduce a `.generation.json` write [[DIR-126-C]] removed; mitigated by naming this as its own
  wiring claim (WIRING CLAIM 2), not folded into claim 1.
- Cross-child interface risk inherited from [[DIR-126-C]]: the gitignored generation-record shape is
  a compatibility contract; this child extends the durable archive only.
- CLI report-format drift: adding `nowMs` to `prepare-admission-check.ts`'s and
  `proposal-convergence.ts`'s JSON output must not break the existing noise-tolerant
  `_parseAgentJson` parser (see the 2026-07-30-fixed `gap-prepare-milestone-noisy-agent-raw-json-
  parse` precedent) or any field the workflow script already reads; mitigated by additive-only field
  changes verified against existing fixtures.
- `--telemetry-report` correctness depends on scanning by embedded `milestoneId`, not directory
  structure — mitigated by filtering on the record's own field.
- New committed-artifact volume: small structured JSON only, explicitly excluded from any LOC
  "productivity" framing.

### Non-goals

Not re-implementing [[DIR-126-A]]'s lease acquisition, [[DIR-126-B]]'s preflight checks, or
[[DIR-126-C]]'s `decideResumeGeneration`/resume logic — only recording what they already decided.
Not building DIR-126-E's capacity-report aggregation — this child makes individual records exist and
be queryable per-attempt; cross-record aggregation is out of scope. Not fabricating token-usage
fields the harness doesn't expose. Not deriving telemetry from Claude Code session JSONL. Not
touching `prepare-admission-check.ts`'s write surface (read-only + one additive `nowMs` field only).
Not changing [[DIR-126-C]]'s `.generation.json` shape, path, or per-taskId-overwrite semantics,
including its no-write-on-`reuse-terminal` behavior. Not implementing DIR-124-B's own
receipt-migration adapter — only shaping records to be deterministically adaptable. Not "fixing" the
already-moot `gap-decide-resume-generation-path-unsanitized-taskid` follow-up (point 9 above — that
code path no longer exists in the current tree).

### Acceptance Criteria coverage

- Real production wiring at every phase boundary and pre-lease exit → WIRING CLAIM 1/2/3, each
  independently checkable by direct source read.
- Directly queryable telemetry (cold/resumed/contention/preflight-rejected/reuse-terminal) via
  `--telemetry-report` → WIRING CLAIM 7, fed by claims 1/2/3.
- Generation-ID non-collision across successive owners → reuses C's landed formula unchanged; the AC
  test exercises that reuse, not new logic.
- `reuse-terminal` measurability → WIRING CLAIM 2 plus the mechanical/content counter split.
- Telemetry integrity (tamper → `telemetry-stale`; missing → fail-closed) → WIRING CLAIM 6, direct
  reuse of `--ledger`'s code shape.
- Receipt write-before-build ordering (the one place a silent failure could produce a false
  `prepared`) → WIRING CLAIM 4, RED/GREEN fixture.
- Phase-transition count parity against a real multi-round journal → WIRING CLAIM 5's
  `_phaseTelemetry` accumulation, including delta-round and PlanCheck-round loops.
- Per-terminal real-dispatch count stays exactly 1 for the 13 pre-Receipt sites and `reuse-terminal`,
  exactly 3 for Receipt → WIRING CLAIM 1/2 (unchanged count) and WIRING CLAIM 4 (disclosed
  increase), each needing its own journal-count fixture.
- All fields present-and-typed → the Defaults table plus schema validation fail-closed behavior.
- Zero new `Date.now()`/`new Date()`/`await import(` regression → WIRING CLAIM 5's grep-based guard,
  given two confirmed prior production incidents.
- Forward-compatible feedback identity / recurrence tracking → WIRING CLAIM 8's `findingCodes[]`,
  its own dedicated fixture.
- One-way DIR-124-B migration compatibility → this child proves its own record shape is
  deterministically adaptable; it cannot prove DIR-124-B's adapter exists (that's DIR-124-B's own
  scope).
- Byte-identical mirrors → existing `sync-vendor.sh --check`, unchanged mechanism.
- Backward-compat regression run → explicit AC item re-running M195/M197/M200/M201/M202-shaped
  fixtures GREEN unmodified.
- Touches-list sufficiency → re-verified live during this reconciliation (point 10): the current
  `## Touches` already lists every file this proposal edits; no separate correction AC item needed.

### Alternatives considered and rejected

- A second, parallel CLI dispatch (`--emit-telemetry`) alongside the unchanged `--record-generation`
  call, for the 13 pre-Receipt sites. Rejected: doubles per-terminal real-dispatch count for no
  correctness benefit, since one already-real process can trivially perform two `fs.write` calls.
- Splitting write/release into two dispatches at ALL 15+3 sites uniformly, instead of scoping the
  split to Receipt only. Rejected: the 13 pre-Receipt/`reuse-terminal` terminals are already
  non-`prepared` regardless of telemetry write outcome, so a second dispatch there buys zero
  correctness and only adds cost; the split is worth its cost exactly once, at the site where a
  silent write failure could otherwise slip into a false certification.
- Extending C's existing gitignored single-record file into the durable archive (add a history array
  to `.generation.json`). Rejected: that path is gitignored specifically because it's ephemeral and
  meant to vanish on release, and is deliberately left unwritten on `reuse-terminal` — a durable,
  cross-session record cannot live somewhere designed to sometimes not be written at all.
- Hosting the new per-phase CLI logic on `prepare-admission-check.ts`. Rejected for the same reason
  [[DIR-126-C]] rejected it: its lease/contention fields lack `fencingToken`, so it structurally
  cannot host generation-identity logic, and it isn't the file this task's `## Touches` scopes for
  new logic.
- A workflow-script-local `Date.now()`/injected-clock source for phase timing, or a dynamic
  `import()`-based pre-check. Rejected: both are confirmed 100%-reproducible production crashes
  (`f6db2a8`, `7357a91`); a test-only injected clock hook can never be present in a real
  JSON-serialized dispatch, so timing built on it would be test-fixture-only, not production-real.
- Deriving phase timing/telemetry from Claude Code session JSONL. Rejected: session logs aren't
  checked in, aren't reproducible by a later auditor, and conflict with the "checked-in workflow
  artifacts, not session prose" bar this same defect is trying to fix.
- A single combined mechanical+content dispatch counter. Rejected: cannot prove
  [[DIR-126-B]]/[[DIR-126-C]]'s savings — a `reuse-terminal` record with a nonzero combined counter
  (from mechanical calls that always run) would look indistinguishable from one that also ran an
  expensive content agent.
- Overwriting a single per-task committed telemetry file (mirroring `.generation.json`'s per-taskId
  overwrite). Rejected: this is the literal defect being fixed — it would silently destroy history
  on every re-run.
- Writing telemetry only on the success path (today's behavior). Rejected by construction: this is
  the literal cause of the measured gap (16 of 17 sampled real calls non-success).
- Treating the separately-filed `gap-decide-resume-generation-path-unsanitized-taskid` follow-up as
  a live blocking prerequisite for this proposal. Rejected after direct re-read of the current
  `prepare-milestone.js`: the local, unsanitized path computation that gap describes was already
  deleted by commit `7357a91` — the gap task should be closed as moot, not treated as in-scope work
  here.

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
- [ ] **Pre-Receipt write-before-release ordering never orphans a lease:** a fixture that forces the
  new telemetry `fs.writeFileSync` inside `_recordGenerationCli` to throw confirms `releaseLease(...)`
  still ran and the Admission lease is not left held — the write is ordered after release, not
  before, so a write failure degrades observability only and never blocks the lease from releasing.
  Grounding: `_releaseLeaseAndRecord`'s current landed `_recordGenerationCli` catch already returns
  `{ok:false}` without releasing the lease if anything inside its try throws (confirmed by direct
  source read), which is exactly the failure mode this ordering decision avoids for the new write.
- [ ] **`reuse-terminal` schema validation rejects malformed records:** a hand-corrupted
  `reuse-terminal` telemetry record (missing `generationId`, or carrying nonzero
  `contentAgentDispatchCount`/`contentAgentMs`, or lacking a prior generation/policy hash) is
  confirmed to fail schema validation closed, producing `needs-human` rather than a false
  `reuse-terminal` pass — a RED fixture distinct from the existing positive/well-formed
  `reuse-terminal` AC item above.
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
- [ ] **`--telemetry-report` zero-match case:** a fixture querying a `milestoneId` with no written
  records confirms `--telemetry-report <milestoneId>` returns `{ok:true, code:"no-records"}`, not a
  crash and not an empty-looking silent success — a companion fixture to the read-after-write case
  above, exercising the Defaults table's zero-match commitment directly.
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
  `releaseLease(...)`, `releaseLease(..., reason: "reuse-terminal", ...)`, `releaseResult`,
  `{schemaVersion:1, taskId, generationId, charterHash, taskContractHash, proposalHash, reviewPolicyHash, terminalPhase, outcome, reason, cacheable, recordedAtMs: Date.now()}`,
  `{terminalPhase, reason}` — every one of these is a real, already-confirmed name from this same
  document's Chosen mechanism or DIR-126-A/B/C's own landed code (direct source read), not a new
  invention, wired and verified as described above. Round-3 additionally flagged: `import()` — the
  bare identifier form (distinct from `await import(`, already covered above) used in the Key
  design decisions' "never a new `Date.now()` call or dynamic `import()` inside the sandboxed
  script" sentence, confirmed real by the same `7357a91` production-crash precedent already cited.

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
