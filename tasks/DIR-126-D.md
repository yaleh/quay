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
every phase transition and every terminal outcome, not only the successful `prepared` path — and
hash-bind a successful generation's record into its receipt so tampering is mechanically
detectable. Fourth child of DIR-126's 5-way split; builds on [[DIR-126-A]] (Admission lease
identity/release), [[DIR-126-B]] (Preflight verdict shape), and [[DIR-126-C]] (the gitignored
`.generation.json` generation-record shape and `decideResumeGeneration`, which this child extends
and never redesigns).

### Problem framing (grounded by direct read of the current tree, 2026-07-30, confirmed at
commit `83c1958`; line numbers re-verified against current `HEAD` and unchanged)

Direct read of `.claude/workflows/prepare-milestone.js` (794 lines, `cmp`-confirmed byte-identical
to `plugin/workflows/prepare-milestone.js`) and `experiments/quay-perpetual-stream/scripts/
proposal-convergence.ts` (517 lines, `cmp`-identical to its `plugin/scripts/` mirror) confirms:

1. There are exactly 15 `_releaseLeaseAndRecord(stageLabel, {terminalPhase, outcome, reason,
   cacheable})` call sites (grep-confirmed at lines 263, 273, 316, 340, 502, 545, 571, 576, 581,
   620, 636, 651, 699, 769, 778): 13 pre-`Receipt` terminals (`preflight-check-failed` ×2,
   `preflight-rejected` ×2, `proposal-author-incomplete`, `adjudicate-failed`,
   `wiring-coverage-check-failed`, `proposal-revise-failed`, `split-recommended`,
   `soft-budget-exceeded`, `delta-cap-exhausted`, `plan-author-failed`, `plancheck-rounds-exceeded`)
   plus 2 belonging to `Receipt` itself (`receipt-selfcheck-failed` at line 769, `prepared` at line
   778), both dispatched AFTER Receipt's own `--build` self-check `agent()` call has already run.
   Three real return sites emit **no** telemetry today: `missing-required-args` (line 68, before
   Admission even starts — `return { outcome: 'needs-human', reason: 'missing-required-args
   (taskId/milestoneId/charterFile)', ... }`), `admission-check-failed` (line 180), and
   `prepare-already-running` (line 185, lease contention, guarded at line 175/183) — none of these
   three holds an Admission lease. A further site — [[DIR-126-C]]'s `reuse-terminal` branch inside
   `_decideResumeCli` (`proposal-convergence.ts` line 415) — releases the lease inline via a bare
   `releaseLease(...)` call (line 421) and returns before `Preflight`; it is a separate CLI submode
   (`--decide-resume`) from the other 15 (`--record-generation`).
2. `_releaseLeaseAndRecord` (`prepare-milestone.js` line 152) wraps exactly one subprocess call,
   `_convergenceAgentCall('--record-generation ...')` → `_recordGenerationCli`
   (`proposal-convergence.ts` lines 442-471). That function computes `generationId =
   sha256(taskId::ownerExecutionId::fencingToken::acquiredAt).slice(0,12)` via
   `_computeGenerationId` (line 353), writes `{schemaVersion:1, taskId, generationId, charterHash,
   taskContractHash, proposalHash, reviewPolicyHash, terminalPhase, outcome, reason, cacheable,
   recordedAtMs: Date.now()}` to `_generationPath(workspace, taskId)` (line 347) =
   `.quay/prepare-leases/<taskId>.generation.json` at line 465, **then** releases the Admission
   lease at line 466. `.gitignore:27` (`**/.quay/prepare-leases/`) confirms this path is
   gitignored. Critically, the existing write happens BEFORE the release, and the surrounding
   `try`/`catch` (lines 443/468) returns `{ok:false}` on any throw WITHOUT releasing the lease — so
   today, a write failure in this function already risks an orphaned lease; this is the exact
   hazard any new write added to this function must not worsen. Write-record-and-release-lease is
   one atomic step for all 15 sites today, but the write target is a single mutable, per-`taskId`
   file — a second attempt for the same task clobbers the first attempt's record before anyone can
   read it historically.
3. `--decide-resume` (`_decideResumeCli`, line 387) and `--record-generation`
   (`_recordGenerationCli`, line 442) are two distinct CLI submodes in the same file.
   `_decideResumeCli` recomputes the identical `generationId`, reads the prior `.generation.json`,
   and calls the pure `decideResumeGeneration`, gated by the exported `CACHEABLE_TERMINALS`
   allowlist (confirmed exactly `PreflightContent/preflight-rejected` and
   `ProposalReview/split-recommended`, line 247). On a `reuse-terminal` decision (line 415) it
   releases the lease **inline in the same call** (line 421) but deliberately does **not** rewrite
   `.generation.json`. A `reuse-terminal` attempt therefore already has a real, computed
   `generationId` and a typed `releaseResult`, but the only call site that can host a committed
   telemetry write for it is inside `_decideResumeCli`'s `reuse-terminal` branch —
   `_recordGenerationCli` never runs for that path.
4. Net: the raw decision/identity material this child needs already exists at 15 of 18 real
   terminal sites, plus a 16th (`reuse-terminal`) with a real `generationId` computed at a separate
   call site — but the only place it is ever recorded is a single mutable, gitignored,
   per-`taskId`-overwritten file. Combined with DIR-126's own measured finding (16 of 17 sampled
   real `prepare-milestone` calls were non-success), a strict majority of that history is
   unrecoverable even after [[DIR-126-C]] lands, because the one file holding a non-`prepared`
   terminal's identity is neither committed nor durable across repeated attempts, and carries no
   phase-level timing or dispatch-count breakdown — a single terminal snapshot.
5. `milestone-preparation-check.ts` already solves a structurally identical problem for a sibling
   artifact: `buildReceipt`'s `ledgerFile` parameter (line 73, `ledgerHash` computed at line 80)
   sha256-hashes a ledger file's content into `receipt.hashes.ledger`; `checkPreparation()` (line
   253+) fails closed with `ledger-missing`/`ledger-stale` (the `if (receipt.ledgerFile) {...}`
   block, lines 312-322) if the bound file is absent or its hash no longer matches current
   content. This is directly reusable machinery, not a new integrity scheme to invent. `git
   ls-files milestones/` confirms `milestones/` is git-tracked today (e.g.
   `milestones/M202/preparation.json`), and `git check-ignore -v` on a hypothetical
   `milestones/prepare-telemetry/<taskId>/<recordId>.json` path returns exit 1 (not ignored) — the
   proposed new tree is committable by construction.
6. **Two confirmed, production-proven hard sandbox constraints**, both visible in this file's own
   commit history: (a) `Date.now()`/`new Date()` inside `prepare-milestone.js` crashed 100%
   reproducibly in production, fixed at `f6db2a8` ("prepare-milestone.js's soft-budget clock
   crashes on EVERY real dispatch ... Date.now() fallback is forbidden in the Workflow sandbox");
   (b) dynamic `import()` likewise crashed in production, fixed at `7357a91`
   (`gap-prepare-milestone-workflow-dynamic-import`) — an in-file comment documents this exact
   failure, discovered on this very milestone's own first live attempt. Both are load-bearing:
   nothing this proposal adds to `prepare-milestone.js` may call the real clock or dynamically
   import a module — every timestamp and every durable file write must ride an already-real
   `agent()`-wrapped subprocess. `ProposalReview`'s existing `nowMs` self-report convention (a real
   `date +%s%3N` executed inside an agent, folded into `_latestKnownNowMs`) is the confirmed live
   precedent for working around constraint (a); `_recordGenerationCli` itself legitimately calls
   `Date.now()` directly because it executes in a real Node subprocess, not the sandboxed workflow
   script.
7. Every phase already sits adjacent to a real dispatch: `_renewLease` (wrapping
   `_admissionAgentCall('--renew ...')`) fires at Adjudicate, ProposalReview entry, each
   ProposalReview delta round, PlanAuthor, each PlanCheck round, and Receipt entry;
   `_admissionAgentCall`/`_preflightAgentCall`/`_convergenceAgentCall` are the file's other real
   CLI-wrapping dispatch families. Grep for `_phaseTelemetry`/`telemetry` in both
   `prepare-milestone.js` and `milestone-preparation-check.ts` today returns zero hits — this is
   genuinely new capability, not an extension of existing telemetry code.
8. `prepare-admission-check.ts`'s lease/owner shape is `{ownerExecutionId, attempt, stage,
   fencingToken, baseCommit, acquiredAt, leaseUntil, heartbeatAt}`, but the contention verdict
   `checkStaleOwner` actually surfaces to the caller (`owner:` object, lines 145-149) only exposes
   `{ownerExecutionId, acquiredAt, leaseUntil, stage}` — no `fencingToken` (confirmed by direct
   read) — so a contention record is structurally incapable of deriving a real, collision-safe
   `generationId` without a separate, out-of-scope change to that file's own output contract,
   which this proposal deliberately avoids (see Non-goals).

### Chosen mechanism

Add one new durable, git-tracked artifact — one JSON record per dispatch attempt at
`milestones/prepare-telemetry/<taskId>/<recordId>.json`, where the `<taskId>` directory segment is
routed through the SAME `_safeTaskIdSegment()` helper `_leasePath`/`_generationPath` already use
(`proposal-convergence.ts` line 341), reused verbatim rather than re-invented. This is a stricter
requirement than the sibling `.generation.json` path: a prior non-blocking gap
(`gap-decide-resume-generation-path-unsanitized-taskid`) accepted the risk there specifically
because that file is gitignored/ephemeral and no real taskId today contains a path separator; this
new path is PERMANENTLY git-committed, so an unsanitized taskId containing `/` or `..` here could
write outside the intended directory tree in a way that persists in git history — reusing
`_safeTaskIdSegment()` closes that class of defect for this new, higher-stakes path from the start.
(`<taskId>` is used as shorthand for this sanitized segment throughout the rest of this document.)
Written from the SAME already-real `proposal-convergence.ts` subprocess invocations that already
run at every terminal today, plus one new minimal CLI submode for the three pre-lease exit sites
that currently emit nothing. [[DIR-126-C]]'s gitignored `.generation.json` and
`decideResumeGeneration`'s evaluation order stay byte-for-byte frozen and remain the sole
resume-decision input; this child is additive telemetry only, never a redesign of C's resume
contract.

**WIRING CLAIM 1 — extend `--record-generation` in place; the 13 pre-Receipt sites keep exactly
one dispatch each.** `_recordGenerationCli` gains a second `fs.writeFileSync` (to the new committed
path) AFTER `releaseLease(...)` succeeds, not before — deliberately reversing today's
write-then-release ordering for this NEW write only (the existing `.generation.json` write stays
before release, unchanged), so a failure in the new write can never prevent the release that
already happens today. Call count and control flow at the 13 pre-Receipt `_releaseLeaseAndRecord`
sites are unchanged. AC coverage needed: a fixture forcing the new write to throw, confirming
`releaseLease(...)` still ran and the lease is not left held; a fixture confirming per-terminal
real-dispatch count at these 13 sites stays exactly 1.

**WIRING CLAIM 2 — `reuse-terminal` gets its own write, inside `_decideResumeCli`, not folded into
Claim 1.** This is the one call site DIR-126-C's `reuse-terminal` decision actually returns from
(line 415-421). Add the same committed-telemetry write there (`recordId = generationId`,
`decision.kind:'reuse-terminal'`, `createsContentGeneration:false`,
`contentAgentDispatchCount:0`), written from the same call that already computes `generationId`
and releases the lease inline. This write must **not** touch `.generation.json` — per point 3
above, [[DIR-126-C]] deliberately keeps that file unwritten on `reuse-terminal`; this child must
not reintroduce a write C explicitly removed. AC coverage needed: its own dedicated fixture,
distinct from Claim 1, since an implementer extending only `_recordGenerationCli` would
structurally miss this path.

**WIRING CLAIM 3 — pre-lease exits get one genuinely new, minimal dispatch.**
`missing-required-args`, `admission-check-failed`, and `prepare-already-running` hold no lease and
(per point 8) cannot derive a real `generationId`. Each gains a new, narrow CLI submode on
`proposal-convergence.ts` — `--record-attempt` — writing **only** the committed telemetry file,
never `.generation.json`, keyed by `recordId = attemptId = sha256(<fields the site's own verdict
actually exposes>).slice(0,12)`, structurally incapable of colliding with a real `generationId`.
`generationId: null`, `decision.kind: "not-evaluated"` for all three — this is the single
highest-value new wiring here, since these three sites had zero telemetry before.
**`missing-required-args` special case:** the committed path is `taskId`-primary, but
`missing-required-args` can itself fire because `taskId` is the missing field — there is no valid
directory key in that exact case. `--record-attempt` special-cases it: when `taskId` is absent, the
record is written under a fixed literal directory, `milestones/prepare-telemetry/_missing-taskId/
<recordId>.json`, with an explicit `taskId: null` field — never fabricated, never dropped. The
other two pre-lease sites always have a real `taskId` (the guard that would produce
`missing-required-args` already passed at line 68 before reaching lines 175/183-185), so they use
the normal `<taskId>/<recordId>.json` path unmodified. AC coverage needed: a real-dispatch fixture
per site, at the same evidentiary bar `prepare-already-running` already gets, PLUS a dedicated
fixture proving the `missing-required-args` case lands under `_missing-taskId/` with `taskId:
null`.

**WIRING CLAIM 4 — Receipt is restructured into write-then-build-then-release; the one place
dispatch count genuinely grows (2→3), disclosed and scoped to Receipt alone.** Today Receipt makes
2 real dispatches per terminal: the `--build`/self-check `agent()` call (runs BEFORE any telemetry
write exists) and the combined `_releaseLeaseAndRecord` call. This ordering means Receipt's
build/selfcheck could already certify `prepared` before any generation record for that attempt
exists — exactly the ordering gap the AC's tamper-detection requirement targets. Split into
`_writeGenerationTelemetry(stageLabel, {...})` (extended `--record-generation`: writes
`.generation.json` AND the new committed telemetry file, no release) and a new release-only
submode `_releaseLease(stageLabel, {...})` (no write). Reorder Receipt's flow: (1)
`_writeGenerationTelemetry` first; (2) write failure → terminal `needs-human`/
`telemetry-write-failed`, `_releaseLease` still runs (no orphaned lease), but the Receipt `--build`
agent call never runs; (3) write success → `--build` runs, now passed `--telemetry <file>` naming a
file that provably already exists; (4) existing `receiptResult.ok` check selects
`receipt-selfcheck-failed` or `prepared`, `_releaseLease` runs once. AC coverage needed: a
dedicated RED/GREEN fixture pair — forced write failure → `needs-human`/`telemetry-write-failed`,
`--build` never invoked; forced write success → `--build --telemetry` provably runs against a file
that already exists at call time.

**WIRING CLAIM 5 — phase timing rides already-real dispatches, never a new clock call or dynamic
import inside the sandbox.** `prepare-admission-check.ts` (invoked by `_renewLease` at every phase
boundary) and the extended `--record-generation`/`--decide-resume`/`--record-attempt` calls each
gain one additional self-reported field in their JSON stdout: `nowMs: Date.now()`, computed in the
real OS subprocess, never the sandbox. `prepare-milestone.js` accumulates `{phase, round,
startedAtMs, endedAtMs}` entries into a plain in-memory `_phaseTelemetry` array by reading `nowMs`
back off already-parsed results — zero new agent dispatches, zero new forbidden calls inside
`prepare-milestone.js`. This extends `ProposalReview`'s existing `nowMs` self-report convention to
the other four content phases (`ProposalAuthors`, `Adjudicate`, `PlanAuthor`, `PlanCheck`). AC
coverage needed: given the two confirmed production crashes (point 6), a hard grep-based
regression-guard AC item: zero new `Date.now()`/`new Date()`/`await import(`/bare `import(` sites
added to `prepare-milestone.js` (either mirror) by this child's diff.

Mechanical vs. content dispatch counters stay separate — `mechanicalRunnerCount`/
`mechanicalRunnerMs` vs. `contentAgentDispatchCount`/`contentAgentMs`, matching the file's existing
taxonomy. This is what makes [[DIR-126-B]]/[[DIR-126-C]]'s savings provable: a
`preflight-rejected` or `reuse-terminal` record with `contentAgentDispatchCount:0` is direct
structural proof, not an inference from wall time.

**WIRING CLAIM 6 — tamper detection reuses `--ledger`'s exact mechanism, not a new integrity
scheme.** `milestone-preparation-check.ts --build` gains `--telemetry <file>`, sha256-hashing its
content into `receipt.hashes.telemetry`, mirroring `buildReceipt`'s existing `ledgerHash`
computation (line 80) verbatim. `checkPreparation()` gains a `receipt.telemetryFile` block
mirroring the existing `if (receipt.ledgerFile) {...}` block (lines 312-322): missing →
`telemetry-missing`; hash mismatch → `telemetry-stale`. AC coverage needed: a dedicated RED/GREEN
fixture pair mirroring the existing `ledger-stale`/`ledger-missing` tests, not code-shape
similarity alone.

**WIRING CLAIM 7 — `--telemetry-report <milestoneId>`**, a new read-only CLI mode on
`milestone-preparation-check.ts`, scans `milestones/prepare-telemetry/**/*.json`, filtering by
each record's own `milestoneId` field — never by directory structure alone, since the layout is
`taskId`-primary and a re-charter'd task could carry a different `milestoneId` across generations
under the same `taskId` directory. Returns `{ok:true, code:"no-records", milestoneId}` on zero
matches, never a crash. AC coverage needed: an end-to-end fixture — write a real record via the
extended write path, then read it back via this exact CLI mode, not a mocked reader — plus a
zero-match fixture.

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

`decision.kind` is `cold|resume|reuse-terminal` for admitted attempts, `not-evaluated` (typed,
never omitted) for the three `--record-attempt` sites. [[DIR-126-C]]'s `.generation.json` keeps
`schemaVersion:1` unmodified; `schemaVersion:2` applies only to this child's new committed archive.

**WIRING CLAIM 8 — `findingCodes[]` recurrence tracking.** One entry per stable code the terminal
carries (at minimum `terminal.reason`, plus each ProposalReview ledger finding's own `code`).
`recurrenceKey = sha256(taskId::code).slice(0,12)`; `firstSeenGeneration`/`lastSeenGeneration`
populated by scanning already-committed `milestones/prepare-telemetry/<taskId>/*.json` for a prior
entry with the same `recurrenceKey` — a plain glob+JSON-parse read inside the already-real
`proposal-convergence.ts` process, no new dispatch. AC coverage needed: a dedicated fixture — a
repeated finding code across two real generations advances `lastSeenGeneration` while
`firstSeenGeneration` stays pinned to the first.

### Concrete control and data flow

```
missing-required-args (pre-Admission, line 68)   → NEW --record-attempt (telemetry-only,
                                                     generationId:null, decision.kind:"not-evaluated")
Admission (_admissionAgentCall gains nowMs; guard at line 175)
  ├─ admission-check-failed (line 180)            → same NEW --record-attempt dispatch
  ├─ prepare-already-running (line 185, contention)→ same, recordId=attemptId (no fencingToken input)
  └─ acquired lease → _phaseTelemetry=[{phase:'Admission', startedAtMs, endedAtMs}]
       $a.resumeFromAdjudicatedProposal explicit true|false → skips --decide-resume entirely
       $a.resumeFromAdjudicatedProposal omitted →
         --decide-resume (computes generationId, reads priorGenerationRecord)
           ├─ reuse-terminal → SAME call: releases lease inline (unchanged, C's R3 fix, line 421)
           │     + NEW committed telemetry write (decision.kind:'reuse-terminal',
           │     contentAgentDispatchCount:0); .generation.json deliberately NOT rewritten → return
           └─ cold|resume → continue
              Preflight ×2 (gains nowMs; _renewLease fires)
                ├─ preflight-check-failed / preflight-rejected
                │     → extended --record-generation: writes UNCHANGED .generation.json PLUS
                │       new committed telemetry record (new write ordered AFTER release)
                └─ passed → ProposalAuthors → Adjudicate → ProposalReview(+delta rounds, gains
                     nowMs) → PlanAuthor → PlanCheck(+rounds) → Receipt
                     (all 13 pre-Receipt terminals: unchanged _releaseLeaseAndRecord wrapper, one
                      dispatch, flushing _phaseTelemetry + counters into the same extended
                      --record-generation write)
                     Receipt (dispatch count 2 → 3, scoped here only, lines 706-786 range):
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
- Dispatch count grows only where it must: the 13 pre-Receipt sites and `reuse-terminal` keep
  their current count (1 each); the 3 pre-lease sites go 0→1 (they had zero telemetry before);
  only Receipt goes 2→3, because that is the one place a silent write failure could otherwise be
  absorbed into a false `prepared` certification.
- All phase timing sourced from already-real subprocess self-reports, never a new `Date.now()`
  call or dynamic `import()` inside the sandboxed script — treated as a hard grep-based gate given
  the two confirmed production incidents (`f6db2a8`, `7357a91`), not an assumption.
- `proposal-convergence.ts` is the only file gaining new logic — `prepare-milestone.js` is
  sandboxed (no fs, no real clock, no dynamic import), `milestone-preparation-check.ts` only runs
  at build/report time, `prepare-admission-check.ts` stays read-only (gains only an additive
  `nowMs` field; its contention `owner` shape is unchanged and still lacks `fencingToken`).
- `--decide-resume` and `--record-generation` are extended separately, not conflated — the
  `reuse-terminal` write must live in `_decideResumeCli` and must not resurrect a
  `.generation.json` write [[DIR-126-C]] deliberately removed.
- Attempt/generation ID scheme matches what each caller can actually prove: admitted attempts
  (including `reuse-terminal`) reuse C's `_computeGenerationId` formula unchanged; pre-lease/
  contention attempts hash only fields their own verdict exposes, structurally unable to collide
  with a real `generationId`.
- No fabrication: an uncapturable field is recorded as explicit `null`/`"unknown"`, never omitted,
  matching the file's existing provenance-flag discipline.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Receipt-path `_writeGenerationTelemetry` write fails | terminal `needs-human`, reason `telemetry-write-failed`; `--build` never runs, never `prepared` off an unwritten record |
| A pre-Receipt terminal's (13 sites, or `reuse-terminal`) telemetry write fails | terminal outcome unaffected (already non-`prepared`); degrades observability only |
| A pre-lease `--record-attempt` dispatch fails to write | logged, but the original terminal outcome is returned regardless — telemetry is additive, never gating on already-terminal paths |
| A phase-timing/dispatch-count field cannot be captured | explicit `null`/`"unknown"`, never omitted, never a synthesized `Date.now()` |
| Admission identity lacks `key`/`ownerExecutionId`/`fencingToken` | fail closed; no bare-session/collision-prone `generationId` ever emitted |
| Contention/pre-lease attempt (no lease held) | `generationId:null`, `recordId = attemptId`, `createsContentGeneration:false`, `decision.kind:"not-evaluated"` |
| `missing-required-args` specifically (`taskId` itself absent, no valid directory key) | record lands at `milestones/prepare-telemetry/_missing-taskId/<recordId>.json`, `taskId: null` — never fabricated, never dropped |
| `reuse-terminal` record has any content-agent dispatch, or lacks a prior generation/policy hash | schema validation fails closed — `needs-human` |
| Acquired generation terminates without a typed lease-release result | terminal stays visibly non-`prepared`; `leaseRelease.ok` never fabricated `true` |
| Receipt names a telemetry file that's missing or hash-mismatched | `telemetry-missing`/`telemetry-stale`, fails closed |
| `--telemetry-report <milestoneId>` finds zero matching records | explicit `{ok:true, code:"no-records"}`, never a crash |

### Compatibility

`preparation.json` gains only optional fields — old receipts remain valid, matching the existing
precedent of tolerant receipt-field growth (e.g. `ledgerFile` itself, the `convergence-not-recorded`
non-crash case). No existing `checkPreparation()` path becomes stricter for a receipt that never
named a telemetry file (same `if (receipt.ledgerFile)`-shaped gate `--ledger` already uses at line
312). Existing M195/M197/M200/M201/M202-shaped fixtures (predating this child, no `--telemetry`)
must stay GREEN unmodified — an explicit regression-run AC item, not an assumption. [[DIR-126-C]]'s
`.generation.json` shape, write path, and `decideResumeGeneration`'s clauses stay untouched
byte-for-byte, including the `reuse-terminal`-never-rewrites behavior. Both workflow mirrors, the
`milestone-preparation-check.ts` mirror, and `proposal-convergence.ts` (both mirrors) must stay
byte-identical (`sync-vendor.sh --check`/`cmp`, currently confirmed identical). No retroactive
backfill into pre-DIR-126 receipts.

### Risks

- Receipt dispatch-count increase (2→3) is the single largest behavior change here — mitigated by
  scoping it to Receipt only, reusing existing `proposal-convergence.ts` code paths for both new
  sub-dispatches (no new subprocess binary).
- Sandbox `Date.now()`/dynamic-`import()` trap recurring — this file has crashed in production
  twice on exactly this class of mistake (`f6db2a8` for the clock; `7357a91` for `import()`,
  discovered on this very milestone's own first live attempt); mitigated by routing every
  timestamp through an already-real subprocess self-report and a grep-based regression fixture
  covering both `Date.now()`/`new Date()` and `await import(`/bare `import(`.
- `reuse-terminal`/`.generation.json` conflation risk — an implementer extending
  `_recordGenerationCli` alone (the more obvious single extension point) could miss that
  `reuse-terminal` needs its write inside `_decideResumeCli` instead, and could accidentally
  reintroduce a `.generation.json` write [[DIR-126-C]] removed; mitigated by naming this as its
  own wiring claim (Claim 2), not folded into Claim 1.
- CLI report-format drift: adding `nowMs` to `prepare-admission-check.ts`'s and
  `proposal-convergence.ts`'s JSON output must not break the existing noise-tolerant JSON parser
  (per the `gap-prepare-milestone-noisy-agent-raw-json-parse` precedent) or any field the workflow
  script already reads; mitigated by additive-only field changes verified against existing
  fixtures.
- `--telemetry-report` correctness depends on scanning by embedded `milestoneId`, not directory
  structure — mitigated by filtering on the record's own field.
- New committed-artifact volume: small structured JSON only, explicitly excluded from any LOC
  "productivity" framing.
- Point 8 above (contention `owner` shape lacking `fencingToken`) means the contention/
  `admission-check-failed`/`missing-required-args` records are structurally weaker (attempt-keyed,
  not generation-keyed) than admitted-attempt records — an accepted, disclosed asymmetry, not a
  defect to silently paper over.

### Non-goals

Not re-implementing [[DIR-126-A]]'s lease acquisition, [[DIR-126-B]]'s preflight checks, or
[[DIR-126-C]]'s `decideResumeGeneration`/resume logic — only recording what they already decided.
Not building DIR-126-E's capacity-report aggregation — this child makes individual records exist
and be queryable per-attempt; cross-record aggregation is out of scope. Not fabricating
token-usage fields the harness doesn't expose. Not deriving telemetry from Claude Code session
JSONL. Not touching `prepare-admission-check.ts`'s write surface (read-only + one additive `nowMs`
field only). Not changing [[DIR-126-C]]'s `.generation.json` shape, path, or per-`taskId`-overwrite
semantics, including its no-write-on-`reuse-terminal` behavior. Not implementing DIR-124-B's own
receipt-migration adapter — only shaping records to be deterministically adaptable.

### Why one milestone, not eight (SPLIT-OR-COMMIT: COMMIT)

The 8 numbered WIRING CLAIMs are call-site enumeration, not 8 separable products:

- **Claims 1-4 are the SAME "write one committed record per terminal outcome" behavior**, split
  only by which of 4 structurally distinct call shapes a terminal falls into (13
  already-instrumented sites / the one `reuse-terminal` short-circuit / 3 previously-silent
  pre-lease exits / the one Receipt path where dispatch count itself changes). Landing only a
  subset (e.g. Claims 1+3 without Claim 4) would leave Receipt — the terminal whose AC requires
  proving telemetry exists before certification — uncovered, reproducing exactly the gap this child
  exists to close (DIR-126's measured finding: 16 of 17 real generations were non-success).
- **Claim 6 is not new design.** It reuses an existing tamper-detection pattern already landed in
  this same file (see WIRING CLAIM 6 above for the exact identifiers and AC coverage); splitting it
  out would be a milestone whose entire content is "copy an existing conditional block,"
  disproportionate overhead for its size.
- **Claims 5, 7, and 8 are the only claims that are individually deferrable** in principle
  (phase-timing enrichment, the read-only query CLI, and recurrence-tracking metadata are each
  additive to records that already exist without them). But all three are explicitly named in the
  already-committed M203 charter, itself the product of DIR-126's own real ProposalReview split —
  deferring any of them now would reopen a scoping decision already made deliberately, not respond
  to new information this ProposalReview round surfaced.
- **Recursively splitting a 4th-of-5 child** has a real, measured cost this session has directly
  observed: each of DIR-126-A/B/C needed its own charter, its own multi-round ProposalReview
  convergence, and its own independent post-Land wiring audit before landing. Splitting DIR-126-D
  again would multiply that fixed per-milestone overhead against a set of claims that mostly cannot
  land independently anyway — only 3 of 8 claims are even theoretically severable, and all 3 are
  charter-committed.
- **Resolution: COMMIT, not split** — every claim keeps its own dedicated, falsifiable AC/fixture
  requirement so reviewability isn't lost to bundling.

### Acceptance Criteria coverage

- Real production wiring at every phase boundary and pre-lease exit → Claims 1/2/3, each
  independently checkable by direct source read (not `--selftest`-only reachability).
- Directly queryable telemetry (cold/resumed/contention/preflight-rejected/reuse-terminal) via
  `--telemetry-report` → Claim 7, fed by Claims 1/2/3.
- Generation-ID non-collision across successive owners → reuses C's landed formula unchanged; the
  AC exercises that reuse, not new logic.
- `reuse-terminal` measurability → Claim 2 plus the mechanical/content counter split.
- Telemetry integrity (tamper → `telemetry-stale`; missing → fail-closed) → Claim 6, direct reuse
  of `--ledger`'s code shape.
- Receipt write-before-build ordering (the one place a silent failure could produce a false
  `prepared`) → Claim 4, RED/GREEN fixture.
- Phase-transition count parity against a real multi-round journal → Claim 5's `_phaseTelemetry`
  accumulation, including delta-round and PlanCheck-round loops.
- Per-terminal real-dispatch count stays exactly 1 for the 13 pre-Receipt sites and
  `reuse-terminal`, exactly 3 for Receipt → Claims 1/2 (unchanged count) and Claim 4 (disclosed
  increase), each needing its own journal-count fixture.
- All fields present-and-typed → the Defaults table plus schema validation fail-closed behavior.
- Zero new `Date.now()`/`new Date()`/`await import(`/`import(` regression → Claim 5's grep-based
  guard, given two confirmed prior production incidents.
- Forward-compatible feedback identity / recurrence tracking → Claim 8's `findingCodes[]`, its own
  dedicated fixture.
- One-way DIR-124-B migration compatibility → this child proves its own record shape is
  deterministically adaptable; it cannot prove DIR-124-B's adapter exists (that's DIR-124-B's own
  scope).
- Byte-identical mirrors → existing `sync-vendor.sh --check`, unchanged mechanism.
- Backward-compat regression run → explicit AC item re-running M195/M197/M200/M201/M202-shaped
  fixtures GREEN unmodified.

### Alternatives considered and rejected

- A second, parallel CLI dispatch (`--emit-telemetry`) alongside the unchanged
  `--record-generation` call, for the 13 pre-Receipt sites. Rejected: doubles per-terminal
  real-dispatch count for no correctness benefit, since one already-real process can trivially
  perform two `fs.write` calls.
- Splitting write/release into two dispatches at ALL 15+3 sites uniformly, instead of scoping the
  split to Receipt only. Rejected: the 13 pre-Receipt/`reuse-terminal` terminals are already
  non-`prepared` regardless of telemetry write outcome, so a second dispatch there buys zero
  correctness and only adds cost; the split is worth its cost exactly once, at the site where a
  silent write failure could otherwise slip into a false certification.
- Extending C's existing gitignored single-record file into the durable archive (add a history
  array to `.generation.json`). Rejected: that path is gitignored specifically because it's
  ephemeral and meant to vanish on release, and is deliberately left unwritten on
  `reuse-terminal` — a durable, cross-session record cannot live somewhere designed to sometimes
  not be written at all.
- Hosting the new per-phase CLI logic on `prepare-admission-check.ts`. Rejected for the same
  reason [[DIR-126-C]] rejected it: its contention-verdict `owner` shape lacks `fencingToken`, so
  it structurally cannot host generation-identity logic without a separate, out-of-scope change to
  that file's own output contract.
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
- Writing telemetry only on the success path (today's behavior, confirmed: all 15
  `_releaseLeaseAndRecord` call sites already write `.generation.json`, but nothing writes a
  committed record on any of them). Rejected by construction: this is the literal cause of the
  measured gap (16 of 17 sampled real calls non-success).

**Mechanism-claim wiring coverage (DIR-117), distinct from the AC-coverage section above:** every
component-relationship this Proposal asserts is already tagged inline as its own numbered WIRING
CLAIM (1 through 8) earlier in this Chosen mechanism section, and each of those 8 claim paragraphs
is individually paired with its own concrete AC-level evidence requirement (a fixture, a grep
guard, or a journal-count check) — see each claim's own "AC coverage needed" sentence above and the
matching Acceptance Criteria bullet below. This paragraph is a pointer to that existing per-claim
coverage, not a new, ninth summary claim requiring its own separate evidence.

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
- [ ] Canonical and `plugin/` mirrors of `prepare-milestone.js`, `milestone-preparation-check.ts`,
  `proposal-convergence.ts`, and `prepare-admission-check.ts` (+ their test files) are byte-identical
  — `cmp`/`sync-vendor.sh --check`.
- [ ] **New committed telemetry path sanitizes taskId, RED/GREEN:** a fixture with a taskId
  containing a path separator (e.g. `foo/bar` or `../evil`) proves the new
  `milestones/prepare-telemetry/<taskId>/...` write path routes the directory segment through the
  existing `_safeTaskIdSegment()` helper before use, confirming the record lands inside the intended
  `milestones/prepare-telemetry/` tree, never outside it — a stricter bar than
  `gap-decide-resume-generation-path-unsanitized-taskid`'s accepted-risk sibling case, since this
  new path is permanently git-committed rather than gitignored/ephemeral.
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
  already gets in the AC item above — PLUS a dedicated fixture proving the `missing-required-args`
  case specifically lands under `_missing-taskId/<recordId>.json` with an explicit `taskId: null`
  field (never fabricated, never dropped), distinct from the other two sites which always have a
  real taskId available.
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
  Round-4 additionally flagged: `f6db2a8` — the sibling production-crash precedent (the
  `Date.now()` clock crash, distinct from `7357a91`'s `import()` crash) cited alongside it in the
  Key design decisions' "two confirmed production incidents" sentence, confirmed real by direct
  source read of this file's own commit history.

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
- `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` (additive `nowMs` field only — WIRING CLAIM 5)
- `plugin/scripts/prepare-admission-check.ts` (additive `nowMs` field only — WIRING CLAIM 5)
- `experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs`
- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
- `plugin/test/prepare-admission-check.test.mjs`
- `plugin/test/prepare-milestone-preparation-e2e.test.mjs`
- `plugin/test/prepare-milestone-convergence.test.mjs`
- `docs/proposals/quay-prepare-execute-feedback-convergence.md`