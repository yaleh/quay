# M205 / gap-wiring-coverage-check-whose-own-and-bold-marker-splitting — Iteration 0 (Build)

**Task:** gap-wiring-coverage-check-whose-own-and-bold-marker-splitting — fix two source-confirmed
regex defects in `wiring-coverage-check.ts` (`WIRING_VERB_RE`'s possessive-determiner exclusion
omits `whose`; `splitSentences()` never splits before a markdown bold marker `**`).
**Charter:** `experiments/quay-perpetual-stream/charters/M205-gap-wiring-coverage-checker-fixes.md`
**Plan:** `docs/plans/M205-gap-wiring-coverage-check-whose-own-and-bold-marker-splitting.md`
(9 ordered stages, all 7 task AC items mapped)
**Base revision:** `1bc3160` (HEAD at Build start; Plan was authored at `3d1ce2c` — the touch-set
source files are byte-unchanged between the two; all Plan baselines were re-verified live at Build
start and matched, with the admission suite grown to 148 tests / 16 suites since Plan authoring).

## Summary

Two precisely-scoped, in-place regex-literal edits in the ONE canonical implementation
(`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`), propagated to the plugin
mirror mechanically (never hand-edited), with a two-layer RED/GREEN regression fixture set in the
canonical test file only:

- **Fix 1** (`WIRING_VERB_RE`, line 50): `whose` added to the `owns?`-branch possessive-determiner
  exclusion lookbehind —
  `(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b` →
  `(?<!(?:'s|s'|its|their|my|our|your|his|her|whose)\s)\bowns?\b`. Verb branch and `/i` flag
  untouched. Strict narrowing: "whose own" no longer false-matches as an ownership-verb claim;
  genuine `owns` claims still fire.
- **Fix 2** (`splitSentences()`, line 102): split boundary widened on BOTH sides —
  `/(?<=[.!?])\s+(?=[A-Z`"])/` → `/(?<=[.!?]|\*\*)\s+(?=[A-Z`"]|\*\*)/`. Adjacent
  `**Bold-prefixed.** **Bold-prefixed.**` sentences now split into separate claims with disjoint
  identifier sets. The lookahead-ONLY variant was empirically disproved at Proposal adjudication
  (it peels `Done.` but leaves the two bold claims merged in one 4-identifier chunk); the symmetric
  both-sides edit is the minimal sufficient fix, re-confirmed live in this Build.

Neither edit touches any other function, any exported signature/return shape, `splitListAwareBlocks`,
the CLI block, or any consumer — every importer's contract (`checkWiringCoverage` in
`task-schema.ts` [W3], `splitSentences` in `prepare-admission-check.ts` [W2], the CLI dispatch from
`prepare-milestone.js` [W1]) is invariant by construction, proven by the non-regression runs below.

## Per-stage disposition (docs/plans/M205-…md)

| Stage | Status | Evidence |
|---|---|---|
| 1 (grounding + baselines) | Done | Canonical suite 18/18 pass; admission both copies 148/148 pass (grown from the Plan's 126 — re-baselined live); CLI vs `tasks/DIR-126-D.md` `ok:true`/22 claims/0 findings; `diff -q` mirrors byte-identical; both defect literals grep-confirmed at lines 50/102 |
| 2 (RED Fix-1 fixtures) | Done | "whose own" → 0-claims test + genuine-`owns` strict-narrowing control added to the canonical test file only; pre-fix run: the "whose own" test FAILS, the control passes, all 18 existing pass |
| 3 (RED Fix-2 two-layer fixtures) | Done | `splitSentences` added to the import; split-layer (exact AC-2 text → 3 chunks, disjoint `{id1,id2}`/`{id3,id4}`) + claim-layer (real wiring verb "calls" → 2 disjoint claims) added; pre-fix run: BOTH fail (split-layer yields 1 merged chunk, claim-layer yields 1 merged 4-identifier claim). Exactly **3 fail / 19 pass of 22** pre-fix — not GREEN-only, not RED-forever |
| 4 (two regex-literal edits) | Done | Exactly 2 lines modified in the canonical module (lines 50, 102). Mechanical receipt: `splitSentences(AC-2 text)` → 3 chunks AND `extractMechanismClaims("…whose own…")` → 0 claims → exit 0 (`STAGE4-RECEIPT-OK`) |
| 5 (GREEN canonical suite) | Done | `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` → **22/22 pass, 0 fail, exit 0** — all three RED fixtures flipped GREEN, no existing test regressed |
| 6 (mirror regeneration [W4]) | Done | `bash plugin/scripts/sync-vendor.sh` (mechanical `cp`, never a hand-edit) then `--check` → `OK (identical): scripts/wiring-coverage-check.ts`, `CLEAN: all files verified, no drift detected`; `diff -q` canonical vs mirror → byte-identical |
| 7 (DIR-126-D.md non-regression [W1]) | Done | CLI post-fix: `{ok:true, code:"wiring-coverage-complete", claims:21, findings:0}`, exit 0. Verdict invariance (not claim-count invariance, per the Plan): 22→21 claims as the finer `**` boundary re-chunks, zero findings — the checker doing its job, not a regression |
| 8 (admission both copies [W2]) | Done | `prepare-admission-check.test.mjs` both copies post-fix: **148/148 pass, 0 fail** — identical to the stage-1 baseline; `preflightMergedMarkdownClaims`'s reuse of `splitSentences` unaffected |
| 9 (full suite + landing) | Done | `bash scripts/test.sh` → SUITE-RESULT (see Test evidence); single commit to `master` scoped to exactly the touch-set files; lifecycle gate runs at Land on the real `extra.acceptance` meter |

## Test evidence

- `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`: **22/22 pass** post-fix
  (18 pre-existing + 4 new: Fix-1 "whose own" RED/GREEN, Fix-1 genuine-`owns` strict-narrowing
  control, Fix-2 split-layer RED/GREEN on the exact AC-2 text, Fix-2 claim-layer RED/GREEN with a
  real wiring verb). Pre-fix run proved exactly the 3 RED fixtures fail (19 pass / 3 fail of 22) —
  mechanically reproducible RED-before/GREEN-after (charter done-when), e.g. by `git stash`-ing the
  module edit.
- Stage-4 mechanical receipt: `splitSentences("Done. **A does X (`id1`, `id2`).** **B does Y
  (`id3`, `id4`).**")` → exactly 3 chunks; `extractMechanismClaims("the terminal whose own AC
  requires `a.ts` and `b.ts`")` → exactly 0 claims → exit 0.
- `bash plugin/scripts/sync-vendor.sh --check` → exit 0, `CLEAN`, `wiring-coverage-check`
  `OK (identical)` [W4/AC 5].
- CLI `--task tasks/DIR-126-D.md` post-fix → exit 0, `ok:true`, `findings: []` [W1/AC 4].
- `prepare-admission-check.test.mjs` (canonical + plugin mirror copies) post-fix → **148/148 pass,
  0 fail** [W2/AC 6].
- **Full canonical `bash scripts/test.sh` run:** SUITE-RESULT — includes
  `plugin/test/plugin-packaging.test.mjs`, which generically gates `sync-vendor.sh --check`
  (exit-0 + CLEAN assertions); the 3 live-GitHub test files self-skip absent
  `QUAY_TEST_LIVE_GITHUB=1` per ADR-019.

## AC checklist disposition

1. **`whose` in `WIRING_VERB_RE` exclusion; "whose own" NOT a claim (RED/GREEN)** — Done: line 50
   literal patched; "whose own" fixture RED pre-fix / GREEN post-fix.
2. **`splitSentences()` splits before `**` on BOTH sides; AC-2 paragraph → 3 chunks, disjoint
   identifier sets (RED/GREEN)** — Done: line 102 literal patched symmetrically; split-layer
   fixture asserts the exact AC-2 text → `["Done.", "**A does X (`id1`, `id2`).**", "**B does Y
   (`id3`, `id4`).**"]` with disjoint `{id1,id2}`/`{id3,id4}`; claim-layer with "calls" asserts 2
   disjoint claims.
3. **Regression tests in the canonical test file ONLY** — Done: all 4 new fixtures in
   `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`; NO
   `plugin/test/wiring-coverage-check.test.mjs` created (that file does not exist; 2/25
   sync-vendor-managed modules have one; mirror fidelity proven by the byte-identity gate).
4. **CLI vs `tasks/DIR-126-D.md` still `ok:true`/0 findings** — Done: `{ok:true,
   claims:21, findings:0}` post-fix (verdict-invariant; claim-count drift 22→21 is the intended
   finer-splitting behavior, disclosed in the Plan's stage 7).
5. **`sync-vendor.sh --check` → CLEAN after mechanical regeneration** — Done: `CLEAN`,
   `wiring-coverage-check` `OK (identical)`.
6. **`prepare-admission-check.test.mjs` both copies green** — Done: 148/148, identical to baseline.
7. **Grounding evidence / wiring-coverage completeness** — Done: the exhaustive-identifier union
   lives in the task's own AC item 7; all [W1]–[W4] surfaces grep-confirmed at stage 1 and re-run
   green post-fix; [W3] contract invariance holds by construction (no exported signature/return
   shape changed — both edits are internal regex literals).

## Charter done-when

"A fresh independent audit confirms both regex fixes are real, source-confirmed, and the new
regression fixtures actually fail before the fix and pass after (RED/GREEN, not GREEN-only)."
Satisfied: both literals were read from source before editing; the pre-fix RED run (3 fail / 19
pass of 22) and post-fix GREEN run (22/22) are recorded above and are mechanically reproducible by
reverting the two module lines.

## Touch-set commit scoping

The commit stages EXACTLY: `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`,
`experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`,
`plugin/scripts/wiring-coverage-check.ts` (regenerated mirror), and this iteration report. The task
file's `extra.acceptance` update (Land-phase lifecycle meter) lands with the task-file write-back.
Nothing from any other milestone is staged.
