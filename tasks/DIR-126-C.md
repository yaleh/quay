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
fail-closed, hash/provenance-derived decision, so a repaired Proposal resumes automatically only
when it is actually safe to reuse — not only when a caller remembers to pass the flag. Third child
of DIR-126's 5-way split. Depends on [[DIR-126-A]] (a resume dispatch is itself an admission event
— the new `Admission` phase must run, and succeed, before any resume-vs-cold decision matters).

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
currentTaskProposalHash, callerOverride})`, replacing the role `_resumeFromAdjudicatedProposal`
plays today in `prepare-milestone.js` (both mirrors).

**Resume (skip `ProposalAuthors`/`Adjudicate`) fires only when ALL of:**
1. The prior generation record's `taskId` matches the current dispatch's.
2. The prior record's `charterHash` equals the current charter file's real hash (a charter edit
   forces a fresh generation).
3. The prior generation's own terminal phase was at or after `Adjudicate` (an admission-rejected or
   preflight-rejected prior generation never reached a real adjudicated Proposal to resume from).
4. The current on-disk Proposal's hash actually *differs* from what that prior generation reviewed.
   If the most recent record's outcome was non-`prepared` and the Proposal hash is UNCHANGED since
   it ran, nothing was fixed — resuming would immediately re-fail the same findings for no benefit,
   so this case is treated as cold, not resumed.

`callerOverride: true|false` remains a temporary compatibility surface exactly as DIR-126's own
Requested-action item 3 permits ("keep the explicit flag as a temporary compatibility surface only
if required") — `$a.resumeFromAdjudicatedProposal`'s existing `true`/`false` semantics stay
byte-identical to today. `undefined` (the new default when the flag is omitted) invokes
`decideResumeGeneration` instead of today's implicit hard-coded `false`.

**Fail-closed on the undecidable case.** Any exception or missing-prior-record path fails closed to
"start fresh generation," never silently resuming on a case the function cannot positively confirm
safe — its own dedicated missing-provenance fixture.

**Review stays unconditional.** The existing `ProposalReview` round-0 full independent review stays
unconditional even under resume — the round-0 full-review agent call sits outside the resume-skip
block today (confirmed by direct read of `prepare-milestone.js`) and must stay there. Automatic
resume only ever skips *re-derivation* (`ProposalAuthors`/`Adjudicate`), never *review*, limiting
the blast radius of a wrong auto-resume decision to "an unnecessary review round," never "an
unreviewed Proposal reaching PlanAuthor."

**Cross-child interface note.** This mechanism consumes a generation-record shape [[DIR-126-D]] is
nominally responsible for finalizing (the durable per-generation telemetry record). This child's
own landing ships against an interim/frozen record shape sufficient for `decideResumeGeneration`'s
own four inputs (`taskId`, `charterHash`, terminal phase, Proposal hash) — [[DIR-126-D]] must treat
that shape as a compatibility contract it inherits, not one it silently redesigns.

### Key design decisions

- **Resume decisions are derived from a stored hash/provenance comparison, never a live content-diff
  or a cheap re-review** — the prior generation record's own recorded charter/proposal hashes are
  the trust anchor (one comparison, one boolean gate), because DIR-125's ledger/finding machinery
  already handles content-quality judgment; resume only needs to answer "is it safe to skip
  re-deriving," not "is it good." (Rejected alternative: re-running `ProposalReview` once, cheaply,
  to check for drift — still spends a real agent dispatch and adds latency/cost the hash-comparison
  design avoids entirely for the common case, for no better fail-closed guarantee.)
- **Unchanged-Proposal-after-a-failed-round resumes as cold, not resumed** — resuming into the
  identical findings a prior round already produced wastes a `ProposalReview` dispatch for zero
  information gain; this is a deliberate refinement over naively resuming whenever
  `charterHash` matches.
- **`ProposalReview`'s round-0 full review is never skipped, only `ProposalAuthors`/`Adjudicate`
  are** — bounds how wrong an incorrect auto-resume decision can be: at worst, one wasted full
  review round, never an unreviewed Proposal reaching `PlanAuthor`.
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
| Prior record's outcome non-`prepared` but Proposal hash unchanged since it ran | treated as cold, not resumed (nothing was fixed; resuming would re-fail the same findings) |
| Prior record's `charterHash` differs from current | treated as cold (charter edit forces fresh) |
| Prior generation's terminal phase before `Adjudicate` (admission/preflight-rejected) | treated as cold (no adjudicated Proposal exists to resume from) |
| Missing/unreadable prior record | `decision: "cold"` (fail closed) |
| Any exception during decision computation | `decision: "cold"` (fail closed, never silently resumes on an undecidable case) |

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
   currentTaskProposalHash, callerOverride})` to `proposal-convergence.ts` (+ `plugin/scripts/`
   mirror) per the Chosen mechanism above.
2. Wire `prepare-milestone.js` (both mirrors) to call `decideResumeGeneration` when
   `$a.resumeFromAdjudicatedProposal` is omitted, preserving the existing explicit-`true`/explicit-
   `false` behavior unchanged.
3. Add real test fixtures: hash-match auto-resume, charter-mutation forces new generation,
   unchanged-Proposal-after-failed-round forces new generation, missing-provenance fails closed to
   cold, and confirmation that `ProposalReview`'s round-0 full review still runs unconditionally
   under both forced and automatic resume.
4. Real regression proof: one real cold dispatch and one real dispatch that hits the automatic-
   resume path (no explicit flag), with journal evidence showing the correct
   `ProposalAuthors`/`Adjudicate` skip/no-skip behavior in each case.

## Acceptance Criteria

- [ ] **Most important — real production wiring, not agent-prompt guidance:** a grep/import-graph
  check shows `decideResumeGeneration` has a REAL production callsite from `prepare-milestone.js`
  (both mirrors) at the point `_resumeFromAdjudicatedProposal` is read today — not zero importers,
  not `--selftest`-only reachability. This item alone, if unmet, fails the whole child regardless
  of how many other items pass.
- [ ] **Automatic safe resume:** a real, hash-matching, adjudicated-and-since-repaired Proposal
  resumes with zero `ProposalAuthors`/`Adjudicate` calls when the flag is omitted — confirmed via
  real journal evidence (not a fixture-only claim for this specific scenario).
  Task/charter/source mutation, or a missing prior record, starts a new generation or returns a
  typed decision result — confirmed via fixtures for each distinct cause.
- [ ] **Unchanged-Proposal-after-failed-round resumes as cold:** a dedicated fixture proves a prior
  non-`prepared` generation with an UNCHANGED Proposal hash is treated as cold, not resumed.
- [ ] **Review stays unconditional under resume:** confirmed, via source read AND a real journal,
  that `ProposalReview`'s round-0 full review still dispatches under both the explicit-`true`
  forced-resume path and the new automatic-resume path — no regression of this pre-existing
  property.
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
  (via the same AC item) to still run regardless of the resume decision.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/prepare-milestone.js`, the control-plane script every future milestone's
  Prepare stage runs through).
- [ ] A real, non-fixture cold dispatch AND a real, non-fixture automatic-resume dispatch are both
  exercised end to end with journal output, not asserted.
- [ ] RED/GREEN evidence exists for hash-match resume, charter-mutation-forces-fresh, unchanged-
  Proposal-after-failure-forces-fresh, and missing-provenance-fails-closed.
- [ ] A fresh independent audit confirms the real production callsite and confirms review staying
  unconditional under resume, not merely unit-test reachability.

## Human verification when exp5 marks this DIR done

1. Does a repaired Proposal resume automatically only when its hashes and provenance make reuse
   safe?
2. Does an unchanged, still-failing Proposal correctly NOT resume (avoiding a wasted re-review)?
3. Does `ProposalReview`'s own independent review still run unconditionally under both forced and
   automatic resume?

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`
- `plugin/scripts/proposal-convergence.ts`
- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- `plugin/test/prepare-milestone-convergence.test.mjs`
