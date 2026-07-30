---
id: DIR-126-C
title: Generation-aware resume for prepare-milestone.js (decideResumeGeneration
  in proposal-convergence.ts) — third child of DIR-126's split
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
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-126-C
    experiments/quay-perpetual-stream/charters/M202-dir126c-generation-aware-resume.md
    milestones/M202/absorb-entry.md
---

**type:** execution

## Proposal

### Problem framing (re-verified live against the current tree, 2026-07-29)

Confirmed by direct read of `.claude/workflows/prepare-milestone.js` (707 lines, byte-identical to
`plugin/workflows/prepare-milestone.js` — `diff -q` returns no difference):

- Line 88: `const _resumeFromAdjudicatedProposal = $a.resumeFromAdjudicatedProposal === true` — a bare
  boolean read of caller-supplied input, no hash/provenance derivation of any kind, gating a single
  `if (_resumeFromAdjudicatedProposal) { ... } else { ... }` branch at line 203 that skips
  `ProposalAuthors`/`Adjudicate` on `true`. `OUTER-LOOP.md`'s CALLER RULE documents the caller
  obligation ("the retry dispatch for that same task MUST pass `{resumeFromAdjudicatedProposal:
  true}`") only in prose — a human/caller judgment call, not a mechanically verified one.
- No durable, task-keyed, cross-dispatch record exists anywhere today: `.quay/prepare-leases/
  <taskId>.json` ([[DIR-126-A]]'s lease) is deleted on every `--release`; the only survivor is an
  append-only `<taskId>.audit.jsonl` of release *events* (`releaseMethod/releasedAt/reason/lease`),
  never a hash/outcome record. `milestones/<milestoneId>/preparation.json` (DIR-117's receipt) is
  keyed by `milestoneId`, and a retry of the same `taskId` gets a NEW `milestoneId` each time
  (confirmed by M197's own `milestone_counter` history, 194→195→...→198) — nothing today answers
  "what was the outcome of the LAST attempt at this `taskId`, under what hashes" without an
  unbounded scan.
- Both [[DIR-126-A]] (single-flight `Admission`, landed `a0aba1f`/M200) and [[DIR-126-B]]
  (deterministic `Preflight`, landed `528897c`/M201) run unconditionally ahead of the resume branch
  today but derive nothing about the RESUME decision itself — they only gate admission and content
  well-formedness.
- **A real, easy-to-miss collision:** both `Preflight` call sites in the file (line 173, before
  `Adjudicate`; line 548, after `PlanAuthor`, checking Plan shape) return the IDENTICAL string
  `reason: 'preflight-rejected'` (confirmed: `grep -n "_releaseLease('preflight-rejected')"` matches
  both 192 and 564). Any cacheable-terminal allowlist keyed on the bare string `'preflight-rejected'`
  would conflate two terminals with very different real re-derivation cost, one of which (plan-shape)
  depends on Plan-file content this mechanism's hash inputs never cover — caching that one as reusable
  would be unsound.
- **Exact terminal-return-site inventory (mechanically re-counted, not assumed):** `grep -n
  "_releaseLease("` against the live file finds **15** real post-Admission call sites (182, 192, 235,
  259, 421, 464, 490, 495, 500, 539, 555, 564, 612, 682, 691), not 11 or 12 as some prior drafts of
  this design assumed — any wiring-coverage claim about "every terminal-return site" must be checked
  against this live count, not a stale comment's approximation.
- **Scope-constraining fact, mechanically enforced, not stylistic:** this task's own `## Touches`
  lists only `prepare-milestone.js` (both mirrors), `proposal-convergence.ts` (both mirrors), and
  their test files — it does **not** list `experiments/quay-perpetual-stream/scripts/
  prepare-admission-check.ts`. This is not a paperwork nicety: [[DIR-126-B]]'s own landed
  `preflightTouchesMismatch` check (in that very file, `prepare-admission-check.ts`) mechanically
  rejects a Plan whose `- Files:` lines reference a path outside the task's declared `## Touches` as
  a **blocking** `preflight-touches-mismatch` finding at `--preflight-plan` time. A design that adds
  new CLI flags to `prepare-admission-check.ts` would author a Plan that edits a file outside this
  task's own declared Touches and would be mechanically flagged by the exact system this child is
  extending — confirmed by direct read of `preflightTouchesMismatch`'s `trulyUnmatched` blocking
  branch. Any chosen mechanism must therefore land entirely inside the six files this task's own
  `## Touches` already names, importing (never editing) anything else.

Net effect: a stale `true` risks silently skipping re-authoring against a since-changed charter; a
missing `true` burns a full `ProposalAuthors`+`Adjudicate`+`ProposalReview` cycle even when the
on-disk Proposal is already safely reusable, or re-derives an unchanged, already-rejected outcome
from scratch — the exact caller-judgment risk class this design closes, DIR-126's own Finding's
third recurring failure mode though not itself using "gap N" numbering (that label is this Proposal's
own, not a verbatim quote — corrected 2026-07-29, ProposalReview finding 41dee413), and the mechanism
that would have made M196's repeated duplicate-generation overlap (`tasks/DIR-126.md:95`, ~54
duplicate workflow-minutes) actually preventable at the decision layer, not just the admission layer
[[DIR-126-A]] already closed.

### Chosen mechanism

Add a pure function to `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` (+
`plugin/scripts/` mirror, byte-identical via the existing vendor-sync mechanism):

```
decideResumeGeneration({
  priorGenerationRecord,      // last known generation record for this taskId, or null
  currentTaskId,
  currentCharterHash,
  currentTaskContractHash,    // sha256 over AC + DoD + Touches sections
  currentTaskProposalHash,    // sha256 over the CURRENT on-disk '## Proposal' section
  currentReviewPolicyHash,    // sha256(PREFLIGHT_POLICY_VERSION + '::' + RESUME_POLICY_VERSION)
  callerOverride,             // true | false | undefined
}) -> { decision: 'cold' | 'resume' | 'reuse-terminal', reason, priorGenerationId?, priorReason? }
```

It stays PURE — no `fs`, no agent dispatch — matching this module's existing documented convention
("This module is PURE... so it can be unit tested directly and consumed by
`milestone-preparation-check.ts`"). All hash computation and record I/O are the CALLER's
responsibility, exactly like every other input this module already consumes.

**`proposal-convergence.ts` also gains its own thin CLI tail**, guarded by the SAME
`isDirectEntry(import.meta)` idiom `prepare-admission-check.ts`'s CLI already uses (imported
read-only from `gate-script-base.ts`, never duplicated) — so `milestone-preparation-check.ts`'s
existing `import { blockingOpen, validateConvergenceCounters, computeConvergenceMetrics } from "./proposal-convergence.ts"`
(the real import — a repo-wide grep confirms `capsFor` is imported only by this module's own unit-test
file `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`, never by
`milestone-preparation-check.ts`) stays a side-effect-free module
load; no argv parsing or `fs` call fires on import, only when the file is invoked directly. This is
the load-bearing scope decision this design makes differently from two earlier drafts of this same
proposal, which instead added `--decide-resume`/`--record-generation` CLI modes to
`prepare-admission-check.ts`: that file is not in this task's `## Touches`, and — as shown in Problem
framing — doing so would get mechanically flagged by [[DIR-126-B]]'s own `preflightTouchesMismatch`
check when this milestone's own Plan is later preflighted. Hosting the CLI on
`proposal-convergence.ts` instead keeps every edit inside the six files this task already declares,
while still following the file's own established "pure decision + thin CLI, `agent()`-dispatched
shell command" shape (`_admissionAgentCall`/`_preflightAgentCall`'s exact pattern, just pointed at a
different, in-Touches script). The two new CLI modes:

- `--decide-resume --taskId <id> --workspace . --charterFile <charterFile> [--callerOverride
  true|false]`: reads `tasks/<taskId>.md` and the charter file fresh off disk, extracts `##
  Acceptance Criteria` / `## Definition of Done` / `## Touches` (via `extractSection`, imported
  read-only from `task-schema.ts` — reused, never reimplemented) for `currentTaskContractHash` and
  `## Proposal` for `currentTaskProposalHash`, computes `currentReviewPolicyHash` in-process from
  `PREFLIGHT_POLICY_VERSION` (imported read-only, unmodified, from `prepare-admission-check.ts` —
  that file's own header comment already documents this exact future consumer: "DIR-126-C consumes
  it for cache invalidation") combined with a new local `RESUME_POLICY_VERSION` constant (a plain,
  manually-bumped string, `"resume-v1"`, matching `PREFLIGHT_POLICY_VERSION`'s own established
  shape), reads the just-acquired admission lease (`.quay/prepare-leases/<taskId>.json`, written by
  [[DIR-126-A]]'s `--acquire`) for `{ownerExecutionId, fencingToken, acquiredAt}` and derives
  `generationId = sha256(`${taskId}::${ownerExecutionId}::${fencingToken}::${acquiredAt}`).slice(0,
  12)` (the SAME `sha256(identity).slice(0,12)` idiom this file's own `fingerprintFinding` already
  uses — not a new ID convention), reads the prior record (`.quay/prepare-leases/
  <taskId>.generation.json`, or `null`), calls the pure `decideResumeGeneration`, and — **if and only
  if** the decision is `reuse-terminal` — ALSO imports and calls `releaseLease` (read-only,
  unmodified, from `prepare-admission-check.ts`) before returning, so decision and release are one
  atomic CLI invocation: no window exists between "decision computed" and "lease released" in which a
  second dispatch could observe `prepare-already-running` for a task about to report `reuse-terminal`
  and vanish. Prints `{decision, reason, priorGenerationId, priorReason, hashes:{charterHash,
  taskContractHash, proposalHash, reviewPolicyHash}, generationId, releaseResult?}`.
- `--record-generation --taskId <id> --workspace . --terminalPhase <phase> --outcome <o> --reason <r>
  --cacheable <bool>`: re-reads the task/charter fresh (the Proposal may have been revised multiple
  times since `--decide-resume` ran, e.g. across `ProposalReview` delta rounds, so the record must
  reflect content AS OF THE ACTUAL TERMINAL, never a stale hash captured at entry), re-derives
  `generationId` the SAME way from the still-held lease, writes/overwrites
  `.quay/prepare-leases/<taskId>.generation.json`, and — **piggybacked in the SAME invocation, not a
  second `agent()` dispatch** — also calls `releaseLease` (read-only import), replacing the plain
  `--release` call `prepare-milestone.js` makes at every one of its 15 terminal-return sites today.
  This keeps the per-terminal dispatch count unchanged from today's baseline (one `agent()` call per
  terminal, now doing release+record together instead of release alone) rather than doubling it.

**Storage:** a single overwritten record at `.quay/prepare-leases/<taskId>.generation.json` — a
sibling file inside the directory `.gitignore` line 27 (`**/.quay/prepare-leases/`) already ignores
wholesale, so **no `.gitignore` edit is required** (also outside this task's `## Touches`). Shape
(the interim/frozen shape [[DIR-126-D]]'s own task body already commits to inheriting as a
compatibility contract, never silently redesigning):

```
{ schemaVersion: 1, taskId, generationId, charterHash, taskContractHash, proposalHash,
  reviewPolicyHash, terminalPhase, outcome, reason, cacheable, recordedAtMs }
```

**Finer-grained `terminalPhase` vocabulary**, deliberately split beyond the workflow's own coarse
`phase()` labels (which today reuse `'Preflight'` for BOTH call sites) so the two `preflight-rejected`
terminals are distinguishable:

```
PHASE_RANK = { PreflightContent:0, ProposalAuthors:1, Adjudicate:2, ProposalReview:3,
               PlanAuthor:4, PreflightPlan:5, PlanCheck:6, Receipt:7 }
```

mapped from the live call-site inventory: `PreflightContent` = lines 182/192 (before `Adjudicate`),
`ProposalAuthors` = 235, `Adjudicate` = 259, `ProposalReview` = 421/464/490/495/500, `PlanAuthor` =
539, `PreflightPlan` = 555/564 (the plan-shape re-check after `PlanAuthor`), `PlanCheck` = 612,
`Receipt` = 682/691.

`CACHEABLE_TERMINALS` is an explicit allowlist of `{terminalPhase, reason}` **pairs**, not `reason`
alone: `{terminalPhase:'PreflightContent', reason:'preflight-rejected'}` and
`{terminalPhase:'ProposalReview', reason:'split-recommended'}`. A `PreflightPlan`/`preflight-rejected`
record is deliberately excluded — it depends on Plan-file content this mechanism's hashes never
cover, and by the time it fires a real `PlanAuthor` agent has already run, so caching it under
`reuse-terminal` would falsely claim savings a `PreflightContent` cache hit actually delivers.

`RESUMABLE_PHASES` for `resume`-eligibility is `PHASE_RANK[priorGenerationRecord.terminalPhase] >
PHASE_RANK['Adjudicate']` — i.e. `ProposalReview`, `PlanAuthor`, `PreflightPlan`, `PlanCheck`,
`Receipt`, but **not** `Adjudicate` itself. This is a deliberate sharpening of the charter's own "at
or after Adjudicate" phrasing: an `adjudicate-failed` terminal's `task_write` may never have
completed, so its provenance for "what Proposal is currently on disk" is unverified: treating it as
already-adjudicated would let `resume` skip re-authoring from a Proposal that was never actually
written by that generation. The stricter, `>` (not `>=`) threshold is the fail-closed reading and
costs nothing on the common path (a real successful `Adjudicate` always advances the terminal phase
past it, into `ProposalReview` or later).

### Concrete control/data flow

```
Admission (--acquire)                                                       [unchanged, DIR-126-A]
  -> IF $a.resumeFromAdjudicatedProposal is undefined (omitted), strictly BEFORE phase('Preflight'):
       agent(): proposal-convergence.ts --decide-resume --taskId <id> --charterFile <f> --workspace .
         -> reads .quay/prepare-leases/<taskId>.json (just-acquired lease) -> derives generationId
         -> reads tasks/<taskId>.md, <charterFile> fresh; extractSection AC/DoD/Touches + Proposal
         -> reads .quay/prepare-leases/<taskId>.generation.json (or null)
         -> decideResumeGeneration({...}) -> {decision, reason, priorGenerationId, priorReason,
                                               hashes, generationId}
         -> IF decision === 'reuse-terminal': releaseLease() INSIDE this same CLI call, report
            releaseResult
       non-parseable JSON / unexpected exit -> fail-closed:
         {outcome:'needs-human', reason:'resume-decision-failed', phase:'Preflight'}
       releaseResult present and ok !== true -> fail-closed:
         {outcome:'needs-human', reason:'reuse-terminal-release-failed', phase:'Preflight'}
       decision === 'reuse-terminal' -> return {outcome:<priorOutcome>,
         reason:'unchanged-generation-terminal', priorReason, decision:'reuse-terminal',
         priorGenerationId}
         [zero Preflight, ProposalAuthors, Adjudicate, ProposalReview, PlanAuthor, PlanCheck agents]
       decision === 'resume' -> _resumeFromAdjudicatedProposal = true   (same branch as explicit true)
       decision === 'cold'   -> _resumeFromAdjudicatedProposal = false (same branch as explicit false)
     IF $a.resumeFromAdjudicatedProposal === true or === false (explicit):
       NO --decide-resume dispatch at all -> _resumeFromAdjudicatedProposal = that literal value
       [byte-identical to today: zero new agent calls, zero new file reads, on this path]
  -> Preflight (--preflight, content) runs UNCONDITIONALLY next, exactly as today, for every path
     that did NOT already return via reuse-terminal
  -> if (_resumeFromAdjudicatedProposal) { skip ProposalAuthors/Adjudicate } else { run them }
                                                            [unchanged branch, now fed by 3 sources]
  -> ProposalReview (unconditional round-0 full review, DIR-125 bounded loop)          [unchanged]
  -> PlanAuthor / Preflight (plan-shape) / PlanCheck / Receipt                          [unchanged]
```

At EVERY one of the file's **15** real post-Admission terminal `return` sites that currently call
`_releaseLease(stageLabel)` (confirmed by live grep: 182, 192, 235, 259, 421, 464, 490, 495, 500, 539,
555, 564, 612, 682, and the final `prepared` success return at 691), `_releaseLease` is replaced by
`_releaseLeaseAndRecord(stageLabel, {outcome, reason, cacheable})`, dispatching
`proposal-convergence.ts --record-generation` (which piggybacks the lease release, per Chosen
mechanism above) instead of the old bare `--release`. `cacheable` is `true` only for the two named
`{terminalPhase, reason}` pairs; `false` for every other terminal. EXCEPTIONS (no record write): the
two pre-lease-acquisition returns (`admission-check-failed`, `prepare-already-running` — no lease was
ever acquired, so no generation happened for this attempt), and the `reuse-terminal` short-circuit
itself, whose `--decide-resume` call already released the lease and deliberately does NOT overwrite
`.generation.json` — the cached record stays authoritative and unmodified across any number of
consecutive `reuse-terminal` hits.

**`decideResumeGeneration`'s exact evaluation order** (pure function; `PHASE_RANK` values used for
step 10 only):

1. `callerOverride === true` → `{decision:'resume', reason:'caller-override-true'}`.
2. `callerOverride === false` → `{decision:'cold', reason:'caller-override-false'}`.
3. Any exception anywhere in the surrounding evaluation → `{decision:'cold',
   reason:'decision-exception'}`, wrapped in try/catch at the CLI layer (not inside the pure function
   itself, which stays a plain series of `if`s) — the CLI wrapper is the one thing capable of
   throwing on malformed disk state.
4. `priorGenerationRecord` missing/null → `{decision:'cold', reason:'missing-prior-record'}`.
5. `priorGenerationRecord.taskId !== currentTaskId` → `cold, reason:'task-id-mismatch'`.
6. `priorGenerationRecord.charterHash !== currentCharterHash` → `cold, reason:'charter-hash-mismatch'`.
7. `priorGenerationRecord.taskContractHash !== currentTaskContractHash` → `cold,
   reason:'task-contract-hash-mismatch'`.
8. `priorGenerationRecord.reviewPolicyHash !== currentReviewPolicyHash` → `cold,
   reason:'review-policy-hash-mismatch'`.
9. `priorGenerationRecord.cacheable === true` AND `{terminalPhase, reason}` is in
   `CACHEABLE_TERMINALS` AND `priorGenerationRecord.proposalHash === currentTaskProposalHash` →
   `{decision:'reuse-terminal', reason:'unchanged-generation-terminal', priorGenerationId,
   priorReason: priorGenerationRecord.reason}`.
10. `PHASE_RANK[priorGenerationRecord.terminalPhase] > PHASE_RANK['Adjudicate']` AND
    `priorGenerationRecord.proposalHash !== currentTaskProposalHash` → `{decision:'resume',
    reason:'repaired-proposal-detected', priorGenerationId}`.
11. Else → `{decision:'cold', reason:'no-eligible-reuse-or-resume-condition'}` (covers: unchanged
    proposal + non-cacheable terminal at/after `ProposalReview`; terminal at/before `Adjudicate`; any
    other combination).

### Key design decisions

- **The new CLI lives on `proposal-convergence.ts` (in this task's `## Touches`), never on
  `prepare-admission-check.ts` (not in Touches)** — the single most load-bearing decision in this
  design, made concrete and mechanically grounded by [[DIR-126-B]]'s own `preflightTouchesMismatch`
  check (see Problem framing). Two earlier drafts of this proposal put the new `--decide-resume`/
  `--record-generation` modes on `prepare-admission-check.ts`, following that file's existing
  "thin CLI wrapper" convention structurally, but at the cost of editing a file this task never
  declared it would touch — a real defect this reconciliation corrects, not a stylistic preference.
  `prepare-admission-check.ts` itself is consumed strictly read-only (`PREFLIGHT_POLICY_VERSION`,
  `releaseLease`), matching the same "import unmodified exports, never add new ones" discipline this
  task's own `## Requested action` already applies to other cross-child dependencies.
- **`decideResumeGeneration` is a fifth pure function alongside `capsFor`/`fingerprintFinding`/
  `upsertFindings`/`validateConvergenceCounters` in the SAME file** — it needs the same fail-closed,
  hash-gated decision-table shape those already provide, and living beside them keeps ProposalReview's
  existing bounded-convergence machinery and this new resume machinery visibly governed by one shared,
  cross-mirror-synced test file.
- **The new CLI tail is guarded by `isDirectEntry(import.meta)`** (imported read-only from
  `gate-script-base.ts`, the same helper `prepare-admission-check.ts`'s own CLI already uses) so
  `milestone-preparation-check.ts`'s existing `import { blockingOpen, validateConvergenceCounters, computeConvergenceMetrics }` stays a side-effect-free
  module load — no `fs`/argv parsing fires on import, only on direct invocation.
- **`(terminalPhase, reason)` PAIRS gate `reuse-terminal` eligibility, not `reason` alone** — the
  live code returns the identical `'preflight-rejected'` string from two genuinely different points
  in the pipeline (content, pre-`Adjudicate`; plan-shape, post-`PlanAuthor`). Caching the plan-shape
  one under `reuse-terminal` would falsely claim "zero Proposal/Plan agent" savings for a terminal
  that already spent a real `PlanAuthor` dispatch, and would need to validate cached Plan-file content
  this record does not hash at all. A plan-shape-preflight-rejected prior generation is still
  `resume`-eligible (its rank is after `Adjudicate`), just not `reuse-terminal`-eligible.
- **`RESUMABLE_PHASES` excludes `Adjudicate` itself** (a strict `>`, not `>=`, threshold) — an
  `adjudicate-failed` terminal cannot positively confirm its `task_write` succeeded; treating it as
  resume-eligible risks resuming from a Proposal the failed `Adjudicate` never actually wrote. A
  sharper reading of the charter's "at or after Adjudicate" phrasing, adopted for the same
  fail-closed reason every other branch of this function already follows.
- **`--decide-resume` computes `reviewPolicyHash` from the `PREFLIGHT_POLICY_VERSION` CONSTANT
  in-process, never by dispatching `--preflight`** — resolves what would otherwise be a circular
  ordering problem (decide-resume must run BEFORE the content `Preflight` check, to also skip that
  mechanical dispatch on a `reuse-terminal` hit, but would need a value the content check itself
  reports). Both constants are plain, cheap-to-import literals; referencing them directly removes a
  race and a redundant dispatch entirely.
- **`reuse-terminal`'s lease release is embedded inside the `--decide-resume` CLI call itself, and
  generation recording is piggybacked onto the existing `--release` call at every other terminal** —
  both changes keep the total `agent()` dispatch count on every path at most equal to today's
  (`reuse-terminal`: one dispatch total, replacing what would otherwise be Admission's acquire +
  decide + release = fewer calls than a naive three-dispatch design; every other terminal: one
  dispatch, unchanged from today's bare `--release`). Neither closes a race by accident — embedding
  release inside `reuse-terminal`'s decide call is the specific fix for the window where a second
  dispatch could observe `prepare-already-running` for a task about to vanish.
- **`reuse-terminal` never overwrites `.generation.json`** — nothing about the world changed, so a
  byte-identical rewrite would be a no-op that only adds risk of a corrupt partial write. [[DIR-126-D]]'s
  own future full per-attempt archive is explicitly this child's Non-goals, not a half-implementation
  here.
- **Explicit `callerOverride` (`true`/`false`) never triggers a `--decide-resume` dispatch at all** —
  not just "the decision is forced," the CALL ITSELF is skipped, so the explicit paths' observable
  dispatch count and returned `outcome`/`reason` stay byte-identical to pre-this-child behavior. The
  terminal `--record-generation` write still happens on those paths (harmless, and lets a LATER
  omitted-flag dispatch benefit from an override-driven generation's provenance).
- **Resume decisions are derived from stored hash/provenance comparison, never a live content-diff or
  a cheap re-review** — DIR-125's ledger/finding machinery already handles content-quality judgment;
  this mechanism only answers "is it safe to skip re-deriving," never "is it good."
- **AC/DoD/Touches and review-policy changes invalidate BOTH resume and reuse** — a wiring defect can
  be fixed by changing an AC while leaving Proposal prose untouched, and a detector-policy bump must
  not inherit an older checker's conclusion.
- **Not reusing the `Workflow` engine's own `resumeFromRunId` cache** — CLAUDE.md's own M144/M176
  entries document that cache as keying only on `(prompt, opts)`, blind to external file/task-state
  changes, exactly the wrong tool for a decision that must react to charter/task/source mutation.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| `$a.resumeFromAdjudicatedProposal === true` | forced resume, zero `--decide-resume` dispatch (unchanged from today) |
| `$a.resumeFromAdjudicatedProposal === false` | forced cold, zero `--decide-resume` dispatch (unchanged effective behavior) |
| Omitted, no prior record for taskId | `cold` (fail closed) |
| Omitted, charter/task-contract/review-policy hashes all match, prior `terminalPhase` ranks after `Adjudicate`, Proposal hash differs | `resume` — skip `ProposalAuthors`/`Adjudicate`, still run unconditional round-0 `ProposalReview` |
| Omitted, all hashes match INCLUDING Proposal hash, prior `(terminalPhase,reason)` in the cacheable allowlist | `reuse-terminal` — zero Preflight/`ProposalAuthors`/`Adjudicate`/`ProposalReview`/`PlanAuthor`/`PlanCheck` dispatches, lease released inline |
| Omitted, all hashes match but prior terminal is non-cacheable (e.g. `soft-budget-exceeded`, `delta-cap-exhausted`, `plan-author-failed`, `PreflightPlan`'s own `preflight-rejected`) | `cold` |
| Omitted, prior `terminalPhase` at or before `Adjudicate` (e.g. `proposal-author-incomplete`, `adjudicate-failed`) | `cold` (not `resume`-eligible; `reuse-terminal`-eligible only if also on the cacheable allowlist) |
| Charter/task-contract/review-policy hash differs from prior record | `cold` (first mismatched field named in `reason`) |
| `--decide-resume` CLI exits non-zero / unparseable JSON | `{outcome:'needs-human', reason:'resume-decision-failed'}`, fail-closed, never silently treated as cold or resume |
| `reuse-terminal` selected but the embedded lease release fails | `{outcome:'needs-human', reason:'reuse-terminal-release-failed'}`, never reports a clean cache hit with a stranded owner |
| Any exception inside `decideResumeGeneration`'s own evaluation | `cold` (fail-closed, per evaluation-order step 3) |

### Compatibility

`$a.resumeFromAdjudicatedProposal`'s explicit `true`/`false` semantics stay byte-identical: no new
agent dispatch, no new file read/write at entry, identical returned `outcome`/`reason`/`phase`
shapes (the terminal `--record-generation` write is new on every path, but has no effect on
decision-relevant returned fields). Only the omitted case changes behavior (from today's implicit
hard-coded `false` to a derived three-way decision). `capsFor()`/DIR-125's bounded-convergence caps,
`MAX_PLANCHECK_ROUNDS`, `wiring-coverage-check.ts`, and the `preparation.json`/`proposal-ledger.json`
receipt shape are untouched. `milestone-preparation-check.ts`'s existing import of
`proposal-convergence.ts` stays side-effect-free (CLI code guarded by `isDirectEntry`).
`prepare-admission-check.ts` is imported read-only (`PREFLIGHT_POLICY_VERSION`, `releaseLease`),
never edited — zero diff against that file, confirmed as its own AC item below. The new
`.quay/prepare-leases/<taskId>.generation.json` file is additive and gitignored, never read by
`milestone-preparation-check.ts`'s existing checks. Both workflow mirrors and both
`proposal-convergence.ts` mirrors stay byte-identical via the existing vendor-sync mechanism
(`sync-vendor.sh --check`/`cmp`).

### Risks

- **Cross-child interface risk (this child → [[DIR-126-D]]):** [[DIR-126-D]]'s own task body already
  commits to inheriting this child's record shape as a compatibility contract; the concrete residual
  risk is DIR-126-D choosing a different keying/path convention than
  `.quay/prepare-leases/<taskId>.generation.json` — flagged for that later child, not fully mitigated
  here.
- **A wrong auto-resume decision could silently skip re-authoring against a since-changed charter** —
  mitigated by `charterHash` being a hard equality gate (evaluation step 6), not a soft signal.
- **A stale cached terminal could suppress useful work after a task/checker change** — mitigated by
  binding reuse to Proposal + AC/DoD/Touches + charter + review-policy hashes AND a narrow
  `(terminalPhase,reason)`-pair allowlist; any mismatch forces cold.
- **Embedding lease release inside `--decide-resume`, and generation recording inside `--release`,
  couples two previously-separate concerns into one CLI invocation each** — mitigated by keeping
  `releaseLease()` itself unchanged (imported, not reimplemented) and by requiring its own explicit
  fail-closed branch (see Defaults table) rather than silently swallowing a release failure.
- **Hosting the new CLI on `proposal-convergence.ts` instead of `prepare-admission-check.ts`'s more
  established CLI-wrapper convention is a real, if narrow, stylistic inconsistency** — two now-similar
  "pure decisions + thin CLI" files exist instead of one growing file; mitigated by the fact that the
  alternative (editing `prepare-admission-check.ts`) is not merely inconsistent but mechanically
  incompatible with this task's own declared `## Touches`.

### Non-goals

Not implementing [[DIR-126-A]]'s admission/lease logic or [[DIR-126-B]]'s preflight checks (both
already landed, only consumed read-only). Not building [[DIR-126-D]]'s full per-attempt telemetry
archive, its `--telemetry`/`--telemetry-report` CLI, its tamper-detection hash-binding into the
receipt, or per-attempt records for `reuse-terminal`/contention/pre-lease exits — this child ships
only the single-record "latest known generation" shape [[DIR-126-D]]'s own task explicitly treats as
an interim/frozen starting point to extend, never redesign. Not building [[DIR-126-E]]'s capacity
report. Not re-deriving Proposal content quality — that stays DIR-125's ledger/finding machinery's
job. Not adding any new export or CLI mode to `prepare-admission-check.ts`, and not editing
`.gitignore` — both are explicit scope boundaries this design's Touches-compliance depends on.

### AC coverage / mechanism-claim wiring coverage (DIR-117)

- **WIRING-CLAIM R1** (charter's own "most important" AC): `decideResumeGeneration` has a real
  production callsite — via `proposal-convergence.ts --decide-resume`, dispatched by `agent()` from
  `prepare-milestone.js` (both mirrors), ONLY when `$a.resumeFromAdjudicatedProposal` is omitted, at
  the point strictly before `phase('Preflight')`.
- **WIRING-CLAIM R2:** explicit `true`/`false` dispatches make ZERO `--decide-resume` calls — a
  fixture/journal check distinct from "explicit behavior unchanged," since a caller could satisfy
  "same returned outcome" while still wastefully dispatching the new CLI underneath.
- **WIRING-CLAIM R3** (charter's "no lease is stranded" AC, sharpened): the lease release on
  `reuse-terminal` happens INSIDE the same `--decide-resume` invocation, not a second dispatch — a
  journal check that exactly one admission-related CLI dispatch occurs on the `reuse-terminal` path
  beyond Admission's own `--acquire`.
- **WIRING-CLAIM R4** (charter's "unchanged stable terminal is not recomputed" AC, sharpened): on
  `reuse-terminal`, the content `Preflight` check is ALSO skipped (return happens strictly before
  `phase('Preflight')`) — a stronger claim than "zero content/review agent," needing its own journal
  assertion distinct from "zero `ProposalAuthors`/`Adjudicate`/`ProposalReview`" counts.
- **WIRING-CLAIM R5:** `prepare-milestone.js` pairs `_releaseLeaseAndRecord` at all **15** real
  post-Admission terminal-return sites (the live-verified count, not an assumed 11 or 12), except the
  two pre-acquisition returns and the `reuse-terminal` short-circuit — a coverage-count fixture
  (real terminal-return sites vs. real record-write callsites). **And the `--terminalPhase` ARGUMENT
  VALUE is itself constrained at the production callsites, not merely the call count:** a
  production-callsite grep confirms the two content-preflight sites (lines 182/192) pass the literal
  `--terminalPhase PreflightContent` while the two plan-shape sites (lines 555/564) pass the literal
  `--terminalPhase PreflightPlan` — so an implementation that wired all 15 sites yet passed a coarse
  `'Preflight'` at both preflight callsites would FAIL this claim, because that coarse value would
  render the post-`PlanAuthor` plan-shape rejection indistinguishable from the content rejection and
  thus unsoundly cacheable in production.
- **WIRING-CLAIM R6:** `reuse-terminal` does NOT overwrite `.generation.json` — a fixture proving the
  file's hash/mtime is unchanged after a real `reuse-terminal` dispatch.
- **WIRING-CLAIM R7:** the `(terminalPhase,reason)`-pair cacheable allowlist correctly distinguishes
  `PreflightContent`/`preflight-rejected` (cacheable) from `PreflightPlan`/`preflight-rejected` (NOT
  cacheable, falls through to `resume`-or-`cold`) — a dedicated fixture, since both currently return
  the literal identical `reason` string. **This claim has two halves, and the pure-function fixture
  alone satisfies neither end-to-end:** (a) the fixture proves `decideResumeGeneration` distinguishes
  the two hand-authored records, AND (b) a production-callsite check (the same grep as WIRING-CLAIM
  R5) proves the plan-shape `_releaseLeaseAndRecord` sites (lines 555/564) actually record
  `terminalPhase:'PreflightPlan'` in a real run — so a real plan-shape `preflight-rejected` terminal
  writes a NON-cacheable record and the next omitted-flag dispatch resolves `resume`-or-`cold`, never
  `reuse-terminal`. Without half (b) an implementation could pass the fixture while passing a coarse
  `'Preflight'` in production and unsoundly cache the plan-shape rejection end-to-end.
- **WIRING-CLAIM R8:** `proposal-convergence.ts`'s new CLI tail is guarded by `isDirectEntry`, so
  `milestone-preparation-check.ts`'s existing static import triggers zero argv parsing / `fs` access
  — an import-time side-effect check, not merely "the file still exports `capsFor`."
- **WIRING-CLAIM R9** (the direct fix for this proposal's own Problem-framing finding): `git diff
  --stat` against `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` and
  `.gitignore` is empty for this child's own commit(s) — this design's entire mechanism lands inside
  the six files this task's `## Touches` already names, closing the scope violation two earlier
  drafts of this same proposal would have introduced.
- Charter's existing ACs — automatic safe resume, unchanged-terminal reuse, no stranded lease, review
  stays unconditional under resume, explicit-flag byte-identical behavior, mirror parity — are all
  covered by the control/data flow and Defaults table above; none are weakened by this design.

### Alternatives considered and rejected

- **Add `--decide-resume`/`--record-generation` CLI modes directly to `prepare-admission-check.ts`**
  (the shape two earlier drafts of this proposal chose, following that file's own established
  "thin CLI wrapper" convention structurally). Rejected: `prepare-admission-check.ts` is not in this
  task's `## Touches`, and [[DIR-126-B]]'s own landed `preflightTouchesMismatch` check would
  mechanically flag a Plan that edits it as a blocking `preflight-touches-mismatch` finding —
  confirmed by direct read of that check's blocking branch. Hosting the CLI on
  `proposal-convergence.ts` instead achieves the identical functional shape without the violation.
- **Dispatch inline `node -e "<snippet>"` commands from within `prepare-milestone.js`'s own `agent()`
  prompts**, rather than a persistent CLI file. Rejected: every existing dispatch in this file targets
  a real, testable script file (`node --experimental-strip-types <file> <flags>`), never inline code;
  inline snippets are harder to unit test in isolation, harder to grep/import-graph-verify for
  WIRING-CLAIM purposes, and more fragile to escape correctly across two dispatch call sites and two
  vendor-synced mirrors. A thin CLI on an already-in-Touches file gets the same zero-new-file-outside-
  Touches property with none of those costs.
- **Re-running `ProposalReview` once, cheaply, to check for drift instead of a hash comparison** —
  still spends a real agent dispatch and adds latency/cost the hash-comparison design avoids entirely
  for the common case, for no better fail-closed guarantee than comparing recorded hashes.
- **Deriving `reviewPolicyHash` by actually dispatching `--preflight` before deciding**, rather than
  referencing `PREFLIGHT_POLICY_VERSION` in-process — creates a circular ordering dependency
  (decide-resume wants to run BEFORE `Preflight`, to also save that mechanical dispatch on a
  `reuse-terminal` hit) and doubles the mechanical CLI cost on every generation for a value that is a
  compile-time constant.
- **Milestone-id-keyed storage** (`milestones/<milestoneId>/generation-record.json`, matching
  `preparation.json`/`proposal-ledger.json`'s existing nesting) — rejected because a retry of the same
  `taskId` gets a NEW `milestoneId` each generation (confirmed via M197's own `milestone_counter`
  history), so lookup-by-`taskId` would need an unbounded scan; a `taskId`-keyed sibling file inside
  the already-gitignored lease directory answers the lookup in one read with zero new `.gitignore`
  surface.
- **Matching `reuse-terminal` eligibility on `reason` string alone** (the charter's literal prose) —
  rejected because the live code returns the SAME `'preflight-rejected'` string from two points in
  the pipeline with very different real costs to re-derive; a `(terminalPhase, reason)` pair is the
  minimum precision that avoids unsoundly caching the post-`PlanAuthor` case.
- **Threading the CURRENT Proposal hash through JS locals computed once at Admission time**, rather
  than having `--record-generation` re-read the task file fresh at each terminal write — rejected
  because the Proposal can be revised multiple times between entry and a downstream terminal (e.g.
  across `ProposalReview` delta-round revisions), so a hash captured once at entry would be stale by
  the time a later terminal fires; re-reading fresh at write time is strictly more correct at
  negligible extra cost.
- **A `>=` (inclusive) `Adjudicate` threshold for `RESUMABLE_PHASES`**, matching the charter's literal
  "at or after Adjudicate" wording — rejected in favor of a strict `>` threshold: an `adjudicate-failed`
  terminal's `task_write` may never have completed, so treating it as already-adjudicated risks
  resuming from a Proposal that generation never actually wrote.
- **Track a full history array of past generations per task instead of just the latest** — rejected:
  `decideResumeGeneration` only ever needs the most recent terminal generation; a single overwritten
  record (matching the lease file's own single-record-per-file convention) avoids unbounded file
  growth, at the cost of losing older history — acceptable since [[DIR-126-D]]'s own future durable
  telemetry record is the correct home for full cross-generation history, not this child.
- **Store the generation record on the task itself** (via `task_write` into a new body section or
  `extra` field) instead of a local `.quay/prepare-leases/` file — rejected: the task body/extra
  fields are the Provider-ABI-visible, human/audit-facing surface (DIR-028 task-canonical principle),
  and every `task_write` is itself a real dispatch cost this mechanism exists to avoid paying on the
  `reuse-terminal` path.

## Plan

Checked — see docs/plans/M202-dir-126-c.md (milestone M202, charter
experiments/quay-perpetual-stream/charters/M202-dir126c-generation-aware-resume.md, base revision
480cb58). Seven ordered stages (RED pure-function fixtures → implement decideResumeGeneration →
thin --decide-resume/--record-generation CLI tail → prepare-milestone.js decision wiring →
_releaseLeaseAndRecord at all 15 terminal sites → mirror sync → real non-fixture dispatch proof +
independent audit) mechanically cover all 27 AC items — verified via milestone-preparation-check.ts
validatePlanStructure ("plan-structure-ok, 7 stage(s), all 27 task AC item(s) mapped"), with every
stage - Files: path inside this task's own ## Touches. Depends on [[DIR-126-A]] (landed
a0aba1f/M200) and [[DIR-126-B]] (landed 528897c/M201), both consumed read-only (zero diff — AC9/R9).

## Finding

1. `.claude/workflows/prepare-milestone.js` line 88 (confirmed by direct read; corrected 2026-07-29,
   ProposalReview finding d34fcbdd — an earlier draft of this item cited line 46, contradicting this
   same document's own correct "## Proposal > Problem framing" citation): `_resumeFromAdjudicatedProposal = $a.resumeFromAdjudicatedProposal === true` — a bare boolean read,
   no derivation, no hash comparison.
2. `OUTER-LOOP.md`'s CALLER RULE documents the resume decision as a human/caller judgment call in
   prose, not a mechanically verified one — confirmed by direct read.
3. The round-0 full-review `agent()` call in `prepare-milestone.js` sits outside the
   `_resumeFromAdjudicatedProposal` skip block (confirmed by direct read) — review already stays
   unconditional under resume today; this child's own AC must not regress that property.

## Requested action

1. Add `decideResumeGeneration({priorGenerationRecord, currentCharterHash,
   currentTaskContractHash, currentTaskProposalHash, currentReviewPolicyHash, callerOverride})` to
   `proposal-convergence.ts` (+ `plugin/scripts/` mirror) per the Chosen mechanism above, returning
   typed `cold`, `resume`, or `reuse-terminal` decisions and reasons.
2. Wire `prepare-milestone.js` (both mirrors) to call `decideResumeGeneration` when
   `$a.resumeFromAdjudicatedProposal` is omitted, preserving the existing explicit-`true`/explicit-
   `false` behavior unchanged.
3. Add real test fixtures: repaired-Proposal auto-resume; unchanged cacheable split/preflight
   terminal reuse with zero agents; Proposal, AC/DoD/Touches, charter, or checker-policy mutation
   invalidating reuse; transient/unknown terminal forcing cold; missing provenance failing closed;
   and confirmation that `ProposalReview` round 0 still runs for every forced/automatic resume
   generation that executes.
4. Real regression proof: one real cold dispatch and one real dispatch that hits the automatic-
   resume path (no explicit flag), with journal evidence showing the correct
   `ProposalAuthors`/`Adjudicate` skip/no-skip behavior in each case, plus one real unchanged-input
   terminal-reuse dispatch proving zero content/review agents.
5. Wire `reuse-terminal` through [[DIR-126-A]]'s real release path before return and prove a
   subsequent same-task dispatch can acquire Admission normally.

## Acceptance Criteria

- [ ] **Most important — real production wiring, not agent-prompt guidance:** a grep/import-graph
  check shows `decideResumeGeneration` has a REAL production callsite from `prepare-milestone.js`
  (both mirrors) at the point `_resumeFromAdjudicatedProposal` is read today — not zero importers,
  not `--selftest`-only reachability. This item alone, if unmet, fails the whole child regardless
  of how many other items pass.
- [ ] **Automatic safe resume:** a real, adjudicated-and-since-repaired Proposal whose
  task-contract/charter/review-policy hashes still match resumes with zero
  `ProposalAuthors`/`Adjudicate` calls when the flag is omitted — confirmed via real journal
  evidence (not a fixture-only claim for this specific scenario).
  **Any mismatch forces a fresh generation:** Proposal, task-contract, charter, review-policy/source
  mutation, or a missing prior record starts a new generation — confirmed via fixtures for each
  distinct cause.
- [ ] **Unchanged stable terminal is not recomputed:** a dedicated fixture and a real journal prove
  that identical task/Proposal/charter/review-policy hashes plus a cacheable
  `split-recommended`/`preflight-rejected` terminal return `reuse-terminal` before any content
  `Preflight`, Proposal/Plan content, or review agent — WIRING-CLAIM R4's sharpened form of this
  item: `reuse-terminal` returns strictly before `phase('Preflight')` itself, not merely before
  `ProposalAuthors`/`Adjudicate`, since the mechanical content check is itself skipped on a cache
  hit. The same fixture with an agent-failure, budget, PlanCheck, or unknown terminal reason forces
  cold — and, end-to-end (not fixture-only), a `PreflightPlan`/`preflight-rejected` terminal ALSO
  forces `resume`-or-`cold`, never `reuse-terminal`, because that terminal depends on Plan-file
  content this mechanism's hashes never cover and a real `PlanAuthor` has already run by the time it
  fires.
- [ ] **No lease is stranded by terminal reuse:** the real `reuse-terminal` journal shows
  [[DIR-126-A]]'s production release call before return, and an immediate subsequent same-task
  dispatch acquires Admission rather than receiving `prepare-already-running`; an injected release
  failure is typed and fail-closed.
- [ ] **Review stays unconditional under resume:** confirmed, via source read AND a real journal,
  that `ProposalReview`'s round-0 full review still dispatches under both the explicit-`true`
  forced-resume path and the new automatic-resume path whenever a generation executes.
  `reuse-terminal` is additionally proved unable to advance to PlanAuthor/Receipt.
- [ ] `$a.resumeFromAdjudicatedProposal`'s explicit `true`/`false` behavior is confirmed unchanged
  (golden-replay comparison against the pre-this-child baseline for both explicit values).
- [ ] **Corrected 2026-07-29, ProposalReview finding 7ef01082:** canonical and `plugin/` mirrors of
  `proposal-convergence.ts` and `prepare-milestone.js` — the two real, byte-identical file pairs
  this child touches — are confirmed identical via `cmp` and `sync-vendor.sh --check` (the latter
  covers `proposal-convergence.ts`, already in `SYNC_SCRIPTS`; `prepare-milestone.js` is checked via
  the existing manual `cmp` convention `plugin-packaging.test.mjs` already exercises). This task's
  own two test files (`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`,
  `plugin/test/prepare-milestone-convergence.test.mjs`) are each real, own-purpose test files, NOT a
  mirror pair of each other (different basenames, different content — pure-function unit tests vs.
  workflow-integration tests) and are not byte-identity-checked by any existing mechanism; this item
  requires only that each independently passes its own real test run, correcting the prior draft's
  factually-wrong claim that they are compared for byte-identity.
- [ ] **WIRING-CLAIM R3 — embedded lease release closes the two-dispatch race window, not just "the
  release eventually happens":** a real journal check confirms exactly ONE admission-related CLI
  dispatch occurs on the `reuse-terminal` path beyond Admission's own `--acquire` (the
  `--decide-resume` call itself, with `releaseLease` embedded inside it) — a naive two-call
  implementation (decide, then separately dispatch `--release`) would satisfy "No lease is stranded
  by terminal reuse" identically without closing the actual race window this design's own Key
  design decisions section says the embedding exists to fix, so this item requires the
  dispatch-count evidence specifically, distinct from that end-state bullet.
- [ ] **WIRING-CLAIM R9 — real Touches-scope containment, not a prose promise:** `git diff --stat`
  against `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` and `.gitignore`
  is empty for every commit landing this child — a real, post-Build `git diff` check, not merely a
  design-decision paragraph. This is the direct, mechanically-checkable fix for this Proposal's own
  Problem-framing finding (a prior draft's design would have gotten mechanically flagged by
  [[DIR-126-B]]'s own landed `preflightTouchesMismatch` check).
- [ ] **WIRING-CLAIM R7 — `(terminalPhase, reason)` pair disambiguation, not `reason` alone:** a
  dedicated fixture proves a prior `{terminalPhase:'PreflightContent', reason:'preflight-rejected'}`
  record IS `reuse-terminal`-eligible while a prior `{terminalPhase:'PreflightPlan',
  reason:'preflight-rejected'}` record (the identical `reason` string, different `terminalPhase`) is
  NOT — confirming the allowlist keys on the pair, not the bare string two real call sites both emit.
  **Plus the production-callsite half (not fixture-only):** the same production grep as WIRING-CLAIM
  R5 confirms the plan-shape `_releaseLeaseAndRecord` sites (lines 555/564) record
  `terminalPhase:'PreflightPlan'` in a real run, so a real plan-shape `preflight-rejected` terminal
  writes a NON-cacheable record and a subsequent omitted-flag dispatch resolves `resume`-or-`cold`,
  never `reuse-terminal` — closing the gap where a coarse production `--terminalPhase` value would
  pass the pure-function fixture yet unsoundly cache the plan-shape rejection end-to-end.
- [ ] **WIRING-CLAIM R2 — explicit flags dispatch zero `--decide-resume` calls:** a real journal
  check confirms both `$a.resumeFromAdjudicatedProposal === true` and `=== false` dispatches contain
  no `--decide-resume`-labeled `agent()` call at all — a stronger claim than "same returned
  outcome," since a caller could satisfy that while still wastefully dispatching the new CLI
  underneath.
- [ ] **WIRING-CLAIM R5 — all 15 real terminal-return sites, not an assumed count:** a coverage
  fixture independently re-derives the live `_releaseLease(`-call-site count via `grep -n
  "_releaseLease("` (expected: 15) and confirms every one of them, except the two pre-acquisition
  returns and the `reuse-terminal` short-circuit, now calls `_releaseLeaseAndRecord` instead.
  **Separately, a production-callsite grep confirms the `--terminalPhase` ARGUMENT VALUE at the two
  preflight record-write sites — NOT merely the call count:** the content-preflight sites (lines
  182/192) pass literal `--terminalPhase PreflightContent` and the plan-shape sites (lines 555/564)
  pass literal `--terminalPhase PreflightPlan`. An implementation that wired all 15 sites yet passed
  a coarse `'Preflight'` at both would satisfy the count while failing this item, since that coarse
  value would make the plan-shape rejection unsoundly cacheable in production. This is `prepare-milestone.js`'s own real production wiring, confirmed distinct from the coarse `phase('Preflight')`/`phase('PlanAuthor')` labels both call sites otherwise share.
- [ ] **WIRING-CLAIM R6 — `reuse-terminal` never overwrites `.generation.json`:** a fixture captures
  `.quay/prepare-leases/<taskId>.generation.json`'s hash/mtime before a real `reuse-terminal`
  dispatch and confirms both are byte-for-byte unchanged after.
- [ ] **WIRING-CLAIM R8 — `proposal-convergence.ts`'s new CLI tail is side-effect-free on import:** a
  fixture imports `proposal-convergence.ts` (the same way `milestone-preparation-check.ts` already
  does) in a process with no CLI argv and confirms zero `fs`/argv-parsing side effects fire —
  distinct from merely confirming the file still exports `capsFor`.

- [ ] **Grounding evidence for the Problem-framing/Chosen-mechanism claims above (added for
  wiring-coverage completeness):** confirmed via direct source read — `OUTER-LOOP.md` documents the
  caller obligation to pass `{resumeFromAdjudicatedProposal: true}` only in prose today (the
  CALLER RULE), not a mechanically verified decision. This child's real, production-wired fix:
  `decideResumeGeneration` is called from `prepare-milestone.js` (confirmed via the production-
  callsite AC item above) whenever `$a.resumeFromAdjudicatedProposal` is `undefined` — replacing
  today's implicit hard-coded `false` default — while the explicit `true`/`false` values keep their
  existing behavior; the real, unconditional `ProposalReview` round-0 review call is confirmed
  (via the same AC item) to still run for every forced/automatic resume generation that executes,
  while `reuse-terminal` is confirmed unable to advance to PlanAuthor/Receipt.

- [ ] **Grounding evidence 1 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `Preflight` `Adjudicate` `PlanAuthor` `reason: 'preflight-rejected'` `grep -n "_releaseLease('preflight-rejected')"`.
- [ ] **Grounding evidence 2 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `proposal-convergence.ts` `isDirectEntry(import.meta)` `prepare-admission-check.ts` `gate-script-base.ts` `milestone-preparation-check.ts` `import { blockingOpen, validateConvergenceCounters, computeConvergenceMetrics } from "./proposal-convergence.ts"` (the real import — repo-wide grep confirms `capsFor` is imported only by `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`, NOT by `milestone-preparation-check.ts`) `fs`.
- [ ] **Grounding evidence 3 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `--decide-resume --taskId <id> --workspace . --charterFile <charterFile> [--callerOverride true|false]` `tasks/<taskId>.md` `## Acceptance Criteria` `## Definition of Done` `## Touches` `extractSection` `task-schema.ts` `currentTaskContractHash` `## Proposal` `currentTaskProposalHash` `currentReviewPolicyHash` `PREFLIGHT_POLICY_VERSION` `prepare-admission-check.ts` `RESUME_POLICY_VERSION` `"resume-v1"` `.quay/prepare-leases/<taskId>.json` `--acquire` `{ownerExecutionId, fencingToken, acquiredAt}` `generationId = sha256(` `).slice(0, 12)` `sha256(identity).slice(0,12)` `fingerprintFinding` `.quay/prepare-leases/ <taskId>.generation.json` `null` `decideResumeGeneration` `reuse-terminal` `releaseLease` `prepare-already-running`.
- [ ] **Grounding evidence 4 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `--record-generation --taskId <id> --workspace . --terminalPhase <phase> --outcome <o> --reason <r> --cacheable <bool>` `--decide-resume` `ProposalReview` `generationId` `.quay/prepare-leases/<taskId>.generation.json` `agent()` `releaseLease` `--release` `prepare-milestone.js`.
- [ ] **Grounding evidence 5 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `terminalPhase` `phase()` `'Preflight'` `preflight-rejected`.
- [ ] **Grounding evidence 6 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `PreflightContent` `Adjudicate` `ProposalAuthors` `ProposalReview` `PlanAuthor` `PreflightPlan` `PlanCheck` `Receipt`.
- [ ] **Grounding evidence 7 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `return` `_releaseLease(stageLabel)` `prepared` `_releaseLease` `_releaseLeaseAndRecord(stageLabel, {outcome, reason, cacheable})` `proposal-convergence.ts --record-generation` `--release`.
- [ ] **Grounding evidence 8 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `admission-check-failed` `prepare-already-running` `reuse-terminal` `--decide-resume` `.generation.json`.
- [ ] **Grounding evidence 9 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `reuse-terminal` `--decide-resume` `--release` `agent()`.
- [ ] **Grounding evidence 10 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `callerOverride` `true` `false` `--decide-resume` `outcome` `reason`.
- [ ] **Grounding evidence 11 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `(terminalPhase,reason)` `reuse-terminal` `ProposalAuthors` `Adjudicate` `ProposalReview` `PlanAuthor` `PlanCheck`.
- [ ] **Grounding evidence 12 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read — `true` `false` `--decide-resume`.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/prepare-milestone.js`, the control-plane script every future milestone's
  Prepare stage runs through).
- [ ] A real, non-fixture cold dispatch AND a real, non-fixture automatic-resume dispatch are both
  exercised end to end with journal output, not asserted.
- [ ] A real unchanged-input `reuse-terminal` dispatch releases its Admission lease and spends zero
  Proposal/Plan content or review agents.
- [ ] RED/GREEN evidence exists for matching-contract repaired-Proposal resume,
  charter-mutation-forces-fresh, unchanged-input stable-terminal reuse,
  task-contract/checker-policy invalidation, transient-terminal cold, and
  missing-provenance-fails-closed.
- [ ] A fresh independent audit confirms the real production callsite and confirms review staying
  unconditional under resume, not merely unit-test reachability.

## Human verification when exp5 marks this DIR done

1. Does a repaired Proposal resume automatically only when its hashes and provenance make reuse
   safe?
2. Does an unchanged stable split/preflight terminal return without Authors, Adjudicate, or another
   review, while any task/charter/checker change invalidates that reuse?
3. Does `ProposalReview`'s own independent review still run unconditionally under both forced and
   automatic resume generations that execute?

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`
- `plugin/scripts/proposal-convergence.ts`
- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- `plugin/test/prepare-milestone-convergence.test.mjs`