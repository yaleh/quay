---
id: gap-preflight-merged-markdown-ascii-dash-false-positive
title: preflight-merged-markdown-claims's mid-line-bullet regex also matches
  an ordinary ASCII " - " prose dash, not just a bullet marker -- currently
  dormant (0/495 real task files hit it), filed as a follow-up rather than
  blocking M201/DIR-126-B's fourth audit round
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
---
## Proposal

Tighten `preflightMergedMarkdownClaims`'s mid-line-bullet detection (`_MID_BULLET_RE` /
`/\S[ \t]+[-*][ \t]+\S/g`, `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`)
so it does not also match an ordinary ASCII " - " prose dash/aside — only a genuine bullet-marker
shape (e.g. requiring the token immediately following the `-`/`*` to itself look like the start of
a new claim, not just any word).

## Finding

Discovered 2026-07-29 by the fourth independent adversarial audit of M201/DIR-126-B (dispatched
specifically to hunt for false positives in the three detectors still calibrated `true`, after
three prior rounds found real defects in the other two). Constructed reproduction:

```
This change touches `foo.ts`, `bar.ts`, `baz.ts`, and `qux.ts` - all four files share one helper
module, so the refactor is contained.
```

The real CLI hard-blocks this ordinary prose (an ASCII hyphen aside, not a bullet list) with
`preflight-merged-markdown-claims`, `blocking:true`. The same sentence using this repo's actual
dominant em-dash style (`—`) does not trip it. A scan of all 495 task files (open + closed) found
**zero** instances of this exact shape (>=2 backtick tokens separated by an ASCII ` - `), so this is
a real but currently dormant gap — it does not affect any live `--preflight` dispatch today, and
`preflight-merged-markdown-claims` remains calibrated `true`/blocking pending this fix (downgrading
it preemptively, with zero real incidence, would be unwarranted per the same "Repair/calibrate"
discipline this repo's own precedent — `gap-preflight-bare-filename-false-positive` — applies: only
downgrade a detector once a REAL false positive is found, not a merely-constructible one).

## Requested action

1. Tighten the mid-line-bullet regex (or the block classification logic built on it) in
   `preflight-admission-check.ts` (+ `plugin/scripts/` mirror) so an ASCII " - " prose dash/aside no
   longer matches, while a genuine mid-line bullet marker (`- item`, `* item` immediately following
   other text on the same physical line) still does.
2. Add a regression test: the exact reproduction sentence above returns zero findings (or, at most,
   a non-blocking `preflight-ambiguous-merged-markdown-claims`), while the existing RED fixture
   (genuine mid-line-bulleted claim-crowding) still blocks.
3. Re-verify no regression: the existing merged-markdown-claims RED/known-good/ambiguous fixture
   trio and the full `prepare-admission-check.test.mjs` suite stay green.

## Acceptance Criteria

- [x] The tightened regex/logic is real, wired in both the canonical
  `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` and the byte-identical
  `plugin/scripts/prepare-admission-check.ts` mirror (`cmp`, zero output). Round-3 design
  (`_isProseDashTail`, severity-downgrade-only). Independently re-verified 2026-07-31, verdict
  CONFIRMED: `cmp` clean on both mirrors, traced the function's own control flow to confirm the
  downgrade signal can never cause full suppression by itself.
- [x] A new regression test confirms the ASCII-dash-prose reproduction no longer hard-blocks, while
  the existing genuine-mid-line-bullet RED fixture still does. Independently re-verified: both
  behave correctly via direct real-CLI reproduction (not just the unit tests).
- [x] No regression: the existing `preflightMergedMarkdownClaims` RED/known-good/ambiguous tests and
  the full `prepare-admission-check.test.mjs` suite stay green. 83/83 pass in both mirrors,
  independently re-run by the round-3 reviewer (not trusted from the implementer's own claim).

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master` under human-steered discipline (this touches the shared
  `prepare-admission-check.ts` module DIR-126-A/DIR-126-B/DIR-126-C all depend on). Landed by the
  orchestrating session after round-3 independent review returned CONFIRMED.
- [x] Real, non-fixture evidence: the reproduction sentence dogfoods clean against the real CLI
  post-fix. Independently re-verified via direct `prepare-admission-check.ts --preflight`
  invocation against all 8 known repro/counterexample shapes plus a new adversarial mixed-signal
  case, not just the pasted output in this Execution record.

**Note (2026-07-31, not blocking this task, filed as a separate follow-up):** the round-3 reviewer
found a real, PRE-EXISTING gap unrelated to any of the three rounds here — a genuine mid-bullet
block with fewer than 2 total backtick identifiers silently returns zero findings (no ambiguous
tier either), confirmed byte-identical to this function's logic on `master` before round 1 ever
touched it. Out of scope for this task (which is specifically about the `>=4`-identifier
false-positive shapes); see `gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss`
for the follow-up.

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs
- experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/ascii-dash-prose.md
- plugin/test/fixtures/preflight/merged-markdown-claims/ascii-dash-prose.md
- experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/code-span-subtraction.md
- plugin/test/fixtures/preflight/merged-markdown-claims/code-span-subtraction.md
- experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/frontloaded-identifiers-crammed-claims.md
- plugin/test/fixtures/preflight/merged-markdown-claims/frontloaded-identifiers-crammed-claims.md
- experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/trailing-identifier-ascii-dash-aside.md
- plugin/test/fixtures/preflight/merged-markdown-claims/trailing-identifier-ascii-dash-aside.md

## Execution record

**Round 1** (2026-07-31, isolated worktree agent): implemented together with the sibling task
`gap-preflight-merged-markdown-claims-code-span-subtraction-false-positive` as one coherent change,
since both false-positive shapes hit the same regex/logic. Design: `_findGenuineMidBullet` treated a
mid-bullet match as genuine iff another backtick-quoted identifier occurred ANYWHERE LATER in the
block. Self-marked `status: done`, AC/DoD checked.

**Independent review of round 1: REFUTED.** The reviewer found the "identifier occurs later"
direction was unsound in both directions:
1. False NEGATIVE (the serious defect): `"...`foo.ts`, `bar.ts`, `baz.ts`, and `qux.ts` - fix the
   null check in the first two - also rename the last two files for clarity."` is a REAL
   crammed-two-claims defect — exactly what this detector exists to catch — but all 4 identifiers
   are front-loaded BEFORE the dashes, so "identifier later" was false and the block silently
   passed with `ok:true`. A false negative here is worse than the false positive being fixed: it
   defeats a hard-blocking safety check.
2. The same design also didn't fully generalize the fix this task itself wanted: `"`foo.ts` - the
   main entry point - and also `bar.ts` for testing, plus `baz.ts` and `qux.ts` for good measure."`
   still hard-blocked, because `bar.ts` occurs later in the block (just not adjacent to either
   marker) — only the narrower "no identifier anywhere after" shape of the originally-constructed
   repro was actually fixed.

**Round 2** (2026-07-31, same session, responding to the review): redesigned around a
direction-agnostic, marker-adjacent signal instead. `_looksLikeNewClaimStart(tail)` looks only at
the single word immediately following each marker: genuine iff that word is a backtick-quoted
identifier directly, or a word NOT in `_CONTINUATION_STOPWORDS` (a closed-class list of
articles/conjunctions/prepositions/pronouns/quantifiers/discourse-connectors — "the", "and",
"also", "which", "with", etc. — deliberately a STOPLIST rather than a verb whitelist, since verbs
are open-class/unbounded and a whitelist would silently under-cover; an unlisted word defaults to
"looks like a claim", the safety-preferred direction). Re-verified against BOTH review
counterexamples plus the original two repros and the pre-existing RED/ambiguous fixtures — all 6
behave correctly (see sibling task's Execution record for the same verification, shared fix).

Regression tests added for both review counterexamples (`frontloaded-identifiers-crammed-claims.md`
→ must still block; `trailing-identifier-ascii-dash-aside.md` → must NOT block), on top of the
round-1 tests, to both `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` and
its byte-identical `plugin/test/` mirror. Full suite: 82/82 pass in both mirrors. `cmp` zero output
on the script mirror, test mirror, and all 4 new fixture mirrors (2 from round 1, 2 from round 2).

Real-CLI dogfood, re-run post-redesign (`prepare-admission-check.ts --preflight`, not the unit-test
harness, against scratch task files):
- This task's own repro (ASCII-dash prose) → `{"ok":true,...}`, no merged-markdown-claims finding.
- Review counterexample A (front-loaded identifiers, must block) →
  `{"ok":false,"findings":[{"code":"preflight-merged-markdown-claims","blocking":true,...}]}`.
- Review counterexample B (trailing identifier, must NOT block) → `{"ok":true,...}`, no
  merged-markdown-claims finding.

**Independent review of round 2: REFUTED, with a worse false negative than round 1.**
`"...`foo.ts`, `bar.ts`, `baz.ts`, and `qux.ts` - The new caching layer must invalidate stale
entries on write, not just on read."` — front-loaded identifiers again, second claim starts with
"The" (a stopword) — silently passed with `result: null`. The reviewer's point, stated precisely:
a stoplist keyed on the FIRST WORD of a continuation cannot work as a genuine/not-genuine binary
gate, because genuine second claims and prose asides draw from the SAME function-word-heavy
distribution of ordinary English sentence openers ("This also...", "It must...", "The new..." are
all completely normal ways to start a real second claim, not just a prose aside). This was flagged
as worse in kind than round 1's bug — round 1 failed on one constructed edge case, round 2 failed
on the common case.

**Round 3** (2026-07-31, by the orchestrating session directly, after two failed subagent-heuristic
attempts): changed strategy. Stopped trying to build a perfect binary genuine/not-genuine
classifier over unstructured English prose — no finite heuristic can be both sound and complete,
and both prior designs erred specifically by ever fully SUPPRESSING a match (returning zero
findings) based on a necessarily-imperfect signal. Redesign: the same continuation-stopword signal
(renamed `_isProseDashTail`, same idea as round 2's tail check) is now bounded to a SEVERITY
DOWNGRADE ONLY. A block whose mid-bullet match(es) ALL look like a prose dash is downgraded from
the blocking (`>=4` identifiers) tier to the ambiguous/`reviewer-required` tier — exactly what this
task's own AC #2 explicitly permits ("zero findings, OR AT MOST a non-blocking ambiguous
variant") — and can never drop all the way to zero findings by this signal alone. This bounds the
blast radius precisely to what both refutations were actually objecting to (silent, invisible
suppression of a real defect): worst case under round 3, a genuine crammed-claims defect is flagged
non-blocking instead of blocking — still a real, visible, human-reviewed finding, never silently
missed.

Re-verified against ALL prior shapes plus a new adversarial case constructed during round 3 itself
(a block with one prose-looking dash AND one genuine-looking dash — must still block, since the
downgrade requires EVERY match in the block to look like prose, not just one):
- `bad.md` (genuine, must block) → still blocks (tail "update" is not a stopword).
- Round-1 counterexample A (front-loaded, genuine, must block) → still blocks (tail "fix" is not a
  stopword; the OTHER dash's "also" being a stopword doesn't matter — not every() match is prose).
- This task's own repro + round-2's counterexample (both prose, must not hard-block) → both
  DOWNGRADED to ambiguous (`ok:true`, `blocking:false`, `disposition:"reviewer-required"`), never
  silently suppressed.
- Round-1 counterexample B (trailing identifier, prose, must not hard-block) → downgraded to
  ambiguous.
- `code-span-subtraction.md` (unrelated to this signal) → unchanged, zero findings.
- New mixed-signal case (`"...qux.ts` - also note this - rewrite the validation logic entirely."`,
  one prose-looking dash + one genuine-looking dash) → correctly BLOCKS (real CLI, `blocking:true`)
  — confirms the "every() match must look like prose" requirement is load-bearing, not vestigial.

New regression test + fixture added for round 2's exact counterexample
(`round2-stopword-opening-second-claim.md`) asserting it is downgraded to ambiguous, not silently
suppressed. Full suite: 83/83 pass in both `experiments/quay-perpetual-stream/test/
prepare-admission-check.test.mjs` and `plugin/test/prepare-admission-check.test.mjs`. `cmp` zero
output on the script mirror, test mirror, and the new fixture mirror.

**Outcome:** fix redesigned a second time, with a structurally different safety property (bounded
downgrade, never full suppression) rather than a bigger heuristic. All evidence above is real and
reproducible. AC/DoD boxes remain UNCHECKED and `status` remains `todo` — two rounds of
self-assessment were wrong already; a third independent review is required before this task is
called done or landed.
