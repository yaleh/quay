---
id: gap-preflight-merged-markdown-ascii-dash-false-positive
title: preflight-merged-markdown-claims's mid-line-bullet regex also matches
  an ordinary ASCII " - " prose dash, not just a bullet marker -- currently
  dormant (0/495 real task files hit it), filed as a follow-up rather than
  blocking M201/DIR-126-B's fourth audit round
status: todo
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

- [ ] The tightened regex/logic is real, wired in both the canonical
  `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` and the byte-identical
  `plugin/scripts/prepare-admission-check.ts` mirror (`cmp`, zero output).
- [ ] A new regression test confirms the ASCII-dash-prose reproduction no longer hard-blocks, while
  the existing genuine-mid-line-bullet RED fixture still does.
- [ ] No regression: the existing `preflightMergedMarkdownClaims` RED/known-good/ambiguous tests and
  the full `prepare-admission-check.test.mjs` suite stay green.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline (this touches the shared
  `prepare-admission-check.ts` module DIR-126-A/DIR-126-B/DIR-126-C all depend on).
- [ ] Real, non-fixture evidence: the reproduction sentence dogfoods clean against the real CLI
  post-fix.

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs
