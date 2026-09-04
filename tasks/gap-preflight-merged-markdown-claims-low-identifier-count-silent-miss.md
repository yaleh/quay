---
id: gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss
title: preflightMergedMarkdownClaims silently returns zero findings for a
  genuine mid-line-bulleted block naming fewer than 2 backtick identifiers --
  pre-existing, found incidentally during a 2026-07-31 adversarial review of two
  sibling false-positive fixes, unrelated to either
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test
    experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
---
## Proposal

**Accepted risk: no code change. Record the reasoning explicitly here as the deliverable.**
The current behavior (return `null` for blocks with fewer than 2 distinct backtick identifiers)
is correct and intentional when assessed against the detector's own stated purpose. The `<2`
threshold is not an accidental omission in a severity-tiering ladder; it is the logical lower
bound of the phenomenon the detector exists to detect.

### Problem framing (grounded in current code)

`preflightMergedMarkdownClaims` (`prepare-admission-check.ts` line 542) scans a task's
"Requested action" / "Proposal" / "Finding" sections for blocks that contain a MID-LINE bullet
marker (regex `/\S[ \t]+[-*][ \t]+\S/g`, line 494 -- matching e.g. "`Foo.ts` - also...") AND
multiple backtick-quoted code identifiers, indicating two or more distinct wiring/architecture
claims crammed onto one un-split line that the list-aware sentence-splitter (line 549, reusing
`splitSentences` from `wiring-coverage-check.ts`) cannot see because it is keyed on LINE-START
bullets only.

The control flow at lines 553-568 is:

```
for (const block of blocks) {
  const midBulletMatches = _midBulletMatches(block);
  if (midBulletMatches.length === 0) continue;
  const identifiers = new Set([...block.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  const allLookLikeProseDash = midBulletMatches.every((m) => m.looksLikeProseDash);
  if (identifiers.size >= 4 && !allLookLikeProseDash) {
    // blocking tier
  } else if (identifiers.size >= 2) {
    // ambiguous / reviewer-required tier
  }
  // identifiers.size < 2: falls through SILENTLY -- no record at all
}
```

When `identifiers.size < 2` (0 or 1 backtick identifier), NEITHER branch fires:
`worstIdentifierCount` stays 0, `anyAmbiguous` stays false, and the function returns `null`
(zero findings, line 580). This is the gap: a block with a genuine mid-line bullet marker but
fewer than 2 backtick identifiers produces no finding at all -- not even an ambiguous/
`reviewer-required` visibility signal.

The construct `Update `FooModule` - also rewrite the retry logic entirely...` (one backtick
identifier, one genuine-looking `- also` mid-line bullet marker) reproduces the gap. A
fully-prose variant with zero identifiers does the same.

This structure is BYTE-FOR-BYTE identical to what shipped originally in M201/DIR-126-B
(commit `3552787`, the initial Build commit) and predates all three rounds of sibling-task
fixes. It was not introduced or affected by any of those fixes. None of the sibling tasks
mention the <2-identifier case in their Requested Action or AC.

### Real-incidence scan

A focused scan was run against ALL 495+ task files under `tasks/`, replicating the detector's
own section-extraction logic (Proposal / Requested action / Finding), block splitting, code-span
exclusion, and mid-bullet matching, then filtering to blocks with <2 unique backtick identifiers.
Methodology: same `extractSection` headings the detector reads, same `_MID_BULLET_RE` regex,
same code-span exclusion as `_midBulletMatches`. Scan script preserved at
`/tmp/real-incidence-scan.mjs` for reproducibility.

**Result: 0 genuine crammed-claims cases with <2 identifiers across the entire task corpus.**
The one raw hit (`gap-build-evidence-manifest-missing.md`, 0 identifiers, match `"d - s"`) is
an ASCII prose dash in the informational block `"[Proposal content preserved - see commit
54c6c301 for the full implementation evidence]"` -- not a crammed-claims pattern, not even a
bullet marker, and its match would be excluded by the code-span check in the real detector
anyway.

The motivating example from this task's own Finding section (`Update `FooModule` - also rewrite
the retry logic entirely...`) is the only known real-English instance of a 1-identifier mid-bullet
block, and it is self-referential (constructed in the Finding section of the gap-reporting task
itself) -- it does not appear in any production task body's Proposal or Requested Action section.

### Key design decisions and rationale

**Decision 1: <2-identifier blocks are outside the detector's scope, not a coverage gap.**

The detector's header comment (lines 423-428) defines its purpose: detecting blocks that
"cram TWO OR MORE distinct wiring claims onto one line." A claim in this detector's vocabulary
is a statement about a named code entity (a backtick-quoted identifier). A block naming 0 or 1
distinct code entities definitionally cannot represent "two crammed claims about different
entities" -- the precondition for the detector's hypothesis is unsatisfied. The <2 threshold is
not an accidental omission in a severity-tiering ladder; it is the logical lower bound of the
phenomenon the detector exists to detect.

The single-identifier construct `Update `FooModule` - also rewrite the retry logic
entirely...` is arguably ONE claim about one entity (`FooModule`) with an inline aside about
retry logic, not TWO claims about DIFFERENT entities. The aside does not name a second code
entity and does not assert a second wiring dependency between named code components. It falls
outside the wiring-claim detector's remit -- it is a formatting/readability concern about prose
cramming, not a wiring-architecture concern about claim crowding.

**Decision 2: The round-3 "never silently suppress below a visible tier" principle does not
apply to the <2-identifier case.**

The sibling tasks' round-3 design (lines 460-472) established that an ASCII-dash prose signal
should DOWNGRADE severity (blocking -> ambiguous) rather than FULLY SUPPRESS a match. This
principle governs how to handle a block that DOES have the requisite number of identifiers
(>=4) but whose mid-bullet markers LOOK like prose dashes -- i.e., it addresses the
FALSE-POSITIVE control problem for the >=4-identifier tier. It does not address the question of
whether the detector should engage at all for <2-identifier blocks, which is a structurally
different question: whether the very phenomenon the detector seeks (multiple crammed claims)
can definitionally exist in the input.

Applying the "never suppress" principle to <2-identifier blocks would mean emitting an
ambiguous finding for every block with 0-1 identifiers and a mid-sentence dash -- a policy that
would flag blocks like "`git ls-files` - we use this to build the basename index" or
"`Date.now()` - the single clock-source for this module" as `reviewer-required`. This is a
high-noise, zero-signal proposition that wastes human reviewer attention on blocks containing a
single entity reference and an ASCII dash, with no plausible multiple-claims hypothesis.

**Decision 3: No new severity tier is needed.**

The existing three-tier system (blocking >=4 non-prose, ambiguous 2-3 or >=4 prose-downgraded,
silent 0-1) is coherent when understood as "multiple-claim blocks" + "plausibly-multiple-claim
blocks" + "cannot-be-multiple-claim blocks." Adding a fourth tier for 0-1 would blur the
detector's purpose and create a new false-positive class without a corresponding
genuine-detection class.

### Concrete control/data flow (current, unchanged)

The detector's normal flow for its five possible input classes:

| Input class | `identifiers.size` | `allLookLikeProseDash` | Finding | Severity |
|---|---|---|---|---|
| >=4 genuine crammed | >=4 | false | `preflight-merged-markdown-claims` | blocking |
| >=4 prose dash | >=4 | true | `preflight-ambiguous-merged-markdown-claims` | reviewer-required |
| 2-3 identifiers | 2-3 | any | `preflight-ambiguous-merged-markdown-claims` | reviewer-required |
| 1 identifier (the gap shape) | 1 | any | `null` (no finding) | silent |
| 0 identifiers (the gap shape) | 0 | any | `null` (no finding) | silent |

The last two rows are the gap under discussion. This proposal RECOMMENDS KEEPING them as-is --
silent is the correct behavior because these blocks cannot contain multiple crammed wiring claims
about distinct code entities.

### Defaults and failure behavior

No change to defaults. The detector's `PREFLIGHT_CALIBRATED["preflight-merged-markdown-claims"]`
stays `true` (blocking is enforced at the `runPreflightChecks` layer). The gap shapes (0-1
identifiers) continue to produce zero findings, which is the intentional accepted-risk posture.

### Compatibility

No code change -- fully backward-compatible by construction. Both mirrors
(`experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` and
`plugin/scripts/prepare-admission-check.ts`, confirmed byte-identical via `diff`) stay
unchanged. The test suite remains unchanged (no new test fixtures, no test modification).

### Risks

**Risk 1 (accepted): A future task might contain a genuinely crammed multi-claim block that
happens to use <2 backtick identifiers.**

Likelihood: very low. The detector's domain is wiring/architecture claims about CODE ENTITIES.
A claim about a code entity that does not backtick-name that entity is rare in this repo's
established authoring conventions (every real task body uses backtick identifiers to name files,
functions, modules, etc.). A block with <2 backtick identifiers but genuinely containing two
wiring claims would require both claims to be about entities named without backtick quoting -- a
style this repo does not use.

Mitigation: the existing list-aware sentence-splitter would still catch this block IF the two
claims are on separate lines (bulleted) -- the `splitSentences`/`splitListAwareBlocks`
reimplementation at line 549 already handles line-start bullets correctly. The only miss case is
a mid-line bullet with both claims avoiding backtick quoting of their entity names -- a shape
with likely zero real incidence, consistent with the real-incidence scan above.

**Risk 2 (defended): A reviewer could interpret the accepted-risk decision as scope creep /
lowering the bar.**

Mitigation: this proposal explicitly distinguishes the <2 case from the >=4 and 2-3 cases on
structural grounds (the detector's purpose is multiple-crammed-claims detection, which has a
definitional lower bound of 2 identifiers), not on cost or convenience. The real-incidence scan
proves the decision is grounded in data, not assumption.

### Non-goals

- Extending the detector to flag poorly-formatted single-claim prose as a general readability
  concern. That is a separate, different detector with a different purpose (prose-formatting
  linting, not wiring-claim crowding detection).
- Adding a general-purpose "any mid-sentence dash is potentially a merged claim" signal. This
  would produce high-noise, low-signal output that undermines the detector's calibrate-then-
  enforce discipline.
- Building a perfect semantic classifier of whether a single-identifier prose block "could" be
  a crammed claim. The round-3 design's own header comment (lines 460-462) explicitly
  acknowledges "no finite heuristic over unstructured English prose can be both sound and
  complete" -- the accepted-risk posture here is an extension of that same principle: do not
  build a heuristic for a question that has zero real incidence.
- Not redesigning the `_isProseDashTail` / `_CONTINUATION_STOPWORDS` heuristic. The heuristic
  serves its purpose at the >=4 tier (downgrade from blocking to ambiguous) and has survived
  independent adversarial audit. This task's scope is the <2-identifier gap only.

### AC coverage

- **AC 1 (real-incidence scan):** Covered. Scan completed (see "Real-incidence scan" section
  above). Result: 0 genuine crammed-claims cases with <2 identifiers across all 495+ task files.
- **AC 2 (fix or accepted-risk note):** Covered by this entire Proposal -- an explicit, reasoned
  accepted-risk note recorded as the task's ## Proposal, satisfying the "explicit, reasoned
  accepted-risk note" path.
- **AC 3 (no regression):** Covered by construction. No code changes means zero regression risk.
  The existing test suite (8 tests in `prepare-admission-check.test.mjs` under
  `describe("preflightMergedMarkdownClaims")`; 83 tests file-wide) continues to pass unchanged.

### Alternatives considered and rejected

**Alternative 1: Extend the ambiguous tier to cover the 1-identifier case, emitting
`preflight-ambiguous-merged-markdown-claims` with disposition `reviewer-required` whenever a
block with a mid-bullet match has exactly 1 identifier (always ambiguous, never blocking, no
`_isProseDashTail` check applied).**

This is the "fix" position. The severity ladder would become:

| Identifiers | Mid-bullet match tails | Verdict |
|---|---|---|
| 0 | any | silent (correct by construction) |
| 1 | any | `ambiguous` / `reviewer-required` (new) |
| 2-3 | any | `ambiguous` / `reviewer-required` (existing) |
| >=4 | all prose-dash | `ambiguous` / `reviewer-required` (existing downgrade) |
| >=4 | at least one non-prose-dash | `blocking` (existing) |

Rejected because:
- The detector's header comment defines its purpose as detecting "two or more distinct wiring
  claims" -- a definitional impossibility for a block with <2 distinct named code entities. The
  1-identifier block `Update `FooModule` - also rewrite the retry logic entirely...` is arguably
  ONE claim about one entity with an inline aside, not TWO claims about different entities.
- The real-incidence scan found 0 genuine cases this would catch -- the only known real-English
  instance is self-referential (constructed in the gap-reporting task's own Finding section).
  Zero signal for the non-zero noise it would introduce (every valid single-entity block with a
  mid-sentence ASCII dash now flagged as `reviewer-required`).
- It violates the "calibrate-then-enforce" discipline: a detector that fires on a phenomenon
  with zero real incidence is definitionally uncalibrated, and per `PREFLIGHT_CALIBRATED`'s own
  design (lines 278-303), an uncalibrated detector should run non-blocking/logged-only. But even
  logged-only, a finding with 0 genuine cases is just noise -- it teaches reviewers to ignore
  the detector, eroding trust in its genuine (>=4 and 2-3) signals.
- The fix is mechanically trivial (one `else if` branch), but triviality is not a sufficient
  justification. The cost is a permanent new false-positive class for a phenomenon that does not
  occur.

**Alternative 2: Apply `_isProseDashTail` to the 1-identifier case -- surface as ambiguous only
when the mid-bullet tail is NOT a stopword, stay silent otherwise.**

Rejected because:
- At identifier count 1, the signal-to-noise ratio for the stopword heuristic is too low. The
  round-2 refutation proved that genuine second claims can start with stopwords ("The new caching
  layer must..."). At count 1, there is even less signal (only one named entity) to cross-validate
  the stopword prediction against.
- This would ALSO create a false-positive class (1-identifier blocks whose tail is NOT a stopword
  -- e.g., "`Date.now()` - the single clock source" where the tail starts with "the", which IS a
  stopword, would stay silent; but "`Date.now()` - returns epoch milliseconds" would flag). The
  stopword heuristic gates on a surface property with no semantic grounding at this tier.

**Alternative 3: Introduce a distinct finding code for 1-identifier blocks
(`preflight-ambiguous-merged-markdown-claims-single-id`).**

Rejected because:
- The reviewer action is identical regardless of identifier count (review the block; decide
  whether it represents one claim or two). Introducing a distinct code adds taxonomy noise without
  meaningful differentiation.
- The existing `preflight-ambiguous-merged-markdown-claims` code and message already cover the
  case ("plausibly one claim with an inline aside, not confidently a merged-claims case") -- but
  the question here is whether to engage the detector at all, not what code to use if it does.

**Alternative 4: Remove the identifier-count gate entirely and flag EVERY mid-bullet-markered
block, regardless of identifier count.**

Rejected because:
- This is exactly the "binary genuine/not-genuine gate" the round-3 design explicitly forbade
  (lines 460-462), just in the opposite direction -- instead of suppressing everything below a
  threshold, it flags everything above zero. Both extremes defeat calibration: a detector that
  fires on every ASCII dash in prose is too noisy to be useful.
- The round-3 design's core insight (lines 467-471) -- "stop trying to build a perfect binary
  classifier... bound the blast radius" -- was about keeping a signal VISIBLE while downgrading
  its severity. It was NOT about making every pattern signal. Adding 0-1 coverage would make
  every ASCII dash signal, creating noise that the severity downgrade does not solve (a reviewer
  still has to read and dismiss each `reviewer-required` finding).

### Mechanism-claim wiring coverage (DIR-117)

**Claim W1:** `preflightMergedMarkdownClaims` currently returns `null` for blocks with <2
backtick identifiers. Verified at lines 561-580 of `prepare-admission-check.ts`: the
`if/else if` ladder has no `identifiers.size < 2` branch, and `worstIdentifierCount`
(initialized to 0) never reaches >=4, and `anyAmbiguous` (initialized to false) stays false,
so line 580 `return null` fires.

**Claim W2:** The <2-identifier gap predates all three rounds of sibling-task fixes. Verified:
git-blame on lines 561-568 shows commit `3552787` (DIR-126-B Build, 2026-07-29), the same
commit that introduced the entire `preflightMergedMarkdownClaims` function. The sibling fixes
landed in later commits and touched different regions (the ASCII-dash prose detection logic at
lines 460-538, not the identifier-count dispatch at lines 561-568).

**Claim W3:** The real-incidence scan found 0 genuine <2-identifier crammed-claims cases across
all 495+ task files. Verified by the scan script at `/tmp/real-incidence-scan.mjs`, which is
reproducible: `node /tmp/real-incidence-scan.mjs`.

**Claim W4:** The accepted-risk decision introduces no regression risk. Verified by
construction: no code change means the existing test suite at
`describe("preflightMergedMarkdownClaims")` (8 tests under that describe block; 83 tests
file-wide) passes byte-identically.

**Claim W5:** The accepted-risk reasoning is grounded in the detector's own stated purpose from
its header comment (lines 423-428): "blocks that cram two or more distinct wiring claims onto
one line." A <2-identifier block definitionally does not contain "two or more distinct"
named-entity claims.

## Plan

`docs/plans/M247-gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss.md` (base revision `1f36910f`, authored 2026-08-01)

## Finding

Discovered 2026-07-31 by the independent adversarial review of round 3 of the two sibling tasks'
fix (which redesigned the mid-line-bullet-marker detector's ASCII-dash/code-span false-positive
handling — see those tasks' Execution records for the full history). While probing
`preflightMergedMarkdownClaims`'s full control flow for the review's own purposes, the reviewer
constructed:

```
Update `FooModule` - also rewrite the retry logic entirely...
```

— one backtick identifier, one genuine-looking mid-line bullet marker ("- also" reads as a
continuation in isolation, but the block plausibly crams "update FooModule" and "rewrite the retry
logic" onto one line) — and a fully prose variant with zero backtick identifiers. Both return `null`
(zero findings) from the real function.

Diffed against `master`'s pre-round-1 (i.e. pre-2026-07-31) code for this function: the
`identifiers.size < 2 -> drop entirely` structure is byte-for-byte identical to what shipped
originally. This is NOT a regression introduced by any of the three rounds on the sibling tasks —
it predates all of them, and none of those tasks' own Requested Action or Acceptance Criteria
mention the low-identifier-count case at all (their scope is specifically the `>=4`-identifier
false-positive shapes). Filed here as its own follow-up rather than silently left unaddressed,
per this repo's own convention (see the sibling tasks' Execution records, and this repo's general
practice of filing every real reviewer finding as a task rather than letting it evaporate).

**Severity note**: this is a genuinely lower-stakes gap than the sibling tasks' — a block naming
fewer than 2 code entities is less likely to represent 2 DISTINCT wiring/architecture claims (the
detector's actual concern), and more likely to be a single claim about one entity with an inline
aside. The real-incidence scan confirms this: 0 genuine cases across all 495+ task files (the
one raw hit is an ASCII prose dash, not a crammed-claims pattern). An explicit accepted-risk
note, recorded in ## Proposal above, is the appropriate resolution.

## Requested action

1. Decide whether a genuine mid-line-bulleted block with 0-1 backtick identifiers should surface
   ANY finding (even non-blocking/ambiguous), or whether the detector's identifier-count-based
   design is intentionally scoped to blocks naming multiple entities (i.e. this may be a correct,
   intentional non-goal rather than a defect — assess against the detector's own stated purpose in
   its header comment before assuming a fix is warranted).
2. If a fix is warranted: extend the existing severity system (blocking / ambiguous /
   reviewer-required / silent) to cover this shape, following the same "never silently suppress a
   genuine defect below a visible tier" principle the sibling tasks' round-3 design established —
   do not reintroduce a binary genuine/not-genuine gate that can return zero findings for a real
   defect.
3. If NOT warranted: record the reasoning explicitly in this task (e.g. citing a real-incidence
   scan finding zero occurrences, or a structural argument for why <2-identifier blocks are out of
   this detector's intended scope) rather than leaving the box silently unchecked.

## Acceptance Criteria

- [x] A real-incidence scan (similar to the sibling tasks' 495-task-file scan) establishes whether
  this shape occurs in this repo's real task files today, to inform severity/priority.
- [x] Either: a fix lands extending coverage to this shape (with regression tests, following the
  round-3 "downgrade never fully suppresses" principle), OR an explicit, reasoned accepted-risk
  note is recorded here explaining why the current behavior is correct/acceptable as designed.
- [x] No regression: the full `prepare-admission-check.test.mjs` suite (both mirrors) stays green.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master` under human-steered discipline, OR closed as an explicit accepted-risk
  decision with documented reasoning — this task's own AC #1 determines which outcome is
  appropriate.

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs
- tasks/gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss.md
- docs/plans/M247-gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss.md

## Execution record

- **Milestone:** M247 — `preflightMergedMarkdownClaims` low-identifier-count silent miss
  (accepted-risk resolution, documentation-only deliverable).
- **Iteration count:** 1 Build pass (no code changes made — the accepted-risk posture recorded in
  `## Proposal` is the deliverable) + 1 verification pass covering the plan's Phase A stages.
- **Outcome:** Closed as an explicit accepted-risk decision with documented reasoning. The
  `<2`-identifier silent fall-through in `preflightMergedMarkdownClaims` is intentional and
  correct per the detector's own stated purpose (header comment: detecting blocks that cram "two
  or more distinct wiring claims onto one line" — a definitional lower bound of 2 identifiers).
  The real-incidence scan found 0 genuine crammed-claims cases with <2 identifiers.
- **Verification performed (plan Phase A, all three stages):**
  - Stage 1 (real-incidence scan): scan reproduced from the detector's own
    `extractSection`/`splitSentences`/`_MID_BULLET_RE` + code-span exclusion logic across all 675
    task files under `tasks/`. Result: **0 genuine cases** with <2 identifiers. The 5 raw regex
    hits are all non-genuine: three are prose math/table patterns (`1085 total - 410 lines`,
    `| - --json`, `N * 50`) that are ASCII dash/asterisk in prose, not bullet markers; two are
    this task's own self-referential examples (the motivating `FooModule` + `- also` construct from
    the Finding section and the `Date.now()` example from the Alternatives section) constructed in
    this task's Proposal/Finding, not in any production task body.
  - Stage 2 (structural review): `preflightMergedMarkdownClaims`'s dispatch ladder at lines
    573-580 (current file, byte-identical both mirrors) confirmed — `if (identifiers.size >= 4 &&
    !allLookLikeProseDash)` then `else if (identifiers.size >= 2)`, no branch for `< 2`;
    `worstIdentifierCount` stays 0 and `anyAmbiguous` stays false, so `return null` (line 592)
    fires. The header comment (lines 435-441) grounds the definitional lower bound of 2.
  - Stage 3 (test suite regression + mirror identity): both mirrors pass **83/83 tests, 0 fail,
    0 skipped** (`scripts/test.sh experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
    and `scripts/test.sh plugin/test/prepare-admission-check.test.mjs`, run with
    `QUAY_TEST_SKIP_STATIC_CHECKS=1` because master-level static checks currently flag unrelated
    in-flight sibling-task files, not this task's). `diff` confirms both script mirrors and both
    test mirrors are byte-identical. `git diff` confirms zero changes to any `experiments/` or
    `plugin/` source/test file (DD1 guardrail: no code changes).
- **Realized Δv:** 0 (documentation-only; the accepted-risk decision record is the surface
  improved, not product code).
- **Commit SHA:** this Build commit on
  `task/gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss` (landed on `master`
  by the outer loop under human-steered discipline).