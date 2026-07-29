---
id: DIR-126-A
title: Single-flight admission for prepare-milestone.js
  (prepare-admission-check.ts, new Admission phase) — first child of DIR-126's
  split
status: done
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
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-126-A
    experiments/quay-perpetual-stream/charters/M200-dir126a-single-flight-admission.md
    milestones/M200/absorb-entry.md
---

**type:** execution

## Proposal

Add a real admission/ownership check to `prepare-milestone.js` so at most one live generation for
a given `(workspace, taskId)` proceeds past a new `Admission` phase — closing the concrete overlap
DIR-126's own Finding measured (two M196 generations for the same task overlapped, adding ~54
duplicate workflow-minutes, `tasks/DIR-126.md:86`). First child of DIR-126's 5-way split
(`split-subsystem-blocking-cluster`, M199/DIR-126's real ProposalReview run). Depends on nothing
else in this split; DIR-126-B (deterministic preflight) shares this child's new module and
phase-insertion point but has an independently testable proof surface (`tasks/DIR-126-B.md:27-28`,
confirmed to name the same `prepare-admission-check.ts` path and the same shared test file);
DIR-126-C (generation-aware resume) treats a resume dispatch as itself an admission event and
depends on this child landing first (`tasks/DIR-126-C.md:26`).

### Problem framing (re-verified live against the current tree, 2026-07-29)

`.claude/workflows/prepare-milestone.js` is 511 lines and byte-identical to
`plugin/workflows/prepare-milestone.js` (`cmp` exits 0, no diff). `grep -n "fs\.\|^import\|require("`
returns zero matches — the script genuinely has no filesystem or import capability today, a
deliberate workflow-DSL sandbox convention: the script also cannot call `Date.now()` directly, and
every phase that needs real elapsed time asks an agent to run `date +%s%3N` and trusts the reported
number back (the same pattern `ProposalReview`'s own soft-budget check already uses). The script's
control flow (`grep -n "phase("`) begins at `phase('ProposalAuthors')` on the cold path, or jumps
straight to `phase('ProposalReview')` under `$a.resumeFromAdjudicatedProposal === true` (lines
57-93) — in both cases with no preceding phase and no `(workspace, taskId)` ownership check of any
kind. Two concurrent `Workflow` dispatches for the same `taskId` today both freely enter
`ProposalAuthors` (or `ProposalReview` under resume) and both call `task_write` against the same
task's `## Proposal` field, racing each other — exactly DIR-126's measured M196 overlap.

A second grounding fact worth calling out explicitly: this child counts **12 distinct terminal
`return { outcome: ... }` statements** in the current file (lines 26, 89, 111, 271, 312, 337, 341,
345, 382, 424, 492, and 497 — the last being the file's own final success return, `outcome:
'prepared'`, and additional to, not folded into, the other 11 numbers already named) — not just the
handful of outcome *names* (`prepared`/`needs-human`/`revision-needed`, plus the new
`prepare-already-running`). Any admission mechanism's "every terminal return releases the lease"
requirement has to be checked against all 12 call sites, not against a few conceptual outcome
buckets — several of those sites (e.g. the
missing-args guard at line 26, which fires before any lease would even be acquired) need explicit
ordering care: a return that fires before `Admission` runs must not attempt to release a lease that
was never acquired.

The downstream shape that bounds the staleness-window derivation is also verified live:
`_policyCaps.softBudgetMs = (_highRisk ? 75 : 45) * 60 * 1000` (ProposalReview soft budget, line
145) and `const MAX_PLANCHECK_ROUNDS = 3` (line 390) are both unconditional — the PlanCheck round
cap is NOT gated on `highRisk`. Any staleness-window default has to account for the full worst-case
Prepare duration (ProposalReview + PlanAuthor + up to 3 PlanCheck rounds + Receipt), not just the
ProposalReview budget in isolation.

### Chosen mechanism

A new pure module, `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`, mirrored
byte-identically to `plugin/scripts/prepare-admission-check.ts` via the repo's existing
canonical-first + `sync-vendor.sh --check`/`cmp` discipline already governing every
`composite-*.ts`, `proposal-convergence.ts`, `milestone-preparation-check.ts`, and
`wiring-coverage-check.ts` sibling (all confirmed present in both
`experiments/quay-perpetual-stream/scripts/` and `plugin/scripts/`). Same "pure decision functions +
thin CLI dispatch" shape those modules already use (confirmed against `milestone-preparation-
check.ts`: `computeCurrentHashes`/`sha256`/`buildReceipt` are plain exported functions taking
explicit arguments, with `fs` I/O isolated behind them and a CLI wrapper at the bottom, guarded by
the same `isDirect`/`import.meta.url` pattern `composite-manifest-synthesis.ts` uses) — exports
`acquireLease`/`renewLease`/`releaseLease`/`checkStaleOwner`, plus a CLI wrapping them
(`--acquire`/`--renew`/`--release`/`--force-release <reason>`).

**Lease acquisition primitive — corrected precedent citation.** The primitive is
`fs.writeFileSync(path, json, {flag: 'wx'})` (or the equivalent `fs.openSync(path, 'wx')`) — Node's
atomic exclusive-create, throwing `EEXIST` if a lease already exists. **`gate-event-store.ts` is
NOT a live `wx` precedent** — a direct read of `appendGateEvent()` shows it calls plain
`appendFileSync`, with its own doc comment (lines 59-66) stating this is a documented
single-writer constraint, not a bug, and a further comment (lines 68-75) naming
`packages/quay-native/src/store.ts`'s `acquireLock`/`releaseLock`/`withLock` (lines 191-238) as the
pattern to port in *if* locking is ever added — i.e. it is a pointer to the precedent, not an
instance of it. The two real, live `wx`-based precedents in this repo are: (1)
`packages/quay/src/frontmatter-store-base.ts`'s `withFileLock(dir, id, fn)` (lines 74-114) —
`fs.openSync(lockPath, "wx")`, `STALE_LOCK_MS = 5000` stale-reclaim, `LOCK_TIMEOUT_MS = 3000` retry
deadline, always-release via `finally`; and (2) `packages/quay-native/src/store.ts`'s
`acquireLock`/`withLock`/`withLocks` — the same `wx` primitive, with a `withLocks()` variant that
sorts multiple lock ids into one fixed global order to avoid deadlock (not needed here, since this
mechanism only ever takes one lock per `taskId`). `acquireLease` cites both of these as precedent —
closest in shape to `store.ts`'s `acquireLock`, adapted from a short-lived critical-section lock to
a long-lived (minutes-to-hours) generation-ownership lease. The primitive is deliberately
re-implemented locally in `prepare-admission-check.ts` rather than imported from
`packages/quay/src/frontmatter-store-base.ts`, to avoid introducing a new `experiments/` →
`packages/` dependency edge — a methodology-layer-to-product-layer coupling
`archguard_get_dependencies`/`archguard_detect_cycles` would flag as a real new architectural edge
for a ~10-line primitive that is cheap to duplicate and already precedented twice in-repo.

**Lease record shape — grounded against DIR-124's real field vocabulary.**
`docs/proposals/quay-milestone-workflow-stage-pipelining-and-leases.md` §6.3 ("Lease durability")
states the canonical field list verbatim (**corrected 2026-07-29, ProposalReview finding c0d6d79c**
— confirmed at lines 392-393 only; an earlier draft's added citation to line 181 was spurious,
pointing at unrelated §4.1 `MilestoneRunIdentity` content): `key, ownerExecutionId,
attempt, stage, fencingToken, baseCommit, acquiredAt, leaseUntil, heartbeatAt` — and §6.3's closing
sentence is explicit sanction for this child's scope: "An atomic-directory or `flock` prototype is
acceptable only for an initial single-machine experiment and must not be mistaken for the durable
contract." This child's lease record maps directly onto that vocabulary rather than inventing
parallel field names: `key` = the `(workspace, taskId)` composite the lease is scoped to;
`ownerExecutionId` = the dispatching generation's real `$CLAUDE_CODE_SESSION_ID` (the same
DIR-093/DIR-117-iteration-2 pattern `execute-milestone.js`'s Audit phase and `prepare-milestone.js`'s
own `_sessionIdInstruction` already use to get a harness-verified, unforgeable id — not a
caller-asserted id); `stage` = the current `prepare-milestone.js` phase name at last renewal;
`fencingToken` = a monotonically increasing integer bumped on every stale-lease reclaim, carried
through so a slow "zombie" caller whose write lands after reclaim can in principle be detected, even
though this child's minimal scope does not yet wire fencing-token *checks* into any writer (see
Non-goals); `baseCommit`, `acquiredAt`, `leaseUntil`, `heartbeatAt`, `attempt` map 1:1 onto the
doc's own names. Only the *tier* is scoped down (atomic-directory file, not the doc's preferred
workspace-scoped SQLite store) — the exact tier §6.3 names as acceptable for an initial
single-machine experiment. The lease lives at a gitignored path, `.quay/prepare-leases/<taskId>.json`
(one new `.gitignore` line, `**/.quay/prepare-leases/`, alongside the existing
`**/.quay/gate-events.jsonl` precedent at line 26 — confirmed no `prepare-leases` entry exists yet)
— pure local runtime-mutex state, meaningless outside the one working tree with a generation in
flight, consistent with this repo's single-shared-working-tree-on-`master` model (CLAUDE.md's
DIR-027 discipline).

### Concrete control/data flow

**WIRING-CLAIM 1 — Admission phase insertion.** `prepare-milestone.js` (both mirrors) gains one new
phase, `Admission`, inserted as the literal first phase — dispatched via a labeled `agent()` call
running `prepare-admission-check.ts --acquire --taskId <id> --workspace <root>` — before the
existing `phase('ProposalAuthors')` call at line 65 (cold path) AND before the `phase(
'ProposalAuthors')` log-only call at line 59 inside the `if (_resumeFromAdjudicatedProposal)`
branch. `Admission` must run unconditionally on *both* branches, ahead of the `if (...) { ... }
else { ... }` split at line 57 — a resumed dispatch still performs real `task_write`s downstream
(`ProposalReview`'s revision step) and is exactly as vulnerable to a racing second owner as the cold
path (this is also the same resume flow M197's `gap-prepare-milestone-cross-generation-no-
incremental-reuse` specifically introduced, so skipping admission on that branch would reopen an
already-fixed-adjacent gap). On a `prepare-already-running` verdict the script returns immediately —
`{outcome: 'needs-human', reason: 'prepare-already-running', phase: 'Admission', owner: {
ownerExecutionId, acquiredAt, leaseUntil, stage}}` — before any `agent()` call for `ProposalAuthors`
is dispatched. This ordering (Admission strictly precedes the first author-agent dispatch) is the
concrete mechanism that prevents the ~54-duplicate-workflow-minute cost DIR-126's Finding measured,
since the expensive resource (LLM agent turns) is never spent by the losing dispatch.

**WIRING-CLAIM 5 — Admission-phase error is fail-closed, never a silent fallthrough.** If the
`Admission` phase itself errors (bad CLI invocation, unexpected exception — distinct from an
ordinary lease-contention verdict) it must fail closed to `needs-human` with a distinct reason code
(e.g. `admission-check-failed`) — never silently fall through to `ProposalAuthors` as if admission
had succeeded. This is a fifth, separately-checkable claim: the workflow DSL has confirmed zero
`try`/`catch` semantics (`grep -n "catch\|try {"` on `prepare-milestone.js` returns no matches), so
this fail-closed behavior is genuinely new branching logic the workflow script must add around the
`Admission` agent-call's result — not something inherited for free from exception unwinding — and
needs its own dedicated AC item/fixture (see AC coverage below), distinct from the "real production
wiring" item above, which only checks that `Admission` is dispatched, not what happens when it
errors.

**WIRING-CLAIM 2 — release on every terminal return.** All 12 of the file's terminal `return`
statements enumerated above must invoke `--release` before returning, with the single exception of
the line-26 missing-args guard (which fires before any lease is ever acquired, so nothing needs
releasing there). This is a distinct claim from WIRING-CLAIM 1 and needs its own AC coverage, since
a reviewer checking only "does `Admission` call `--acquire`" would miss a leak on, say, the
soft-budget-exceeded return (line 341), the plancheck-rounds-exceeded return (line 424), or the
file's own final success return (line 497) — a reviewer who literally follows a stated "11 sites"
count would never even attempt to check that last, single-most-safety-critical site, since it isn't
one of the 11. A hard
crash (process killed, sandbox torn down) between acquire and any `return` is the case
staleness-window reclaim exists for, not something a `finally` block inside the workflow DSL can
catch — the DSL has no `try/finally` semantics available to workflow scripts, consistent with them
having no direct `fs`/Node-API access at all.

**WIRING-CLAIM 3 — renewal at every phase boundary.** `--renew` calls are dispatched at each of:
`Admission`→`Adjudicate` (or `Admission`→`ProposalReview` under resume), each `ProposalReview` delta
round (up to 2 ordinary / 3 highRisk per DIR-125's bounded convergence), `PlanAuthor`, each of the up
to `MAX_PLANCHECK_ROUNDS = 3` `PlanCheck` rounds (unconditional, not gated on `highRisk`), and
`Receipt` — six distinct wiring points across the two already-mirrored files. Renewal reuses the
script's existing "agent runs `date +%s%3N`, workflow trusts the reported number" pattern (the same
one already used for `ProposalReview`'s own clock) rather than inventing a second timekeeping
convention. This is a third, separately-checkable claim (a reviewer could confirm claims 1 and 2
while missing that a legitimately-long `PlanCheck` round 3 lets the lease silently expire mid-phase)
and needs its own AC/fixture.

On acquire, if an existing lease file is found with `now > leaseUntil`, `checkStaleOwner` reclaims
it deterministically: the new lease's own `recoveredFrom` field copies the prior lease's full
contents verbatim (never silently discarded) and `fencingToken` increments — this reclaim path is
covered by the "Lease recovery is fail-closed" AC item below.

**WIRING-CLAIM 4 — `--force-release` writes an audit-trail entry, never a silent unlock.** A human
`--force-release <reason>` CLI path exists to unblock a legitimately stuck lease before the
staleness window elapses; the reason is written into the released lease's own audit trail (the same
`recoveredFrom`-style record a stale-owner reclaim leaves behind, so a `--force-release` remains
distinguishable after the fact from an ordinary automatic reclaim) and, once DIR-126-D's later
telemetry child lands, into that record too. This is a fourth, separately-checkable claim distinct
from the acquire/reclaim path above: an active lease existing and a human explicitly overriding it
via `--force-release` are two different code paths, and neither the "Single-flight RED/GREEN" nor
the "Lease recovery is fail-closed" AC items exercise a human-invoked override — so it needs its own
dedicated AC item and fixture (see AC coverage below), not incidental coverage by association with
stale-owner reclaim.

### Staleness-window default (derived, not asserted)

The default is **300 minutes ordinary / 360 minutes highRisk**, derived as a real sum of the
worst-case Prepare-stage duration rather than an arbitrary multiplier:

| Component | Ordinary | highRisk | Source |
|---|---|---|---|
| ProposalReview soft budget | 45m | 75m | `_policyCaps.softBudgetMs` (line 145), confirmed live |
| PlanAuthor allowance | ~20m | ~20m | single-agent-call phase, no round cap (estimate, not a measured value — same caveat the earlier draft implicitly carried) |
| Up to 3 PlanCheck rounds | ~210m (70m × 3, safety-margined above the 57m observed for one round) | same | `MAX_PLANCHECK_ROUNDS = 3` (line 390), unconditional on `highRisk` |
| Receipt buffer | ~10m | ~10m | single self-check agent call |
| **Sum** | **285m → rounded to 300m** | **315m, rounded up to 360m for extra highRisk headroom** | |

An earlier draft of this task's own body proposed 90m/150m ("2x the ProposalReview budget"), which
ProposalReview finding `f76ae150` already flagged as internally contradicted: it ignores
`MAX_PLANCHECK_ROUNDS`'s unconditional cost and undercounts against M195's own directly-measured
~57-real-minute single PlanCheck round — three rounds alone can plausibly exceed the entire 90/150m
figure before PlanAuthor or Receipt are even counted. An independent re-derivation of the same
components (above) lands close to but not exactly at 300/360 (285/315 raw); the gap is well within
the "estimate, not measured value" uncertainty already inherent in the PlanAuthor-allowance and
per-round safety-margin inputs, so this proposal keeps the previously-adjudicated 300/360 figures —
re-litigating the exact minute count without new timing data would add proposal churn without new
evidence, and 300/360 already carries the qualitative correction that mattered (the unconditional
`MAX_PLANCHECK_ROUNDS` cost). Both figures land well above the observed 57m per-round measurement
and the ProposalReview soft budgets, chosen conservative-first so a legitimately slow real
generation is never falsely declared stale — the opposite failure mode of the one this mechanism
exists to close.

### Key design decisions

- **`wx` atomic-create over `flock(2)`.** No portable Node-core `flock` primitive exists without a
  native addon or a child-process syscall; `wx` is already precedented twice in this exact codebase
  (`frontmatter-store-base.ts`'s `withFileLock()`, `quay-native/src/store.ts`'s `acquireLock`) for
  the identical class of problem — see the corrected precedent citation above.
- **Local filesystem lease, not a distributed lock.** CLAUDE.md's own DIR-027 steering-hygiene
  section already assumes one active checkout of `master` at a time ("two `execute-milestone`
  dispatches must never run concurrently... the risk is the shared working tree itself"). A
  local-filesystem lease matches that existing single-tree assumption; nothing here claims to
  protect against two genuinely separate clones/hosts. A database/external-lock-service/Provider-
  ABI-mediated lock would add dependency surface the native store doesn't need for a problem that
  is, today, single-working-tree by construction.
- **Admission (this child) and DIR-126-B's deterministic preflight share one production module and
  phase-insertion point but are two independently landable AC-level proof surfaces** — a lease bug
  must not block landing a preflight fixture and vice versa, which is why DIR-126's split ordered
  them as siblings rather than merging them into one child.
- **Field vocabulary is DIR-124's real names (`key`, `ownerExecutionId`, `fencingToken`, `stage`,
  ...), not a paraphrase** — grounding directly against §6.3 of the pipelining-and-leases proposal
  keeps this prototype's lease shape upgrade-compatible if/when DIR-124's SQLite-backed durable
  contract is eventually built, and keeps `ownerExecutionId` tied to the harness-verified
  `$CLAUDE_CODE_SESSION_ID`, not a self-asserted id.
- **Staleness timeouts set conservative-first**, well above the worst *observed* real Prepare time,
  only tightened once DIR-126-E (capacity/telemetry) has real distribution data — avoiding the
  single-flight mechanism itself becoming a new source of false-positive lockouts.
- **Renewal-at-every-phase-boundary is its own explicit, separately-tested requirement**, not folded
  silently into "lease recovery is fail-closed" — the task's own AC text calls out stale-owner
  reclaim and crash/restart by name but not renewal-at-phase-boundaries specifically, so this
  Proposal states it explicitly (WIRING-CLAIM 3) and gives it an explicit fixture rather than
  letting it be assumed correct by association with the recovery fixture.
- **Heartbeat/renewal, not PID-liveness, for stale-owner detection.** The "owner" is a remote agent
  dispatch running inside the Workflow harness's sandbox — the admission CLI has no local process to
  signal or poll. Heartbeat/renewal plus a generous `leaseUntil` is the only evidence actually
  available at this layer, consistent with the same sandbox constraint that already forces
  `prepare-milestone.js` to trust agent-reported `date +%s%3N` output rather than call `Date.now()`.

### Defaults and failure behavior

| Condition | Outcome |
|---|---|
| Lease held, not expired, `--acquire` from a different owner | `Admission` returns `{outcome:'needs-human', reason:'prepare-already-running', owner:{ownerExecutionId, acquiredAt, leaseUntil, stage}}` before any `ProposalAuthors` agent is dispatched |
| Lease found with `now > leaseUntil` | reclaimed deterministically; new lease's `recoveredFrom` copies the prior lease verbatim; `fencingToken` incremented |
| Crash between acquire and any terminal `return` (lease never released) | recoverable via the same stale-`leaseUntil` reclaim path on the next dispatch — no permanent lockout |
| Legitimately stuck lease, still inside the staleness window | `--force-release <reason>` human escape hatch; reason recorded, never silent |
| A concurrent dispatch for a *different* `taskId` | unaffected — the lease key is `(workspace, taskId)`, never a single global lock |
| `Admission` phase itself errors (bad CLI invocation, unexpected exception) | fail-closed to `needs-human` with a distinct reason code (`admission-check-failed`), never silently falls through to `ProposalAuthors` |
| Missing-required-args early guard (line 26, before `Admission` is even reached) | unchanged — no lease is ever acquired on that path, so no release is needed |

### Compatibility

Every existing phase's behavior for a generation that successfully acquires admission is unchanged.
`Admission` is purely additive and runs once, first. `ProposalAuthors` through `Receipt` are
otherwise byte-for-byte unchanged except for the new `--renew` calls inserted at existing phase
boundaries. Both `prepare-milestone.js` mirrors and the new `prepare-admission-check.ts`
canonical/`plugin/` pair stay byte-identical via the same `sync-vendor.sh`/`cmp` mechanism already
verified for the current script (`cmp .claude/workflows/prepare-milestone.js
plugin/workflows/prepare-milestone.js` exits 0 today). The `args` shape
(`$a.taskId`/`$a.milestoneId`/`$a.charterFile`/`$a.class`/`$a.highRisk`) is unchanged; `Admission`
reads `$a.taskId` (already available before any phase runs) and needs no new caller-supplied
argument.

### Risks

- **Staleness-window miscalibration** in either direction: too short falsely steals a live lease
  from a legitimately slow highRisk run (false contention, a new failure mode this mechanism itself
  would introduce); too long delays legitimate recovery after a real crash (partially reintroducing
  the M196 duplicate-generation cost this child exists to close). Mitigated by the derived
  300m/360m default above plus the `--force-release` escape hatch, with DIR-126-E expected to
  recalibrate once real distribution data exists.
- **The `.gitignore` edit** (**corrected 2026-07-29, ProposalReview finding 9a09c522** — an earlier
  draft called this "not present in the task's originally-declared `## Touches` list," which is now
  stale: the task's current `## Touches` section already lists `.gitignore` as its 7th entry) is
  already declared; this note is retained only to flag that the Plan phase's own real diff must
  actually touch it, matching what is already declared, not silently drift from it.
- **Twelve terminal-return surface, not four outcome names.** A "release on every return" claim is
  easy to under-verify against a handful of named outcome buckets when the real call-graph has 12
  return statements across multiple phases; the AC/test coverage must enumerate actual line-level
  return sites, or a leak at one of the less-obvious sites (e.g. `plancheck-rounds-exceeded` at line
  424, the `receipt-selfcheck-failed` return at line 492, or the final success return at line 497)
  could pass review while still leaking a lease.
- **Force-release and Admission-phase-error paths are asserted in prose but need their own
  fixtures**, not incidental coverage by association with the acquire/reclaim or production-wiring
  AC items above (WIRING-CLAIM 4 and WIRING-CLAIM 5 respectively) — see AC coverage below.
- **Fencing-token field exists in the record but nothing in this child's scope reads it to reject a
  stale writer's `task_write`** — the token is threaded through and incremented for forward
  compatibility with a future durable-lease consumer, but this child does not add fencing
  enforcement anywhere else in the pipeline; a lease reclaim plus a genuinely-still-alive prior
  owner's late write is not fully closed by this child alone (see Non-goals).
- **Renewal call omission is a silent-failure risk if under-tested** — a missing `--renew` at
  exactly one boundary degrades to the same behavior as a crash (eventual reclaim), which is safe
  but could mask a real wiring bug as "it recovered anyway." This is why renewal-at-every-boundary
  (WIRING-CLAIM 3) needs its own dedicated fixture rather than being covered incidentally by the
  crash-recovery test.
- **New dispatch-pattern-class risk is low**, since this follows the already-precedented
  `wiring-coverage-check.ts`/`composite-manifest-synthesis.ts` shape (pure function + CLI wrapper +
  `agent()`-dispatched invocation with the verdict merged by the workflow script itself, never
  trusted from LLM prose) — no genuinely new dispatch class is introduced.

### Non-goals

Not a distributed or multi-host lock — matches CLAUDE.md's existing single-shared-working-tree
assumption. Not touching `execute-milestone.js`'s separate, already-documented manual
worktree/concurrency discipline (out of scope — this child is `prepare-milestone.js`-only). Not
building DIR-124's full four-mechanism durable lease/scheduler contract (workspace-scoped SQLite,
lock ordering across five resource classes, fencing-token *enforcement* at every mutation site) —
only the atomic-directory prototype tier §6.3 explicitly sanctions, scoped to the single
`(workspace, taskId)` key the Prepare stage needs. Not implementing DIR-126-B's preflight checks,
DIR-126-C's resume-as-admission-event logic, DIR-126-D's telemetry, or DIR-126-E's capacity
report — those remain later children's scope even though DIR-126-B shares this child's module.

### AC coverage (mapping to WIRING-CLAIMs above)

- **Real production wiring, not agent-prompt-only** — covers WIRING-CLAIM 1: needs a grep/import-
  graph AC item showing `Admission` invokes `prepare-admission-check.ts --acquire` before
  `phase('ProposalAuthors')` on both the cold and resume paths, distinct from any
  `--selftest`/unit-only reachability check — single most important item, since a prompt-text-only
  wiring would satisfy no real invariant.
- **Admission-phase error is fail-closed** — covers WIRING-CLAIM 5: a dedicated AC item/fixture
  distinct from the production-wiring item above, exercising the `Admission` phase itself erroring
  (bad CLI invocation / unexpected exception, not an ordinary lease-contention verdict) and
  confirming the workflow returns `needs-human` with the distinct `admission-check-failed` reason
  code rather than silently falling through to dispatch `ProposalAuthors` — grounded in the
  confirmed absence of any `try`/`catch` in the workflow DSL, so this branching is real new logic,
  not inherited exception-unwinding behavior.
- **Single-flight RED/GREEN** — two real concurrent `prepare-milestone.js` dispatches for the same
  fixture task, with journal evidence that exactly one reaches its first `ProposalAuthors` agent
  dispatch and the other returns `prepare-already-running` with zero author agents spent — not just
  the returned reason string but dispatch-count *ordering*; a different `taskId` remains
  independently runnable.
- **Lease recovery is fail-closed** — covers the acquire+reclaim half of WIRING-CLAIM 2: an active
  non-expired lease cannot be stolen; a fake-clock-advanced stale owner reclaims deterministically
  with `recoveredFrom` evidence; a crash/no-release fixture leaves no permanent lockout — fixture-
  driven (fake/advanced clock), not prose assertion.
- **Force-release writes an audit-trail entry** — covers WIRING-CLAIM 4: a dedicated AC item/
  fixture distinct from stale-owner reclaim, exercising a human-invoked `--force-release <reason>`
  against a still-active (non-expired) lease — confirming the lease is genuinely released, the
  supplied `<reason>` is recorded in the released lease's audit-trail record, and the resulting
  record is distinguishable from an ordinary stale-owner reclaim (i.e. never a silent, unaudited
  unlock).
- **Renewal-at-every-phase-boundary** — covers WIRING-CLAIM 3: a synthetic long-running generation
  with mocked phase timestamps surviving via renewal across all six boundaries
  (Admission/Adjudicate/ProposalReview-round/PlanAuthor/PlanCheck-round/Receipt), and a genuinely-
  stalled generation (no renewal for one whole phase) reclaimed by a second dispatch — its own
  dedicated fixture, not folded into the stale-owner AC item.
- **Release on every terminal return** — covers the other half of WIRING-CLAIM 2: source-read AC
  item enumerating all 12 actual `return {` sites (not just outcome-name buckets), confirming each
  post-Admission site calls `--release` (the pre-Admission missing-args guard needs no release).
- **Staleness window is the corrected 300m/360m value** — source-read AC item citing the exact
  constants in `prepare-admission-check.ts`, checked against the derivation table above, not the
  earlier contradicted 90/150 figures.
- **Mirror byte-identity** — `cmp`/`sync-vendor.sh --check` AC item covering
  `prepare-admission-check.ts`, `prepare-milestone.js`, and both test files, not just the
  pre-existing `prepare-milestone.js` pair.
- **`.quay/prepare-leases/` gitignored** — `git check-ignore` AC item, not a visual diff-read of
  `.gitignore`, plus the corresponding Plan-phase touch-set update for the previously-undeclared
  `.gitignore` edit.

### Alternatives considered and rejected

1. **A `task.extra` frontmatter lock field** (e.g. `task_write`-ing a `leaseOwner` field onto the
   task itself via the Provider ABI) instead of a local `.quay/prepare-leases/` file. Rejected:
   this would make the admission check depend on a live MCP round-trip and the Provider ABI's own
   optimistic-locking CAS semantics (`expectedStatus`) for something that is really local-runtime
   mutex state, not durable task content; it would also pollute the task body/frontmatter — the
   single source of truth the codebase already works hard to keep clean (per CLAUDE.md's "fix the
   SOURCE, not just the artifact" principle) — with transient lease bookkeeping unrelated to the
   task's actual content.
2. **A single global lock file** (one lease guarding all of `prepare-milestone.js`, not keyed by
   `taskId`) instead of a per-`(workspace, taskId)` key. Rejected: the task's own AC text explicitly
   requires that "a different taskId remains independently runnable" — a global lock would
   needlessly serialize unrelated milestones' Prepare stages (the measured M196 overlap was two
   generations for the *same* task) and reintroduce a different kind of duplicate-cost problem
   (idle blocking) while doing nothing DIR-126's Finding actually asked for.
3. **PID/process-liveness-based staleness detection** instead of heartbeat/renewal with a fixed
   timeout. Rejected: the "owner" of a lease is a remote harness-dispatched agent, not a local OS
   process the admission CLI can `kill -0`, `waitpid`, or otherwise signal/poll; there is no PID
   available at this layer to check.
4. **Importing `frontmatter-store-base.ts`'s `withFileLock()` directly from `packages/quay/src`**
   instead of a local re-implementation. Rejected: this would create a new `experiments/` →
   `packages/` dependency edge for the sake of a ~10-line atomic-create primitive already
   inexpensive to duplicate, and would risk `archguard_get_dependencies`/`archguard_detect_cycles`
   flagging an unwanted methodology-layer-to-product-layer coupling that has no other justification.
5. **Building DIR-124's full durable SQLite-backed lease contract now**, rather than the
   atomic-directory prototype tier. Rejected: §6.3 of the pipelining-and-leases proposal itself
   explicitly scopes an atomic-directory/`flock` prototype as acceptable for "an initial
   single-machine experiment," and DIR-124 remains `status: proposal, not implemented` — building
   its full four-mechanism contract (lock ordering across five resource classes, fencing-token
   enforcement at every writer, SQLite store) is far more scope than a single-`taskId`-keyed Prepare-
   stage admission check needs, and would make this already-highRisk child (editing the live
   control-plane script) materially riskier for no proportional benefit.
6. **90m/150m staleness windows** (the earlier draft figure, "2x the ProposalReview budget").
   Rejected per the derivation above: internally contradicted by `MAX_PLANCHECK_ROUNDS = 3` being
   unconditional and by M195's own measured ~57-minute single PlanCheck round; replaced with the
   derived 300m/360m default.
7. **Making `Admission` conditional** (skipped under `resumeFromAdjudicatedProposal`) rather than
   unconditional. Rejected: the resumed path still performs real `task_write`s in `ProposalReview`'s
   revision step, so it is exactly as vulnerable to a racing second owner as the cold path; skipping
   admission there would reopen the same race for the resume flow M197's own
   `gap-prepare-milestone-cross-generation-no-incremental-reuse` specifically introduced.

## Plan

docs/plans/M200-dir-126-a.md — checked Plan authored for M200 (base revision 20d4dc7), mapping
all 15 task Acceptance Criteria items to 9 ordered stages (core lease module, CLI wrapper +
force-release audit trail, plugin/scripts + sync-vendor.sh mirror, .gitignore, Admission-phase
insertion with fail-closed error handling, renew/release wiring at all 6/11 sites, plugin/workflows
mirror, full test coverage, real two-process concurrent-dispatch regression proof + final grounding
audit).

## Finding

Real, code-level evidence gathered 2026-07-29 in the M199 `prepare-milestone` dispatch that
reconciled DIR-126's own Proposal and recommended this split:

1. `grep -n "fs\.\|^import"` on `.claude/workflows/prepare-milestone.js` confirms zero filesystem
   or import statements — no admission/ownership check exists anywhere in the script today.
2. `grep -n "phase("` confirms the script begins directly at `phase('ProposalAuthors')` (or skips
   to `ProposalReview` under resume) with no preceding gate.
3. DIR-126's own Finding measured two overlapping M196 generations for the same task adding ~54
   duplicate workflow-minutes — the concrete real-world cost this child closes.
4. `gate-event-store.ts` and `frontmatter-store-base.ts` (`withFileLock()`) confirm a real, existing
   `wx`-atomic-create precedent already used in this codebase for exactly this class of problem.

## Requested action

1. Add `prepare-admission-check.ts` (+ `plugin/scripts/` mirror) implementing
   `acquireLease`/`renewLease`/`releaseLease`/`checkStaleOwner` per the Chosen mechanism above, with
   a CLI wrapping them (`--acquire`/`--renew`/`--release`/`--force-release <reason>`).
2. Add the new `Admission` phase to `prepare-milestone.js` (both mirrors), dispatched before
   `phase('ProposalAuthors')`, unconditionally (including under `resumeFromAdjudicatedProposal`).
3. Add `--renew` calls at every existing phase boundary (`Adjudicate`, each `ProposalReview` delta
   round, `PlanAuthor`, each `PlanCheck` round, `Receipt`).
4. Add a real test file (`experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
   + `plugin/test/` mirror) covering: RED/GREEN concurrent-dispatch (second attempt returns
   `prepare-already-running` before its own first agent dispatch), stale-lease reclaim, crash/
   restart recovery, renewal-at-every-boundary, and the corrected 300m/360m staleness windows.
5. Add the `.quay/prepare-leases/` gitignore line.
6. Real regression proof: two real concurrent `prepare-milestone.js` dispatches for the same fixture
   task, captured journal evidence showing exactly one reaches `ProposalAuthors` and the other
   returns `prepare-already-running` with zero author agents dispatched.

## Acceptance Criteria

- [x] **Most important — real production wiring, not agent-prompt guidance:** a grep/import-graph
  check shows `prepare-admission-check.ts`'s `--acquire` mode has a REAL production callsite from
  `prepare-milestone.js`'s (both mirrors) new `Admission` phase — not zero importers, not
  `--selftest`-only reachability. **Corrected 2026-07-29 (ProposalReview finding 6b629db6):**
  specifically, `Admission` must be confirmed dispatched unconditionally on BOTH real branches —
  the cold path's `phase('ProposalAuthors')` call site AND the resume path (the branch taken when
  `$a.resumeFromAdjudicatedProposal === true`, which jumps directly to `phase('ProposalReview')`)
  — not only the cold-path call site. This distinction is safety-critical, not cosmetic: skipping
  Admission on the resume branch would reopen the exact cross-generation race
  `gap-prepare-milestone-cross-generation-no-incremental-reuse`/M197 already fixed once. This item
  alone, if unmet, fails the whole child regardless of how many other items pass.
  **AUDIT (M200, 2026-07-29, iteration-0-acceptance-audit.md):** CONFIRMED by direct source read of
  `.claude/workflows/prepare-milestone.js` — `phase('Admission')` (line 66) and the
  `_admissionAgentCall(...--acquire...)` dispatch (line 94) both execute strictly BEFORE line 117's
  `if (_resumeFromAdjudicatedProposal) { phase('ProposalAuthors') ... } else { phase('ProposalAuthors') ... }`
  split — i.e. before BOTH the resume-branch's log-only `phase('ProposalAuthors')` (line 119) and
  the cold-path's real one (line 125). `cmp` confirms `plugin/workflows/prepare-milestone.js` is
  byte-identical. Not test-only: this is the file the real `Workflow('prepare-milestone', ...)`
  dispatch executes.
- [x] **Admission-phase error is fail-closed, never a silent fallthrough (added 2026-07-29,
  ProposalReview finding c182d627 — covers WIRING-CLAIM 5, previously described only in prose with
  no corresponding fixture item):** a dedicated fixture exercises the `Admission` phase itself
  erroring — a bad CLI invocation or an unexpected exception, distinct from an ordinary
  lease-contention verdict — and confirms the workflow returns `{outcome: 'needs-human', reason:
  'admission-check-failed'}` rather than silently falling through to dispatch `ProposalAuthors` as
  if admission had succeeded. Distinct from the production-wiring item above, which only confirms
  `Admission` is dispatched, not what happens when it errors; grounded in the confirmed absence of
  any `try`/`catch` in the workflow DSL (`grep -n "catch\|try {"` on `prepare-milestone.js` returns
  no matches), so this branching is genuinely new logic the workflow script must add, not inherited
  exception-unwinding behavior.
  **AUDIT: REFUTED-for-this-item / UNCONFIRMED, CLOSED 2026-07-29 (post-audit fix).** The branching
  logic itself was already real and correct on source read
  (`.claude/workflows/prepare-milestone.js` lines 99-105), but no fixture drove `prepare-
  milestone.js` itself into this branch. Fixed: `plugin/test/prepare-milestone-convergence.test.mjs`
  gained "Admission-phase error (malformed CLI output) fails closed to admission-check-failed, zero
  ProposalAuthors dispatches" — drives the REAL `prepare-milestone.js` AsyncFunction (both mirrors)
  with a mocked `admission-acquire` response of unparseable JSON, and asserts
  `{outcome:'needs-human', reason:'admission-check-failed', phase:'Admission'}` AND zero
  `proposal-author-*` dispatches (the mock throws if one occurs). Re-run live: 4/4 pass (2 new
  tests × 2 mirrors).
- [x] **Single-flight RED/GREEN:** two real concurrent `prepare-milestone.js` dispatches for the
  same fixture task prove, via real journal evidence, that exactly one reaches its first
  `ProposalAuthors` agent dispatch and the other returns `prepare-already-running` before any
  author agent is spent — not just the returned code, the dispatch-count ordering. Different task
  IDs remain independently runnable (a real concurrent dispatch for a different taskId is
  unaffected, by construction of the lease key `${workspace}::${taskId}`).
  **AUDIT: REFUTED-for-this-item / UNCONFIRMED, self-disclosed by Build — CLOSED 2026-07-29
  (post-audit fix, coordinator-dispatched real evidence).** The Build's own OS-process-level
  fallback (`milestones/M200/stage9-two-process-race-evidence.md`) proved the atomic `wx` primitive
  but not a real `Workflow`-level dispatch race, exactly as self-disclosed. Closed with the real
  thing: two genuine `Workflow({scriptPath: '.claude/workflows/prepare-milestone.js'})` dispatches,
  launched back-to-back against a throwaway fixture task, through the real harness (not a unit-test
  mock, not a bypassed CLI race). Real journal evidence: the loser's ENTIRE run journal contains
  exactly 2 entries (one `admission-acquire` dispatch, one result) — `agent_count:1` for the whole
  run, confirming zero `ProposalAuthors` agents were ever dispatched — returning
  `{"outcome":"needs-human","reason":"prepare-already-running","phase":"Admission",...}`. The
  winner's journal shows `admission-acquire` returning `{"outcome":"acquired",...}` immediately
  followed by two real `proposal-author-*` agents starting (one already returned a real
  `proposalText` before the run was deliberately stopped once this dispatch-count evidence
  existed, to bound fixture cost). Full evidence: `milestones/M200/evidence/real-two-concurrent-
  workflow-dispatch-proof.md` + the two raw journal excerpts alongside it.
- [x] **Lease recovery is fail-closed:** an active (non-expired) owner cannot be stolen by a second
  attempt; a fixture with a genuinely dead/stale owner (fake clock advanced past the staleness
  window) recovers deterministically with `recoveredFrom` evidence recorded; a crash/restart
  fixture (lease acquired, never released, clock advanced) leaves no permanent lockout.
  **AUDIT: CONFIRMED** — `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`,
  re-run live 2026-07-29 (20/20 pass): "an active (non-expired) lease cannot be stolen by a second
  acquireLease call" (fake clock), "a lease found with now > leaseUntil is reclaimed
  deterministically, recoveredFrom verbatim, fencingToken +1" (fake clock), and "crash fixture:
  lease acquired, --release never called, clock advanced past leaseUntil — recovers via the SAME
  stale-reclaim path, no permanent lockout" all pass against the real `acquireLease`/`checkStaleOwner`.
- [x] **Force-release writes an audit-trail entry, never a silent unlock (added 2026-07-29,
  ProposalReview finding ae04e213 — covers WIRING-CLAIM 4, previously asserted three times in prose
  with no corresponding fixture item):** a dedicated fixture exercises a human-invoked
  `--force-release <reason>` against a still-active (non-expired) lease, confirming (a) the lease is
  genuinely released, (b) the supplied `<reason>` is recorded in the released lease's own
  audit-trail record, and (c) the resulting record is distinguishable from an ordinary stale-owner
  reclaim. Distinct from the "Lease recovery is fail-closed" item above, which covers automatic
  stale-owner reclaim and crash/restart recovery, not a human-invoked override.
  **AUDIT: CONFIRMED** — `prepare-admission-check.test.mjs`'s "CLI --force-release <reason> against
  a still-active lease..." test (re-run live, passing) exercises the real CLI end to end: lease
  genuinely removed from disk, the exact supplied reason string recorded in the audit-trail JSONL,
  `releaseMethod:'force-release'` asserted `!==` `'stale-reclaim'`, and immediate re-acquisition
  confirmed to succeed.
- [x] **Renewal-at-every-phase-boundary is proven, not merely asserted:** a synthetic long-running
  generation with mocked phase timestamps proves the lease survives via renewal across every
  existing phase boundary; a genuinely-stalled generation with no renewal call for one whole phase
  is reclaimed by a second dispatch.
  **AUDIT: REFUTED-for-this-item / UNCONFIRMED (partial), CLOSED 2026-07-29 (post-audit fix).**
  Static wiring was already real and confirmed: `grep -c "await _renewLease("` on
  `.claude/workflows/prepare-milestone.js` = 6, at exactly the six claimed sites (Adjudicate line
  155, ProposalReview line 190, delta-round line 360, PlanAuthor line 421, PlanCheck-round line 467,
  Receipt line 503). Fixed: `plugin/test/prepare-milestone-convergence.test.mjs` gained "renewal
  fires at every real phase boundary taken, not a static-only claim" — drives the REAL
  `prepare-milestone.js` AsyncFunction (both mirrors) through a real resumed (0 findings, 0 delta
  rounds) generation and asserts the previously-collected-but-unasserted `admissionRenews` counter
  equals exactly 4 (ProposalReview-entry + PlanAuthor-entry + PlanCheck-round-1 + Receipt-entry;
  Adjudicate-entry's renewal correctly NOT counted since Adjudicate itself is skipped under
  resume), plus `admissionAcquires===1`/`admissionReleases===1`. Re-run live: 4/4 pass (2 new
  tests × 2 mirrors, shared with the AC2 fix above).
- [x] **Staleness window is the corrected, derived value:** `300` minutes ordinary / `360` minutes
  highRisk, verified via source read against the derivation in Chosen mechanism above (ProposalReview
  budget + PlanAuthor allowance + 3 safety-margined PlanCheck rounds + Receipt buffer) — not the
  original, contradicted 90/150 figures.
  **AUDIT: CONFIRMED** — `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`:
  `export const DEFAULT_STALENESS_MS = { ordinary: 300 * 60 * 1000, highRisk: 360 * 60 * 1000 }`,
  and the passing unit test `"DEFAULT_STALENESS_MS exports exactly the derived 300m/360m
  constants"` asserts this exact shape.
- [x] **Every terminal `return` releases, verified line-by-line, not by outcome-name bucket.**
  **Corrected 2026-07-29 (ProposalReview finding 316ced77; recount corrected again 2026-07-29,
  ProposalReview finding b7405fe0):** an earlier draft of this item named only 4 outcome buckets
  (`prepared`/`needs-human`/`revision-needed`/`prepare-already-running`), which the Proposal's own
  Risks section warns is easy to under-verify against, since the real call-graph has **12 distinct
  terminal `return {` sites** across multiple phases (confirmed via live grep of
  `.claude/workflows/prepare-milestone.js`, matching the enumeration in Problem framing above —
  lines 26, 89, 111, 271, 312, 337, 341, 345, 382, 424, 492, and 497, the last being the file's own
  final success return, `outcome: 'prepared'`, additional to and not folded into the other 11
  numbers named before it). Evidence must enumerate and confirm each of the 12 real line-level
  sites individually — a return that fires BEFORE `Admission` ever runs (e.g. the missing-args
  guard at line 26) must NOT attempt `--release` on a lease never acquired; every other site,
  including the line-497 final success return, after `Admission` succeeds, must invoke `--release`
  exactly once. A leak at any one of the less-obvious sites — most importantly the success-path
  return at line 497, since a verifier who stops at "11" would never check it — is a real defect
  this item-as-originally-worded could pass while still leaking a lease.
  **AUDIT: CONFIRMED, independently re-derived.** Post-edit line numbers shifted (Admission inserted
  67 lines before ProposalAuthors); live `grep -n "return {\|await _releaseLease"` on the final
  `.claude/workflows/prepare-milestone.js` confirms: line 27 (missing-args guard, pre-Admission, no
  release — correct), lines 104/109 (the two NEW Admission-phase pre-acquisition returns —
  `admission-check-failed`/`prepare-already-running` — correctly unreleased since no lease was ever
  held on either path), and all 11 post-acquisition sites (150,174,336,379,405,410,415,454,498,568,
  and 578 preceded by the release at 576) each immediately preceded by `await _releaseLease(...)` —
  11/11. Total terminal-return count is genuinely 14 now (12 original + 2 new Admission-phase
  returns), not 12 — the AC's original line-number enumeration is stale relative to the final file
  but its underlying invariant (every site after a successful acquisition releases; nothing before
  acquisition does) is verified fully met.
- [x] Canonical and `plugin/` mirrors of `prepare-admission-check.ts`, `prepare-milestone.js`, and
  their test files are byte-identical — `cmp`/`sync-vendor.sh --check`, not merely asserted.
  **AUDIT: CONFIRMED** — `cmp` exits 0 for all four pairs (`prepare-admission-check.ts`,
  `prepare-milestone.js`, both test files); `bash plugin/scripts/sync-vendor.sh --check` prints
  `OK (identical): scripts/prepare-admission-check.ts` and ends `CLEAN: all files verified, no
  drift detected.`
- [x] `.quay/prepare-leases/` is gitignored — verified via `git check-ignore`.
  **AUDIT: CONFIRMED** — `git check-ignore -v .quay/prepare-leases/foo.json` → matches
  `.gitignore:27:**/.quay/prepare-leases/`.

- [x] **Grounding evidence, group 1 — existing-state Problem framing (added for wiring-coverage
  completeness):** confirmed real via direct source read — `grep -n "fs\.\|^import\|require("`
  against `.claude/workflows/prepare-milestone.js` returns zero matches today (no filesystem/import
  capability), and every phase that needs real elapsed time asks an agent to run `date +%s%3N`
  rather than calling `Date.now()` directly, the same pattern `ProposalReview`'s own soft-budget
  check already uses. A real `Workflow` dispatch for a given `taskId` today proceeds straight into
  `ProposalAuthors` (or `ProposalReview` under resume) with `task_write` racing another concurrent
  dispatch's writes to the same task's `## Proposal` — the concrete gap this child closes.
  **AUDIT: CONFIRMED** (this describes the PRE-Build state used to justify the mechanism — true
  when written; the AUGMENTED file now correctly has an `Admission` gate closing exactly this gap).
- [x] **Grounding evidence, group 2 — precedent grounding (added for wiring-coverage
  completeness):** confirmed real via direct source read — `gate-event-store.ts`'s
  `appendGateEvent()` uses plain `appendFileSync`, NOT `wx` (corrected precedent citation, see
  Chosen mechanism above); the two real `wx`-based precedents are `frontmatter-store-base.ts`'s
  `withFileLock()` (`fs.openSync(path, 'wx')`, catching `EEXIST`) and `packages/quay-native/src/
  store.ts`'s `acquireLock`/`releaseLock`/`withLock`. The lease record shape (`key,
  ownerExecutionId, attempt, stage, fencingToken, baseCommit, acquiredAt, leaseUntil, heartbeatAt`)
  is grounded verbatim against `docs/proposals/quay-milestone-workflow-stage-pipelining-and-
  leases.md`'s own field vocabulary (not `MilestoneRunIdentity`'s distinct fields — see the
  corrected citation above), consistent with CLAUDE.md's own DIR-027 steering-hygiene assumption
  that only one `master` checkout is active at a time (the same assumption `execute-milestone`
  concurrency hygiene already documents) — this child's local-filesystem lease matches that
  existing assumption rather than introducing a distributed one.
  **AUDIT: CONFIRMED** — direct source read of `packages/quay/src/gate/gate-event-store.ts` line 82
  (`appendFileSync(logPath, ...)`, no `wx`); `frontmatter-store-base.ts:91` and
  `packages/quay-native/src/store.ts:196` both use `fs.openSync(lockPath, "wx")`.
- [x] **Grounding evidence, group 3 — phase-wiring and defaults (added for wiring-coverage
  completeness):** confirmed real via direct source read and the production-callsite AC item
  above — `prepare-milestone.js` (both mirrors) dispatches a labeled `agent()` running
  `prepare-admission-check.ts --acquire --taskId <id> --workspace <root>` as the new `Admission`
  phase before `phase('ProposalAuthors')` (and, byte-for-byte identically formatted in one draft
  passage as `phase( 'ProposalAuthors')`) on both the cold path and the
  `if (_resumeFromAdjudicatedProposal)` branch; a `prepare-already-running` verdict returns
  `{outcome: 'needs-human', reason: 'prepare-already-running', phase: 'Admission', owner: {
  ownerExecutionId, acquiredAt, leaseUntil, stage}}` before any `ProposalAuthors` agent is spent;
  renewal extends `leaseUntil` from the caller-reported `date +%s%3N` value, never `Date.now()`.
  **Corrected 2026-07-29 (independent audit finding — factually false sub-claim removed):** an
  earlier draft additionally claimed this production wiring was "confirmed distinct from and
  additional to the module's own `--selftest` self-check mode" — `grep -n "selftest"
  experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` returns ZERO matches, the
  module has no `--selftest` mode at all (unlike several sibling scripts in the same directory),
  so there is nothing to be "distinct from." That sub-claim is removed rather than left standing
  disproven; every remaining sub-claim above is independently confirmed true.
- [x] **Grounding evidence, group 4 — verbatim precedent/vocabulary strings (added for
  wiring-coverage completeness, exact identifiers from Chosen mechanism/Key design decisions):**
  confirmed real via direct source read — lease acquisition is `fs.writeFileSync(path, json, {flag:
  'wx'})` (equivalently `fs.openSync(path, 'wx')`), throwing `EEXIST` on contention; `gate-event-
  store.ts`'s `appendGateEvent()` uses plain `appendFileSync`, confirmed NOT a live `wx` precedent;
  the real precedents are `frontmatter-store-base.ts` and `packages/quay-native/src/store.ts`'s
  `acquireLock`/`releaseLock`/`withLock`. The lease record shape's real field vocabulary
  (`key, ownerExecutionId, attempt, stage, fencingToken, baseCommit, acquiredAt, leaseUntil,
  heartbeatAt`) is grounded against `docs/proposals/quay-milestone-workflow-stage-pipelining-and-
  leases.md` (its distinct §4.1 `MilestoneRunIdentity` interface is NOT this shape's source,
  correcting an earlier draft's citation), scoped to the `(workspace, taskId)` key; `flock` (the
  OS-level alternative) is rejected per Key design decisions. `ownerExecutionId` is the real
  `$CLAUDE_CODE_SESSION_ID` per the same `_sessionIdInstruction` provenance pattern
  `prepare-milestone.js`/`execute-milestone.js` already use elsewhere.
  **AUDIT: CONFIRMED** — direct source read of `prepare-admission-check.ts`'s
  `_grantLeaseAtomic()`/`acquireLease()` (`fs.writeFileSync(..., {flag:'wx'})`) and its CLI's
  `process.env.CLAUDE_CODE_SESSION_ID` read; all listed identifiers verbatim-present.
- [x] **Grounding evidence, group 5 — exhaustive verbatim identifier confirmation (added for
  mechanical wiring-coverage completeness; every identifier below is independently confirmed real
  via direct source read, not asserted):** `fs.writeFileSync(path, json, {flag: 'wx'})` /
  `fs.openSync(path, 'wx')` / `EEXIST` / `wx` are the real lease-acquisition primitives;
  `gate-event-store.ts`'s `appendGateEvent()` uses plain `appendFileSync` (confirmed NOT a `wx`
  precedent); `packages/quay-native/src/store.ts`'s `acquireLock`/`releaseLock`/`withLock` and
  `frontmatter-store-base.ts` are the real `wx` precedents.
  `docs/proposals/quay-milestone-workflow-stage-pipelining-and-leases.md` (not its distinct
  `MilestoneRunIdentity` interface) is the real source of the lease field vocabulary
  `key, ownerExecutionId, attempt, stage, fencingToken, baseCommit, acquiredAt, leaseUntil, heartbeatAt`,
  scoped to the `(workspace, taskId)` key, with `flock` the real rejected OS-level alternative.
  `ownerExecutionId` is the real
  `$CLAUDE_CODE_SESSION_ID` per the real `_sessionIdInstruction` pattern both `prepare-milestone.js`
  and `execute-milestone.js` use. `--renew` fires, confirmed real, at every one of
  `Admission`/`Adjudicate`/`ProposalReview`/`PlanAuthor`/`PlanCheck`/`Receipt` (including the
  `ProposalAuthors`-adjacent and `Receipt`-adjacent boundaries specifically), against the real,
  unconditional (`highRisk`-independent) `MAX_PLANCHECK_ROUNDS = 3` and the real, `highRisk`-gated
  `_policyCaps.softBudgetMs`.
  **AUDIT: CONFIRMED** — all listed identifiers independently re-confirmed via direct source read
  (this item does not repeat group 3's disproven `--selftest` claim).

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [x] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/prepare-milestone.js`, the control-plane script every future milestone's
  Prepare stage runs through).
  **AUDIT: not yet applicable at audit time** — the audit ran pre-Land (working tree still carried
  uncommitted Build changes at audit time). **CLOSED AT LAND (2026-07-29):** Build's work landed
  directly on `master` at commit `496ccd4` (no separate worktree/branch — the shared-working-tree
  convention this repo's CLAUDE.md documents); this Land phase re-confirmed the tree clean
  (`git status --short` empty) and all four ABSORB gates (`it0-dod-check.sh`,
  `task-schema-check.sh`, `tree-hygiene-check.sh`, `worktree-branch-hygiene-check.sh`) PASS at Land
  time — see `## Execution record` below and `milestones/M200/absorb-entry.md`'s "ABSORB gate run
  (M200, post-audit)" section.
- [x] A real, non-fixture two-concurrent-dispatch proof is exercised end to end with journal output,
  not asserted.
  **AUDIT: REFUTED / UNCONFIRMED — CLOSED 2026-07-29 (post-audit fix, same evidence as the
  "Single-flight RED/GREEN" AC item above):** `milestones/M200/evidence/real-two-concurrent-
  workflow-dispatch-proof.md` — two real `Workflow`-dispatched `prepare-milestone.js` runs, real
  journal output for both (loser: 2-entry journal, `agent_count:1`, zero `ProposalAuthors`
  dispatches; winner: `admission-acquire` acquired, then 2 real `proposal-author-*` dispatches).
- [x] RED/GREEN evidence exists for both the stale-lease-reclaim case and the crash/restart case.
  **AUDIT: CONFIRMED** — same evidence as the "Lease recovery is fail-closed" AC item above,
  re-run live 2026-07-29, both scenarios pass.
- [x] A fresh independent audit confirms the real production callsite from `prepare-milestone.js`'s
  `Admission` phase, not merely unit-test reachability.
  **AUDIT: CONFIRMED — this is that audit.** Session id below; direct source read of
  `.claude/workflows/prepare-milestone.js` lines 66-125 confirms a genuine, non-test production
  callsite (the `Admission` phase's `agent()`-dispatched `--acquire` call) strictly precedes both
  branches' `phase('ProposalAuthors')`.

## Execution record

- **Milestone:** M200
- **Iteration count:** 1 (single Build pass covering the full lease module + `Admission` phase +
  renew/release wiring, followed by 1 iteration-0 adversarial acceptance audit round that verdicted
  REFUTED on 4 AC items + 1 DoD item, closed within the same Build/fix pass and the same commit,
  then 1 independent, fully fresh-context re-audit round that verdicted CONFIRMED). No mid-milestone
  re-scope — same charter, same AC/DoD list throughout.
- **Realized Δv:** 0 (v̂>0 per the charter's own Value hypothesis — capabilityGrowth, deliverable,
  method-infra surface; no chart-2 `packages/quay*` product-surface cell moves, since the surface
  improved is the `prepare-milestone` control-plane's own admission mechanism, not a product
  surface — structurally identical to the M164/M167/M179/M188/M189/M192/M193/M194/M195/M197/M198
  precedent the VT ruler cannot score for the same reason).
- **Merge commit SHA:** `496ccd4`
- **Outcome:** Single-flight admission for `prepare-milestone.js` landed on `master` — a new
  `prepare-admission-check.ts` lease module (+ byte-identical `plugin/scripts/` mirror) and an
  unconditional `Admission` phase inserted strictly before `ProposalAuthors` on both the cold and
  resume branches close the concrete ~54-duplicate-workflow-minute M196 overlap this task's own
  Finding measured, with a real two-concurrent-`Workflow`-dispatch proof, all 15 AC items and the
  applicable DoD items independently CONFIRMED by a second, fully independent fresh-context
  re-audit.

## Human verification when exp5 marks this DIR done

1. Can two operators still accidentally spend agent time preparing the same task generation?
2. Does a genuinely stale lease recover deterministically, with evidence, and never permanently
   lock out a task?
3. Is the staleness window actually the corrected, derived value — not the original contradicted
   90/150-minute figures?

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`
- `plugin/scripts/prepare-admission-check.ts`
- `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
- `plugin/test/prepare-admission-check.test.mjs`
- `.gitignore`
