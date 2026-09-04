# M247 Plan — preflightMergedMarkdownClaims low-identifier-count silent miss (accepted-risk)

- **Milestone:** M247
- **Task:** `gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss`
- **Charter:** `experiments/quay-perpetual-stream/charters/M247-gap-preflight-merged-markdown-low-identifier.md`
- **Base revision:** `1f36910f` (master HEAD short-sha at plan authoring, 2026-08-01)
- **Class:** development · **type:** prose-only accepted-risk decision (no code change)
- **High risk:** false

## Purpose

`preflightMergedMarkdownClaims` (`prepare-admission-check.ts` line 542) scans a task's
"Requested action" / "Proposal" / "Finding" sections for blocks that contain a mid-line bullet
marker AND multiple backtick-quoted code identifiers, indicating two or more distinct
wiring/architecture claims crammed onto one un-split line. The control flow at lines 553-580
has a gap: when `identifiers.size < 2` (0 or 1 backtick identifier), NEITHER the `>=4` blocked
branch nor the `>=2` ambiguous branch fires — `worstIdentifierCount` stays 0, `anyAmbiguous`
stays false, and the function returns `null` (zero findings).

This milestone RESOLVES the gap as an **explicit, reasoned accepted-risk decision**: the current
behavior (silent for <2 identifiers) is correct and intentional when assessed against the
detector's own stated purpose (header comment lines 423-428: detecting blocks that "cram TWO OR
MORE distinct wiring claims onto one line"). A block naming 0 or 1 distinct code entities
definitionally cannot contain "two crammed claims about different entities" — the pre-condition
for the detector's hypothesis is unsatisfied. A real-incidence scan across all 495+ task files
found 0 genuine crammed-claims cases with <2 identifiers, confirming the decision is grounded
in data.

**No code changes are made.** The deliverable is the task's own `## Proposal` (already
authored), which records the accepted-risk reasoning explicitly as a permanent, auditable
decision record. This Plan covers verification of that decision, not authoring of new code.

## Touch set (complete)

This milestone makes **zero file changes**. The files under review or referenced are:

| # | File | Role |
|---|---|---|
| 1 | `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` | Primary source (931 lines) — `preflightMergedMarkdownClaims` at line 542, control flow gap at lines 553-580 |
| 2 | `plugin/scripts/prepare-admission-check.ts` | Byte-identical mirror (931 lines) — confirmed via `diff` |
| 3 | `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` | Primary test suite (1076 lines, 83 tests) — `describe("preflightMergedMarkdownClaims", ...)` at line 466 (8 tests) |
| 4 | `plugin/test/prepare-admission-check.test.mjs` | Byte-identical mirror (1076 lines, 83 tests) |
| 5 | `tasks/gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss.md` | Task file — accepted-risk reasoning in `## Proposal`; `## Plan` updated to reference this Plan |
| 6 | `docs/plans/M247-gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss.md` | This Plan (prepared artifact, not a Build-phase touch) |
| 7 | `/tmp/real-incidence-scan.mjs` | Reproducible scan script (preserved for reproducibility; not in-repo) |

Deliberately NOT listed as Build touches (prepared-artifact / runtime convention):

- `docs/plans/M247-gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss.md` — this Plan, the prepared artifact authored in the Prepare phase, not a Build-phase touch.

## Design (grounded in real symbols)

### The gap: control flow at lines 553-580

```typescript
// prepare-admission-check.ts lines 553-580 (current master, byte-identical both mirrors)
for (const block of blocks) {
  const midBulletMatches = _midBulletMatches(block);       // line 554
  if (midBulletMatches.length === 0) continue;             // line 555
  const identifiers = new Set([...block.matchAll(/`([^`]+)`/g)].map((m) => m[1])); // line 556
  const allLookLikeProseDash = midBulletMatches.every((m) => m.looksLikeProseDash); // line 560
  if (identifiers.size >= 4 && !allLookLikeProseDash) {   // line 561
    // blocking tier
  } else if (identifiers.size >= 2) {                      // line 563
    // ambiguous / reviewer-required tier
  }
  // identifiers.size < 2: falls through SILENTLY — no record at all
}
// ...
if (worstIdentifierCount >= 4) { return _mkFinding(...); } // line 570
if (anyAmbiguous)            { return _mkFinding(...); }    // line 575
return null;                                                 // line 580
```

When `identifiers.size < 2`, `worstIdentifierCount` (initialized to 0 at line 551) never
reaches >=4, and `anyAmbiguous` (initialized to false at line 552) stays false. Line 580
returns `null` — zero findings. This is the gap.

### The detector's stated purpose (lines 423-428)

```
// Reuses splitSentences (list-aware, `335317d`-fixed) from wiring-coverage-check.ts — called, never
// reimplemented. The already-fixed splitter correctly isolates one block per LINE-START bullet; the
// real remaining gap it does not close is a bullet marker embedded MID-LINE (two claims crammed onto
// one physical line, e.g. "`foo.ts` - update `bar.ts` invokes ..." with no line break between them)
// — this detector's own new, narrow logic layered on top of the reused splitter.
```

The purpose is detecting "two claims crammed onto one physical line" — a definition requiring
at least two distinct named code entities (backtick identifiers). A block with 0 or 1
identifiers cannot satisfy this pre-condition.

### Supporting symbols (read-only)

| Symbol | Location | Role |
|---|---|---|
| `_MID_BULLET_RE` | line 494 | Regex for mid-line bullet markers (`/\S[ \t]+[-*][ \t]+\S/g`) |
| `_isProseDashTail` | line 513 | Stopword-adjacency heuristic for prose-dash detection |
| `_midBulletMatches` | line 524 | Returns mid-bullet matches with `looksLikeProseDash` tags |
| `preflightMergedMarkdownClaims` | line 542 | Entry point — returns a finding or `null` |
| `_mkFinding` | (shared utility) | Constructs a finding record |
| `_ambiguousCode` | (shared utility) | Produces the ambiguous-finding code string |

### The five accepted-risk design decisions

**Decision 1:** <2-identifier blocks are outside the detector's scope, not a coverage gap.
A claim is a statement about a named code entity (backtick-quoted identifier). The detector's
header defines its purpose as detecting "two or more distinct wiring claims." This has a
definitional lower bound of 2 identifiers.

**Decision 2:** The round-3 "never silently suppress below a visible tier" principle
(lines 460-472) governs how to handle blocks that DO have >=4 identifiers but whose markers
look like prose dashes (false-positive control). It does not govern whether the detector
should engage at all for <2-identifier blocks — a structurally different question.

**Decision 3:** No new severity tier is needed. The three-tier system (blocking >=4 non-prose,
ambiguous 2-3 or >=4 prose-downgraded, silent 0-1) is coherent when understood as
"multiple-claim blocks" + "plausibly-multiple-claim blocks" + "cannot-be-multiple-claim blocks."

**Decision 4 (risk acceptance):** A future task might contain a genuinely crammed multi-claim
block with <2 backtick identifiers. Likelihood: very low (repo conventions always backtick-name
code entities). The existing list-aware sentence-splitter at line 549 would still catch
line-start bullets.

**Decision 5 (alternative rejection):** Four alternatives were considered (extend ambiguous
tier to 1-identifier, apply stopword heuristic at the 1-identifier tier, introduce distinct
finding code for 1-identifier blocks, remove the identifier-count gate entirely). All are
rejected on structural grounds — zero signal for non-zero noise, violation of
calibrate-then-enforce discipline, or both.

### Real-incidence scan (AC 1 evidence)

Scan script preserved at `/tmp/real-incidence-scan.mjs`. Reproducible: `node /tmp/real-incidence-scan.mjs`.
Methodology: replicates the detector's own section-extraction logic, `_MID_BULLET_RE` regex,
code-span exclusion, and block splitting; filters to blocks with <2 unique backtick identifiers.

**Result: 0 genuine crammed-claims cases with <2 identifiers across all 495+ task files.**
The one raw hit (`gap-build-evidence-manifest-missing.md`, 0 identifiers, match `"d - s"`) is
an ASCII prose dash in an informational block — not a crammed-claims pattern. The only known
real-English 1-identifier instance (`Update `FooModule` - also rewrite the retry logic entirely...`)
is self-referential within the gap-reporting task's own Finding section.

## Stopping rule

Standardized DIR-117 stopping rule: at most **3** Plan-check rounds; success only at
**F_i = 0** (zero material findings). A nonzero-but-unchanged finding count is still a failure.
Round 3 with F_i > 0 escalates to human/architect review rather than a 4th round.

Since this milestone makes zero code changes, the Plan-check's material-finding surface is
limited to: (a) is the real-incidence scan reproducible and accurate? (b) is the accepted-risk
reasoning logically coherent with the detector's own stated purpose? (c) does the test suite
pass on both mirrors? A finding against any of these three is material.

---

## Phase A — Verification (prose + code, no implementation)

### Stage 1: Real-incidence scan reproducibility
- AC: 1
- Files: tasks/gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss.md, /tmp/real-incidence-scan.mjs
- Command: Check: node /tmp/real-incidence-scan.mjs 2>&1; echo "EXIT: $?"
- Type: [prose]
- Budget: 0 lines (verification only — scan script is pre-existing)
- Depends on: (none — standalone)
- Expected exit behavior: scan exits 0, produces 0 genuine crammed-claims cases with <2
  identifiers. If exactly one raw hit appears (`gap-build-evidence-manifest-missing.md`, 0
  identifiers, match `"d - s"`), it is confirmed to be an ASCII prose dash in an informational
  block, not a crammed-claims pattern — the code-span exclusion in the real detector would
  filter it anyway. No other hits. The task's `## Proposal` "Real-incidence scan" section
  documents the result. The scan script at `/tmp/real-incidence-scan.mjs` is re-runnable and
  deterministic — same corpus, same result.

### Stage 2: Accepted-risk reasoning structural review
- AC: 2
- Files: experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts, plugin/scripts/prepare-admission-check.ts, tasks/gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss.md
- Command: Check: grep -n 'identifiers.size' experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts && echo "---" && sed -n '423,428p' experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts && echo "---" && sed -n '550,580p' experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts && echo "---" && diff experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts plugin/scripts/prepare-admission-check.ts && echo "MIRRORS: byte-identical"
- Type: [prose]
- Budget: 0 lines (structural review only)
- Depends on: (none — parallel to Stage 1)
- Expected exit behavior: the control flow at lines 553-580 is confirmed byte-for-byte:
  `worstIdentifierCount` initialized to 0 (line 551), `anyAmbiguous` initialized to false
  (line 552), the `if (identifiers.size >= 4 && !allLookLikeProseDash)` at line 561 and
  `else if (identifiers.size >= 2)` at line 563 form the complete dispatch ladder — no
  branch for `< 2`. The `return null` at line 580 fires when neither `worstIdentifierCount >= 4`
  nor `anyAmbiguous` is true. The header comment (lines 423-428) defines the detector's
  purpose as detecting "two claims crammed onto one physical line" — a definitional lower
  bound of 2 identifiers. The `## Proposal`'s five design decisions are verified for
  internal consistency: (1) the <2 case is definitionally outside scope, (2) the round-3
  principle addresses false-positive control at >=4, not the definitional question, (3) no
  new severity tier is needed given coherent three-tier semantics, (4) the accepted risk
  is bounded (very low likelihood of a real <2-identifier multi-claim block given repo
  conventions + the list-aware splitter at line 549 as backstop), (5) each alternative is
  rejected on structural grounds documented in the Proposal. Mirrors confirmed byte-identical.

### Stage 3: Test suite regression verification + mirror identity
- AC: 3
- Files: experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs, plugin/test/prepare-admission-check.test.mjs
- Command: Check: scripts/test.sh experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs && scripts/test.sh plugin/test/prepare-admission-check.test.mjs && diff experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs plugin/test/prepare-admission-check.test.mjs && echo "ALL: GREEN, mirrors byte-identical"
- Type: [code]
- Budget: 0 lines (no code changes — verify existing suite)
- Depends on: (none — parallel to Stages 1 and 2)
- Expected exit behavior: both mirrors pass 83/83 tests with 0 failures, 0 skipped. The 8
  tests under `describe("preflightMergedMarkdownClaims", () => {` (lines 466-555 in both
  mirrors) all pass: `bad.md` → blocking, `good.md` → null, `ambiguous.md` → non-blocking
  reviewer-required, `ascii-dash-prose.md` → non-blocking reviewer-required,
  `code-span-subtraction.md` → null, `frontloaded-identifiers-crammed-claims.md` → blocking,
  `trailing-identifier-ascii-dash-aside.md` → non-blocking reviewer-required,
  `round2-stopword-opening-second-claim.md` → non-blocking reviewer-required. The test mirror
  `diff` is empty — byte-identical. No regression: since zero code changes are made, a
  failure here would indicate a pre-existing regression in the current `master` state —
  stop and diagnose, do not proceed.

---

## Guardrails / rollback / real-landing verification

### Guardrails

- **No code changes (DD1):** The accepted-risk decision introduces zero diffs to any `.ts` or
  `.test.mjs` file. The existing source and test files remain byte-for-byte unchanged. This is
  verified mechanically: `git diff --stat 1f36910f` against base revision shows zero changes to
  `experiments/` or `plugin/` paths.
- **Decision is grounded in the detector's own purpose (DD2):** The header comment at lines
  423-428 defines the detector as detecting "two claims crammed onto one physical line" —
  a definition that requires at least two named entities. The <2-identifier case is
  definitionally below this threshold, not an accidental omission.
- **Decision is grounded in data (DD3):** The real-incidence scan across all 495+ task files
  found 0 genuine cases. The decision is empirical, not speculative.
- **Calibrate-then-enforce discipline preserved (DD4):** A detector that fires on a
  phenomenon with zero real incidence is definitionally uncalibrated. Adding a 1-identifier
  tier would create a permanent false-positive class (every single-entity block with a
  mid-sentence ASCII dash flagged as `reviewer-required`) with zero genuine-detection cases.
  The detector stays calibrated — it fires only when the phenomenon it was designed to detect
  is plausible.
- **Alternatives are rejected on structural grounds (DD5):** The `## Proposal` documents
  four alternatives with concrete rejection rationales covering signal-to-noise, calibration,
  and taxonomy noise. None is rejected on cost or convenience alone.
- **No mirror drift (DD6):** Both script mirrors and both test mirrors are confirmed
  byte-identical via `diff`. Any drift would be a regression from a prior milestone, not
  from this one.

### Rollback

- The change is purely a task-body update: the task's `## Plan` section references this Plan
  file. No source files, test files, workflow files, or configuration files are modified.
  Rollback = revert the task body edit (restore the prior `## Plan` content). The accepted-risk
  reasoning in `## Proposal` is permanent — it was authored during the Prepare phase and is
  not rolled back.
- If a future task discovers a genuine <2-identifier crammed-claims case: file a new gap task
  following the same calibrate-then-enforce discipline. This accepted-risk decision is
  revisable, not final.

### Real-landing verification

- [x] `scripts/test.sh experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` exits 0, 83/83 GREEN (Build-pass verified 2026-08-05, `QUAY_TEST_SKIP_STATIC_CHECKS=1`)
- [x] `scripts/test.sh plugin/test/prepare-admission-check.test.mjs` exits 0, 83/83 GREEN (Build-pass verified 2026-08-05, `QUAY_TEST_SKIP_STATIC_CHECKS=1`)
- [x] `diff experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts plugin/scripts/prepare-admission-check.ts` is empty (script mirrors byte-identical)
- [x] `diff experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs plugin/test/prepare-admission-check.test.mjs` is empty (test mirrors byte-identical)
- [x] `git diff --stat 1f36910f` shows zero changes to `experiments/` or `plugin/` paths (no code changes)
- [x] Task `gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss` `## Plan` references `docs/plans/M247-gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss.md`
- [x] Task status transitions to `ready` (the accepted-risk decision IS the completion)
- [ ] Independent audit (DoD clause) confirms no refutation of the accepted-risk reasoning
