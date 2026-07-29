---
id: DIR-126-C
title: Generation-aware resume for prepare-milestone.js (decideResumeGeneration in
  proposal-convergence.ts) — third child of DIR-126's split
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

Replace `prepare-milestone.js`'s caller-supplied `resumeFromAdjudicatedProposal` boolean with a
fail-closed, hash/provenance-derived three-state decision: safely resume a repaired Proposal,
reuse an unchanged stable terminal without dispatching agents, or start cold when inputs/policy
changed or evidence is insufficient. Third child of DIR-126's 5-way split. Depends on
[[DIR-126-A]] (a resume/reuse attempt is itself an admission event — the new `Admission` phase must
run, and succeed, before any resume-vs-reuse-vs-cold decision matters).

### Problem framing (re-verified live against the current tree, 2026-07-29)

`.claude/workflows/prepare-milestone.js` line 46: `_resumeFromAdjudicatedProposal =
$a.resumeFromAdjudicatedProposal === true` — read once, trusted, with no derivation. `OUTER-LOOP.md`
documents the real caller obligation only in prose ("CALLER RULE: ... the retry dispatch for that
same task MUST pass `{resumeFromAdjudicatedProposal: true}`") — a human/caller judgment call, not a
mechanically verified one. A stale `true` could silently skip re-authoring against a since-changed
charter; a missing `true` burns a fresh `ProposalAuthors`+`Adjudicate` cycle even when the on-disk
Proposal is already safely reusable. This is the exact class of caller-judgment risk DIR-126's
Finding names as gap 3.

### Chosen mechanism

`experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` (+ `plugin/scripts/` mirror)
gains a pure function `decideResumeGeneration({priorGenerationRecord, currentCharterHash,
currentTaskContractHash, currentTaskProposalHash, currentReviewPolicyHash, callerOverride})`,
replacing the role `_resumeFromAdjudicatedProposal` plays today in `prepare-milestone.js` (both
mirrors). `currentTaskContractHash` covers the review-relevant non-Proposal task sections (AC, DoD,
Touches); `currentReviewPolicyHash` covers the workflow/checker policy version, including
[[DIR-126-B]]'s preflight checker version/hash once B lands.

**Resume (skip `ProposalAuthors`/`Adjudicate`) fires only when ALL of:**
1. The prior generation record's `taskId` matches the current dispatch's.
2. The prior record's `charterHash` equals the current charter file's real hash (a charter edit
   forces a fresh generation).
3. The prior record's `taskContractHash` and `reviewPolicyHash` equal the current values (an AC,
   DoD, Touches, workflow, or checker-policy edit forces a fresh decision).
4. The prior generation's own terminal phase was at or after `Adjudicate` (an admission-rejected or
   preflight-rejected prior generation never reached a real adjudicated Proposal to resume from).
5. The current on-disk Proposal's hash actually *differs* from what that prior generation reviewed,
   proving a repair occurred after the prior terminal.

**Reuse terminal (dispatch no content/review agents) fires only when ALL review inputs are
unchanged** (`taskId`, charter hash, task-contract hash, Proposal hash, and review-policy hash) and
the prior outcome/reason belongs to an explicit cacheable-terminal allowlist. Initially that
allowlist is deliberately narrow: deterministic `preflight-rejected` and grounded
`split-recommended`. Agent crashes, incomplete authors/adjudication, `soft-budget-exceeded`,
`delta-cap-exhausted`, PlanAuthor/PlanCheck failures, and any unknown reason are never cacheable.
The workflow returns a typed `{outcome: <prior outcome>, reason: 'unchanged-generation-terminal',
priorReason, decision: 'reuse-terminal', priorGenerationId}` after Admission and before any
Proposal/Plan agent. This is the direct control that would have prevented M196 from paying for the
same split decision repeatedly. Because Admission has already acquired [[DIR-126-A]]'s lease, this
new terminal path must call A's real release mechanism before returning; a release failure stays
fail-closed/visible rather than leaving an apparently successful cache hit with a stranded owner.

`callerOverride: true|false` remains a temporary compatibility surface exactly as DIR-126's own
Requested-action item 3 permits ("keep the explicit flag as a temporary compatibility surface only
if required") — `$a.resumeFromAdjudicatedProposal`'s existing `true`/`false` semantics stay
byte-identical to today. `undefined` (the new default when the flag is omitted) invokes
`decideResumeGeneration` instead of today's implicit hard-coded `false`.

**Fail-closed on the undecidable case.** Any exception, missing prior record, missing hash, policy
version mismatch, or non-cacheable prior terminal fails closed to "start fresh generation," never
silently resuming or reusing a terminal on a case the function cannot positively confirm safe —
its own dedicated missing-provenance/policy fixtures.

**Review stays unconditional for every generation that executes.** The existing `ProposalReview`
round-0 full independent review stays unconditional under `resume` — the round-0 full-review agent
call sits outside the resume-skip block today and must stay there. `reuse-terminal` is not a new
generation and cannot advance to PlanAuthor/Receipt; it only re-emits a hash-bound prior terminal
before content/review dispatch. Thus no changed or newly accepted input can reach PlanAuthor
without a fresh independent review.

**Cross-child interface note.** This mechanism consumes a generation-record shape [[DIR-126-D]] is
nominally responsible for finalizing (the durable per-generation telemetry record). This child's
own landing ships against an interim/frozen record shape sufficient for `decideResumeGeneration`'s
own required inputs (`taskId`, `generationId`, `charterHash`, `taskContractHash`, Proposal hash,
`reviewPolicyHash`, terminal phase/outcome/reason) — [[DIR-126-D]] must treat that shape as a
compatibility contract it inherits, not one it silently redesigns.

### Key design decisions

- **Resume decisions are derived from a stored hash/provenance comparison, never a live content-diff
  or a cheap re-review** — the prior generation record's own recorded charter/proposal hashes are
  the trust anchor (one comparison, one boolean gate), because DIR-125's ledger/finding machinery
  already handles content-quality judgment; resume only needs to answer "is it safe to skip
  re-deriving," not "is it good." (Rejected alternative: re-running `ProposalReview` once, cheaply,
  to check for drift — still spends a real agent dispatch and adds latency/cost the hash-comparison
  design avoids entirely for the common case, for no better fail-closed guarantee.)
- **Unchanged review inputs plus a cacheable stable terminal reuse that terminal, not cold-start** —
  this avoids both a wasted re-review and the still larger waste of re-running
  `ProposalAuthors`/`Adjudicate`. The allowlist is narrow and policy-hash-bound; transient or
  unknown failures remain cold.
- **`ProposalReview`'s round-0 full review is never skipped, only `ProposalAuthors`/`Adjudicate`
  are, for an executing generation** — `reuse-terminal` cannot advance and therefore cannot carry
  an unreviewed Proposal to `PlanAuthor`.
- **AC/DoD/Touches and checker-policy changes invalidate reuse** — Proposal hash alone is
  insufficient because a wiring defect can be fixed by changing an AC while leaving Proposal prose
  untouched, and a detector upgrade must not inherit an older checker's conclusion.
- **`reuse-terminal` owns lease release before return** — it runs after Admission, so it is a new
  terminal edge that must use [[DIR-126-A]]'s production release path and prove the next dispatch is
  not falsely rejected as already running.
- **Not reusing the `Workflow` engine's own `resumeFromRunId` cache** for this decision — CLAUDE.md's
  own M144/M176 entries document that cache as keying only on `(prompt, opts)`, blind to external
  file/task-state changes, exactly the wrong tool for a decision that must react to charter/task/
  source mutation.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| `$a.resumeFromAdjudicatedProposal` omitted | automatic decision from `decideResumeGeneration` (new default) |
| `$a.resumeFromAdjudicatedProposal === true` | forced resume (unchanged from today) |
| `$a.resumeFromAdjudicatedProposal === false` | forced cold (unchanged effective behavior — today's implicit default is already always-cold) |
| All review-input hashes/policy unchanged + prior deterministic preflight rejection or grounded split recommendation | `decision: "reuse-terminal"`; re-emit typed prior terminal before content/review agents |
| Proposal changed after a prior generation, while charter/task contract/policy match and prior reached Adjudicate | `decision: "resume"`; skip Authors/Adjudicate, still run full ProposalReview |
| Prior terminal is transient/non-cacheable or unknown | `decision: "cold"` |
| Prior record's `charterHash` differs from current | treated as cold (charter edit forces fresh) |
| AC/DoD/Touches hash or review/checker-policy hash differs | treated as cold (review inputs changed) |
| Prior generation's terminal phase before `Adjudicate` | ineligible for `resume`; an unchanged, policy-matched deterministic `preflight-rejected` may still use `reuse-terminal`, otherwise cold |
| Missing/unreadable prior record | `decision: "cold"` (fail closed) |
| Any exception during decision computation | `decision: "cold"` (fail closed, never silently resumes/reuses on an undecidable case) |
| `reuse-terminal` selected but [[DIR-126-A]] lease release fails | fail closed with a typed release failure; never report a clean cache hit while ownership remains stranded |

### Compatibility

`$a.resumeFromAdjudicatedProposal`'s `true`/`false` semantics stay byte-identical to today; only
the omitted case changes behavior (from hard-coded `false` to a derived decision). Existing callers
that always pass the flag explicitly, per `OUTER-LOOP.md`'s current CALLER RULE, see zero behavior
change until they choose to stop passing it. `capsFor()`/DIR-125's bounded-convergence caps and
`wiring-coverage-check.ts`'s existing checks are untouched. Both workflow mirrors and the
`proposal-convergence.ts` mirror stay byte-identical via the existing vendor-sync mechanism.

### Risks

- **Cross-child interface risk (this child -> DIR-126-D):** this child's resume-decision function
  consumes a generation-record shape DIR-126-D is nominally responsible for finalizing. This
  child's own landing ships against an interim/frozen record shape, and DIR-126-D must treat that
  shape as a compatibility contract it inherits — an explicit AC on DIR-126-D once this child lands
  (flagged here for that later child, not fully mitigated within this child's own scope).
- **A wrong auto-resume decision could silently skip re-authoring against a since-changed charter**
  — mitigated by the `charterHash` comparison being a hard gate (any charter edit forces fresh),
  not a soft signal.
- **A stale cached split/preflight terminal could suppress useful work after task/checker changes**
  — mitigated by binding reuse to Proposal + AC/DoD/Touches + charter + review-policy hashes and a
  narrow cacheable-reason allowlist; any missing/mismatched field forces cold.

### Non-goals

Not implementing [[DIR-126-A]]'s admission/lease logic, [[DIR-126-B]]'s preflight checks,
[[DIR-126-D]]'s telemetry record (only consumes an interim/frozen shape of it), or [[DIR-126-E]]'s
capacity report. Not re-deriving Proposal content quality — that stays DIR-125's ledger/finding
machinery's job; this child only decides whether re-deriving is necessary.

## Plan

N/A — directive-class child resolved via a human-steered milestone. Depends on [[DIR-126-A]].

## Finding

1. `.claude/workflows/prepare-milestone.js` line 46 (confirmed by direct read): `_resumeFromAdjudicatedProposal = $a.resumeFromAdjudicatedProposal === true` — a bare boolean read,
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
  Proposal, task-contract, charter, review-policy/source mutation, or a missing prior record starts
  a new generation — confirmed via fixtures for each distinct cause.
- [ ] **Unchanged stable terminal is not recomputed:** a dedicated fixture and a real journal prove
  that identical task/Proposal/charter/review-policy hashes plus a cacheable
  `split-recommended`/`preflight-rejected` terminal return `reuse-terminal` before any
  Proposal/Plan content or review agent. The same fixture with an agent-failure, budget, PlanCheck,
  or unknown terminal reason forces cold.
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
- [ ] Canonical and `plugin/` mirrors of `proposal-convergence.ts`, `prepare-milestone.js`, and
  their test files are byte-identical — `cmp`/`sync-vendor.sh --check`.

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
