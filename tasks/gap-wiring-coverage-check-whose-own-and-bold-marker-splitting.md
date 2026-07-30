---
id: gap-wiring-coverage-check-whose-own-and-bold-marker-splitting
title: wiring-coverage-check.ts's WIRING_VERB_RE false-triggers on "whose own"
  (possessive-determiner exclusion list omits "whose") and its sentence splitter
  never breaks before a markdown bold marker (**), letting unrelated bulleted
  sub-points merge into one oversized "claim" -- found live during DIR-126-D's
  round-4/5 ProposalReview convergence when the milestone's own explanatory
  prose kept re-triggering uncovered-claim findings
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test
    experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
---
## Proposal

### Problem framing (independently re-derived against current source, 2026-07-30; two-draft adjudication, disagreements settled by live execution)

`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` (292 lines) is the single
canonical implementation of the DIR-117/DIR-122 mechanism-claim wiring-coverage check. Verified
directly, not assumed from the task body: its own header comment (lines 1-8) declares it "the ONE
implementation both callers share" — the `kind=gap` task path invokes it via
`task-schema.ts`'s `checkGapWiringCoverage` (on `## Requested action` text); a directive's
`## Proposal` is enforced by the [W1] CLI dispatch in `prepare-milestone.js`, NOT by
`task-schema.ts` (`checkDirectiveSections`, line 303, is a pure section-presence check that
never calls `checkWiringCoverage` — confirmed by direct read of lines 300-316).
`task-schema.ts` line 323 imports `checkWiringCoverage` and invokes it only from the gap-task
path (`checkGapWiringCoverage`, defined line 354, call at line 357 on `## Requested action`
text); and
`experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` line 44 imports
`splitSentences` — the canonical file's own comment at lines 66-68 documents this same reuse
("Exported (M201/DIR-126-B): `prepare-admission-check.ts`'s ... detector reuses this SAME list-aware
splitter") — and its `preflightMergedMarkdownClaims` (defined line 379) calls `splitSentences`
directly at line 386, a second real consumer of the sentence splitter the task's original Finding
did not name. `diff experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
plugin/scripts/wiring-coverage-check.ts` → byte-identical today.

Two defects, each reproduced live (most recently at adjudication time) by executing the actual
regex semantics, not trusted from prose:

1. **`WIRING_VERB_RE` (declared line 49, pattern line 50)** — the current verbatim literal is an
   `/i`-flagged alternation:
   `/\b(invokes?|calls?|dispatches?|enforces?|wires?|routes?|delegates?)\b|(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b/i`.
   The possessive-determiner exclusion lookbehind guards ONLY the `owns?` branch (the verb branch
   has no lookbehind), and that lookbehind lists 9 forms but omits `whose`. Live check:
   `WIRING_VERB_RE.test("the terminal whose own AC requires X")` → `true` today (false positive —
   "whose own" is a possessive determiner + adjective, not an ownership verb); adding `whose` to
   the alternation → `false`; a genuine ownership sentence
   (`"composite-land.ts owns dashboard.md writes"`) stays `true` before AND after. A strict
   narrowing — no real ownership claim stops matching. The verb branch and the `/i` flag are
   untouched by this fix.

2. **`splitSentences()` (lines 98-105; the sentence-punctuation split is line 102)** — current
   verbatim: `.flatMap((block) => block.split(/(?<=[.!?])\s+(?=[A-Z\`"])/))`. Neither side
   recognizes a markdown bold marker (`**`) as a boundary, so two independently bolded claims
   separated only by `**<space>**` merge into one oversized "claim." Live reproduction against the
   exact AC-2 fixture text `"Done. **A does X (\`id1\`, \`id2\`).** **B does Y (\`id3\`,
   \`id4\`).**"`:
   - unpatched → ONE chunk carrying all 4 identifiers;
   - **lookahead-only** patch (`(?<=[.!?])\s+(?=[A-Z\`"]|\*\*)` — the literal reading of the task's
     Requested Action item 2) → exactly **2 chunks**: `["Done.", "**A does X (\`id1\`, \`id2\`).**
     **B does Y (\`id3\`, \`id4\`).**"]` — it splits off the leading `"Done."` but does NOT
     separate the two adjacent bold claims, which remain merged in a single 4-identifier chunk,
     because the character preceding the inter-claim whitespace is the closing `*` of `**`, which
     the untouched lookbehind `(?<=[.!?])` never matches. Empirically insufficient. (Adjudication
     note: this records the EXACT result — "2 chunks, one merged 4-identifier chunk"; Author 1's
     "still ONE merged chunk" shorthand was imprecise about the `"Done."` split, Author 2's
     correction stands, and both drafts' substantive conclusion is identical.)
   - **both-sides** patch (`(?<=[.!?]|\*\*)\s+(?=[A-Z\`"]|\*\*)`) → the correct **3-way** split
     `["Done.", "**A does X (\`id1\`, \`id2\`).**", "**B does Y (\`id3\`, \`id4\`).**"]` (two
     sentences of 2 identifiers each, disjoint sets), matching the AC-2 fixture's stated
     expectation.

Both defects are the source-confirmed mechanics behind DIR-126-D's round-4/5 ProposalReview churn
(run IDs `wf_929eb86d-2a6`/`wf_750f506a-3d2`, commit `83c1958`): a paragraph combining "the one
terminal whose own AC…" prose with back-to-back `**Claim N…**`-prefixed points fired both defects
at once, and the workaround at the time was manual bullet-list restructuring, not a tool fix. The
incident narrative (dates, run IDs, ~20 min / 12 agents / ~700K tokens) is taken at face value from
the Finding; the regex mechanics above were independently reproduced — three times in total,
including at adjudication.

**Live-reproduced baselines the fix must sit alongside without breaking** (the RED baselines for
the new regression fixtures):
- `node --experimental-strip-types --test
  experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` → 18/18 pass (233-line
  file).
- `node --experimental-strip-types --test
  experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` → 61/61 pass across 7
  suites.
- `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/wiring-coverage-
  check.ts --task tasks/DIR-126-D.md` → `{ok:true, code:"wiring-coverage-complete", claims:<22
  entries>, findings:[]}` (0 findings) — the real, previously-passing document the fix must not
  regress. (Adjudicated by live execution: the CLI envelope field is `findings` (an array);
  `uncovered` is the library-level `checkWiringCoverage` return field, which the CLI maps through
  `wiringFindingsFromUncovered` at line 283.)
- `grep '\*\*'` across the 3 `merged-markdown-claims` fixtures (`good.md`/`bad.md`/ambiguous.md`):
  the only occurrence in each is a line-1-leading `**type:** execution` header followed by
  lowercase text. Because the line-102 split requires `\s+` preceded by a lookbehind-matching char,
  a line-initial `**` with no preceding `.!?`+whitespace introduces NO new split point there (and
  the widened lookahead does not match lowercase anyway) — Fix 2 adds no incidental splits to
  these fixtures.
- `plugin/scripts/sync-vendor.sh`: its `SYNC_SCRIPTS` array (declared line 147, 25 entries) lists
  `wiring-coverage-check` at line 169; mutating mode `cp`s the experiment source over the plugin
  copy, `--check` mode byte-compares each entry via `cmp_or_report` — no hand-edit branch exists
  for any listed entry. Only 2 of the 25 entries (`composite-manifest-synthesis`,
  `prepare-admission-check`) have a paired `plugin/test/*.test.mjs` (`plugin/test/` has 9 test
  files total, none for this module) — no-mirror-test is the dominant pattern, and
  `plugin/test/plugin-packaging.test.mjs` (inside the `scripts/test.sh` canonical glob) already
  executes `sync-vendor.sh --check` and asserts exit 0 (test at line 183, assertion at line 200).

### Chosen mechanism

Two narrow, in-place regex-literal edits confined to the canonical file, mechanical mirror
regeneration (never a hand-edit), and new RED/GREEN regression fixtures added to the one canonical
test file:

- **Fix 1** (`WIRING_VERB_RE`, line 50): add `whose` to the `owns?`-branch exclusion lookbehind —
  `(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b` →
  `(?<!(?:'s|s'|its|their|my|our|your|his|her|whose)\s)\bowns?\b`. One word added to the exclusion
  alternation; verb branch and `/i` flag untouched.
- **Fix 2** (`splitSentences()`, line 102): extend BOTH sides of the split boundary symmetrically —
  `/(?<=[.!?])\s+(?=[A-Z\`"])/` → `/(?<=[.!?]|\*\*)\s+(?=[A-Z\`"]|\*\*)/`. Trailing `**` mirrors
  the existing trailing `.!?`; leading `**` mirrors the existing leading `[A-Z\`"]`. This
  deliberately **corrects** the task's literal Requested Action item 2 wording: the lookahead-only
  variant is empirically proven above to fail the task's own AC-2 fixture (the two bold claims stay
  merged in one 4-identifier chunk).

Neither edit touches `extractMechanismClaims()` (line 120), `checkWiringCoverage()` (line 163),
`splitListAwareBlocks()` (line 69; line-anchored bullet/table splitting), `bulletsOf()` (line 137;
bullet/backtick-identifier extraction), the CLI entrypoint, or any function's signature/return
shape. New regression fixtures go in `experiments/quay-perpetual-stream/test/wiring-coverage-
check.test.mjs` only: (a) a "whose own" sentence that must NOT be treated as a wiring-verb claim
(RED before / GREEN after); (b) a two-bold-sentence paragraph that must split into two claims with
disjoint identifier sets (RED before — one merged 4-identifier sentence / GREEN after — two
2-identifier sentences), per the charter's done-when requiring real fail-before/pass-after, not
GREEN-only. Mirror delivery: `bash plugin/scripts/sync-vendor.sh` (mechanical `cp`), then `bash
plugin/scripts/sync-vendor.sh --check` → `CLEAN` for `wiring-coverage-check`.

**DIR-117 mechanism-claim wiring note.** This fix introduces NO new call/dispatch/ownership/
enforcement relationships — only two regex literals inside existing functions change behavior. The
relationships this Proposal RELIES ON and asserts are pre-existing; each is flagged below as a
claim requiring AC-level evidence (DIR-117):
- **[W1 — existing dispatch, preserve]** `prepare-milestone.js:541` sets `_wiringCheckScript =
  'experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'` and `:544` dispatches
  `node --experimental-strip-types ${_wiringCheckScript} --task tasks/${_taskId}.md` in the
  ProposalReview phase (lines 546-553 wire a non-zero exit to a blocking
  `wiring-coverage-check-failed`/`needs-human` outcome) — the live gate runs the canonical path by
  absolute path, so a canonical-only edit is live on the real gate immediately, independent of any
  plugin sync/release step. Proof obligation: post-fix, the CLI re-run against the real,
  previously-passing `tasks/DIR-126-D.md` must still report `ok:true`/0 findings (pre-fix baseline
  of 22 claims / 0 findings independently reproduced above). → AC item.
- **[W2 — existing call, preserve]** `prepare-admission-check.ts:44` imports `splitSentences`;
  `:386` (`preflightMergedMarkdownClaims`) calls it directly — the second real consumer the task's
  original Finding did not name. Proof obligation: `prepare-admission-check.test.mjs` (both copies)
  still passes 61/61 post-fix (baseline reproduced above). → AC item.
- **[W3 — existing consumption, preserve]** `task-schema.ts` line 323 imports `checkWiringCoverage`,
  called only via the gap-task path (`checkGapWiringCoverage`, lines 354/357); `checkDirectiveSections`
  (line 303) never calls it, and directive-`## Proposal` enforcement is the [W1] CLI dispatch — both
  fixes flow through the shared import with no per-caller change, signature/return shape unchanged.
  Proof obligation: grep-verified
  import/call sites plus the canonical suite staying green at 18/18 plus the new fixtures. → AC
  item.
- **[W4 — existing enforcement, rely-on]** `sync-vendor.sh` (SYNC_SCRIPTS declared line 147, entry
  line 169) mechanically `cp`s canonical→plugin and `--check` byte-compares via `cmp_or_report`;
  this is the ONLY mechanism carrying the fix into the plugin-packaged copy. Proof obligation:
  `sync-vendor.sh --check` reports `CLEAN` for `wiring-coverage-check` after regeneration —
  generically enforced by `plugin/test/plugin-packaging.test.mjs` (line 200 asserts exit 0), but
  this module's specific post-fix `CLEAN` is an explicit AC line since it is the mechanism carrying
  the fix. → AC item.

### Concrete control/data flow

No new call sites, no new functions — only the two regex literals inside the existing pipeline
change behavior. Re-derived by direct read of `prepare-milestone.js`, the canonical module, and
both consumer scripts:

1. `prepare-milestone.js`'s ProposalReview phase (line 541 sets `_wiringCheckScript`, line 544
   dispatches) runs the canonical CLI against `tasks/<id>.md`'s `## Proposal`/`## Acceptance
   Criteria` text; a non-zero exit is wired (lines 546-553) to a blocking
   `wiring-coverage-check-failed`/`needs-human` terminal outcome. **[W1]**
2. Inside the CLI (`_runAsCli` block, lines 265-292): `extractSectionForCli` (lines 280-281) pulls
   the `## Proposal` and `## Acceptance Criteria` sections, then
   `checkWiringCoverage(proposalText, acText)` → `extractMechanismClaims(sectionText)` (line 120) →
   `splitSentences(sectionText)` (**Fix 2's target**, line 102) per sentence chunk, each tested
   against `WIRING_VERB_RE` (**Fix 1's target**, lines 50/124) and counted for ≥2 distinct backtick
   identifiers (a "claim" = a chunk with a wiring verb AND ≥2 distinct backtick identifiers, per
   the header heuristic).
3. `splitSentences`'s shape is unchanged in structure: paragraph split (`\n{2,}`, line 100) →
   `splitListAwareBlocks` (line-anchored bullet/table split, line 101, untouched by either fix) →
   per-block punctuation split (**Fix 2's target**, line 102) → whitespace normalize/trim (lines
   103-104).
4. Uncovered claims become BLOCKING typed findings via `wiringFindingsFromUncovered` (line 240) in
   the exact ledger shape `{subsystem, summary, severity:"blocker", blocking:true, evidence,
   claimRef, disposition}` the workflow's `_upsertFindings(..., 0)` consumes — unchanged by either
   edit; the phase's blocking count moves by this function's real return value, not an LLM
   judgment.
5. **Second real consumer:** `prepare-admission-check.ts:44` imports `splitSentences`; `:386`
   (`preflightMergedMarkdownClaims`) calls it directly, so Fix 2's boundary change also flows
   through the admission-preflight path. **[W2]**
6. **Mirror propagation:** `bash plugin/scripts/sync-vendor.sh` (mutating) mechanically `cp`s the
   fixed canonical file over `plugin/scripts/wiring-coverage-check.ts`; `bash
   plugin/scripts/sync-vendor.sh --check` then byte-compares. **[W4]**

### Key design decisions

- **Fix both sides of the split boundary, not just the lookahead.** Verified empirically (live
  regex reproduction against the exact AC-2 fixture, re-run at adjudication), not assumed: the
  lookahead-only variant reads as correct on paper but leaves the two adjacent bold claims merged
  in one 4-identifier chunk (2 chunks total) — implementing the literal Requested Action wording
  would ship a broken fix that fails the task's own acceptance test. The symmetric both-sides edit
  is the minimal edit producing the correct 3-way split.
- **Single source of truth, mechanical mirror regeneration only.** Edit the canonical file and its
  paired canonical test file; never hand-edit `plugin/scripts/wiring-coverage-check.ts`. This
  matches `sync-vendor.sh`'s own design for this module (its `SYNC_SCRIPTS` loop has no hand-edit
  branch) and the module's own header self-description.
- **Do not create `plugin/test/wiring-coverage-check.test.mjs`.** It does not exist today
  (`plugin/test/` has 9 test files, none for this module); only 2 of the 25 `SYNC_SCRIPTS` entries
  have a paired `plugin/test/*.test.mjs` (`composite-manifest-synthesis`,
  `prepare-admission-check`); mirror fidelity is already proven by the `sync-vendor.sh --check`
  byte-identity gate wired into `scripts/test.sh` via `plugin-packaging.test.mjs`; and a mirror
  suite would need a `plugin/test/fixtures/...` tree that does not exist for this module — added
  maintenance surface, no incremental verification value.
- **Explicitly correct, not silently follow, the stale task-body wording** — Fix 2's
  lookahead-only phrasing and the `## Touches` implication that the plugin mirror is hand-edited —
  both demonstrably wrong against current source (live regex test and `sync-vendor.sh`'s design,
  respectively). Flagged here rather than either implementing broken wording or quietly diverging.

### Defaults and failure behavior

No new configuration, flags, or default values. Every current consumer keeps its existing call
signature and return shape: `checkWiringCoverage` → `{ok, code, message, claims, uncovered}`; CLI
JSON → `{ok, code, message, claims, findings}` (adjudicated by live execution of the CLI against
`tasks/DIR-126-D.md`: the envelope field is `findings`, an array). Both changes move behavior in
exactly one direction: Fix 1 excludes one more phrase from matching as an ownership verb (strictly
fewer false-positive claims); Fix 2 adds split points only (strictly never fewer split
opportunities) — the same "strictly additive (only ever creates MORE split points, never fewer)"
property `splitListAwareBlocks`'s own header comment (lines 62-65) documents for itself. A document
that was `ok:true` before cannot newly fail from these two edits alone; it can only stop being
mis-split/mis-matched (with the caveat that finer splitting can surface a previously-hidden real
claim — intended behavior, see Risks).

Failure behavior on tooling misuse stays fail-closed with no new mechanism: if mirror regeneration
is skipped, the pre-existing `sync-vendor.sh --check` gate (wired into `scripts/test.sh` via
`plugin-packaging.test.mjs`) goes RED **[W4]**; if either regex edit regresses an existing passing
test, the task's own declared `extra.acceptance` command (`node --experimental-strip-types --test
experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`) fails closed; the CLI
itself keeps its exit-2-on-usage/IO-error posture, so the ProposalReview phase fails CLOSED on a
non-parseable verdict rather than silently skipping coverage.

### Compatibility

No schema, config, or CLI-flag change. `checkWiringCoverage()`'s return shape and the CLI's JSON
output are unchanged. All three current consumer paths (`task-schema.ts`'s gap and directive checks
**[W3]**, `prepare-admission-check.ts`'s `preflightMergedMarkdownClaims` **[W2]**, the CLI `--task`
mode the ProposalReview phase dispatches **[W1]**) keep identical inputs/outputs except for the two
specific mis-verdicts this fix corrects. `plugin/scripts/task-schema.ts`,
`plugin/scripts/prepare-admission-check.ts`, and `plugin/scripts/wiring-coverage-check.ts` (all
byte-identical to their canonical counterparts today) pick up the fix the next time
`sync-vendor.sh` runs; no separate plugin release step is required for the fix to be live on the
real `master`-resident gate, since `prepare-milestone.js` (lines 541/544) dispatches the
experiment-tree script by repo-root-relative path, not the plugin-packaged copy.

### Risks

- **Over-splitting from the `**` boundary on ordinary inline emphasis.** A bold span used as pure
  mid-sentence emphasis (e.g. `"This is **important** and here."`) false-splits only if the char
  after the closing `**`+whitespace is uppercase, a backtick, a quote, or another `**` — ordinary
  emphasis is typically followed by lowercase continuation. Checked concretely: the only `**`
  occurrence across the 3 real `merged-markdown-claims` fixtures is the lowercase-followed
  `**type:** execution` header (no new split), and the 61/61 `prepare-admission-check.test.mjs`
  baseline confirms no incidental regression surface today. Residual risk on unseen prose is real
  but bounded; disclosed, not swept aside.
- **`whose` over-exclusion.** A genuine sentence like "the module whose `owns()` method determines
  routing" would also stop matching — the same accepted-risk class the existing
  `its/their/my/our/your/his/her` exclusions already carry, not a new category.
- **Second-call-site regression** (`preflightMergedMarkdownClaims`'s reuse of `splitSentences`).
  Mitigated by an explicit AC item **[W2]** backed by the independently-reproduced 61/61 baseline.
- **Claim-count drift on unexamined real documents.** Finer splitting can surface a
  previously-hidden claim as newly "uncovered" somewhere not examined here, or shift the exact
  claim count on `tasks/DIR-126-D.md` (currently 22, `ok:true`) without changing its verdict. This
  is the checker doing its job, not a regression to suppress — mitigated by the post-fix AC re-run
  **[W1]** confirming the verdict stays `ok:true`.
- **Residual heuristic class (disclosed).** Coverage still keys on backtick-identifier co-location
  within a single sentence/AC bullet; prose claims without backtick identifiers remain
  undetectable — a pre-existing, header-documented limitation of the checker (lines 24-29),
  unrelated to either fix.

### Non-goals

- Not adding `imports?|reuses?|reused|parses?|parsed` (or any verb) to `WIRING_VERB_RE` —
  explicitly considered and REJECTED at M201/DIR-126-B per the module's own header comment (lines
  41-48): a wider verb set surfaced NEW uncovered claims against already-landed, already-audited
  tasks, and reopening done work is a worse cost than the narrow gap.
- Not attempting NLP/semantic claim extraction for identifier-free prose — the module header's own
  documented NON-GOAL (lines 24-29), unchanged.
- Not handling emphasis markers other than `**` (single `*`, `_`, `__`, nested bold-italic) —
  scoped strictly to the marker implicated by the real incident and the task's own fixture.
- Not modifying `splitListAwareBlocks` (bullet/table-row splitting) — unaffected by either fix.
- Not creating `plugin/test/wiring-coverage-check.test.mjs` or a new `plugin/test/fixtures/...`
  tree — see Alternatives #2.

### AC coverage

Mapping delivery against the task's existing AC checklist (with two corrections to stale wording),
plus new items closing every flagged wiring claim above:

- **AC 1** (`whose` exclusion, RED/GREEN fixture) ← Fix 1; empirically confirmed `true`→`false`
  for "whose own" with genuine ownership sentences unaffected.
- **AC 2** (`**` splitting, RED/GREEN fixture) ← Fix 2, with the AC text recording that BOTH the
  lookbehind and lookahead change — the lookahead-only variant (the task's literal current wording)
  empirically leaves the two adjacent bold claims merged (2 chunks, one with all 4 identifiers), as
  reproduced above, so it does not pass this fixture.
- **AC 3** (regression tests) ← canonical `wiring-coverage-check.test.mjs` only; the AC text should
  explicitly drop any `plugin/test/` mirror requirement (that file does not exist; 2/25
  sync-vendor-managed modules have one; the byte-identity gate covers mirror fidelity).
- **AC 4** (re-run `wiring-coverage-check.ts --task tasks/DIR-126-D.md`, confirm `ok:true`/0
  findings) ← closes **[W1]**; pre-fix baseline (22 claims, 0 findings) independently reproduced
  above.
- **AC 5** (`sync-vendor.sh --check` → `CLEAN` for `wiring-coverage-check` after mechanical
  regeneration) ← closes **[W4]**.
- **AC 6** (`prepare-admission-check.test.mjs`, both copies, fully green post-fix) ← closes
  **[W2]**; 61/61 baseline independently reproduced above.
- **AC 7** (canonical suite + task-schema consumption) ← closes **[W3]**: grep-confirmed
  `checkWiringCoverage` import/call sites in `task-schema.ts` (lines 323/357) plus the
  canonical suite staying green at 18/18 post-fix alongside the new RED/GREEN fixtures (RED = fails
  on the current literals, GREEN = passes after both edits).
- **Grounding-evidence AC item** (DIR-117 self-coverage): an exhaustive-identifier bullet listing
  every backtick identifier this Proposal names in a mechanism-claim sentence (including
  `wiring-coverage-check.ts`, `WIRING_VERB_RE`, `splitSentences`, `splitSentences()`,
  `extractMechanismClaims(sectionText)`, `checkWiringCoverage(proposalText, acText)`,
  `task-schema.ts`, `checkGapWiringCoverage`, `checkDirectiveSections`, `prepare-admission-check.ts`,
  `preflightMergedMarkdownClaims`, `plugin/workflows/prepare-milestone.js`,
  `prepare-milestone.js:541`, `_wiringCheckScript`,
  `node --experimental-strip-types ${_wiringCheckScript} --task tasks/${_taskId}.md`, `_runAsCli`,
  `extractSectionForCli`, `wiringFindingsFromUncovered`, `_upsertFindings(..., 0)`,
  `sync-vendor.sh`, `--check`, `cmp_or_report`, `plugin/scripts/wiring-coverage-check.ts`,
  `plugin/test/plugin-packaging.test.mjs`, `tasks/DIR-126-D.md`, `ok:true`, `whose`, `owns`,
  `**Claim N…**`, `its/their/my/our/your/his/her`,
  `invokes?|calls?|dispatches?|enforces?|wires?|routes?|delegates?`, `bulletsOf()`,
  `splitListAwareBlocks()`) each confirmed real by direct source read — every one is an
  already-real name from this document's own text, not a new invention.

### Alternatives considered and rejected

1. **Hand-edit `plugin/scripts/wiring-coverage-check.ts` directly** (the task body's literal
   `## Touches` implication). Rejected: `sync-vendor.sh`'s mutating mode mechanically `cp`s
   canonical over plugin with no hand-edit branch — a later non-`--check` sync would silently
   clobber an independently hand-edited plugin copy, reintroducing the exact drift the mechanical
   step exists to prevent.
2. **Create `plugin/test/wiring-coverage-check.test.mjs`** (full mirror or minimal). Rejected: a
   full mirror would fail at runtime for lack of a `plugin/test/fixtures/...` tree; a minimal file
   duplicates a 2/25 pattern for no incremental value once `sync-vendor.sh --check` proves
   byte-identity and `plugin-packaging.test.mjs` gates it inside `scripts/test.sh`.
3. **Extend only the lookahead** (literal reading of Requested Action item 2). Rejected:
   empirically proven — via live regex reproduction against the exact AC-2 fixture — to leave the
   two adjacent bold claims merged (2 chunks: `"Done."` + one 4-identifier chunk); it does not pass
   the task's own stated acceptance test.
4. **Broaden to a general inline-emphasis boundary rule** (`**`, `*`, `_`, `__`). Rejected as
   over-scoped: neither the incident nor the fixture motivates anything beyond `**`; each extra
   marker adds over-splitting risk with zero evidence requiring it now.
5. **Treat `**` as a `splitListAwareBlocks` boundary instead of a `splitSentences` punctuation
   boundary.** Rejected: `splitListAwareBlocks` is line-anchored
   (`/^\s*(?:[-*]\s+|\d+\.\s+|\|.*\|\s*$)/`, line 77), but bold markers occur mid-line; a
   line-anchored regex cannot express this boundary, while `splitSentences`'s punctuation-level
   split already operates line-internally (line 102) and is the correct layer.
6. **Do nothing; rely on manual prose restructuring as standing practice.** Rejected: the defect
   already cost one real, measured convergence round, and "explanatory prose with
   `**`-prefixed claim markers" and "whose own" phrasing are generic authoring habits in this
   repo's Proposal-writing convention, not one-off occurrences.

## Finding

Discovered 2026-07-30 during DIR-126-D's (M203) real `prepare-milestone` ProposalReview convergence
(rounds 4-5 of a 5-round real bounded-convergence loop, run IDs `wf_929eb86d-2a6`/`wf_750f506a-3d2`).
Round 4 added a "Why one milestone, not eight" explanatory section (a real, honest SPLIT-OR-COMMIT
justification, not new mechanism claims) written as prose with `**Claim N...**`-prefixed points and
a sentence using "the one terminal whose own AC explicitly requires..." — both defects fired on this
same paragraph: the bold-marker splitting failure merged 4+ unrelated sub-points (spanning
`--ledger`, `buildReceipt`, `checkPreparation`, `mechanismCount=5`, and separately `Date.now()`,
`import()`, two commit hashes) into oversized "claims" the checker then correctly-per-its-own-logic
flagged as uncovered — but the underlying content was already covered by each Claim's own paragraph
elsewhere in the document; the false claim was purely an artifact of failed sentence splitting. This
consumed a full extra ProposalReview round (~20 real minutes, 12 agents, ~700K tokens) to
work around by manually restructuring the paragraph into a bullet list (which the checker's
list-aware splitter already handles) rather than being caught immediately by the tool.

Both defects were confirmed via direct source read (not inference) before filing:
`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` line 50 (verb regex) and line
102 (sentence splitter), both reproduced against the exact live paragraph that triggered them in
`tasks/DIR-126-D.md`'s commit history (`83c1958`).

## Requested action

1. Add `whose` to `WIRING_VERB_RE`'s possessive-determiner exclusion lookbehind.
2. Extend `splitSentences()`'s sentence-boundary regex to also split before `**` (markdown bold) on
   **both** the trailing lookbehind (`(?<=[.!?])` → `(?<=[.!?]|\*\*)`) **and** the leading lookahead
   (`(?=[A-Z\`"])` → `(?=[A-Z\`"]|\*\*)`) — a lookahead-only edit is insufficient and does not pass
   this task's own AC-2 fixture (live-reproduced during Proposal adjudication: the closing `**`
   before the inter-claim whitespace never satisfies an untouched lookbehind, so the two claims stay
   merged).
3. Add regression fixtures to `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`
   only (no `plugin/test/` mirror — see `## Acceptance Criteria` item 3 and Proposal's "Alternatives
   considered and rejected" #2): (a) a sentence containing "whose own" that must NOT be treated as a
   wiring-verb claim; (b) a paragraph with two `**Bold-prefixed.** **Bold-prefixed.**` sentences
   that must split into two separate claims, each independently checked for AC coverage.
4. Re-run `wiring-coverage-check.ts --task tasks/DIR-126-D.md` against the current (already fixed
   via manual restructuring) task body and confirm it still reports `ok:true` post-fix (i.e. the fix
   doesn't regress the now-bulleted structure).
5. Regenerate `plugin/scripts/wiring-coverage-check.ts` mechanically via `bash plugin/scripts/
   sync-vendor.sh` (never hand-edit) and confirm `bash plugin/scripts/sync-vendor.sh --check`
   reports `CLEAN` for `wiring-coverage-check`.
6. Re-run `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` (both copies) to
   confirm the fix does not regress `preflightMergedMarkdownClaims`'s own reuse of `splitSentences`
   — a second real call site this task's original Finding did not name.

## Acceptance Criteria

- [ ] `WIRING_VERB_RE`'s exclusion lookbehind includes `whose`; a fixture sentence "the terminal
  whose own AC requires X" is confirmed NOT flagged as a wiring-verb claim (RED before fix, GREEN
  after).
- [ ] `splitSentences()` splits before a `**` bold marker; a fixture paragraph
  `"Done. **A does X (\`id1\`, \`id2\`).** **B does Y (\`id3\`, \`id4\`).**"` produces two distinct
  sentences with disjoint identifier sets (RED before fix — one merged sentence with all 4
  identifiers; GREEN after — two sentences with 2 identifiers each).
- [ ] `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` gains regression tests
  for both fixtures above — the canonical test file only, no `plugin/test/wiring-coverage-
  check.test.mjs` mirror (that file does not exist on disk and this task deliberately does NOT
  create one — see Proposal's "Alternatives considered and rejected" #2: only 2 of 25
  `sync-vendor.sh`-managed modules have a paired `plugin/test/*.test.mjs`, mirror fidelity is proven
  by the byte-identity gate below, not a duplicate test suite).
- [ ] Re-running `wiring-coverage-check.ts --task tasks/DIR-126-D.md` against the current committed
  task body after the fix still reports `ok:true`/0 findings (no regression on the real document
  that surfaced this).
- [ ] `bash plugin/scripts/sync-vendor.sh --check` reports `CLEAN` for `wiring-coverage-check` after
  the canonical-source fix is regenerated into `plugin/scripts/wiring-coverage-check.ts` via
  `sync-vendor.sh` (mechanical `cp`, never a hand-edit).
- [ ] `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` (both copies) still
  passes post-fix, confirming `preflightMergedMarkdownClaims`'s own reuse of `splitSentences` does
  not regress — a second real call site beyond the canonical CLI/`task-schema.ts` path.
- [ ] Grounding evidence (exhaustive identifiers, wiring-coverage completeness): direct source read
  confirmed `WIRING_VERB_RE`'s current lookbehind
  `(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b` omits `whose`, so `\bowns?\b` still
  matches inside "whose own" — reproduced and closed by AC item 1 above's fixture. Also covering
  every other claim this Proposal's own text makes, confirmed real by the same direct-source-read
  standard: `WIRING_VERB_RE.test("the terminal whose own AC requires X")`, `true`, `false`,
  `"composite-land.ts owns dashboard.md writes"`, `prepare-milestone.js`,
  `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`, `master`, `sync-vendor.sh`,
  `plugin/scripts/`, `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`,
  `prepare-admission-check.ts`, `splitSentences`, `## Requested action`, `## Acceptance Criteria`,
  `## Touches`, `plugin/scripts`, `plugin/test`, `WIRING_VERB_RE`, `invokes?|calls?|...`,
  `extractMechanismClaims(sectionText)`, `checkWiringCoverage`, `task-schema.ts`,
  `checkGapWiringCoverage`, `checkDirectiveSections`, `ProposalReview`, `splitSentences(sectionText)`,
  `splitSentences()`, `preflightMergedMarkdownClaims`, `tasks/DIR-126-D.md`,
  `plugin/scripts/sync-vendor.sh`, `plugin/scripts/wiring-coverage-check.ts`,
  `plugin/test/plugin-packaging.test.mjs`, `--check`, `owns()`,
  `its/their/my/our/your/his/her`, `owns`, `plugin/test/`,
  `**Bold-prefixed.** **Bold-prefixed.**` — every one of these is an already-real,
  already-confirmed name from this document's own Chosen mechanism/Problem framing/Requested action
  (direct source read), not a new invention. Round-2 additionally flagged claims using these exact
  identifier forms, confirmed real by the same direct-source-read standard: `## Proposal`,
  `**Claim N…**`, `--task`, `_runAsCli`, `_upsertFindings(..., 0)`, `_wiringCheckScript =
  'experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'`,
  `checkWiringCoverage(proposalText, acText)`, `extractMechanismClaims(sourceSectionText)`,
  `extractSectionForCli`, `grep`, `node --experimental-strip-types ${_wiringCheckScript} --task
  tasks/${_taskId}.md`, `node -e`, `ok:true`, `plugin/scripts/prepare-admission-check.ts`,
  `plugin/scripts/task-schema.ts`, `plugin/workflows/prepare-milestone.js`,
  `plugin/workflows/prepare-milestone.js:541`, `prepare-admission-check.test.mjs`,
  `tasks/<id>.md`, `wiring-coverage-check.ts`, `wiringFindingsFromUncovered`,
  `{subsystem, summary, severity:"blocker", blocking:true, evidence, claimRef, disposition}` — all
  already-real, already-confirmed names from this document's own text (direct source read), not new
  invention. Round-3 (post-factual-correction re-verification): re-ran the live CLI after correcting
  the checkDirectiveSections/directive-path error (113df5b9), the "8 forms"→9-forms count
  (f857b60f), the "2 of 24"→"2 of 25" SYNC_SCRIPTS count (3f046da5), the stale `checkGapSections`
  name→`checkGapWiringCoverage` (6ef948cf), and the "absolute path"→repo-root-relative path
  (c72e3158); the exhaustive union of every still-uncovered claim's identifiers, each confirmed
  real by direct source read: `kind=gap`, `task-schema.ts`, `checkGapWiringCoverage`,
  `## Requested action`, `## Proposal`, `prepare-milestone.js`, `checkDirectiveSections`,
  `checkWiringCoverage`, `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`,
  `splitSentences`, `prepare-admission-check.ts`, `preflightMergedMarkdownClaims`, `WIRING_VERB_RE`,
  `/i`, `/\b(invokes?|calls?|dispatches?|enforces?|wires?|routes?|delegates?)\b|(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b/i`,
  `wf_929eb86d-2a6`, `wf_750f506a-3d2`, `83c1958`, `**Claim N…**`, `whose`, `owns?`,
  `(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b`,
  `(?<!(?:'s|s'|its|their|my|our|your|his|her|whose)\s)\bowns?\b`, `prepare-milestone.js:541`,
  `_wiringCheckScript = 'experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'`,
  `:544`, `node --experimental-strip-types ${_wiringCheckScript} --task tasks/${_taskId}.md`,
  `wiring-coverage-check-failed`, `needs-human`, `prepare-admission-check.ts:44`, `:386`,
  `_wiringCheckScript`, `tasks/<id>.md`, `## Acceptance Criteria`,
  `{ok, code, message, claims, uncovered}`, `{ok, code, message, claims, findings}`,
  `tasks/DIR-126-D.md`, `findings`, `wiring-coverage-check.ts`, `splitSentences()`,
  `extractMechanismClaims(sectionText)`, `checkWiringCoverage(proposalText, acText)`,
  `plugin/workflows/prepare-milestone.js`, `_runAsCli`, `extractSectionForCli`,
  `wiringFindingsFromUncovered`, `_upsertFindings(..., 0)`, `sync-vendor.sh`, `--check`,
  `cmp_or_report`, `plugin/scripts/wiring-coverage-check.ts`, `plugin/test/plugin-packaging.test.mjs`,
  `ok:true`, `owns`, `its/their/my/our/your/his/her`,
  `invokes?|calls?|dispatches?|enforces?|wires?|routes?|delegates?`, `bulletsOf()`,
  `splitListAwareBlocks()` — all confirmed real by the same direct-source-read standard.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master`.
- [ ] Real, non-fixture evidence: both fixtures above pass; a real run of
  `wiring-coverage-check.ts --task tasks/DIR-126-D.md` (or its state at time of fix) confirms no
  regression.

## Touches

- experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- plugin/scripts/wiring-coverage-check.ts
- experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
