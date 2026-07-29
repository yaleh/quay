---
id: DIR-126-B
title: Deterministic mechanical preflight for prepare-milestone.js (new Preflight
  phase) — second child of DIR-126's split
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

Add mechanical, pre-content-agent-dispatch checks for the five recurring `prepare-milestone` failure
classes DIR-126's own Finding names (merged Markdown claim blocks, stale AC/DoD references,
Proposal/Plan/Touches disagreement, non-existent claimed precedent/imports, non-runnable Plan
command/path shapes), rejecting cheaply before any expensive LLM author/reviewer agent is
dispatched. Second child of DIR-126's 5-way split. Depends on [[DIR-126-A]] (shares its new
`prepare-admission-check.ts` module and the pre-`ProposalAuthors` phase-insertion point), but has
an independently testable, independently landable proof surface (five named fixture classes with
stable codes) — a lease bug in A must not block landing a preflight fixture here and vice versa.

### Problem framing (re-verified live against the current tree, 2026-07-29)

The first thing that happens on `prepare-milestone.js`'s cold path today is a real `await
parallel(...)` dispatching 2-3 real LLM Proposal-author agents (`.claude/workflows/prepare-
milestone.js` lines ~65-90). Nothing mechanically checks the task/charter for the five recurring
failure classes DIR-126 names first. The one mechanical check that does exist,
`wiring-coverage-check.ts`, is dispatched later, at `ProposalReview` (after Proposal
authoring/adjudication, not before), and covers only mechanism-claim-vs-AC wiring — a narrower
scope than the five classes this child targets.

It is still an open source of false positives, not a solved problem: commit `703e014`
(`gap-wiring-coverage-check-owns-false-positive`) already fixed one recurring class (the checker's
`WIRING_VERB_RE` matching the possessive "own"), and this repo's own immediately-prior commit
`f3d870b` (M198, this same overall session) hit a *different*, still-open class from the identical
checker — dense, un-blank-lined Proposal bullet lists merging multiple distinct wiring claims into
one giant sentence, firing 26 blocking findings from formatting, not content, on the first real
`prepare-milestone` generation against DIR-119-D1. This child closes that specific, still-open
class at its root (the sentence-splitting logic itself), not by papering over individual
occurrences after the fact.

### Chosen mechanism

Same module as [[DIR-126-A]] (`experiments/quay-perpetual-stream/scripts/prepare-admission-
check.ts` + `plugin/scripts/` mirror), a distinct `runPreflightChecks`/`--preflight` entry point
and five new pure check functions, one per DIR-126-named failure class, each with a stable code
(`preflight-merged-markdown-claims`, `preflight-stale-ac-refs`, `preflight-touches-mismatch`,
`preflight-missing-precedent`, `preflight-invalid-plan-command`) and its own fixture file.

`prepare-milestone.js` (both mirrors) gains a new `Preflight` phase, right after `Admission` and
before `ProposalAuthors`, dispatched the same way the existing `wiring-coverage-check.ts` call
already is (labeled `agent()` running the real CLI, verdict merged by the script). Any finding with
`blocking: true` returns `{outcome: 'revision-needed', reason: 'preflight-rejected', phase:
'Preflight', findings: [...]}` before `ProposalAuthors`.

The mechanical CLI runner is accounted separately from content-generation/review agents: the
production journal must show at most one bounded preflight runner and zero `proposal-author-*`,
`adjudicate`, `proposal-review`, or `plan-check-*` dispatches on a content-preflight rejection.
This avoids describing an agent-hosted CLI invocation as literally "pre-agent" while preserving
the real requirement: no expensive content agent is spent on an objectively malformed input.

**Plan-shape-timing reading (flagged for reviewer confirmation):** the task's AC groups "invalid
Plan command/path shapes" with the other four under one "before ProposalAuthors/ProposalReview"
timing claim, but a Plan file cannot exist before `PlanAuthor` runs. This Proposal reads the AC's
intent as "each preflight class runs before the first expensive agent dispatch that can act on its
already-available input": the four content checks (merged-markdown-claims, stale-ac-refs,
touches-mismatch, missing-precedent) gate `ProposalAuthors`; the Plan-shape check runs as a
`--preflight-plan` invocation gating `PlanCheck`'s first round instead, dispatched right after
`PlanAuthor` produces the Plan file and before the first `plan-check-round-1` agent.

**Reuse, not reimplementation.** The module reuses (imports, never duplicates)
`task-schema.ts`'s existing section/AC-count extraction and adds a Markdown-list-aware sentence
boundary to `wiring-coverage-check.ts`'s `splitSentences` (a `- `/`* ` bullet line becomes its own
sentence boundary, so a dense, un-blank-lined bullet list no longer merges multiple wiring claims
into one giant sentence) — closing the still-open M198 false-positive class at its root, shared by
both this child's own preflight checks and the pre-existing `wiring-coverage-check.ts` module both
callers (DIR-117 and DIR-122) already depend on.

**No heuristic overreach.** Any check that cannot mechanically distinguish malformed from
ambiguous-but-valid emits a distinct `preflight-ambiguous-<check>` non-blocking code marked
`reviewer-required` — mirroring the existing non-blocking `wiring-coverage-none-claimed` code
already in `wiring-coverage-check.ts`'s verdict codes — never silently auto-rejected by regex.

**Calibrate before enforcing.** The merged-list/regex detector fix and its regression corpus land
and pass before any new verdict from that detector is allowed to become fail-closed in the
production `Preflight` phase. Implementation therefore has an explicit two-step activation gate:
(1) repair `splitSentences`, replay the real M195/M197 known-good tasks plus the M198 false-positive
and M199 merged-list reproductions, and demonstrate the corrected typed verdicts; then (2) enable
`blocking: true` only for failure classes whose real-negative and ambiguous-valid fixtures both
pass. A checker version/hash is emitted with every verdict so [[DIR-126-C]] can invalidate a
cached terminal decision whenever B's detection policy changes.

### Key design decisions

- **Preflight is a distinct entry point in the same module A introduces, not a separate module** —
  matches DIR-126's own `## Touches` (which names exactly one new script) while keeping the two
  mechanisms' AC-level proof surfaces independent (see Problem framing / Chosen mechanism above).
- **The Plan-shape check runs at a different point than the four content checks** (gating
  `PlanCheck`'s first round, not `ProposalAuthors`) — a Plan cannot be preflighted before it exists;
  this Proposal makes that timing split explicit rather than silently treating all five as one
  homogeneous gate.
- **Reuse `task-schema.ts`/`wiring-coverage-check.ts`'s existing extraction logic, never a third
  parsing implementation** — avoids the preflight module itself becoming a second, drifting copy of
  checks these two modules already do differently.
- **Ambiguous-but-valid stays `reviewer-required`, never silently rejected or silently passed** —
  the exact discipline "No heuristic overreach" requires; mirrors the existing
  `wiring-coverage-none-claimed` non-blocking-code precedent rather than inventing a new posture.
- **Detector repair and calibration precede fail-closed activation** — the production callsite
  cannot mark the merged-list class blocking until the old false-positive reproduction is GREEN,
  the real bad fixture is still RED, and the known-good/ambiguous corpus stays non-blocking.
- **Every verdict carries a checker policy version/hash** — a later detector change is a cache
  invalidation event for [[DIR-126-C]], never silently paired with an older terminal decision.
- **Fixture suite seeded from real M192/M195/M196/M198 artifacts already checked into this repo**,
  not synthetic-only fixtures — grounds the five check functions against the actual failure shapes
  DIR-126's own Finding measured, reducing the risk of a preflight false positive recreating the
  exact regression class M198 (this same session) just hit.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Content preflight (4 classes) finds a blocking defect | `revision-needed`, `preflight-rejected`, before `ProposalAuthors` |
| Plan-shape preflight finds a blocking defect | `revision-needed`, `preflight-rejected`, before `PlanCheck`'s first round |
| Content preflight finding is ambiguous/uncertain | non-blocking, `preflight-ambiguous-<check>`, `reviewer-required`; flows into normal `ProposalReview`, never silently rejected or silently passed |
| Detector regression/calibration corpus is not GREEN | detector stays non-blocking/not activated; milestone cannot Land |
| Checker policy version/hash differs from a prior generation | old cached terminal is ineligible for reuse by [[DIR-126-C]] |
| Valid M195/M197-shaped fixture | GREEN — all five checks pass, no regression on known-good real Prepare generations |

### Compatibility

A cold or resumed generation whose Proposal/Plan already satisfies all five checks sees zero
behavior change beyond the new `Preflight` phase's own (passing) dispatch — `ProposalAuthors`
through `Receipt` are otherwise unchanged. `wiring-coverage-check.ts`'s `splitSentences` fix is
additive (recognizes more sentence boundaries, never fewer) — existing GREEN wiring-coverage
verdicts on already-passing tasks must remain GREEN, verified by re-running the existing
`wiring-coverage-check.test.mjs` suite unmodified. Both workflow mirrors and the shared script
mirror stay byte-identical via the existing vendor-sync mechanism.

### Risks

- **Preflight false positives recreating the exact `wiring-coverage-check.ts` regression class M198
  just hit** — mitigated by the "reviewer-required, never silently reject" disposition for
  uncertain checks, and by seeding the fixture suite from real M192/M195/M196/M198 artifacts rather
  than synthetic-only fixtures.
- **The preflight module could itself become a second, drifting copy of checks `wiring-coverage-
  check.ts`/`task-schema.ts` already do differently** — mitigated by explicitly reusing (not
  reimplementing) their existing extraction logic.
- **The Plan-shape-timing reading is this Proposal's own interpretation of an ambiguous AC
  grouping** — flagged explicitly above for reviewer confirmation or correction rather than
  silently assumed; if the reviewer disagrees, the AC below is revised accordingly, not
  reinterpreted unilaterally mid-Build.

### Non-goals

Not NLP-based semantic preflight — stays mechanical/regex/structural, exactly as "No heuristic
overreach" requires; ambiguous cases remain reviewer work. Not a rewrite of
`it0-split-or-commit-check.ts`'s parent/child completion enforcement. Not implementing
[[DIR-126-A]]'s admission/lease logic (shares the module, not the scope), [[DIR-126-C]]'s resume
logic, [[DIR-126-D]]'s telemetry, or [[DIR-126-E]]'s capacity report.

## Plan

N/A — directive-class child resolved via a human-steered milestone. Depends on [[DIR-126-A]].

## Finding

1. `grep -n "await parallel"` on `.claude/workflows/prepare-milestone.js` confirms the cold path's
   first action is dispatching real Proposal-author agents, with no preceding mechanical content
   check.
2. `wiring-coverage-check.ts`'s own `splitSentences` function (confirmed by direct read) splits
   only on `\n{2,}` or sentence-ending-punctuation-plus-capital/backtick — never on a bare bullet
   list `- `/`* ` line — confirming the M198 merged-list false-positive class is real and still
   open (distinct from the possessive-"own" class `703e014` already fixed).
3. DIR-126's own Finding names the five recurring failure classes by example, drawn from real
   M192/M195/M196/M198 sessions.

## Requested action

1. Add `runPreflightChecks`/`--preflight`/`--preflight-plan` entry points to
   `prepare-admission-check.ts` (+ `plugin/scripts/` mirror), with five named pure check functions
   and stable codes per the Chosen mechanism above.
2. Add the new `Preflight` phase to `prepare-milestone.js` (both mirrors): the four content checks
   gate `ProposalAuthors`; the Plan-shape check gates `PlanCheck`'s first round.
3. Add the Markdown-list-aware sentence-boundary fix to `wiring-coverage-check.ts`'s
   `splitSentences` (+ `plugin/scripts/` mirror), closing the M198 false-positive class at its root;
   land and calibrate this detector behavior before enabling its fail-closed production verdict.
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

- [ ] **Most important — real production wiring, not agent-prompt guidance:** a grep/import-graph
  check shows `prepare-admission-check.ts`'s `--preflight`/`--preflight-plan` modes have REAL
  production callsites from `prepare-milestone.js`'s (both mirrors) new `Preflight` phase — not
  zero importers, not `--selftest`-only reachability. This item alone, if unmet, fails the whole
  child regardless of how many other items pass.
- [ ] **Preflight precedes agents:** fixtures for all five named classes (merged Markdown claim
  blocks, stale AC/DoD references, Proposal/Plan/Touches disagreement, non-existent claimed
  precedent/imports, invalid Plan command/path shapes) each terminate with their own stable code
  before the first agent dispatch that can act on their already-available input
  (`ProposalAuthors` for the first four, `PlanCheck` round 1 for the Plan-shape check) — real
  journal evidence, not asserted. A rejected content preflight shows at most one bounded
  mechanical runner and zero content-generation/review agents. Valid M195/M197-shaped fixtures
  remain GREEN.
- [ ] **Repair/calibrate before fail-closed activation:** the M198 false-positive and M199
  merged-list reproductions are corrected first; real known-bad, known-good, and
  ambiguous-valid corpora then prove the detector's blocking boundary before the production
  `Preflight` callsite is allowed to enforce it. A deliberately restored old splitter turns this
  activation-gate test RED.
- [ ] **No heuristic overreach:** an ambiguous-but-valid fixture for each of the five checks is
  confirmed to emit its `preflight-ambiguous-<check>` code, `reviewer-required`, non-blocking — not
  silently rejected and not silently passed.
- [ ] **`wiring-coverage-check.ts`'s merged-list false-positive class is closed at its root:** a RED
  fixture reproducing the exact M198/DIR-119-D1 defect (dense, un-blank-lined bullet list merging
  multiple wiring claims) is confirmed uncovered under the OLD `splitSentences`, then GREEN under
  the fixed version — and the full pre-existing `wiring-coverage-check.test.mjs` suite (15/15 per
  the last real run) stays green, confirming no regression on already-passing cases.
- [ ] Canonical and `plugin/` mirrors of `prepare-admission-check.ts`, `wiring-coverage-check.ts`,
  `prepare-milestone.js`, and their test files are byte-identical — `cmp`/`sync-vendor.sh --check`.
- [ ] Every preflight verdict records a stable checker policy version/hash; changing the detector
  or its blocking policy changes that value and makes an older [[DIR-126-C]] cached terminal
  ineligible for reuse.

- [ ] **Grounding evidence for the Problem-framing/Chosen-mechanism claims above (added for
  wiring-coverage completeness):** confirmed via direct source read — commit `703e014`
  (`gap-wiring-coverage-check-owns-false-positive`) already fixed `WIRING_VERB_RE`'s possessive-
  "own" false-positive class; commit `f3d870b` (M198, this same overall `prepare-milestone`
  session) independently hit a different, still-open merged-Markdown-list class from the identical
  `wiring-coverage-check.ts` checker. This child's real, production-wired fix: `prepare-milestone.js`
  gains a new `Preflight` phase, dispatched via `agent()` right after `Admission` and before
  `ProposalAuthors`, running the real (non-`--selftest`) preflight CLI — confirmed real via the
  production-callsite AC item above.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/prepare-milestone.js` and the shared `wiring-coverage-check.ts` module both
  DIR-117 and DIR-122 depend on).
- [ ] A real, non-fixture `prepare-milestone` dispatch against a task with a deliberately-seeded
  known-bad Proposal is exercised end to end, showing `preflight-rejected` before any author agent
  is spent, with journal output showing the bounded mechanical runner separately, not asserted.
- [ ] RED/GREEN evidence exists for all five preflight classes plus the `splitSentences` fix.
- [ ] Fail-closed activation evidence proves detector calibration completed before enforcement;
  no uncalibrated regex verdict is blocking in production.
- [ ] A fresh independent audit confirms the real production callsite from `prepare-milestone.js`'s
  `Preflight` phase, not merely unit-test reachability, and confirms the Plan-shape-timing reading
  either matches the reviewer's own intent or was corrected per their feedback.

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
