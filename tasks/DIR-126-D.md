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
detectable. Fourth child of DIR-126's 5-way split; builds on landed [[DIR-126-A]] (Admission lease
identity — `key`/`ownerExecutionId`/`fencingToken`), [[DIR-126-B]] (Preflight verdict shape), and
[[DIR-126-C]] (the gitignored `.generation.json` record and `decideResumeGeneration`, which this
child extends, never redesigns).

### Problem framing (grounded in the current tree, verified 2026-07-30)

Direct read of `.claude/workflows/prepare-milestone.js` (794 lines, `cmp`-identical to
`plugin/workflows/prepare-milestone.js`) and `experiments/quay-perpetual-stream/scripts/
proposal-convergence.ts` (517 lines, `cmp`-identical to its `plugin/scripts/` mirror) confirms:

1. `_releaseLeaseAndRecord(stageLabel, {terminalPhase, outcome, reason, cacheable})` (defined line
   152) is called from exactly 15 sites (grep-confirmed lines 263, 273, 316, 340, 502, 545, 571,
   576, 581, 620, 636, 651, 699, 769, 778) — 13 pre-`Receipt` terminals plus `Receipt`'s own two
   (`receipt-selfcheck-failed` line 769, `prepared` line 778). Each delegates to
   `_recordGenerationCli` (lines 442-471), which reads the held lease, computes `generationId =
   sha256(taskId::ownerExecutionId::fencingToken::acquiredAt).slice(0,12)` (`_computeGenerationId`,
   line 353), writes it to `_generationPath(workspace, taskId)` =
   `.quay/prepare-leases/<taskId>.generation.json` (line 465, via `_safeTaskIdSegment()` at line
   341), then releases the lease (line 466) — all inside one shared try/catch whose catch returns
   `{ok:false}` on ANY throw without releasing the lease (a pre-existing hazard, confirmed by
   direct read, that this proposal must not worsen). `.gitignore:27` (`**/.quay/prepare-leases/`)
   confirms this whole directory is gitignored: a single mutable, per-`taskId` file that a second
   attempt silently overwrites, destroying history.
2. Three real terminal returns carry **no** telemetry today because none ever acquires an
   Admission lease and so none reaches `_releaseLeaseAndRecord`: `missing-required-args` (line 68,
   fires before Admission), `admission-check-failed` (line 180), and `prepare-already-running`
   (line 185, ordinary lease contention — confirmed distinct from `admission-check-failed` at
   lines 175-185).
3. `--decide-resume` (`_decideResumeCli`, line 387) is structurally distinct from
   `--record-generation`/`_recordGenerationCli`. Its `reuse-terminal` branch
   (`decision.decision === "reuse-terminal"`, line 415) releases the lease **inline** at line 421
   (`reason: "reuse-terminal"`) and returns without ever calling `_recordGenerationCli` — a 16th,
   structurally separate call shape that the pre-`Receipt`-sites fix cannot reach by construction.
   `CACHEABLE_TERMINALS` (line 247, confirmed exactly two entries: `PreflightContent/
   preflight-rejected` and `ProposalReview/split-recommended`) is the allowlist gating whether
   reuse is even considered; DIR-126-C's landed behavior deliberately leaves `.generation.json`
   unwritten on this branch.
4. `milestone-preparation-check.ts` already solves the identical "hash-bind an auxiliary artifact
   into the receipt, fail closed on drift" problem for a sibling artifact: `buildReceipt`'s
   `ledgerFile` param (line 73) sha256-hashes ledger content into `receipt.hashes.ledger` (via
   `ledgerHash`, line 80); `checkPreparation()`'s `if (receipt.ledgerFile) {...}` block (lines
   312-322) returns `ledger-missing`/`ledger-stale` on absence/mismatch. `git check-ignore -v
   milestones/prepare-telemetry/foo/bar.json` exits 1 (confirmed not ignored) — `milestones/` is a
   real, git-tracked tree today (`milestones/M202/preparation.json` exists on disk) — so a new
   subtree there is committable by construction, no `.gitignore` change needed.
5. Two confirmed production crashes bound what new logic may run **inside** the sandboxed
   `prepare-milestone.js` process itself: in-file comments (lines 204-205, 360-363) and commit
   history (`f6db2a8`, `7357a91`) document that dynamic `import()` and a bare `Date.now()`/
   `new Date()` fallback both crash the Workflow sandbox at runtime. Grep confirms zero live call
   sites of either pattern remain today. By contrast, `proposal-convergence.ts` runs as a real OS
   subprocess and already calls `Date.now()` directly today (e.g. `recordedAtMs: Date.now()`, line
   462) — that is fine there; the constraint is specific to code that executes inside
   `prepare-milestone.js`'s own process. Any new timestamp/durable write this proposal adds must
   ride an already-real subprocess dispatch (the existing self-reported-`nowMs` convention), never
   a new in-sandbox clock or `import()` call.
6. The contention verdict exposed for `prepare-already-running` (`{ownerExecutionId, acquiredAt,
   leaseUntil, stage}`, from `prepare-admission-check.ts`'s `checkStaleOwner`) structurally lacks
   `fencingToken`. A pre-lease/contention verdict therefore cannot derive a real, collision-safe
   `generationId` — those three sites need a weaker, attempt-scoped identity, not a fabricated
   generation ID.

Net effect: DIR-126's own measured finding — 16 of 17 sampled real `prepare-milestone` calls were
non-success — combines with the above to mean every one of the 15+3+1 real call shapes already has
the raw decision/identity material needed, but the only durable record of any of it is a single
mutable, gitignored, per-`taskId`-overwritten file, and three call shapes (the pre-lease exits plus
`reuse-terminal`) leave nothing durable at all. Capacity/bottleneck analysis is today
reconstructable only from private Claude session JSONL prose — the exact gap this milestone must
close.

### Chosen mechanism

Add one new durable, git-tracked artifact — one JSON record per dispatch **attempt**, at
`milestones/prepare-telemetry/<taskId>/<recordId>.json` — written by whichever call actually
produces a terminal outcome, covering all 15 + 1 (`reuse-terminal`) + 3 (pre-lease) = 19 real call
shapes, not only the success path. The `<taskId>` path segment MUST route through the existing
`_safeTaskIdSegment()` helper (line 341), reused verbatim: since this path is permanently
committed (unlike the gitignored `.generation.json` sibling, which accepted an
unsanitized-`taskId` risk under `gap-decide-resume-generation-path-unsanitized-taskid`),
sanitization here is load-bearing in a way it wasn't there — an unsanitized `taskId` containing
`/` or `..` could write outside the intended tree and persist that in git history.

All new logic lives in `proposal-convergence.ts` and `milestone-preparation-check.ts` — the two
files that already run as real OS subprocesses outside the sandbox. `prepare-milestone.js` only
gains new call sites into CLI submodes it already dispatches (or thin new submodes of the same
binaries) — never new fs/clock/`import()` logic of its own. DIR-126-C's `.generation.json` shape
and `decideResumeGeneration`'s evaluation order stay byte-for-byte frozen; this milestone records
what they already decided, it does not redesign them.

**Mechanism A — a committed write at every terminal outcome**, realized across five structurally
distinct call shapes (landing a strict subset reproduces exactly the gap being fixed):

- **[WIRING CLAIM A.1]** `_recordGenerationCli` gains a second write to the new committed path,
  issued **after** the existing `releaseLease(...)` call succeeds — a deliberate reversal from
  `.generation.json`'s own write-then-release ordering, and only for this new write — in its own
  try/catch separate from the block `releaseLease(...)` runs inside. A write throw can therefore
  never prevent, or retroactively invalidate, a release that already happened; it instead sets a
  distinct `telemetryWriteOk:false` field. Covers the 13 pre-`Receipt` sites; per-terminal
  dispatch count stays exactly 1. **AC needed:** a fixture forcing the new write to throw *after*
  a successful release, proving the lease still released and the call's own `ok` stays `true`; a
  real-journal-count fixture proving no site's dispatch count doubles.
- **[WIRING CLAIM A.2]** `reuse-terminal` gets its **own** write inside `_decideResumeCli` — this
  is the only call site DIR-126-C's `reuse-terminal` branch (line 415) actually returns from;
  `_recordGenerationCli` never runs for it, so this cannot be folded into A.1. New write:
  `recordId = generationId`, `decision.kind: 'reuse-terminal'`, `createsContentGeneration: false`,
  `contentAgentDispatchCount: 0`, written from the same call that already computes `generationId`
  and releases the lease inline (line 421). Must not touch `.generation.json` — resurrecting a
  write there would regress DIR-126-C's deliberate omission. **AC needed:** a dedicated fixture
  distinct from A.1's, since an implementer extending only `_recordGenerationCli` would
  structurally miss this path entirely.
- **[WIRING CLAIM A.3]** the three pre-lease exits (`missing-required-args` line 68,
  `admission-check-failed` line 180, `prepare-already-running` line 185) get a new, minimal
  `--record-attempt` CLI submode on `proposal-convergence.ts`. None of the three holds a lease and
  (per point 6 above) none can derive a real `generationId`. `--record-attempt` writes **only**
  the committed telemetry file (never `.generation.json`), keyed `recordId = attemptId =
  sha256(<fields the site's own verdict already exposes>).slice(0,12)` — structurally unable to
  collide with a real `generationId` — with `generationId: null`, `decision.kind:
  "not-evaluated"`. `missing-required-args`'s special case: `taskId` may itself be the missing
  field, so there is no valid directory key — this case routes to a fixed literal directory
  `milestones/prepare-telemetry/_missing-taskId/<recordId>.json` with an explicit `taskId: null`.
  This is the highest-value new coverage: these three sites had zero telemetry before. **AC
  needed:** a real-dispatch fixture per site at the same evidentiary bar as
  `prepare-already-running`'s existing fixture, plus a dedicated fixture for the `_missing-taskId/`
  routing.
- **[WIRING CLAIM A.4]** `Receipt`'s dispatch count grows 2→3, scoped there only. Today `Receipt`
  makes exactly 2 real dispatches per terminal: one combined `agent()` call running the `--build`
  self-check (confirmed by direct read of lines 748-766 — this runs BEFORE any telemetry record
  for the attempt exists), then the `_releaseLeaseAndRecord('prepared', ...)` call — meaning
  `Receipt` could already certify `prepared` before any generation record exists, exactly the gap
  the tamper-detection AC targets. Split into `_writeGenerationTelemetry(stageLabel, {...})` (an
  extended `--record-generation` that writes `.generation.json` AND the new committed file, no
  release) and `_releaseLease(stageLabel, {...})` (release only, no write). New flow: (1) write
  telemetry first; (2) write failure → terminal `needs-human`/`telemetry-write-failed`,
  `_releaseLease` still runs (no orphaned lease), `--build` never runs; (3) write success →
  `--build --telemetry <file>` runs against a file that provably already exists; (4) the existing
  `receiptResult.ok` check selects `receipt-selfcheck-failed` or `prepared`, `_releaseLease` runs
  once. **AC needed:** a RED/GREEN pair — forced write failure → `needs-human`, `--build` never
  invoked; forced write success → `--build --telemetry` runs against an already-existing file.
- **[WIRING CLAIM A.5]** `milestone-preparation-check.ts --build` gains `--telemetry <file>`,
  sha256-hashing it into `receipt.hashes.telemetry`, mirroring `buildReceipt`'s existing
  `ledgerHash` computation (line 80) verbatim; `checkPreparation()` gains an
  `if (receipt.telemetryFile) {...}` block mirroring the existing `ledgerFile` block (lines
  312-322) — missing file → `telemetry-missing`; hash mismatch → `telemetry-stale`. **AC needed:**
  a dedicated RED/GREEN pair mirroring the existing `ledger-stale`/`ledger-missing` tests, not
  code-shape similarity alone.

**Frozen record schema** (superset of DIR-126-C's `.generation.json` v1 fields — no renames, no
removals; `.generation.json` itself stays `schemaVersion: 1` unmodified; this new archive is
`schemaVersion: 2`):

```
{schemaVersion: 2, recordId, attemptId, generationId,
 admission: {key, ownerExecutionId, fencingToken, acquiredAt},
 workspace, taskId, milestoneId, class, highRisk,
 hashes: {charter, taskContract, proposal, reviewPolicy},
 decision: {kind, reason, priorGenerationId, priorReason, createsContentGeneration},
 contentAgentDispatchCount, contentAgentMs,
 terminal: {outcome, reason, phase, cacheable},
 leaseRelease: {attempted, ok, reason},
 sessionId, recordedAtMs}
```

`contentAgentDispatchCount`/`contentAgentMs` are flat per-generation totals, not a per-phase
breakdown array (per-phase intra-generation timing is explicitly deferred — see below) — required
by A.2's own proof that `reuse-terminal` dispatches zero content agents. `decision.kind` is
`cold|resume|reuse-terminal` for admitted attempts, `not-evaluated` (typed, never omitted) for the
three `--record-attempt` sites. Any field this milestone cannot derive for a given terminal is an
explicit `null`/`"unknown"`, never omitted or fabricated — matching the codebase's existing
provenance-flag discipline (e.g. `ledgerFile: null`).

**Mechanism B — a read-only query mode (charter-mandated).**

- **[WIRING CLAIM B.2]** a new read-only `--telemetry-report <milestoneId>` CLI mode on
  `milestone-preparation-check.ts`, scanning `milestones/prepare-telemetry/**/*.json` and
  filtering by each record's own `milestoneId` field — never by directory layout alone, since
  layout is `taskId`-primary and a re-charter'd task can carry a different `milestoneId` across
  generations under the same directory. Zero matches → `{ok: true, code: "no-records",
  milestoneId}`, never a crash. **AC needed:** an end-to-end fixture — write a real record via the
  extended write path, read it back via this exact CLI mode (not a mocked reader) — plus a
  dedicated zero-match fixture.

**Explicitly deferred, not part of this child's scope:** per-phase intra-generation timing
(`{phase, round, startedAtMs, endedAtMs}` breakdowns) and `findingCodes[]` recurrence tracking
(`recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration`). Neither phrase appears in the M203
charter text; the charter's "every phase boundary" language is read here as "every phase that can
produce a terminal outcome gains a telemetry-emit callsite" (Mechanism A's job), not granular
intra-generation timing. Both are real, separable follow-up work — filed as a dedicated deferral
task, `tasks/gap-dir126d-deferred-phase-timing-recurrence-tracking.md`, cross-referenced under
`## Touches`, rather than silently dropped or smuggled into this child's AC as scope creep.

### Concrete control and data flow

```
missing-required-args (pre-Admission, line 68)      → [A.3] --record-attempt
                                                        (generationId:null, decision.kind:"not-evaluated",
                                                         taskId:null, under _missing-taskId/)
Admission (guard, lines 175-185)
  ├─ admission-check-failed (line 180)                → [A.3] --record-attempt
  ├─ prepare-already-running (line 185, contention)    → [A.3] --record-attempt, recordId=attemptId
  └─ lease acquired
       resumeFromAdjudicatedProposal explicit true|false → skips --decide-resume entirely
       resumeFromAdjudicatedProposal omitted →
         --decide-resume (_decideResumeCli: recomputes generationId, reads prior generation record)
           ├─ reuse-terminal → same call releases lease inline (line 421, unchanged)
           │     + [A.2] new committed telemetry write (decision.kind:'reuse-terminal',
           │       contentAgentDispatchCount:0); .generation.json deliberately NOT rewritten → return
           └─ cold|resume → continue
              Preflight ×2 (_renewLease fires) → ProposalAuthors → Adjudicate →
                ProposalReview(+delta rounds) → PlanAuthor → PlanCheck(+rounds)
                (13 pre-Receipt terminals: unchanged _releaseLeaseAndRecord wrapper, one dispatch
                 each, extended --record-generation write ordered AFTER release) [A.1]
                Receipt (dispatch count 2 → 3, scoped here only) [A.4]:
                  _writeGenerationTelemetry('Receipt', {...}) FIRST [NEW]
                    ├─ write fails → _releaseLease('Receipt', {reason:'telemetry-write-failed'})
                    │     → needs-human; --build never runs; never 'prepared'
                    └─ write ok  → milestone-preparation-check.ts --build --telemetry <file>
                          [existing dispatch, now hash-binds a file that already exists] [A.5]
                        ├─ receiptResult.ok:false → _releaseLease(..., 'receipt-selfcheck-failed')
                        └─ receiptResult.ok:true  → _releaseLease(..., outcome:'prepared')

Read path (any time, no lease held):
  --telemetry-report <milestoneId> scans milestones/prepare-telemetry/**/*.json,
  filters by embedded milestoneId [B.2]
```

### Key design decisions

- Two artifacts, two lifecycles, one unchanged upstream interface: DIR-126-C's gitignored
  `.generation.json` stays exactly the input `decideResumeGeneration` already consumes; the new
  committed archive is purely additive and read by nothing upstream of it.
- Dispatch count grows only where correctness demands it: the 13 pre-`Receipt` sites and
  `reuse-terminal` keep count 1; the 3 pre-lease sites go 0→1 (pure gain, previously uncovered);
  only `Receipt` goes 2→3, because `Receipt` is the one place a silent write failure could
  otherwise be absorbed into a false `prepared` certification with no generation record to back it.
- Every new timestamp is sourced from an already-real subprocess self-report, never a new
  `Date.now()`/`new Date()`/`import()` inside `prepare-milestone.js` — a hard, grep-checked gate
  given the two confirmed production incidents, not a preference.
- `--decide-resume` and `--record-generation` are extended separately, deliberately not
  conflated: the `reuse-terminal` write belongs inside `_decideResumeCli` and must not resurrect
  the `.generation.json` write DIR-126-C intentionally removed.
- `proposal-convergence.ts` and `milestone-preparation-check.ts` are the only files gaining new
  logic; `prepare-admission-check.ts` stays untouched (its `owner` shape, confirmed lacking
  `fencingToken`, is unchanged; phase-timing there is deferred scope).
- ID scheme matches what each caller can actually prove: admitted attempts (including
  `reuse-terminal`) reuse DIR-126-C's `_computeGenerationId` formula unchanged; pre-lease/
  contention attempts hash only fields their own verdict already exposes, structurally incapable
  of colliding with a real `generationId`.
- No fabrication: any uncapturable field is recorded as an explicit `null`/`"unknown"`, never
  omitted.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| `Receipt`-path `_writeGenerationTelemetry` write fails | terminal `needs-human`, reason `telemetry-write-failed`; `--build` never runs, never `prepared` off an unwritten record |
| A pre-`Receipt` terminal's telemetry write fails (13 sites, or `reuse-terminal`) | terminal outcome unaffected (already non-`prepared`); degrades observability only, surfaced via `telemetryWriteOk:false` |
| A pre-lease `--record-attempt` dispatch fails to write | logged; original terminal outcome returned regardless — telemetry is additive, never gating on an already-terminal path |
| A field cannot be captured | explicit `null`/`"unknown"`, never omitted, never a synthesized clock value |
| Admission identity lacks `key`/`ownerExecutionId`/`fencingToken` | fail closed; no bare-session/collision-prone `generationId` ever emitted |
| Contention/pre-lease attempt (no lease held) | `generationId: null`, `recordId = attemptId`, `createsContentGeneration: false`, `decision.kind: "not-evaluated"` |
| `missing-required-args` (taskId itself absent) | record under `milestones/prepare-telemetry/_missing-taskId/<recordId>.json`, `taskId: null` |
| `reuse-terminal` record lacks a prior generation/policy hash, or has nonzero content-agent counts | schema validation fails closed → `needs-human` |
| Acquired generation terminates without a typed lease-release result | terminal stays visibly non-`prepared`; `leaseRelease.ok` never fabricated `true` |
| Receipt names a telemetry file that's missing or hash-mismatched | `telemetry-missing`/`telemetry-stale`, fails closed |
| `--telemetry-report <milestoneId>` finds zero matching records | explicit `{ok: true, code: "no-records"}`, never a crash |

### Compatibility

`preparation.json` gains only optional fields; the new `if (receipt.telemetryFile)` gate is
structurally identical to the existing `if (receipt.ledgerFile)` gate, so no existing
`checkPreparation()` path becomes stricter for a receipt that names no telemetry file. Existing
M195/M197/M200/M201/M202-shaped fixtures (none passing `--telemetry`) must stay GREEN unmodified —
an explicit AC/regression item, not an assumption. DIR-126-C's `.generation.json` shape, write
path, and `decideResumeGeneration`'s evaluation clauses (including no-write-on-`reuse-terminal`)
stay byte-for-byte untouched. Mirror sync uses two distinct, already-real mechanisms, not one:
`milestone-preparation-check.ts` and `proposal-convergence.ts` (both `.ts`) are checked via
`sync-vendor.sh --check` (its `SYNC_SCRIPTS` array names both by name); `prepare-milestone.js` (a
`.js` workflow file `sync-vendor.sh` never touches) is checked via `plugin/sync.sh && git diff
--exit-code plugin/`, the CI-wired mechanism `plugin/sync.sh`'s own header comment documents. Both
pairs are confirmed byte-identical today via `cmp`. `prepare-admission-check.ts` is untouched by
this child, so its mirror-identity is out of this child's own AC scope, though it stays true
incidentally. No retroactive backfill of pre-DIR-126 receipts.

### Risks

- `Receipt`'s dispatch-count increase (2→3) is the largest control-flow change here — mitigated by
  scoping it to `Receipt` only and reusing existing `proposal-convergence.ts` code paths for both
  new sub-dispatches (no new subprocess binary introduced).
- Sandbox `Date.now()`/dynamic-`import()` recurrence is a concrete, twice-confirmed-in-production
  crash class in this exact file (`f6db2a8`, `7357a91`) — mitigated by routing every new timestamp
  through an already-real subprocess self-report plus a grep-based regression fixture covering
  both patterns.
- `reuse-terminal`/`.generation.json` conflation risk: an implementer extending
  `_recordGenerationCli` alone (the more obvious extension point) could miss that `reuse-terminal`
  needs its own write inside `_decideResumeCli`, and could accidentally resurrect a removed
  `.generation.json` write — mitigated by naming this its own claim (A.2), not folded into A.1.
- Additive JSON fields on subprocess CLI output could collide with the workflow's noise-tolerant
  JSON parser (per `gap-prepare-milestone-noisy-agent-raw-json-parse`) — mitigated by
  additive-only field changes verified against existing fixtures.
- `--telemetry-report` correctness depends on filtering by each record's own embedded
  `milestoneId` field, not directory layout — mitigated by filtering on that field explicitly.
- The contention/pre-lease `owner` shape structurally lacks `fencingToken`, so
  contention/`admission-check-failed`/`missing-required-args` records are attempt-keyed rather
  than generation-keyed — an accepted, disclosed asymmetry, not a silently papered-over defect.
- New committed-artifact volume is small, structured JSON only; excluded from any code-volume
  "productivity" framing.

### Non-goals

Not re-implementing DIR-126-A's lease acquisition, DIR-126-B's preflight checks, or DIR-126-C's
`decideResumeGeneration`/resume logic — only recording what they already decided. Not building
DIR-126-E's capacity-report aggregation — individual records must exist and be queryable
per-attempt; cross-record aggregation is out of scope. Not fabricating token-usage fields the
harness doesn't expose. Not deriving telemetry from Claude Code session JSONL under any
circumstance. Not touching `prepare-admission-check.ts`. Not changing DIR-126-C's
`.generation.json` shape, path, or per-`taskId`-overwrite semantics, including
no-write-on-`reuse-terminal`. Not implementing per-phase intra-generation timing or
`findingCodes[]` recurrence tracking (deferred). Not implementing DIR-124-B's own
receipt-migration adapter — only shaping this record to be deterministically adaptable by a future
consumer.

### Acceptance Criteria coverage

- Real production wiring at every phase boundary and pre-lease exit, confirmed by direct source
  read (not `--selftest`-only reachability) → Claims A.1/A.2/A.3.
- Directly queryable telemetry across cold/resumed/contention/preflight-rejected/reuse-terminal →
  Claim B.2, fed by Claims A.1/A.2/A.3.
- Generation-ID non-collision across successive owners in one session → reuses DIR-126-A/C's
  landed formula unchanged; the AC exercises that reuse, not new logic.
- `reuse-terminal` measurability (hashes, prior generation ID, zero content-agent counters) →
  Claim A.2's flat `contentAgentDispatchCount: 0` field, true by construction on that path.
- Telemetry integrity (tamper → `telemetry-stale`; missing → fail-closed) → Claim A.5, direct
  reuse of `--ledger`'s code shape.
- Receipt write-before-build ordering (the one place a silent failure could produce a false
  `prepared`) → Claim A.4, RED/GREEN fixture.
- Per-terminal dispatch count stays exactly 1 for the 13 pre-Receipt sites and `reuse-terminal`,
  exactly 3 for Receipt → Claims A.1/A.2 (unchanged) and A.4 (disclosed increase), each with its
  own journal-count fixture.
- All fields present-and-typed, schema-validated fail-closed → the Defaults table plus a dedicated
  schema-validation AC item.
- Zero new `Date.now()`/`new Date()`/`import()` regression → a dedicated grep-based guard over
  this child's own diff.
- One-way DIR-124-B migration compatibility → this milestone proves its own record shape is
  deterministically adaptable; it cannot prove DIR-124-B's adapter exists.
- Byte-identical mirrors → existing `sync-vendor.sh --check` (for the two `.ts` files) and
  `plugin/sync.sh && git diff --exit-code plugin/` (for `prepare-milestone.js`), unchanged
  mechanisms.
- Backward-compat regression run → explicit AC item re-running M195/M197/M200/M201/M202-shaped
  fixtures GREEN unmodified.
- New committed telemetry path sanitizes `taskId` → reuses `_safeTaskIdSegment()`, dedicated
  RED/GREEN fixture with a path-separator `taskId`.
- `--telemetry-report` end-to-end and zero-match behavior → Claim B.2, two fixtures.

### Alternatives considered and rejected

- A second, parallel CLI dispatch (e.g. `--emit-telemetry`) alongside the unchanged
  `--record-generation` call at the 13 pre-Receipt sites. Rejected: doubles per-terminal dispatch
  count for no correctness benefit, since the already-dispatched process can perform a second
  `fs.write` in the same call.
- Splitting write/release into two dispatches uniformly at all 15+3 sites, not just Receipt.
  Rejected: the 13 pre-Receipt/`reuse-terminal` terminals are already non-`prepared` regardless of
  telemetry write outcome, so a second dispatch there buys no correctness and only adds cost; the
  split is worth paying for exactly once, where a silent write failure could otherwise slip into a
  false certification.
- Extending DIR-126-C's existing gitignored `.generation.json` into the durable archive (e.g. a
  history array). Rejected: that file is gitignored specifically because it's ephemeral, and is
  deliberately left unwritten on `reuse-terminal` — a durable, cross-session record cannot live
  somewhere designed to sometimes not be written at all.
- Hosting the new telemetry logic on `prepare-admission-check.ts`. Rejected: its
  contention-verdict `owner` shape structurally lacks `fencingToken`, so it cannot host
  generation-identity logic without a separate, out-of-scope change to that file's own output
  contract.
- A workflow-script-local `Date.now()`/injected-clock source, or a dynamic `import()`-based
  helper, anywhere in this milestone's own new code. Rejected: both are confirmed, reproducible
  production crash classes in this exact file; a test-only injected clock can never appear in a
  real JSON-serialized dispatch, so timing built on it would be test-fixture-only, never
  production-real.
- Deriving telemetry from Claude Code session JSONL. Rejected: session logs aren't checked in,
  aren't reproducible by a later auditor, and directly contradict the "checked-in workflow
  artifact, not session prose" bar this milestone exists to establish.
- A single combined mechanical+content dispatch counter. Rejected: cannot prove DIR-126-B/C's
  savings — a `reuse-terminal` record with a nonzero combined counter (from mechanical calls that
  always run) would be indistinguishable from one that also ran an expensive content agent.
- A single overwritten per-task committed telemetry file, mirroring `.generation.json`'s
  per-`taskId` overwrite semantics. Rejected: this is the literal defect being fixed — it would
  silently destroy history on every re-run of the same task.
- Writing telemetry only on the success path (today's confirmed behavior). Rejected by
  construction: this is the literal cause of the measured gap (16 of 17 sampled real calls
  non-success, no committed telemetry survives any of them).
- Implementing phase-boundary intra-generation timing and finding-recurrence tracking as part of
  this same milestone. Rejected on direct re-grep of the actual charter text: neither concept is
  named there; folding them in would be scope creep beyond what this charter's Scope section
  actually commits to, and each is real, separable follow-up work better filed as its own
  deferral task.

**Mechanism-claim wiring coverage (DIR-117):** every new call/dispatch/ownership relationship
this Proposal introduces is tagged above as its own claim — [A.1]-[A.5] under Mechanism A, [B.2]
under Mechanism B — each paired with an explicit "AC needed" note naming the concrete
fixture/grep-guard/journal-count check required, and each also appears in the Acceptance Criteria
coverage list above. Most likely to be under-proved by an implementer treating this as "just add a
write call": Claim A.1 (extended `--record-generation` write ordering relative to `releaseLease`)
and Claim A.4 (Receipt's dispatch-count 2→3 restructuring) — both require an explicit RED fixture
(forced-throw/forced-failure) proving the surrounding control flow behaves as specified, not
merely a GREEN happy-path fixture. Claims A.2 and A.3 are most likely to be silently skipped
entirely (rather than merely under-tested), since they are the two paths that do not flow through
the already-obvious `_recordGenerationCli` extension point — each needs its own dedicated fixture,
not one shared with A.1.

## Plan

`docs/plans/M203-dir-126-d.md` — 13-stage Plan authored 2026-07-30 at base revision `1170b25`,
mapping all 23 task AC items to ordered stages (schema/helpers → Claims A.1-A.5 → Claim B.2 →
generation-ID/migration proofs → regression guard → mirror sync → backward-compat run → deferral
task → real-landing verification). Depends on [[DIR-126-A]], [[DIR-126-B]], [[DIR-126-C]].

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
   check.ts` answering per-generation telemetry queries without JSONL parsing.
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
  generation, mechanical/content dispatch counts, terminal/cacheability, lease-release result, and
  generation ID — retrieved via `--telemetry-report`, without parsing `~/.claude/projects/**.jsonl`.
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
- [ ] Every emitted record's fields are confirmed present-and-typed (`null`/`"unknown"` where
  genuinely uncapturable, never omitted) — verified via schema check against a real record.
- [ ] **Stable record identity:** every record carries an explicit telemetry schema version,
  Prepare attempt/generation identity, workflow and checker-policy hashes, material-input hashes,
  mechanical/content-agent counts, and terminal outcome/reason — a stable basis a future child could
  build recurrence tracking on, without this child implementing that tracking itself (see the
  deferred `findingCodes[]`/`recurrenceKey` note under Mechanism B above).
- [ ] **One-way receipt migration:** DIR-124-B can deterministically adapt these Prepare records
  into its canonical `RunIdentity`/`StageReceiptEnvelope` without parsing prose or Claude session
  JSONL. DIR-126-D remains the Prepare telemetry producer, not a second cross-workflow receipt
  authority, and a fixture proves there is no reverse/dual-write dependency.
- [ ] Canonical and `plugin/` mirrors of `milestone-preparation-check.ts` and
  `proposal-convergence.ts` are byte-identical — `sync-vendor.sh --check` (confirmed the real
  mechanism for these two `.ts` scripts by direct read of `sync-vendor.sh`'s `SYNC_SCRIPTS` array,
  which lists both by name). Canonical and `plugin/` mirrors of `prepare-milestone.js` are
  byte-identical — `plugin/sync.sh && git diff --exit-code plugin/` (the real, CI-wired mechanism
  for workflow files per `plugin/sync.sh`'s own header comment: "CI: sync.sh && git diff
  --exit-code plugin/"; confirmed `sync-vendor.sh`'s `SYNC_SCRIPTS` array covers only `${s}.ts`
  names and never touches `.js` workflow files, so `sync-vendor.sh --check` is the wrong mechanism
  for `prepare-milestone.js`). Test files
  (`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` and
  `experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs` versus
  `plugin/test/prepare-milestone-convergence.test.mjs` and
  `plugin/test/prepare-milestone-preparation-e2e.test.mjs`) are separate, differently-named test
  suites, not byte-identical mirrors of each other, and are out of this item's scope — confirmed by
  direct `cmp`/`ls -la` (the two pairs differ at byte 4, and are 39874 vs 66350 bytes and 27156 vs
  17449 bytes respectively). `prepare-admission-check.ts` is untouched by this child (see Non-goals
  above).
- [ ] **New committed telemetry path sanitizes taskId, RED/GREEN:** a fixture with a taskId
  containing a path separator (e.g. `foo/bar` or `../evil`) proves the new
  `milestones/prepare-telemetry/<taskId>/...` write path routes the directory segment through the
  existing `_safeTaskIdSegment()` helper before use — the SAME helper `_leasePath` and
  `_generationPath` already reuse for `.generation.json`'s own path — confirming the record lands
  inside the intended `milestones/prepare-telemetry/` tree, never outside it — a stricter bar than
  `gap-decide-resume-generation-path-unsanitized-taskid`'s accepted-risk sibling case, since this
  new path is permanently git-committed rather than gitignored/ephemeral.
- [ ] **Pre-Receipt dispatch count never doubles:** a real multi-round generation's journal shows
  each of the 13 pre-Receipt `_releaseLeaseAndRecord` terminal call sites still dispatches exactly
  once per terminal (never silently doubled to 2) after the extended `--record-generation` change.
- [ ] **Receipt's real-dispatch count is exactly 3, not silently 2 or 4:** a real `prepared`
  generation's journal shows exactly 3 real dispatches for the Receipt terminal specifically
  (`_writeGenerationTelemetry('Receipt', ...)`, `milestone-preparation-check.ts --build --telemetry`,
  `_releaseLease('Receipt', ...)`) — distinct from the ordering-only RED/GREEN item below, and from
  the pre-Receipt-sites-stay-1 item above, which explicitly excludes Receipt from its own scope.
- [ ] **Pre-Receipt write-before-release ordering never orphans a lease:** a fixture that forces the
  new telemetry `fs.writeFileSync` inside `_recordGenerationCli` to throw confirms `releaseLease(...)`
  still ran and the Admission lease is not left held — the write is ordered after release, not
  before, so a write failure degrades observability only and never blocks the lease from releasing.
  Grounding: `_releaseLeaseAndRecord`'s current landed `_recordGenerationCli` catch already returns
  `{ok:false}` without releasing the lease if anything inside its try throws (confirmed by direct
  source read), which is exactly the failure mode this ordering decision avoids for the new write.
- [ ] **Pre-Receipt telemetry-write failure never misreports a successful release, RED/GREEN:** a
  fixture that forces the new telemetry write to throw AFTER `releaseLease(...)` already succeeded
  confirms `_recordGenerationCli`'s own returned `ok` still reflects the release result (`true`), not
  the write failure, because the new write runs in its own try/catch separate from the block
  `releaseLease(...)` runs inside — with the write failure surfaced via a distinct
  `telemetryWriteOk:false` field, never silently swallowed and never flipping `ok` to `false` for an
  already-successful release — unlike today's landed `_recordGenerationCli` catch, which returns
  `{ok:false}` for ANY throw inside its shared try block, confirmed by direct source read.
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
  case specifically fires *because* `taskId` itself is the missing field and lands under
  `milestones/prepare-telemetry/_missing-taskId/<recordId>.json` with an explicit `taskId: null`
  field (never fabricated, never dropped), distinct from the other two sites which always have a
  real `taskId` available.
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
  source read of this file's own commit history. Round-5 additionally flagged: `decision.kind:
  'reuse-terminal'`, `createsContentGeneration: false`, `contentAgentDispatchCount: 0` — the
  space-after-colon literal forms Claim A.2's own sentence uses (distinct, as plain text, from the
  no-space `decision.kind:'reuse-terminal'`/`createsContentGeneration:false`/
  `contentAgentDispatchCount:0` forms already covered above), naming the exact same real
  `reuse-terminal` telemetry-write fields, confirmed real by the same direct-source-read standard.
  Round-6 additionally flagged, after this round's Mechanism-B scope trim (deferring `nowMs`
  phase-timing and `findingCodes[]` recurrence tracking to a future child, per the follow-up gap task
  cross-referenced under `## Touches`): `contentAgentDispatchCount: 0` (space variant, distinct from
  the no-space form already covered above), `null`, `"unknown"` — the frozen record schema's own
  explicit no-fabrication discipline for fields this milestone doesn't derive for every terminal,
  confirmed real by direct design in this same document's Frozen record schema section. Round-7 additionally flagged two Problem-framing sentences whose full identifier
  sets were not yet co-located in one AC bullet: point 1's `_recordGenerationCli`/
  `proposal-convergence.ts`/`generationId = sha256(taskId::ownerExecutionId::fencingToken::acquiredAt).slice(0,12)`/
  `_computeGenerationId`/`_generationPath(workspace, taskId)`/
  `.quay/prepare-leases/<taskId>.generation.json`/`{ok:false}` sentence (the catch-all-throw
  `{ok:false}` behavior here is the SAME real, landed `_recordGenerationCli` catch already
  confirmed by direct source read in the write-before-release-ordering AC item above, restated here
  alongside its co-occurring identifiers so this specific Problem-framing sentence is itself
  covered); and point 3's `reuse-terminal`/`decision.decision === "reuse-terminal"`/
  `reason: "reuse-terminal"`/`_recordGenerationCli` sentence describing `_decideResumeCli`'s inline
  lease release on that branch, distinct from `_recordGenerationCli`'s own separate call shape —
  both confirmed real by direct source read of the current `proposal-convergence.ts`, the same
  standard as every round above. Round-9 additionally flagged three co-occurring identifiers from
  the same two Problem-framing/Chosen-mechanism sentences whose OTHER identifiers were already
  cited above but these three were not yet co-located in this bullet: `_safeTaskIdSegment()` (the
  sanitization helper `_recordGenerationCli`'s new committed-path write routes through, cited
  alongside `_generationPath(workspace, taskId)` in the same Problem-framing point-1 sentence and
  again in the Chosen mechanism's own taskId-sanitization paragraph);
  `milestones/prepare-telemetry/<taskId>/<recordId>.json` (the new committed artifact path itself,
  cited in the Chosen mechanism's opening sentence alongside `reuse-terminal`, already covered
  above); and `_releaseLeaseAndRecord('prepared', ...)` (the exact call-with-args form the Receipt
  phase's `prepared` terminal uses, distinct as literal text from the bare `_releaseLeaseAndRecord`
  and `_releaseLeaseAndRecord(stageLabel, {terminalPhase, outcome, reason, cacheable})` forms
  already covered above) — all three confirmed real by the same direct-source-read standard as
  every round above.

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
- `tasks/gap-dir126d-deferred-phase-timing-recurrence-tracking.md`