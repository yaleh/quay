# Plan — M205 / gap-wiring-coverage-check-whose-own-and-bold-marker-splitting

- **Milestone:** M205
- **Task:** `gap-wiring-coverage-check-whose-own-and-bold-marker-splitting`
  (`tasks/gap-wiring-coverage-check-whose-own-and-bold-marker-splitting.md`)
- **Charter:** `experiments/quay-perpetual-stream/charters/M205-gap-wiring-coverage-checker-fixes.md`
  (GATE-HASH-REF: `5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93`)
- **Base revision:** `3d1ce2c` (HEAD short-sha at Plan authoring, 2026-07-30; full:
  `3d1ce2c763ed41f0c93ae1f05dfede713c55793f`). Supersedes the stale `b850542`/`b28cfdb`/`c82efac`
  Plans: `git diff --stat b850542..3d1ce2c` touches ONLY the task's own file (`## Touches`
  declarations), so every touch-set source file is byte-unchanged since the prior Plan, and all
  baselines below were re-verified LIVE at `3d1ce2c` during this Plan's authoring session.
- **Class:** development · capabilityGrowth · deliverable · not highRisk · primitive task role
- **Declared acceptance command (`extra.acceptance`):**
  `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`

Fix two source-confirmed regex defects in the ONE canonical implementation of the DIR-117/DIR-122
mechanism-claim wiring-coverage check (`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`,
292 lines):

- **Fix 1** — `WIRING_VERB_RE` (declared line 49, pattern line 50): the `owns?`-branch
  possessive-determiner exclusion lookbehind
  `(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b` lists 9 forms but omits `whose`, so
  "the terminal whose own AC requires X" false-matches as an ownership-verb claim (live-verified
  `WIRING_VERB_RE.test(...)` → `true` today, `false` under the patched literal; the genuine
  ownership sentence `"composite-land.ts owns dashboard.md writes"` stays `true` under BOTH).
  Edit: add `whose` to the existing exclusion alternation. Verb branch and `/i` flag untouched.
  The regex's single evaluation point is `WIRING_VERB_RE.test(sentence)` inside
  `extractMechanismClaims` (line 124), so the edit propagates to every consumer through that one
  call.
- **Fix 2** — `splitSentences()` (lines 98-105; per-block punctuation split line 102): the
  boundary `/(?<=[.!?])\s+(?=[A-Z`"])/` recognizes neither side of a markdown bold marker, so two
  adjacent `**Bold-prefixed.** **Bold-prefixed.**` sentences merge into one oversized "claim".
  Edit: widen BOTH sides — `/(?<=[.!?]|\*\*)\s+(?=[A-Z`"]|\*\*)/`. A lookahead-only variant is
  EMPIRICALLY WRONG (live-reproduced: it peels off `Done.` but leaves the two bold claims merged
  in one 4-identifier chunk — 2 chunks total — because the char before the inter-claim whitespace
  is a closing `*`, outside the untouched lookbehind). The symmetric both-sides edit is the
  minimal edit producing the correct 3-way split.

Neither edit touches `splitListAwareBlocks()` (line 69), `backtickIdentifiers()` (line 108),
`extractMechanismClaims()` (line 120), `bulletsOf()` (line 137), `checkWiringCoverage()`
(line 163), `extractSectionForCli` (line 222), `wiringFindingsFromUncovered` (line 240), the
`_runAsCli` block (lines 265-292), or any exported function's signature/return shape. Both edits
move behavior in ONE direction only: Fix 1 strictly reduces false-positive verb matches; Fix 2 is
strictly additive (only ever creates MORE split points, never fewer — the same property
`splitListAwareBlocks`'s own header documents). A document that was `ok:true` before cannot newly
FAIL from these two edits alone.

**Live baselines captured at `3d1ce2c` this session** (the RED-side references and
non-regression anchors):

- `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`
  → **18/18 pass, fail 0** (233-line file; line-10 import is
  `extractMechanismClaims, bulletsOf, checkWiringCoverage` — NOT `splitSentences`, which the
  split-layer fixture must ADD; `splitSentences` is exported at line 98).
- `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs plugin/test/prepare-admission-check.test.mjs`
  → **126/126 pass, fail 0** (63 per copy, 7 suites each).
- `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts --task tasks/DIR-126-D.md`
  → `{ok:true, code:"wiring-coverage-complete"}`, **22 claims, `findings: []`**, exit 0 — the real
  previously-passing document the fix must not regress.
- `diff -q experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts plugin/scripts/wiring-coverage-check.ts`
  → byte-identical today.

**Wiring claims this Plan relies on (all PRE-EXISTING, [W1]-[W4]; verified by direct source read
at `3d1ce2c`):**

- **[W1]** `plugin/workflows/prepare-milestone.js:541` sets
  `_wiringCheckScript = 'experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'`
  (repo-root-relative — the canonical file is what the real gate executes) and `:544` dispatches
  `node --experimental-strip-types ${_wiringCheckScript} --task tasks/${_taskId}.md` in the
  ProposalReview phase; the guard (lines 549-553) fails a non-parseable verdict CLOSED to
  `wiring-coverage-check-failed`/`needs-human` via `_releaseLeaseAndRecord`, and line 555 merges
  the parsed `findings` array via `_upsertFindings(..., 0)`.
- **[W2]** `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts:44` imports
  `splitSentences`; `preflightMergedMarkdownClaims` (line 379) calls it directly at line 386 — the
  second real consumer the original Finding did not name.
- **[W3]** `experiments/quay-perpetual-stream/scripts/task-schema.ts:323` imports
  `checkWiringCoverage`, called only via the gap path (`checkGapWiringCoverage`, lines 354/357,
  wired into the gap assertion set at line 441). Both fixes are internal regex literals — no
  exported signature/return shape changes, so every importer's contract is invariant by
  construction.
- **[W4]** `plugin/scripts/sync-vendor.sh` (`cmp_or_report` line 53, `SYNC_SCRIPTS` line 147,
  `wiring-coverage-check` entry line 169) mechanically `cp`s canonical→plugin and `--check`
  byte-compares; it is the ONLY mechanism carrying the fix into the mirror (no hand-edit branch),
  and is generically gated inside `scripts/test.sh` by `plugin/test/plugin-packaging.test.mjs`
  (exit-0 assertion line 200, CLEAN assertion line 203).

## Complete touch set (classification · mode · stage · line budget)

| # | File | Class | Mode | Stage(s) | Line budget |
|---|---|---|---|---|---|
| 1 | `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` | code | EDIT — two regex literals (lines 50, 102) | 4 | 2 lines modified, net 0 |
| 2 | `plugin/scripts/wiring-coverage-check.ts` | code | REGENERATE — `sync-vendor.sh` mechanical `cp`, byte-identical; NEVER hand-edit | 6 | carries the same 2-line change |
| 3 | `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` | code | EDIT — line-10 import + RED/GREEN fixtures | 2, 3, 5 | ~+75 lines |
| 4 | `tasks/gap-wiring-coverage-check-whose-own-and-bold-marker-splitting.md` | prose | EDIT — `## Plan` splice (this prepare step) + AC checkboxes flipped at landing | 9 | ~+20 lines |
| 5 | `docs/plans/M205-gap-wiring-coverage-check-whose-own-and-bold-marker-splitting.md` | prose | CREATE/EDIT — this Plan | 9 | ~470 lines new |
| 6 | `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` | code | RUN-ONLY | 1, 8 | 0 |
| 7 | `plugin/test/prepare-admission-check.test.mjs` | code | RUN-ONLY | 1, 8 | 0 |
| 8 | `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` | code | READ-ONLY — [W2] consumer (lines 44/379/386) | 1 | 0 |
| 9 | `plugin/scripts/prepare-admission-check.ts` | code | READ-ONLY — mirror consumer (exercised via its test copy) | 8 | 0 |
| 10 | `experiments/quay-perpetual-stream/scripts/task-schema.ts` | code | READ-ONLY — [W3] consumer (lines 323/354-357/441) | 1 | 0 |
| 11 | `plugin/scripts/task-schema.ts` | code | READ-ONLY — mirror; carries `sync-vendor.sh`'s expected attribution-only diff (NOT in the byte-identical set) | — | 0 |
| 12 | `experiments/quay-perpetual-stream/test/task-schema.test.mjs` | code | RUN-ONLY — OPTIONAL reinforcement (outside `scripts/test.sh`'s glob; run directly if desired) | 9 | 0 |
| 13 | `plugin/workflows/prepare-milestone.js` | code | READ-ONLY — [W1] dispatch source (lines 541/544/549-555) | 1 | 0 |
| 14 | `.claude/workflows/prepare-milestone.js` | code | READ-ONLY — workflow copy | — | 0 |
| 15 | `plugin/scripts/sync-vendor.sh` | shell | RUN-ONLY — [W4] mirror mechanism (lines 53/147/169) | 6 | 0 |
| 16 | `plugin/test/plugin-packaging.test.mjs` | code | RUN-ONLY — generically gates `sync-vendor.sh --check` (lines 183/200/203) | 9 | 0 |
| 17 | `scripts/test.sh` | shell | RUN-ONLY — canonical suite entrypoint (owns the test glob) | 9 | 0 |
| 18 | `tasks/DIR-126-D.md` | prose | READ-ONLY — real non-regression document | 1, 7 | 0 |

Total NEW code: ~+75 lines of test fixtures plus 2 modified regex-literal lines in the canonical
module; the mirror carries the identical 2-line change mechanically. Everything else is
READ-ONLY/RUN-ONLY.

## AC → stage mapping (all 7 task Acceptance Criteria items)

| AC# | Subject | Covering stages |
|---|---|---|
| 1 | `whose` in `WIRING_VERB_RE` exclusion; "whose own" fixture NOT a claim (RED before / GREEN after) | 2 (RED fixture), 4 (implementation), 5 (GREEN) |
| 2 | `splitSentences()` splits before `**` on BOTH sides; AC-2 paragraph → 3 chunks, disjoint `{id1,id2}`/`{id3,id4}` (RED before / GREEN after) | 3 (RED fixture), 4 (implementation), 5 (GREEN) |
| 3 | Regression tests in the canonical test file ONLY (no `plugin/test/` mirror created) | 2, 3 (authoring), 5 (green) |
| 4 | `wiring-coverage-check.ts --task tasks/DIR-126-D.md` still `ok:true`/0 findings post-fix | 7 |
| 5 | `sync-vendor.sh --check` → `CLEAN` for `wiring-coverage-check` after mechanical regeneration | 6 |
| 6 | `prepare-admission-check.test.mjs` (both copies) still fully green post-fix | 8 |
| 7 | Grounding evidence — exhaustive identifiers / wiring-coverage completeness (DIR-117 self-coverage) | 1 (baselines + call-site greps), 9 (exhaustive-identifier list + landing verification) |

Every AC index 1-7 appears in at least one stage's `- AC:` list below (mechanically enforced by
`milestone-preparation-check.ts`'s `parsePlanStages` → `validatePlanStructure`; this Plan emits
exactly 9 stage blocks in that format and self-checks to `plan-structure-ok`: "Plan has 9
stage(s), all 7 task AC item(s) mapped").

**Dependency graph:** `1 → 2 → 3 → 4 → 5 → 6 → {7, 8} → 9` (stages 7 and 8 are independent of
each other and may run in either order after 6; stage 8's plugin copy exercises the regenerated
mirror, so it MUST follow 6).

---

### Stage 1: Grounding + baseline capture at base revision `3d1ce2c`
- AC: 7
- Files: experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts, experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs, experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs, plugin/test/prepare-admission-check.test.mjs, tasks/DIR-126-D.md, plugin/workflows/prepare-milestone.js, experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts, experiments/quay-perpetual-stream/scripts/task-schema.ts, plugin/scripts/sync-vendor.sh
- Command: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs && node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs plugin/test/prepare-admission-check.test.mjs && node --experimental-strip-types experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts --task tasks/DIR-126-D.md

**Class: prose / verification (READ + RUN only).** Zero changed lines. Budget: 0. Deps: none.

Re-confirm, at the base revision, every fact the rest of this Plan relies on:

- Run the three baseline commands above. **Expected exit behavior:** exit 0 for the whole chain;
  suite 1 reports `pass 18` / `fail 0`; suite 2 reports `pass 126` / `fail 0` (63 per copy); the
  CLI prints JSON `{ok:true, code:"wiring-coverage-complete"}` with 22 claims and `findings: []`
  and exits 0. (All three were run live at `3d1ce2c` during this Plan's authoring session with
  exactly these results.)
- Grep-confirm the two defect literals verbatim: `WIRING_VERB_RE` at line 50 (9-form exclusion, no
  `whose`) and the `splitSentences` punctuation split at line 102 (`/(?<=[.!?])\s+(?=[A-Z`"])/`).
- Grep-confirm the four pre-existing wiring surfaces: [W1] `prepare-milestone.js:541`/`:544`;
  [W2] `prepare-admission-check.ts:44`/`:379`/`:386`; [W3] `task-schema.ts:323`/`:357`/`:441`
  (`checkDirectiveSections` at line 303 verified call-free — directive-side enforcement is the
  [W1] CLI dispatch); [W4] `sync-vendor.sh:53`/`:147`/`:169`.
- Confirm `diff -q` canonical vs `plugin/scripts/wiring-coverage-check.ts` → byte-identical.

If any baseline deviates, STOP and re-adjudicate before touching anything — the RED/GREEN
expectations of stages 2-3 and the non-regression anchors of stages 7-8 are pinned to these
results.

### Stage 2: RED — Fix-1 "whose own" regression fixtures (canonical test file only)
- AC: 1, 3
- Files: experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
- Command: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs

**Class: code (RED).** Budget: ~+25 lines. Deps: stage 1.

Add to `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` ONLY (no
`plugin/test/wiring-coverage-check.test.mjs` — that file does not exist and this task deliberately
does NOT create one; mirror fidelity is proven by the stage-6 byte-identity gate):

- A test asserting `extractMechanismClaims("the terminal whose own AC requires `a.ts` and `b.ts` …")`
  yields **0 claims** (a "whose own" sentence with ≥2 backtick identifiers must NOT be treated as
  an ownership-verb claim).
- A genuine-`owns` CONTROL test asserting
  `extractMechanismClaims("composite-land.ts owns dashboard.md writes from `x.ts` to `y.ts` …")`
  yields **1 claim** — this must pass under BOTH the current and the patched literal (strict
  narrowing: no real ownership claim stops matching).

**Expected exit behavior (RED):** the `extra.acceptance` command exits **non-zero** — the new
"whose own" test FAILS (under the current literal, `WIRING_VERB_RE` matches "whose own", so 1
claim ≠ expected 0), the control test passes, and the existing 18 tests still pass
(`fail` count = exactly the new RED test). Do NOT edit the module in this stage — the failure
proves the fixture detects the live defect.

### Stage 3: RED — Fix-2 two-layer bold-marker fixtures (split-layer + claim-layer)
- AC: 2, 3
- Files: experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
- Command: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs

**Class: code (RED).** Budget: ~+50 lines (including the 1-line import change). Deps: stage 2.

First, add `splitSentences` to the line-10 import (→ `extractMechanismClaims, bulletsOf, checkWiringCoverage, splitSentences`).
Then add the TWO-LAYER fixture design the Proposal mandates (implementation trap named explicitly:
the AC-2 fixture text uses the verb "does", which is NOT a wiring verb — verified against
`extractMechanismClaims`'s verb test at line 124 and `identifiers.length >= 2` test at line 126 —
so a claim-level assertion on the literal AC-2 text returns 0 claims BOTH before and after the
split fix and would be RED-forever; hence two layers):

- **(a) Split-layer:** assert
  `splitSentences("Done. **A does X (`id1`, `id2`).** **B does Y (`id3`, `id4`).**")` yields
  exactly **3 chunks** — a leading zero-identifier `Done.` chunk plus two identifier-carrying
  sentences with DISJOINT backtick-identifier sets `{id1, id2}` / `{id3, id4}` — asserted directly
  on the exact AC-2 text.
- **(b) Claim-layer RED/GREEN pair:** use a REAL wiring verb inside the bold sentences —
  `"**A calls `x1.ts` from `y1.ts`.** **B calls `x2.ts` from `y2.ts`.**"` — asserting
  `extractMechanismClaims` yields **2 claims** with disjoint identifier pairs
  `{x1.ts, y1.ts}` / `{x2.ts, y2.ts}`.

**Expected exit behavior (RED):** exit **non-zero** — the split-layer test FAILS (unpatched:
exactly ONE merged chunk carrying all 4 identifiers with `Done.` still attached — the char after
the post-`Done.` whitespace is `*`, outside the existing lookahead class, so the unpatched regex
does not even peel `Done.` off; the 2-chunk `Done.`-peeled shape is the disproved lookahead-only
variant, NOT the pre-fix baseline); the claim-layer test FAILS (1 merged 4-identifier claim ≠ 2);
stage 2's "whose own" test still fails RED; the existing 18 pass.

### Stage 4: Implementation — two in-place regex-literal edits in the canonical module
- AC: 1, 2
- Files: experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- Command: node --experimental-strip-types --input-type=module -e "const m = await import('./experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'); const chunks = m.splitSentences('Done. **A does X (\`id1\`, \`id2\`).** **B does Y (\`id3\`, \`id4\`).**'); const claims = m.extractMechanismClaims('the terminal whose own AC requires \`a.ts\` and \`b.ts\`'); if (chunks.length !== 3 || claims.length !== 0) process.exit(1);"

**Class: code (implementation).** Budget: 2 lines modified, net 0. Deps: stage 3.

Apply exactly two edits to `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`:

1. **Line 50 (`WIRING_VERB_RE`):**
   `(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b` →
   `(?<!(?:'s|s'|its|their|my|our|your|his|her|whose)\s)\bowns?\b` — one word added to the
   existing exclusion alternation; the verb branch
   `\b(invokes?|calls?|dispatches?|enforces?|wires?|routes?|delegates?)\b` and the `/i` flag are
   untouched.
2. **Line 102 (`splitSentences` per-block split):**
   `block.split(/(?<=[.!?])\s+(?=[A-Z`"])/)` →
   `block.split(/(?<=[.!?]|\*\*)\s+(?=[A-Z`"]|\*\*)/)` — trailing `\*\*` mirrors the existing
   trailing `[.!?]`; leading `\*\*` mirrors the existing leading `[A-Z`"]`. BOTH sides, not
   lookahead-only.

No other line changes: `splitListAwareBlocks` (69), `backtickIdentifiers` (108),
`extractMechanismClaims` (120), `bulletsOf` (137), `checkWiringCoverage` (163),
`extractSectionForCli` (222), `wiringFindingsFromUncovered` (240), `_runAsCli` (265-292), and
every exported signature/return shape are untouched — the [W3] contract invariance is by
construction.

**Expected exit behavior:** the stage Command (run from the repo root; the `\`` escapes make the
`-e` program safe inside bash double quotes) exits **0** ONLY when BOTH edits are in place —
exactly 3 chunks from the AC-2 text and 0 claims from the "whose own" sentence; exits **1**
otherwise. It is the mechanical implementation receipt bridging the RED stages (2-3) and the GREEN
stage (5).

### Stage 5: GREEN — canonical suite via the declared `extra.acceptance` command
- AC: 1, 2, 3
- Files: experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs, experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- Command: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs

**Class: code (GREEN).** Budget: 0. Deps: stage 4.

Run the task's declared `extra.acceptance` command verbatim — the SAME command the lifecycle gate
runs. **Expected exit behavior:** exit **0**, `fail 0`, `pass` = the existing 18 plus EVERY new
fixture GREEN: "whose own" → 0 claims; genuine-`owns` control → 1 claim; AC-2 split-layer → 3
chunks with disjoint `{id1,id2}`/`{id3,id4}`; claim-layer → 2 claims with disjoint pairs. Any
failure here BLOCKS the milestone — do not proceed to stage 6 with a red suite (fail-closed by
design: this command is the lifecycle meter).

### Stage 6: Mirror regeneration — mechanical `sync-vendor.sh`, never a hand-edit [W4]
- AC: 5
- Files: plugin/scripts/wiring-coverage-check.ts, plugin/scripts/sync-vendor.sh
- Command: bash plugin/scripts/sync-vendor.sh && bash plugin/scripts/sync-vendor.sh --check

**Class: code (mechanical regeneration).** Budget: the mirror carries stage 4's 2-line change;
0 new lines authored. Deps: stage 5.

Regenerate `plugin/scripts/wiring-coverage-check.ts` by running `sync-vendor.sh` in mutating mode
(mechanical `cp` canonical→plugin; `SYNC_SCRIPTS` entry at line 169; no hand-edit branch exists
for any of the 25 entries), then byte-verify with `--check` (`cmp_or_report`, line 53).
**Expected exit behavior:** BOTH runs exit 0 and `--check` reports `CLEAN` for
`wiring-coverage-check`; `diff -q` canonical vs mirror → byte-identical. Hand-editing
`plugin/scripts/wiring-coverage-check.ts` is FORBIDDEN — a later non-`--check` sync would silently
clobber it, reintroducing the exact drift the mechanical step exists to prevent.

### Stage 7: Real-document non-regression — CLI vs `tasks/DIR-126-D.md` [W1]
- AC: 4
- Files: tasks/DIR-126-D.md, experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- Command: node --experimental-strip-types experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts --task tasks/DIR-126-D.md

**Class: verification (RUN only).** Budget: 0. Deps: stage 6.

Re-run the canonical CLI against the real document that surfaced both defects (already manually
restructured into bullets pre-fix; stage-1 baseline: `ok:true`, 22 claims, 0 findings). **Expected
exit behavior:** exit **0** with JSON `ok:true` and `findings: []`. This asserts VERDICT
invariance, NOT claim-count invariance: the finer `**` boundary may shift the exact claim count
(a previously-merged chunk can split into pieces whose claims remain AC-covered), so a count
different from 22 WITH `ok:true`/empty `findings` is the checker doing its job, not a regression
to suppress. Any `ok:false` or non-empty `findings` BLOCKS — that would mean the fix surfaced a
genuinely uncovered claim, requiring adjudication, not silent acceptance.

### Stage 8: Second-consumer non-regression — `prepare-admission-check.test.mjs`, both copies [W2]
- AC: 6
- Files: experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs, plugin/test/prepare-admission-check.test.mjs, experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts, plugin/scripts/prepare-admission-check.ts
- Command: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs plugin/test/prepare-admission-check.test.mjs

**Class: verification (RUN only).** Budget: 0. Deps: stage 6 (the plugin test copy imports
`plugin/scripts/prepare-admission-check.ts`, which imports the REGENERATED mirror
`plugin/scripts/wiring-coverage-check.ts` — so this stage cannot run before stage 6).

Exercise `preflightMergedMarkdownClaims`'s direct reuse of `splitSentences`
(`prepare-admission-check.ts:379`, call at `:386`) through BOTH copies' test suites. **Expected
exit behavior:** exit **0**, `pass 126` (63 per copy, 7 suites each), `fail 0` — identical to the
stage-1 baseline. Any failure BLOCKS: the widened boundary must not regress the admission
preflight's merged-markdown-claims detector (its 3 real
`experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/` fixtures carry
only a line-initial `**type:**` + lowercase continuation, which introduces NO new split point
under the both-sides fix — verified: line-initial `**` with no preceding `[.!?]`-or-`**`+whitespace
is unaffected, and the widened lookahead does not match lowercase).

### Stage 9: Grounding evidence, full canonical suite, and real landing on `master`
- AC: 7
- Files: scripts/test.sh, plugin/test/plugin-packaging.test.mjs, experiments/quay-perpetual-stream/test/task-schema.test.mjs, tasks/gap-wiring-coverage-check-whose-own-and-bold-marker-splitting.md, docs/plans/M205-gap-wiring-coverage-check-whose-own-and-bold-marker-splitting.md
- Command: bash scripts/test.sh

**Class: prose + verification (landing).** Budget: ~+20 task-body lines (the `## Plan` splice
performed at this prepare step + AC checkbox flips at landing) and ~470 new prose lines for this
Plan file. Deps: stages 7 and 8.

- **(a) Full canonical suite.** Run `bash scripts/test.sh` (it owns the glob
  `packages/*/test/*.test.mjs plugin/test/*.test.mjs`; do not hand-write a copy of the glob
  elsewhere). This also executes `plugin/test/plugin-packaging.test.mjs`, which gates
  `sync-vendor.sh --check` generically (exit-0 assertion line 200, CLEAN assertion line 203).
  **Expected exit behavior:** exit 0. The 3 live-GitHub test files self-skip via their own in-file
  skip conditions absent `QUAY_TEST_LIVE_GITHUB=1` and report `skipped`, NOT silently excluded.
- **(b) Grounding evidence (AC 7).** The exhaustive backtick-identifier list (rounds 1-5 union)
  lives in the task's own `## Acceptance Criteria` item 7; every identifier in it was confirmed
  real by direct source read during Proposal adjudication and re-verified by stage 1's greps at
  `3d1ce2c` — none is a new invention. [W3] is closed by construction (both edits are internal
  regex literals; no exported signature/return shape changes), optionally reinforced by a direct
  `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/task-schema.test.mjs`
  run (it lives OUTSIDE `scripts/test.sh`'s glob, so it must be invoked directly, not via the
  canonical suite). This stage's own deliverable — this Plan file — makes the directive-mode
  `--task` self-coverage check return `ok:true` on the task's own file.
- **(c) Real landing.** Stage EXACTLY the touch-set files that changed (the canonical module, the
  canonical test file, the regenerated mirror, the task file, this Plan file) and make a SINGLE
  commit to `master` — the loop runs directly on `master` (DIR-027). Then run the lifecycle gate:
  `quay task check gap-wiring-coverage-check-whose-own-and-bold-marker-splitting` →
  `ok:true` (all AC boxes checked), and `promote`/`complete`, which re-runs the real
  `extra.acceptance` command as the mechanical meter ("the meter is runnable, not asserted").
  **Expected exit behavior:** `scripts/test.sh` exit 0; the commit lands on `master`; task check
  reports `ok:true`; lifecycle transition succeeds.

## Guardrails

- **Canonical-only edit; mirror ONLY via `sync-vendor.sh`.** Never hand-edit
  `plugin/scripts/wiring-coverage-check.ts` (stage 6); the single source of truth is the canonical
  module plus its paired canonical test file.
- **Both sides of the split boundary, or the fix is broken.** The lookahead-only variant is
  empirically disproved (stage 3's RED expectations encode the proof); implementing it would ship
  a fix that fails the task's own AC-2 test.
- **Two-layer fixtures, because "does" is not a wiring verb.** A claim-level test on the literal
  AC-2 text is RED-forever (0 claims before AND after — lines 124/126); the claim-layer MUST use a
  real wiring verb ("calls"). Never ship a GREEN-only OR a RED-forever fixture.
- **No new verbs, no scope creep.** Do NOT add `imports?|reuses?|reused|parses?|parsed` (or any
  verb) to `WIRING_VERB_RE` — explicitly REJECTED at M201/DIR-126-B (header lines 41-48: the wider
  verb set surfaces NEW uncovered claims against already-landed, already-audited tasks). Do NOT
  touch `splitListAwareBlocks`, emphasis markers other than `**`, or the module header's stale
  `checkDirectiveSections` attribution (comment-only, out of scope). Do NOT create
  `plugin/test/wiring-coverage-check.test.mjs` or a `plugin/test/fixtures/...` tree for this module.
- **Strictly one-directional behavior.** Fix 1 only ever reduces false-positive matches; Fix 2
  only ever adds split points. A document `ok:true` before cannot newly FAIL from these edits
  alone (stage 7's verdict-invariance check encodes this).
- **Commit hygiene — scope the commit to THIS touch set.** The shared working tree currently
  contains unrelated in-flight changes from another milestone (DIR-126-E: e.g.
  `milestone-preparation-check.ts` both copies, `packages/quay-github/src/github-client.ts`,
  `tasks/DIR-126-E.md`); `git add` ONLY this task's touch-set files. Two `execute-milestone`
  dispatches must never run concurrently against this repo (shared working tree — CLAUDE.md);
  land at a clean window per DIR-027 steering hygiene (root-level `.halt` or private worktree,
  `restart-readiness-check.sh` before un-halt).

## Rollback

- The change is a single commit touching two regex literals + fixtures + regenerated mirror:
  `git revert <sha>` restores the pre-fix literals and test file, THEN re-run
  `bash plugin/scripts/sync-vendor.sh && bash plugin/scripts/sync-vendor.sh --check` to carry the
  reverted literals into the mirror and re-prove byte-identity (`CLEAN`). No schema, config, CLI
  flag, or persisted-state migration exists — revert + re-sync is complete rollback.
- If any of stages 5/7/8 goes red mid-Build: `git checkout --` the two edited canonical files
  (module + test), re-run `sync-vendor.sh` to restore mirror byte-identity, and the tree is back
  at the stage-1 baseline (18/18, 126/126, DIR-126-D `ok:true`) — then re-adjudicate before
  retrying.

## Real-landing verification

- `git log -1 --stat` on `master` shows exactly the touch-set files (canonical module, canonical
  test, regenerated mirror, task file, this Plan) in one commit — nothing from other milestones.
- Post-commit re-run of the full evidence chain, each with its expected exit behavior:
  `extra.acceptance` command → exit 0, all fixtures GREEN;
  CLI `--task tasks/DIR-126-D.md` → exit 0, `ok:true`, `findings: []`;
  `sync-vendor.sh --check` → exit 0, `CLEAN` for `wiring-coverage-check`;
  `prepare-admission-check.test.mjs` both copies → exit 0, 126/126;
  `bash scripts/test.sh` → exit 0.
- `quay task check gap-wiring-coverage-check-whose-own-and-bold-marker-splitting` → `ok:true`;
  lifecycle `promote`/`complete` passes on the real `extra.acceptance` meter.
- **Independent audit (charter done-when):** a fresh auditor confirms both regex fixes are
  real and source-confirmed, and that the new fixtures are genuinely RED-before/GREEN-after —
  mechanically reproducible by `git stash`-ing the module edit (stage 4): the new tests FAIL;
  `git stash pop`: they PASS. Not GREEN-only, not RED-forever.

## Standardized stopping rule

At most **3 Plan-check rounds**; success ONLY at **F_i = 0** (zero findings). If findings remain
after round 3, escalate to human adjudication rather than auto-continuing. This Plan's mechanical
floor is self-verified at authoring time via `milestone-preparation-check.ts`'s
`parsePlanStages`/`validatePlanStructure` at `acCount = 7`: expected result `plan-structure-ok`
("Plan has 9 stage(s), all 7 task AC item(s) mapped") — every stage block above emits the exact
`### Stage <N>: <title>` + `- AC:` + `- Files:` + `- Command:` shape that check parses.
