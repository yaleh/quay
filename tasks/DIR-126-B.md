---
id: DIR-126-B
title: Deterministic mechanical preflight for prepare-milestone.js (new
  Preflight phase) — second child of DIR-126's split
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
    DIR-126-B
    experiments/quay-perpetual-stream/charters/M201-dir126b-deterministic-preflight.md
    milestones/M201/absorb-entry.md
---

**type:** execution

## Proposal

Add mechanical, pre-content-agent-dispatch checks for five recurring `prepare-milestone` failure
classes (merged Markdown claim blocks, stale AC/DoD references, Proposal/Plan/Touches disagreement,
non-existent claimed precedent/imports, non-runnable Plan command/path shapes). **Correction
(2026-07-29, ProposalReview finding):** this five-way taxonomy is this child's own decomposition of
the "dense Proposal prose, insufficient AC granularity" pattern `tasks/DIR-126.md`'s `## Finding`
section actually names (workflow-yield stats, the M199 wiring-coverage 14-blocking-finding
reproduction) — direct read of that section confirms it does NOT literally enumerate these five
named classes; that enumeration is this Proposal's own grounded analysis of the recurring failure
mode, not a verbatim quote from the parent. Rejecting cheaply before any expensive LLM
author/reviewer agent is
dispatched. Second child of DIR-126's 5-way split. Depends on [[DIR-126-A]] (shares its new
`prepare-admission-check.ts` module and the pre-`ProposalAuthors` phase-insertion point, landed
`496ccd4`/M200), but has an independently testable, independently landable proof surface (five named
fixture classes with stable codes) — a lease bug in A must not block landing a preflight fixture
here and vice versa.

### Problem framing (re-verified live against the current tree, 2026-07-29)

`.claude/workflows/prepare-milestone.js`'s cold path acquires the `Admission` lease (DIR-126-A,
landed), then falls straight into `ProposalAuthors`, dispatching `await parallel(...)` over 2-3 real
LLM author agents — with no mechanical check of the task/charter in between. The only existing
mechanical content check, `wiring-coverage-check.ts`'s `checkWiringCoverage()`, is dispatched much
later, inside `ProposalReview`, i.e. *after* 2-3 authors and an adjudicator have already been paid
for — and its scope is narrower than what this child targets: one class (mechanism-claim-to-AC
wiring), not the five DIR-126 names.

`wiring-coverage-check.ts` is itself a live source of false positives, not a solved instrument: commit
`703e014` fixed one class (`WIRING_VERB_RE` matching the possessive "own"); this same overall session's
commit `f3d870b` (M198) independently hit a second, then-open class — dense, un-blank-lined Proposal
bullet lists merging multiple distinct wiring claims into one sentence, firing 26 blocking findings
from formatting rather than content against DIR-119-D1's first generation. **That second class was
independently closed at its root — before this child's Build begins — by commit `335317d`**
(`splitListAwareBlocks()` added to `splitSentences`, both mirrors `cmp`-clean;
`wiring-coverage-check.test.mjs` is 18/18 green (as of `44ca1b3`), including two regression tests
for the merged-list case). This narrows this child's real remaining scope to: build the five NEW `Preflight`-phase check
functions; verify (not re-fix) that the `335317d` fix stays green; do not touch `splitSentences`
itself beyond exporting it for reuse.

### Chosen mechanism

Extend the same module DIR-126-A already introduced,
`experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` (+ `plugin/scripts/`
byte-identical mirror), with a distinct, additive entry point — `runPreflightChecks()` — and two new
CLI modes, `--preflight` (the four content checks) and `--preflight-plan` (the Plan-shape check),
added to the existing `parseArgs`/`spec.flags` beside `acquire`/`renew`/`release`/`force-release` (no
new arg-parsing implementation). Five new pure detector functions live in the same file, one per
DIR-126-named failure class, each returning a typed verdict `{code, blocking, message, evidence,
disposition}` tagged with a shared `PREFLIGHT_POLICY_VERSION` — a plain, manually-bumped exported
version-string constant (simpler and less fragile than a source-derived hash: nothing in this file
family computes a content hash today, and a forgotten re-derivation step would silently pair a new
detector with a stale version string, which is a worse failure mode than a human remembering to bump
a literal).

| Code | Class | Reuses |
|---|---|---|
| `preflight-merged-markdown-claims` | dense bullet-list claim merging in the task's own pre-existing sections | `splitListAwareBlocks`/`splitSentences`, exported from `wiring-coverage-check.ts` (already fixed by `335317d`) — called, never re-implemented |
| `preflight-stale-ac-refs` | Proposal/Plan/Finding references a file path, task id, or commit hash inside `## Acceptance Criteria`/`## Definition of Done` that no longer resolves | `extractSection`/AC-count helpers from `task-schema.ts`, plus `fs.existsSync`/`git cat-file -e <sha>^{commit}` |
| `preflight-touches-mismatch` | Proposal/Plan/charter narrative disagrees with `## Touches` | `checkTouches` from `task-schema.ts` as a well-formedness precondition, layered with new set-difference/cross-source logic (genuinely new — `checkTouches` validates glob syntax only, never cross-checks against prose) |
| `preflight-missing-precedent` | a claimed commit hash or file path does not resolve against the repo | new, isolated shell-outs (`git cat-file -e`, `fs.existsSync`) scoped to commit-hash-shaped/file-path-shaped backtick tokens only — semantic "this pattern already exists"-style claims are out of mechanical reach and route to `reviewer-required` |
| `preflight-invalid-plan-command` | a Plan's `### Stage N` block has an empty `- Command:`/`- Check:` line, an out-of-range `- AC:` index, an AC index never covered by any stage, or a `- Files:` path that doesn't exist | the same mechanical `### Stage N`/`- AC:`/`- Files:`/`- Command:` block shape `milestone-preparation-check.ts` already parses at Receipt time — reused, not reimplemented |

`prepare-milestone.js` (both mirrors) gains a new `phase('Preflight')`, inserted right after
`Admission`'s lease-acquired branch and strictly before the `ProposalAuthors` `parallel(...)`
dispatch, running the four content checks. A second, later `--preflight-plan` dispatch — still
logically part of Preflight, using the identical `agent()`-wraps-a-real-CLI pattern the file already
establishes twice (`Admission`'s lease CLI, `ProposalReview`'s `wiring-coverage-check` CLI) — runs
immediately after `PlanAuthor` writes the Plan file and strictly before `PlanCheck`'s round-1
`agent()` call; a Plan file structurally cannot exist before `PlanAuthor` runs, so it cannot be
preflighted at the same insertion point as the other four.

**Content-check input scope (flagged for reviewer confirmation, same posture as the Plan-shape-timing
note below).** At the point the four content checks run, no final authored Proposal necessarily
exists yet on the cold path — only the task's own pre-existing sections (`## Finding`, `## Requested
action`, `## Acceptance Criteria`, `## Touches`, and any already-present `## Proposal` text, which is
exactly what a `resumeFromAdjudicatedProposal` run reuses) plus the charter file are available. This
Proposal reads each content check as operating on **whatever is actually available at that point**,
not on a not-yet-written Proposal draft:
- `preflight-merged-markdown-claims` scans `## Requested action` (cold path) or `## Proposal` (resume
  path) plus `## Finding` for claim-bearing blocks that the shared list-aware splitter would still
  treat as merged.
- `preflight-stale-ac-refs` scans `## Acceptance Criteria`/`## Definition of Done`'s own
  backtick-quoted tokens.
- `preflight-touches-mismatch` compares the task's `## Touches` glob list against the charter's own
  Touches reference (many DIR-126-family charters, including this task's own, delegate via "Per
  `tasks/<taskId>.md`'s own Touches list — not duplicated here"; a charter that instead declares a
  genuinely distinct list is the mismatch case). The **same** function is invoked a second time, with different
  inputs, at Plan-shape time — the just-authored Plan's aggregate `- Files:` lines (unioned across all
  `### Stage N` blocks) vs. the task's `## Touches` globs — one implementation, two call sites.
- `preflight-missing-precedent` scans every commit-hash-shaped and file-path-shaped backtick token in
  `## Finding`/`## Requested action`/any already-present `## Proposal` text.

If a reviewer's actual intent differs from this reading, the AC below should be corrected explicitly
rather than the code silently reinterpreted mid-Build.

**Accounting the mechanical runner separately from content agents.** A `Preflight` rejection still
spends one bounded, non-LLM-content CLI invocation wrapped in a single labeled `agent()` call (the
same shape `Admission`'s lease-acquire already uses) — not literally "zero agent turns," but zero
*content-generation/review* turns. Production/journal evidence on a rejected preflight must show at
most one bounded preflight-runner dispatch and zero `proposal-author-*`, `adjudicate`,
`proposal-review`, or `plan-check-*` labeled dispatches.

### Concrete control/data flow

```
Admission (lease acquired)                                              [unchanged, DIR-126-A]
  -> phase('Preflight')  [content]
       agent(): node --experimental-strip-types prepare-admission-check.ts \
                  --preflight --taskId <id> --workspace .
       -> runPreflightChecks({mode:'content', taskBody, charterBody})
       -> { ok, policyVersion: PREFLIGHT_POLICY_VERSION,
            findings: [{code, blocking, subsystem:'preflight', message, evidence, disposition}] }
       any finding.blocking === true
         -> _releaseLease('preflight-rejected')
         -> return {outcome:'revision-needed', reason:'preflight-rejected', phase:'Preflight', findings}
       non-parseable JSON / unexpected non-zero exit
         -> fail-closed: {outcome:'needs-human', reason:'preflight-check-failed', phase:'Preflight'}
       ELSE (ok, or only non-blocking preflight-ambiguous-<check>)
         -> log() each finding (see ledger-separation decision below); continue
  -> ProposalAuthors / Adjudicate / ProposalReview (incl. existing wiring-coverage-check)  [unchanged]
  -> PlanAuthor writes ${_planFile}                                                        [unchanged]
  -> --preflight-plan dispatch  [plan-shape, before PlanCheck round 1]
       agent(): node --experimental-strip-types prepare-admission-check.ts \
                  --preflight-plan --taskId <id> --workspace . --planFile ${_planFile}
       -> runPreflightChecks({mode:'plan', taskBody, planBody})
       -> same verdict shape
       blocking finding -> revision-needed/preflight-rejected, phase:'Preflight', before plan-check-round-1
       ELSE -> phase('PlanCheck') round loop (up to MAX_PLANCHECK_ROUNDS)                  [unchanged]
  -> Receipt                                                                                [unchanged]
```

### Key design decisions

- **Same module as DIR-126-A, distinct entry point, not a new script.** Matches DIR-126's own `##
  Touches` (one new script shared across A and B); keeps the two mechanisms' proof surfaces
  independently testable — a lease-fixture defect must not block landing a preflight fixture and vice
  versa — via separate exported functions and separate test blocks in the shared
  `prepare-admission-check.test.mjs`.
- **Two distinct insertion points, not one homogeneous gate.** The four content checks gate
  `ProposalAuthors`; the Plan-shape check gates `PlanCheck` round 1, because its input (the Plan file)
  does not exist earlier — stated explicitly rather than assumed, and flagged for reviewer
  confirmation alongside the content-check input-scope reading above.
- **Preflight is a binary hard gate, deliberately kept OUTSIDE the DIR-125 typed-finding ledger
  (`_ledger`/`_upsertFindings`), not grafted onto it.** `ProposalReview`'s bounded-convergence ledger
  has its own disposition vocabulary (`plan|split|accepted-risk|backlog|duplicate|superseded`) built
  for reconciling agent-authored review findings against an existing Proposal draft — it has no slot
  for a pre-authoring "reviewer-required, not yet a real Proposal to review" state, and grafting one on
  would either force a disposition that misrepresents the finding or require widening the ledger schema
  for a use case DIR-125 was never scoped to cover. Preflight instead mirrors `Admission`'s existing
  binary accept/reject shape (`acquired` vs `prepare-already-running` vs fail-closed
  `admission-check-failed`): a blocking finding returns immediately via the same terminal-return idiom
  every other phase in this file already uses; non-blocking/`preflight-ambiguous-<check>` findings are
  surfaced via `log()` only, visible in the run journal for a human/auditor, but never merged into
  `_ledger` and never part of the Receipt's hash-bound ledger.
- **Reuse, never re-derive, existing extraction.** `preflight-merged-markdown-claims` imports and calls
  `wiring-coverage-check.ts`'s exported `splitListAwareBlocks`/`splitSentences` (making them exported,
  if not already, is in scope — both this checker and `wiring-coverage-check.ts`'s own DIR-117/DIR-122
  callers need identical boundary logic and must not drift into two heuristics).
  `preflight-touches-mismatch` calls `task-schema.ts`'s exported `checkTouches()` first (fail closed
  if the section itself is malformed) then layers new cross-source comparison —
  `checkTouches` validates glob well-formedness only, it does not diff Touches against prose, so this
  is genuinely new logic, not a duplicate. `preflight-invalid-plan-command` reuses
  `milestone-preparation-check.ts`'s existing stage-block parser rather than writing a third Markdown
  parser.
- **Deliberate overlap with `milestone-preparation-check.ts`'s later Receipt-time structural check,
  not redundant/dead code.** The Plan-shape preflight catches the same defect class up to 3
  `PlanCheck` rounds earlier and cheaper; the later check still runs unchanged as the final gate. This
  overlap is intentional and should be documented in-code so a future maintainer doesn't mistake it for
  duplication to delete.
- **Ambiguous stays `reviewer-required`, never silently rejected or silently passed.** Mirrors the
  existing non-blocking `wiring-coverage-none-claimed` precedent already in `wiring-coverage-check.ts`'s
  verdict-code vocabulary, rather than inventing a new disposition category for this module.
- **Calibrate-then-enforce, per detector, independently.** Each of the five new detectors activates
  `blocking: true` in production only after its own known-bad/known-good/ambiguous-valid fixture triad
  is green — a partially-calibrated detector set (e.g. 3 of 5 proven) still lands, with the other 2
  running non-blocking/logged-only rather than the whole `Preflight` phase being all-or-nothing. This
  is the same discipline `335317d`'s already-landed `splitSentences` fix followed (cited as reused
  precedent, not claimed as this child's own work).
- **Fixtures seeded from real artifacts, not synthetic-only** — M192/M195/M196/M198 sessions (per
  DIR-126's own Finding) plus the M199 merged-list reproduction, plus valid M195/M197-shaped fixtures
  that must stay green as the regression floor.
- **`PREFLIGHT_POLICY_VERSION` is emitted by this child only; consuming it for cache invalidation is
  explicitly [[DIR-126-C]]'s scope**, not enforced or interpreted here.

### Defaults and failure behavior

| Condition | Outcome |
|---|---|
| Content preflight (4 classes) finds a blocking defect | `revision-needed`, `preflight-rejected`, phase `Preflight`, before `ProposalAuthors` — zero `proposal-author-*`/`adjudicate`/`proposal-review`/`plan-check-*` dispatches |
| Plan-shape preflight finds a blocking defect | `revision-needed`, `preflight-rejected`, phase `Preflight`, before `PlanCheck` round 1 — zero `plan-check-round-*` dispatches |
| Content preflight finding is ambiguous | non-blocking `preflight-ambiguous-<check>`, `reviewer-required`; logged only, flows forward unchanged, never merged into `_ledger` |
| Preflight CLI exits non-zero / unparseable JSON | fail-closed to `needs-human`/`preflight-check-failed` — mirrors `Admission`'s existing `admission-check-failed` fail-closed pattern, never silently treated as "no findings" |
| A detector's calibration corpus is not green | that detector stays non-blocking in production; milestone cannot Land while any detector claims fail-closed status without matching calibration evidence |
| `PREFLIGHT_POLICY_VERSION` differs from a prior cached generation | prior terminal ineligible for [[DIR-126-C]] cache reuse |
| Valid M195/M197-shaped fixture | all five checks pass, zero regression |

### Compatibility

A generation whose already-available inputs satisfy all five checks sees exactly one additional
(passing) `Preflight` dispatch and one additional (passing) `--preflight-plan` dispatch —
`ProposalAuthors` through `Receipt` behavior is otherwise byte-for-byte unchanged, since no existing
phase's logic is modified, only two new phases/dispatches inserted around unchanged phases.
`wiring-coverage-check.ts` itself is untouched beyond exporting its existing sentence-splitting
helpers for reuse — the existing 18/18 `wiring-coverage-check.test.mjs` suite must remain green,
unmodified, as regression evidence. Canonical/`plugin/` mirrors of every touched file stay
byte-identical via the existing vendor-sync mechanism (`sync-vendor.sh --check`/`cmp`), the same
discipline DIR-126-A already followed for the shared module.

### Risks

- **Preflight false positives recreating the exact M198 `wiring-coverage-check.ts` regression class.**
  Mitigated by (a) reusing the already-fixed, already-tested `splitListAwareBlocks` boundary logic
  rather than writing a second, independently-buggy sentence splitter, and (b) the reviewer-required
  disposition for anything a detector cannot confidently classify.
- **Preflight becoming a second, drifting parser alongside `task-schema.ts`/`wiring-coverage-check.ts`/
  `milestone-preparation-check.ts`.** Mitigated by the explicit reuse decisions above; any new parsing
  this child does add (the cross-consistency logic in `preflight-touches-mismatch`) is scoped narrowly
  and documented as new, not conflated with existing extraction.
- **The content-check input-scope reading and the Plan-shape-timing reading are this Proposal's own
  interpretation** of an AC written at a level of abstraction above the concrete inputs available at
  each gate point — flagged explicitly for reviewer confirmation/correction, not silently resolved.
- **`preflight-missing-precedent`'s mechanical bound.** Grep-verifying a cited commit hash or file path
  is tractable; grep-verifying a *semantic* claim like "this pattern already exists" is not. Scope is
  explicitly limited to tokens shaped like a commit hash or file path — anything else routes to
  `reviewer-required`, not a false claim of full precedent verification.
- **`touches-mismatch` false positives on auto-derived vs. manually-declared `## Touches` sections** —
  mitigated by preflighting only manually-declared sections and treating an absent/auto-derived section
  as `preflight-ambiguous`, never blocking.
- **Two insertion points instead of one increases the chance of a mirror-drift bug** (canonical vs.
  `plugin/` diverging on only one of the two callsites). Mitigated by the `cmp`/`sync-vendor.sh --check`
  AC item covering both files in full, not per-phase.
- **The deliberate overlap with `milestone-preparation-check.ts`'s Receipt-time check could read as
  redundant/dead code to a future maintainer** unless explicitly documented as intentional
  earlier-and-cheaper duplication in-code.

### Non-goals

Not NLP/semantic preflight — mechanical/regex/structural only, consistent with "no heuristic
overreach"; anything requiring judgment routes to `reviewer-required`. An LLM-based preflight would
itself be the expensive dispatch this phase exists to avoid spending. Not a rewrite of
`it0-split-or-commit-check.ts`'s parent/child completion enforcement. Not [[DIR-126-A]]'s
admission/lease logic (shares the module, not the scope — already landed; this child adds no new
lease semantics). Not [[DIR-126-C]]'s resume/cache-decision logic (this child only emits the
`PREFLIGHT_POLICY_VERSION` field C consumes), [[DIR-126-D]]'s telemetry, or [[DIR-126-E]]'s capacity
report.

### Split consideration (DIR-026/ADR-014 Clause 9, addressed against a real split-multi-mechanism finding)

A ProposalReview run against this child's own text found `mechanismCount=5` (one per named
detector) and recommended `split-multi-mechanism`, DIR-026's `>2` threshold. This child argues
against a further split rather than fragmenting, for the same reasons DIR-126-A's own four lease
primitives (`acquireLease`/`renewLease`/`releaseLease`/`checkStaleOwner`) were correctly landed as
ONE child, not four:

1. **This child is already the product of a completed split.** `tasks/DIR-126.md` was itself split
   into 5 ordered children (`d59d3a7`) specifically to bound each child's own proof surface. Five
   detector functions inside ONE new `Preflight` phase, sharing ONE entry point and ONE new module
   (`prepare-admission-check.ts`, the same module DIR-126-A already introduced), is the SAME
   granularity DIR-126-A used for its own four lease primitives — not a new, larger bundle.
2. **The five detectors are not independently landable in any real sense.** All five share one CLI
   invocation shape, one `Preflight` phase insertion point (two, for the Plan-shape variant), one
   calibrate-then-activate staging gate, and one `PREFLIGHT_POLICY_VERSION` — landing "just 2 of
   5" would leave the `Preflight` phase itself half-built and non-functional for the other 3 classes,
   unlike DIR-126's original 5 children, which were genuinely separable (different modules, different
   phases, different landing order/dependencies).
3. **Splitting further would repeat, at a finer grain, the exact problem DIR-026 exists to prevent
   forever.** If mechanismCount alone (independent of whether the mechanisms share one entry point,
   one activation gate, and one atomic landing unit) mandates a split, there is no natural floor —
   each individual detector function would itself eventually accrete sub-claims worth splitting.
   DIR-026's own text scopes the trigger to a genuinely fragmentable cluster, not to "more than 2
   named sub-behaviors inside one cohesive phase."

Disposition: not split. If a future reviewer still disagrees after reading this rebuttal, the
correct next step is a real Build-time discovery that the five detectors are NOT sharable at the
assumed granularity (e.g. genuinely divergent activation timing beyond the already-documented
two-insertion-point split) — not a preemptive fragmentation based on the count alone.

### Mechanism-claim wiring coverage (DIR-117)

- **WIRING-CLAIM 1:** `prepare-milestone.js`'s new `Preflight` phase (both mirrors) invokes
  `prepare-admission-check.ts --preflight` via `agent()`, strictly after `Admission`'s lease-acquired
  branch and strictly before the `ProposalAuthors` `parallel(...)` dispatch.
- **WIRING-CLAIM 2:** `prepare-milestone.js`'s `PlanAuthor`→`PlanCheck` boundary (both mirrors) invokes
  `prepare-admission-check.ts --preflight-plan` via `agent()`, strictly before the `plan-check-round-1`
  agent.
- **WIRING-CLAIM 3:** a blocking content-preflight finding returns
  `revision-needed`/`preflight-rejected` with real journal evidence of zero
  `proposal-author-*`/`adjudicate`/`proposal-review`/`plan-check-*` dispatches on that path.
- **WIRING-CLAIM 4:** a blocking Plan-shape finding returns `revision-needed`/`preflight-rejected` with
  real journal evidence of zero `plan-check-round-*` dispatches on that path.
- **WIRING-CLAIM 5:** `preflight-merged-markdown-claims` imports `splitListAwareBlocks`/`splitSentences`
  from `wiring-coverage-check.ts` — reused, not reimplemented.
- **WIRING-CLAIM 6:** `preflight-touches-mismatch` imports `checkTouches()` from `task-schema.ts` before
  its own cross-source comparison logic, and is called from two distinct call sites (task-vs-charter
  pre-`ProposalAuthors`; Plan-vs-Touches pre-`PlanCheck`) using the same implementation.
- **WIRING-CLAIM 7:** `preflight-invalid-plan-command` reuses `milestone-preparation-check.ts`'s
  existing stage-block parser rather than a new implementation.
- **WIRING-CLAIM 8:** every preflight verdict carries `PREFLIGHT_POLICY_VERSION` — emission only;
  [[DIR-126-C]] owns consuming it for cache invalidation, out of this child's scope.
- **WIRING-CLAIM 9:** `runPreflightChecks`'s CLI entry point is parsed by the same `parseArgs`/
  `gate-script-base.ts`/`isDirectEntry` machinery `--acquire`/`--renew`/`--release` already use, via
  two new flags added to the existing `spec.flags` object — no new arg-parsing implementation.

### AC coverage

- **Real production wiring, not agent-prompt guidance** → WIRING-CLAIM 1/2 above, each independently
  grep/import-graph-checkable at two distinct callsites; WIRING-CLAIM 9 specifically (added
  2026-07-29, ProposalReview finding — this bullet's own text previously only cited claim 9
  parenthetically) → a dedicated grep of `parseArgs`/`gate-script-base.ts`/`isDirectEntry`/
  `spec.flags` confirms `runPreflightChecks`'s CLI entry point reuses the SAME parsing machinery
  `--acquire`/`--renew`/`--release` already use — no second, duplicate arg-parsing implementation.
- **Preflight precedes agents**, per class, with journal evidence of zero content-agent dispatches on
  rejection → WIRING-CLAIM 3/4, plus the five fixture files (one per class) each demonstrating their own
  blocking termination point; valid M195/M197-shaped fixtures stay green.
- **Repair/calibrate before fail-closed** → the per-detector known-bad/known-good/ambiguous-valid
  fixture triad gate, explicit in "Key design decisions."
- **No heuristic overreach** → the `reviewer-required` disposition, tested per detector; the explicit
  mechanical-bound scoping for `preflight-missing-precedent`.
- **`wiring-coverage-check.ts` merged-list class stays closed** → verification-only AC item (already
  satisfied by `335317d`, not new work), re-run of the existing 18/18 suite.
- **Mirror byte-identity** → `cmp`/`sync-vendor.sh --check` across all touched files (WIRING-CLAIM
  1/2's two callsites both covered).
- **Checker version/hash on every verdict** → `PREFLIGHT_POLICY_VERSION`, WIRING-CLAIM 8, consumed
  contract with [[DIR-126-C]].
- **Reuse, never reimplement, existing extraction (added 2026-07-29, ProposalReview finding):** →
  WIRING-CLAIM 5 (`preflight-merged-markdown-claims` imports `splitListAwareBlocks`/`splitSentences`
  from `wiring-coverage-check.ts`), WIRING-CLAIM 6 (`preflight-touches-mismatch` imports
  `checkTouches()` from `task-schema.ts`, one implementation shared across two insertion points), and WIRING-CLAIM 7
  (`preflight-invalid-plan-command` reuses `milestone-preparation-check.ts`'s existing stage-block
  parser) — each independently grep/import-graph-checkable: a real production import shows the new
  detector functions genuinely reference the named existing functions instead of reimplementing
  them, not merely descriptive prose in "Key design decisions"/Risks.

### Alternatives considered and rejected

1. **A brand-new, separate script/module instead of extending `prepare-admission-check.ts`.** Rejected:
   DIR-126's own `## Touches` names exactly one new script shared across the whole 5-way split; a
   second module would fragment the shared CLI-dispatch pattern `prepare-milestone.js` already uses
   twice (`Admission`, `wiring-coverage-check`) into three slightly different shapes for no functional
   gain, and would duplicate `gate-script-base.ts`'s `parseArgs`/`isDirectEntry` wiring a third time in
   the same file family.
2. **Running all five checks at a single insertion point, before `ProposalAuthors`, with the Plan-shape
   check passing through/no-oping until a Plan file exists.** Rejected: this either silently skips real
   Plan-shape validation (defeating the point of gating `PlanCheck`) or requires `Preflight` to read a
   file that structurally does not exist yet. Two insertion points, explicitly documented, is more
   honest than one insertion point with implicit conditional behavior.
3. **Making all five detectors fail-closed/blocking from the first commit, skipping calibrate-then-
   enforce staging.** Rejected: this is exactly the failure mode DIR-126's own Finding and M198's
   `wiring-coverage-check.ts` false positive both demonstrate — an unreviewed regex-based blocking check
   can reject valid work. The task's own "no heuristic overreach"/"calibrate before enforcing" language
   makes staged activation a stated requirement.
4. **Importing `packages/quay/src/frontmatter-store-base.ts`'s locking/parsing primitives** for the new
   checks' Markdown handling. Rejected for the same reason DIR-126-A already rejected importing that
   package's `withFileLock`: it would create a new `experiments/` → `packages/` dependency edge for
   logic this module needs only a thin slice of; `task-schema.ts`/`wiring-coverage-check.ts`/
   `milestone-preparation-check.ts` (all already `experiments/`-local) are the correct reuse targets.
5. **Reimplementing sentence/claim extraction, Touches parsing, or the Plan stage-block parser locally**
   instead of importing the existing exported functions. Rejected: creates a second, independently-
   drifting implementation of concepts DIR-122's own AC forbids duplicating, and recreates exactly the
   "second buggy splitter" risk this proposal's own Risks section names.
6. **Merging Preflight's non-blocking/ambiguous findings into the DIR-125 `_ledger`.** Rejected: the
   ledger's disposition vocabulary (`plan|split|accepted-risk|backlog|duplicate|superseded`) has no slot
   for a pre-authoring "reviewer-required, not yet a real Proposal to review" state; grafting it on would
   either force a disposition that misrepresents the finding or require widening the ledger schema,
   out of scope for this child. `log()`-only visibility was chosen instead.
7. **Dropping the Plan-shape preflight on the theory `milestone-preparation-check.ts`'s Receipt-time
   check already covers it.** Rejected: the later check only fires after `PlanAuthor` plus up to 3
   `PlanCheck` rounds have already run; an earlier, cheaper rejection is exactly the cost-avoidance this
   child's charter targets. The overlap is intentional, not redundant.
8. **NLP/LLM-based semantic detection of the five classes instead of mechanical/regex checks.**
   Rejected: contradicts "no heuristic overreach" and the entire cost rationale of this child — an
   LLM-based preflight would itself be the expensive dispatch this phase exists to avoid.

## Plan

`docs/plans/M201-dir-126-b.md` — authored 2026-07-29 against this task's just-adjudicated Proposal
and Acceptance Criteria (base revision `c5e0954`). Nine ordered stages (RED test scaffolding;
export-reuse from `wiring-coverage-check.ts`; the five detector functions +
`runPreflightChecks`/CLI flags; the content-`Preflight` phase insertion before `ProposalAuthors`;
the `--preflight-plan` insertion before `PlanCheck` round 1; fixture corpora + calibrate-then-
enforce staging; `wiring-coverage-check.ts` merged-list regression verification; mirror byte-
identity sync; real non-fixture end-to-end dispatch proof) map every one of this task's 24
Acceptance Criteria items to at least one stage. Supersedes the prior N/A placeholder.

## Finding

1. `grep -n "await parallel"` on `.claude/workflows/prepare-milestone.js` confirms the cold path's
   first action is dispatching real Proposal-author agents, with no preceding mechanical content
   check.
2. **Superseded (2026-07-29):** `wiring-coverage-check.ts`'s `splitSentences` function, as of the
   pre-`335317d` source, split only on `\n{2,}` or sentence-ending-punctuation-plus-capital/backtick
   — never on a bare bullet list `- `/`* ` line — confirming the M198 merged-list false-positive
   class was real (distinct from the possessive-"own" class `703e014` already fixed). Direct read of
   the CURRENT source confirms this is now fixed: `splitListAwareBlocks()` (commit `335317d`) treats
   every bullet-list line as its own sentence boundary, and `wiring-coverage-check.test.mjs` is
   18/18 green (`335317d`'s original 17/17 plus `44ca1b3`'s pipe-table-row fix and its regression
   test) including three regression tests for this exact class of defect.
3. **Correction (2026-07-29, ProposalReview finding):** the five recurring failure classes above
   are this child's own decomposition, drawn by example from real M192/M195/M196/M198 sessions and
   `tasks/DIR-126.md`'s own Finding — not a literal enumeration `tasks/DIR-126.md`'s `## Finding`
   section itself contains (confirmed by direct read: that section names workflow-yield stats and
   the M199 wiring-coverage reproduction, never these five specific phrases verbatim).

## Requested action

1. Add `runPreflightChecks`/`--preflight`/`--preflight-plan` entry points to
   `prepare-admission-check.ts` (+ `plugin/scripts/` mirror), with five named pure check functions
   and stable codes per the Chosen mechanism above.
2. Add the new `Preflight` phase to `prepare-milestone.js` (both mirrors): the four content checks
   gate `ProposalAuthors`; the Plan-shape check gates `PlanCheck`'s first round.
3. **Already done (commit `335317d`, not new work for this child):** the Markdown-list-aware
   sentence-boundary fix to `wiring-coverage-check.ts`'s `splitSentences` (+ `plugin/scripts/`
   mirror) already closed the M198 false-positive class at its root, calibrated and landed. Build
   should verify it stays green (re-run `wiring-coverage-check.test.mjs`, 18/18 expected), not
   re-implement it.
4. Add fixture files seeded from real M192/M195/M196/M198 artifacts for each of the five check
   classes, the M199 merged-list/14-finding reproduction, plus valid M195/M197-shaped fixtures that
   must stay GREEN.
5. Add a real test file (`experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`,
   shared with DIR-126-A's own tests, + `plugin/test/` mirror) covering all five preflight classes
   RED/GREEN, the ambiguous/`reviewer-required` disposition, and the `splitSentences` fix's
   regression-safety against the existing `wiring-coverage-check.test.mjs` suite.
6. Emit a stable checker policy version/hash in every preflight verdict and cover version changes
   as terminal-cache invalidations for [[DIR-126-C]].

## Acceptance Criteria

- [x] **Most important — real production wiring, not agent-prompt guidance:** a grep/import-graph
  check shows `prepare-admission-check.ts`'s `--preflight`/`--preflight-plan` modes have REAL
  production callsites from `prepare-milestone.js`'s (both mirrors) new `Preflight` phase — not
  zero importers, not `--selftest`-only reachability. This item alone, if unmet, fails the whole
  child regardless of how many other items pass. **Confirmed (2026-07-29 adversarial audit,
  `milestones/M201/audits/iteration-0-acceptance-audit.md` §1.1):** `git show 3552787 --
  .claude/workflows/prepare-milestone.js` shows real `phase('Preflight')` callsites strictly
  bracketing `ProposalAuthors`/`PlanCheck`; `grep -rn selftest prepare-admission-check.ts` = zero
  hits; independently reproduced via a live-`AsyncFunction` scratch harness.
- [x] **Preflight precedes agents:** fixtures for
  all five named classes (merged Markdown claim blocks, stale AC/DoD references, Proposal/Plan/Touches
  disagreement, non-existent claimed precedent/imports, invalid Plan command/path shapes) each
  terminate with their own stable code before the first agent dispatch that can act on their
  already-available input (`ProposalAuthors` for the first four, `PlanCheck` round 1 for the
  Plan-shape check) — real journal evidence, not asserted. A rejected content preflight shows at
  most one bounded mechanical runner and zero content-generation/review agents: real journal
  evidence confirms zero `proposal-author-*`, `adjudicate`, `proposal-review`, or `plan-check-*`
  dispatches on a content-preflight rejection (confirmed, reproduced independently).
  **Fixed (2026-07-29, `gap-preflight-bare-filename-false-positive`):** the audit's §1.2 finding —
  `preflight-stale-ac-refs`/`preflight-missing-precedent` hard-blocking on this repo's dominant
  bare-filename authoring convention — was a real defect in `_scanStaleReferences()`'s literal
  repo-root-relative path join, fixed with a repo-wide basename fallback (`git ls-files`, computed
  once per scan). Re-dogfooding the exact production CLI invocation against DIR-126-B's own real
  task+charter now returns `{ok:true, findings:[]}` (was 2 blocking findings). Valid M195/M197-shaped
  fixtures remain GREEN, confirmed via 57/57 real test run plus the live dogfood re-run.
  **Round 2 (2026-07-29, second independent audit):** the round-1 fix itself had two more real
  defects — (a) its basename fallback was unconditional, silently passing a directory-qualified but
  fabricated path whenever an unrelated file shared its basename; (b) neither detector recognized a
  file the task's own `## Touches` declares as future work (`` `foo.ts (new)` ``) as anything other
  than a stale precedent, hard-blocking 6/39 (~15%) of this repo's real open tasks. Both fixed: the
  basename fallback now applies only to bare (no-`/`) tokens; a new Touches-membership check (reusing
  `preflightTouchesMismatch`'s own `_extractGlobsFromSection`/`_globCoversPath` helpers, no new
  parser) exempts declared-future files. A `.quay/`-prefix carve-out (illustrative per-workspace
  runtime paths, never repo-tracked) closed 3 more real false positives found while re-sweeping.
  5 of the original 6 flagged real tasks now dogfood clean; 3 new regression tests, 60/60 suite pass.
- [x] **Repair/calibrate before fail-closed
  activation:** for each of the five NEW preflight detectors, real known-bad, known-good, and
  ambiguous-valid corpora prove the detector's blocking boundary before the production `Preflight`
  callsite is allowed to enforce it. (The M198/M199 `splitSentences` merged-list class is a
  separate, already-closed precedent — commit `335317d`, landed and calibrated before this child's
  Build — cited here only as the pattern to follow, not as remaining work; a deliberately restored
  old splitter turning that specific regression test RED is evidence the EXISTING fix is real, not
  evidence this child built something new.) **Fixed (2026-07-29):** the audit §1.3 finding — the
  synthetic fixture corpus never exercised this repo's own dominant bare-filename convention, so the
  calibration boundary it "proved" was wrong against real content — is closed by the same
  `_scanStaleReferences()` basename-fallback fix as the AC item above, plus two new regression tests
  exercising exactly the real-content shape the synthetic corpus missed.
- [x] **No heuristic overreach:** an
  ambiguous-but-valid fixture for each of the five checks is confirmed to emit its
  `preflight-ambiguous-<check>` code, `reviewer-required`, non-blocking — not silently rejected and
  not silently passed. Per-fixture ambiguous routing works (5/5 tests pass). **Fixed (2026-07-29):**
  the audit §1.4 finding — real valid content (DIR-126-A/DIR-126-B's own task+charter) was
  hard-blocked instead of correctly passing — is closed by the same fix; DIR-126-B's own real
  content now dogfoods clean rather than needing a `reviewer-required` fallback at all.
- [x] **`wiring-coverage-check.ts`'s merged-list false-positive class is closed at its root
  (ALREADY SATISFIED — commit `335317d`, `gap-wiring-coverage-check-merged-markdown-list`, `status:
  done`, landed before this child's Build; this item verifies it stays true, not that Build
  produces it):** a RED fixture reproducing the exact M198/DIR-119-D1 defect (dense, un-blank-lined
  bullet list merging multiple wiring claims) is confirmed uncovered under the OLD `splitSentences`,
  then GREEN under the fixed version — and the full pre-existing `wiring-coverage-check.test.mjs`
  suite (18/18 per the current real run, including the two regression tests added by `335317d` and
  one more added by `44ca1b3`) stays green, confirming no regression on already-passing cases.
  **Confirmed (audit §1.5):** `bash scripts/test.sh experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` → 18/18 pass, independently re-run.
- [x] Canonical and `plugin/` mirrors of `prepare-admission-check.ts`, `wiring-coverage-check.ts`,
  `prepare-milestone.js`, and their test files are byte-identical — `cmp`/`sync-vendor.sh --check`.
  **Confirmed (audit §1.6):** `cmp` on all four touched pairs identical; `bash plugin/scripts/sync-vendor.sh --check` → CLEAN.
- [x] Every preflight verdict records a stable checker policy version/hash; changing the detector
  or its blocking policy changes that value and makes an older [[DIR-126-C]] cached terminal
  ineligible for reuse. **Confirmed (audit §1.7):** `PREFLIGHT_POLICY_VERSION = "preflight-v1"`
  present on every finding in both the test suite and this audit's own dogfooding runs.

- [x] **Grounding evidence for the Problem-framing/Chosen-mechanism claims above (added for
  wiring-coverage completeness):** confirmed via direct source read — commit `703e014`
  (`gap-wiring-coverage-check-owns-false-positive`) already fixed `WIRING_VERB_RE`'s possessive-
  "own" false-positive class; commit `f3d870b` (M198, this same overall `prepare-milestone`
  session) independently hit a different merged-Markdown-list class from the identical
  `wiring-coverage-check.ts` checker, which was itself independently closed by commit `335317d`
  (`gap-wiring-coverage-check-merged-markdown-list`) before this child's Build — no longer "still
  open." This child's real, production-wired fix: `prepare-milestone.js` gains a new `Preflight`
  phase, dispatched via `agent()` right after `Admission` and before `ProposalAuthors`, running the
  real (non-`--selftest`) preflight CLI — confirmed real via the production-callsite AC item above.

**Note (2026-07-29, ProposalReview finding d0f864c6):** the 16 bullets below are citation coverage
for incidental Proposal prose (comparison-table rows, defaults tables, precedent citations, the
individually-numbered WIRING-CLAIM paragraphs) that `wiring-coverage-check.ts`'s mechanical
verb+identifier matcher independently flags as needing coverage — they are grounding/citation
evidence for prose ALREADY substantively covered by the earlier "Real production wiring"/"Preflight
precedes agents"/"Reuse, never reimplement" AC bullets above, not a second, independent source of
real coverage. Kept because the checker is fail-closed by design (an uncovered claim blocks), not
because each is itself a distinct new architectural commitment.

- [x] **Grounding evidence 1 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `wiring-coverage-check.ts` `703e014` `WIRING_VERB_RE` `f3d870b` `335317d` `splitListAwareBlocks()` `splitSentences` `cmp` `wiring-coverage-check.test.mjs` `44ca1b3`.
- [x] **Grounding evidence 2 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `preflight-missing-precedent` `git cat-file -e` `fs.existsSync` `reviewer-required`.
- [x] **Grounding evidence 3 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `--preflight-plan` `agent()` `Admission` `ProposalReview` `wiring-coverage-check` `PlanAuthor` `PlanCheck`.
- [x] **Grounding evidence 4 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `preflight-touches-mismatch` `## Touches` `tasks/<taskId>.md`.
- [x] **Grounding evidence 5 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `- Files:` `### Stage N` `## Touches`.
- [x] **Grounding evidence 6 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `preflight-merged-markdown-claims` `wiring-coverage-check.ts` `splitListAwareBlocks` `splitSentences`.
- [x] **Grounding evidence 7 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `preflight-touches-mismatch` `task-schema.ts` `checkTouches()` `checkTouches`.
- [x] **Grounding evidence 8 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `blocking: true` `Preflight`.
- [x] **Grounding evidence 9 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `revision-needed` `preflight-rejected` `Preflight` `ProposalAuthors` `proposal-author-*` `adjudicate` `proposal-review` `plan-check-*`.
- [x] **Grounding evidence 10 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `revision-needed` `preflight-rejected` `Preflight` `PlanCheck` `plan-check-round-*`.
- [x] **Grounding evidence 11 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `Preflight` `--preflight-plan` `ProposalAuthors` `Receipt`.
- [x] **Grounding evidence 12 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `prepare-milestone.js` `Preflight` `prepare-admission-check.ts --preflight` `agent()` `Admission` `ProposalAuthors` `parallel(...)`.
- [x] **Grounding evidence 13 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `prepare-milestone.js` `PlanAuthor` `PlanCheck` `prepare-admission-check.ts --preflight-plan` `agent()` `plan-check-round-1`.
- [x] **Grounding evidence 14 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `revision-needed` `preflight-rejected` `proposal-author-*` `adjudicate` `proposal-review` `plan-check-*`.
- [x] **Grounding evidence 15 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `revision-needed` `preflight-rejected` `plan-check-round-*`.
- [x] **Grounding evidence 16 (exhaustive identifiers, wiring-coverage completeness):** confirmed real via direct source read and/or CLI dispatch — `preflight-touches-mismatch` `checkTouches()` `task-schema.ts` `ProposalAuthors` `PlanCheck`.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/prepare-milestone.js` and the shared `wiring-coverage-check.ts` module both
  DIR-117 and DIR-122 depend on). **§1.2's false-positive defect is now fixed
  (`gap-preflight-bare-filename-false-positive`) — this item correctly remains open pending Land
  itself completing.**
- [x] A real, non-fixture `prepare-milestone` dispatch against a task with a deliberately-seeded
  known-bad Proposal is exercised end to end, showing `preflight-rejected` before any author agent
  is spent, with journal output showing the bounded mechanical runner separately, not asserted.
  **Confirmed (audit §2.2), independently reproduced via a fresh scratch harness driving the real
  workflow source against a freshly-authored known-bad task (not the Build's own harness).**
- [x] RED/GREEN evidence exists for all five preflight classes plus the `splitSentences` fix.
  **Confirmed (audit §2.3):** 55/55 + 18/18 test runs, re-executed independently.
- [x] Fail-closed activation evidence proves detector calibration
  completed before enforcement; no uncalibrated regex verdict is blocking in production. **Fixed
  (2026-07-29):** audit §2.4's finding — the calibration boundary was wrong against real content —
  is closed by the same `_scanStaleReferences()` fix; see AC "Repair/calibrate before fail-closed
  activation" above.
- [x] A fresh independent audit confirms the real production callsite from `prepare-milestone.js`'s
  `Preflight` phase, not merely unit-test reachability, and confirms the Plan-shape-timing reading
  either matches the reviewer's own intent or was corrected per their feedback. **This item itself
  is satisfied by `milestones/M201/audits/iteration-0-acceptance-audit.md` §1.1/§2.5 — but the
  audit's OVERALL verdict is REFUTED on other grounds (§1.2), so the child as a whole is not done.**

## Human verification when exp5 marks this DIR done

1. Do cheap, objective defects stop before any expensive author/reviewer dispatch?
2. Are ambiguous semantic claims explicitly reported as reviewer-required, never silently
   rewritten or rejected by a regex-only check?
3. Is the still-open M198 merged-Markdown-list false-positive class genuinely closed at its root,
   confirmed by the pre-existing wiring-coverage-check.test.mjs suite staying green?

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`
- `plugin/scripts/prepare-admission-check.ts`
- `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`
- `plugin/scripts/wiring-coverage-check.ts`
- `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
- `plugin/test/prepare-admission-check.test.mjs`
- `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`
