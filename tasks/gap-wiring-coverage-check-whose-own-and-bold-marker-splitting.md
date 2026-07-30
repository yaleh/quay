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

### Problem framing (independently re-verified against current source, both drafts agree)

Direct read of `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` — the ONE
canonical implementation both `task-schema.ts` (`checkGapSections`/`checkDirectiveSections`,
import line 323) and `prepare-admission-check.ts` (`preflightMergedMarkdownClaims` — import line
44, call site line 386) consume (`grep` confirms both import sites; no second implementation
exists) — plus live `node -e` reproductions against today's unmodified regex literals confirm both
defects exactly as filed, and confirm the task's own Requested-action wording for defect 2 is
insufficient:

1. **`WIRING_VERB_RE` (line 50)**:
   `(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b`. The possessive-determiner exclusion
   lookbehind lists 8 words but omits `whose`. Live check:
   `WIRING_VERB_RE.test("the terminal whose own AC requires X")` → `true` today. Adding `whose` to
   the alternation flips it to `false`, while a genuine ownership sentence
   (`"composite-land.ts owns dashboard.md writes"`) still matches `true` — verified live, before
   and after the patch, and confirmed to be a strict narrowing (no real ownership claim stops
   matching).

2. **`splitSentences()` (line 102)**: `.split(/(?<=[.!?])\s+(?=[A-Z\`"])/)`. Neither the
   lookbehind nor the lookahead recognizes a markdown bold marker (`**`) as a boundary, so two
   independently bolded claims separated only by `** **` stay merged into one oversized "claim"
   string. Live reproduction against the exact AC-2 fixture text `"Done. **A does X (\`id1\`,
   \`id2\`).** **B does Y (\`id3\`, \`id4\`).**"`:
   - unpatched: one chunk containing all 4 identifiers.
   - **lookahead-only** patch (`(?=[A-Z\`"]|\*\*)`, the task's own Requested Action item 2's
     literal wording, lookbehind left untouched): still ONE merged chunk — the character
     preceding the inter-claim whitespace is the closing `*` of `**`, not `.`/`!`/`?`, so the
     untouched lookbehind never fires and the split point never activates. Confirmed insufficient
     by direct empirical test, independently reproduced in both drafts of this adjudication.
   - **lookbehind-and-lookahead** patch (`(?<=[.!?]|\*\*)\s+(?=[A-Z\`"]|\*\*)`): produces the
     correct 3-way split — `["Done.", "**A does X (\`id1\`, \`id2\`).**", "**B does Y (\`id3\`,
     \`id4\`).**"]`, 2 identifiers per resulting sentence, matching the AC-2 fixture's stated
     expectation.

Both were the real, source-confirmed cause of DIR-126-D's round-4/round-5 `ProposalReview` churn
(~20 minutes / 12 agents / ~700K tokens) per the task's own Finding — a paragraph combining "whose
own" prose and back-to-back `**Claim N…**`-prefixed bold points false-triggered both bugs at once,
and the working fix at the time was manual bullet-list restructuring, not a tool fix.

**Independently re-verified wiring/mirroring facts** (not assumed from the task body, cross-checked
between both drafts): `diff experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
plugin/scripts/wiring-coverage-check.ts` returns no output (byte-identical today).
`plugin/scripts/sync-vendor.sh`'s `SYNC_SCRIPTS` array lists 25 entries including
`wiring-coverage-check`; in non-`--check` mode it mechanically `cp`s
`${EXPERIMENT_SCRIPTS}/${s}.ts` over `${PLUGIN_DIR}/scripts/${s}.ts` for every entry — no hand-edit
branch exists for this array. `--check` mode byte-compares via `cmp_or_report`, already exercised
by `plugin/test/plugin-packaging.test.mjs` (part of the `scripts/test.sh` canonical glob).
`find plugin/test -iname 'wiring-coverage-check*'` returns nothing — no
`plugin/test/wiring-coverage-check.test.mjs` exists, contradicting the task's own `## Touches` and
AC item 3. Of the 25 `SYNC_SCRIPTS` entries (24 besides `wiring-coverage-check` itself), only 2
(`composite-manifest-synthesis`, `prepare-admission-check`) have a paired
`plugin/test/*.test.mjs` — confirmed via `ls plugin/test/*.test.mjs` — so a "no mirror test file"
outcome is the dominant (22/24), not exceptional, pattern.

Also independently confirmed: `plugin/workflows/prepare-milestone.js` line 541 sets
`_wiringCheckScript = 'experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'` and
dispatches an agent to run that exact canonical path via
`node --experimental-strip-types ${_wiringCheckScript} --task tasks/${_taskId}.md` — the
ProposalReview gate runs the canonical source directly, not the plugin mirror, so a canonical-only
fix is live on the real gate immediately, independent of any plugin release/sync step.
`prepare-admission-check.ts` line 44 imports `splitSentences` from `wiring-coverage-check.ts` and
line 386 calls it inside `preflightMergedMarkdownClaims` — a second real, currently-unflagged
consumer of the sentence splitter that the task's Finding text does not name. Running
`node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`
against the current unpatched source passes 18/18 (0 failures) — the RED baseline the new
regression tests must sit alongside without breaking. Running
`node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
against the current unpatched source passes 61/61 (0 failures) — the pre-fix baseline this
proposal's second-call-site regression claim must reproduce post-fix.

Also confirmed via grep on the 3 `merged-markdown-claims` fixtures
(`experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/{good,bad,
ambiguous}.md`): the only `**` occurrence in each file is a leading `**type:** execution` header
line, whose character after the closing `**` is a space then lowercase `execution` — the new
lookahead (`[A-Z\`"]|\*\*`) does not match lowercase, so Fix 2 introduces no new split there.

### Chosen mechanism

Fix both defects as narrow, in-place regex-literal edits inside the canonical file only
(`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`); regenerate the plugin
mirror mechanically via the existing `sync-vendor.sh` (never hand-edit `plugin/scripts/`); add the
two regression fixtures to the canonical test file only
(`experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`, currently 233 lines / 18
tests); and re-verify the second, previously-unnamed real call site
(`prepare-admission-check.ts`) does not regress — while correcting, rather than silently
implementing around, the parts of the task's own `## Requested action` / `## Touches` text that
empirical testing shows are wrong (lookahead-only is insufficient) or stale (the `plugin/test/`
mirror file does not exist).

- **Fix 1**: `(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b` →
  `(?<!(?:'s|s'|its|their|my|our|your|his|her|whose)\s)\bowns?\b`. Adds one word to the exclusion
  alternation; the verb alternation (`invokes?|calls?|dispatches?|enforces?|wires?|routes?|
  delegates?`) is untouched.
- **Fix 2** (a correction to the task body's literal wording, empirically required — not
  optional): `.split(/(?<=[.!?])\s+(?=[A-Z\`"])/)` →
  `.split(/(?<=[.!?]|\*\*)\s+(?=[A-Z\`"]|\*\*)/)`. Extends **both** sides of the split boundary
  symmetrically — trailing `**` mirrors the existing trailing `.!?`; leading `**` mirrors the
  existing leading `[A-Z\`"]`. A lookahead-only edit (the literal reading of the task's Requested
  Action item 2) is empirically proven, via live regex reproduction, to leave the AC-2 fixture's
  two bold claims merged.

Both edits are confined to the two regex literals — `extractMechanismClaims()`,
`checkWiringCoverage()`, `splitListAwareBlocks()`, `bulletsOf()`, and every function
signature/return shape are unchanged.

### Concrete control/data flow

No new call sites, no new functions. The existing pipeline, confirmed by direct read:

1. `prepare-milestone.js`'s ProposalReview phase (`plugin/workflows/prepare-milestone.js:541`)
   dispatches an agent that runs the canonical CLI (`_runAsCli` block, this module's own lines
   265-292) against the Proposal's `## Acceptance Criteria`-bearing sections of `tasks/<id>.md`.
   **[wiring claim — needs AC coverage: re-running the CLI against a real task body must still
   report `ok:true` post-fix.]**
2. The CLI extracts `## Proposal` and `## Acceptance Criteria` section text
   (`extractSectionForCli`) and calls `checkWiringCoverage(proposalText, acText)`, which calls
   `extractMechanismClaims(sourceSectionText)`, which calls `splitSentences(sectionText)`
   (**Fix 2's target**) for every sentence and tests each against the (now-patched)
   `WIRING_VERB_RE` (**Fix 1's target**), then counts backtick identifiers.
3. `splitSentences(text)`'s existing shape is unchanged: paragraph split (`\n{2,}`) →
   `splitListAwareBlocks` (bullet/table-row aware, not touched by this fix) → per-block
   punctuation split (**Fix 2's target**) → whitespace normalization/trim.
4. Uncovered claims become BLOCKING typed findings (`wiringFindingsFromUncovered`) in the exact
   shape `prepare-milestone.js`'s `_upsertFindings(..., 0)` consumes (`{subsystem, summary,
   severity:"blocker", blocking:true, evidence, claimRef, disposition}`), so the phase's blocking-
   finding count moves by the function's real return value, not an LLM's independent judgment
   call.
5. **A second, real consumer not named in the task's Requested Action**:
   `prepare-admission-check.ts` line 44 imports `splitSentences` from `wiring-coverage-check.ts`,
   and line 386's `preflightMergedMarkdownClaims` calls it directly.
   **[wiring claim surfaced independently by this proposal — needs its own AC item: re-running
   `prepare-admission-check.test.mjs` post-fix must still pass in full (61/61 pre-fix baseline
   independently reproduced above; the AC is the post-fix re-confirmation).]**
6. **Mirror regeneration**: after editing the canonical source, run
   `bash plugin/scripts/sync-vendor.sh` (mutating mode) to mechanically `cp` the fixed file over
   `plugin/scripts/wiring-coverage-check.ts`, then `bash plugin/scripts/sync-vendor.sh --check` to
   confirm byte-identity.
   **[wiring claim — needs AC coverage: `sync-vendor.sh --check` reports CLEAN for
   `wiring-coverage-check` after regeneration. This is already exercised generically by
   `plugin/test/plugin-packaging.test.mjs`'s sync-vendor check test, part of the `scripts/test.sh`
   canonical glob, but the specific module's post-fix CLEAN result should still be an explicit AC
   line since it's the mechanism by which the fix reaches the plugin-packaged copy.]**

### Key design decisions

- **Fix both sides of the split regex, not just the lookahead.** Verified empirically (not
  assumed from the task text) that a lookahead-only change fails the task's own AC-2 fixture; the
  task's literal Requested Action wording would pass code review on paper but fail the task's own
  acceptance test at implementation time.
- **Single source of truth, mechanical regeneration.** Edit only the `experiments/` canonical file
  and its paired test file; never hand-edit `plugin/scripts/wiring-coverage-check.ts`. This
  matches `sync-vendor.sh`'s own design for this module group (mechanical `cp`, `--check`
  byte-compare, no hand-edit path) and this file's own header comment ("the ONE implementation
  both callers share") — hand-editing the plugin copy would be silently clobbered by the next
  non-`--check` `sync-vendor.sh` run and creates a second, driftable source of truth for no
  benefit.
- **Do not create `plugin/test/wiring-coverage-check.test.mjs`.** It does not exist today, only 2
  of the 25 `SYNC_SCRIPTS`-listed modules have a paired `plugin/test/*.test.mjs`
  (`composite-manifest-synthesis`, `prepare-admission-check`), and the module's fidelity is
  already proven by the `sync-vendor.sh --check` byte-identity gate rather than a duplicate test
  file. A minimal new file targeting just the two new fixtures would also need its own fixture
  tree under `plugin/test/fixtures/preparation/`, which does not currently exist for this module —
  added maintenance surface with no additional verification value once byte-identity is proven.
- **Correct rather than silently follow the task's literal wording** for Fix 2, and correct rather
  than silently no-op the task's `## Touches`/AC item 3 wording that implies a
  `plugin/test/` mirror exists or should be created.

### Defaults and failure behavior

No new configuration, flags, CLI arguments, or default values are introduced. Both fixes live
entirely inside existing regex literals; every current caller (`task-schema.ts`'s
`checkGapSections`/`checkDirectiveSections`, `prepare-admission-check.ts`'s
`preflightMergedMarkdownClaims`, the CLI entrypoint used by `prepare-milestone.js`) keeps its
existing call signature and return shape. Both changes are behavior-narrowing/additive only in one
direction: Fix 1 excludes one more phrase from matching as an ownership verb (strictly fewer
false-positive claims); Fix 2 adds split points only (strictly never fewer claims recognized as
separate) — the same "additive-only" property `splitListAwareBlocks`'s own header comment
documents for its own pass. A document that was `ok:true` before the fix cannot newly fail after
it purely from these two changes — it can only stop being mis-split/mis-matched.

Failure behavior on tooling misuse is unchanged and stays fail-closed: if the mirror-regeneration
step is skipped, the pre-existing `sync-vendor.sh --check` gate (wired into `scripts/test.sh` via
`plugin-packaging.test.mjs`) goes RED — a real, pre-existing, fail-closed CI signal catches a
forgotten regeneration mechanically, not by review discipline. If either regex edit regresses an
existing passing test in `wiring-coverage-check.test.mjs`, the same `extra.acceptance` gate the
task already declares fails the ProposalReview phase closed, per the CLI's documented exit-2-on-
error / non-zero-on-mismatch posture — no new failure path needs to be built.

### Compatibility

No schema, config, or CLI-flag change. `checkWiringCoverage()`'s `{ok, code, message, claims,
uncovered}` return shape and the CLI's JSON output are unchanged. All three current call paths
(`task-schema.ts`'s two functions, `prepare-admission-check.ts`'s `preflightMergedMarkdownClaims`,
the CLI `--task` mode used by `prepare-milestone.js`) keep working with identical inputs/outputs
except for the two specific mis-verdicts this fix corrects. `plugin/scripts/wiring-coverage-check.ts`
and its own two importers (`plugin/scripts/task-schema.ts`,
`plugin/scripts/prepare-admission-check.ts` — both confirmed present and currently byte-identical
to their canonical counterparts) pick up the fix automatically the next time `sync-vendor.sh`
runs — no separate release step is required for this fix to be "live" on the real
`master`-resident `prepare-milestone.js` gate, since that workflow dispatches the experiment-tree
script by path, not the plugin-packaged copy.

### Risks

- **Over-splitting from the `**` boundary.** A bold span used as pure inline emphasis mid-sentence
  (`"This is **important** and here."`) could theoretically false-split only if the character
  right after the closing `**` (following whitespace) were uppercase, a backtick, a quote, or
  another `**` — ordinary inline emphasis is typically followed by lowercase continuation text.
  Checked concretely against the 3 real `merged-markdown-claims` fixtures (only `**` occurrence is
  a `**type:** execution` header followed by lowercase text — no false split) and against the live
  61/61-passing `prepare-admission-check.test.mjs` run; residual risk on unseen prose is real but
  bounded and testable, called out as a non-goal below rather than swept aside.
- **`whose` over-exclusion.** A genuine, unusual sentence like "the module whose `owns()` method
  determines routing" would now also be excluded from matching as an ownership claim. This is the
  same class of accepted risk the existing `its/their/my/our/your/his/her` exclusions already
  carry, not a new risk category.
- **Second call site regression.** `prepare-admission-check.ts`'s reuse of `splitSentences` is a
  real dependency the task's Requested Action does not name explicitly. Mitigated by making it an
  explicit AC item and by the independently-reproduced 61/61 pre-fix baseline above that the
  post-fix run must reproduce.
- **Claim-count drift on real documents.** Finer splitting can surface a previously-hidden,
  previously-merged claim as newly "uncovered" on some other document not examined here (or change
  the exact claim count on `tasks/DIR-126-D.md` without changing its `ok:true` verdict). This is
  intended, correct behavior (the checker doing its job on real content) rather than a regression
  to suppress — mitigated by re-running the CLI against at least one real, previously-passing task
  body post-fix as an AC item.
- **Residual false-positive class this fix does not address (disclosed, non-goal).** Hand-applying
  both fixes to a scratch copy and re-running the real CLI against this task's own Proposal still
  leaves `ok:false` with several claims uncovered — background/framing sentences whose backtick
  identifiers don't literally co-locate in any single AC bullet, even when the Proposal's own text
  conceptually maps them elsewhere. This fix narrows the `whose`-exclusion and bold-marker-splitting
  classes specifically; it does not attempt the broader background-sentence-vs-AC-bullet identifier
  co-location problem, which is a separate, pre-existing `wiring-coverage-check.ts` characteristic
  (the established workaround throughout this session has been per-document Grounding-evidence
  bullets, not a checker change) — out of scope here.

### Non-goals

- Not adding `imports?|reuses?|reused|parses?|parsed` (or any other verb) to `WIRING_VERB_RE` — a
  change already explicitly considered and rejected at M201/DIR-126-B, documented in the file's
  own header comment, for reopening-already-landed-work reasons unrelated to this fix. Out of
  scope here.
- Not attempting real NLP/semantic claim extraction for prose without backtick identifiers — an
  existing, explicitly documented limitation of this module (its own header NON-GOAL), unchanged
  by this fix.
- Not handling every Markdown-emphasis-adjacent boundary (single `*`/`_` emphasis, nested
  bold+italic) — scoped strictly to `**` (double-asterisk bold), the only marker implicated by the
  real incident and the task's own fixture.
- Not modifying `splitListAwareBlocks` (bullet/table-row splitting) — unaffected by either fix,
  already covered by prior gap tasks for that logic.
- Not creating `plugin/test/wiring-coverage-check.test.mjs` or a new
  `plugin/test/fixtures/preparation/` tree — see Alternatives below.

### AC coverage

Mapping the task's existing AC checklist against what this proposal delivers:

- **AC 1** (`whose` exclusion, RED/GREEN fixture) — directly covered by Fix 1; empirically
  confirmed correct (`true`→`false` for the "whose own" sentence, real ownership sentence
  unaffected).
- **AC 2** (`**` splitting, RED/GREEN fixture) — directly covered by Fix 2, with the correction
  that the underlying regex change must touch both the lookbehind and the lookahead — empirically
  the lookahead-only variant (the task's literal current wording) fails this exact fixture.
- **AC 3** (regression tests) — covered in the canonical
  `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` only; recommend the AC
  text explicitly drop any `plugin/test/` mirror requirement since that file does not exist and
  creating it has no precedent for this module class (2/25, not the dominant pattern).
- **AC 4** (re-run against a real, previously-passing task body — `tasks/DIR-126-D.md` — confirm
  `ok:true`) — covered; this is the direct check that Fix 2's finer splitting does not newly break
  something that was already passing.
- **New AC item (this proposal's own claim)**: `bash plugin/scripts/sync-vendor.sh --check`
  reports CLEAN for `wiring-coverage-check` after the canonical fix + regeneration — closes the
  mirror-regeneration wiring claim above.
- **New AC item (this proposal's own claim)**: `experiments/quay-perpetual-stream/test/prepare-
  admission-check.test.mjs` still passes in full post-fix (61/61 pre-fix baseline reproduced
  above) — closes the second-call-site wiring claim, which the task's Requested Action does not
  currently name.

### Alternatives considered and rejected

1. **Hand-edit `plugin/scripts/wiring-coverage-check.ts` directly, in addition to the canonical
   source** (the task body's literal "+ plugin/scripts/ mirror" `## Touches` wording). Rejected:
   works against `sync-vendor.sh`'s own mechanical `cp` + `--check` design for this module group
   (no hand-edit branch exists for `SYNC_SCRIPTS` entries); a future non-`--check` sync run would
   silently overwrite an independently hand-edited plugin copy, and maintaining two hand-edited
   copies reintroduces exactly the drift risk the mechanical regeneration step exists to
   eliminate.
2. **Create `plugin/test/wiring-coverage-check.test.mjs`** (full mirror or a minimal new file).
   Rejected: a full mirror would fail at runtime since its `RED_FIXTURE`/CLI-mode tests read
   fixtures under `experiments/quay-perpetual-stream/test/fixtures/preparation/`, and no
   `plugin/test/fixtures/preparation/` tree exists; a minimal new file avoids that but duplicates
   a pattern only 2 of 25 sync-vendor-managed modules use, for no incremental verification value
   once `sync-vendor.sh --check` already proves plugin/canonical byte-identity.
3. **Extend only the lookahead** (a literal reading of "extend the lookahead" in the task's own
   Requested Action wording). Rejected: empirically proven, via live regex reproduction, to leave
   the AC-2 fixture's two bold claims merged — this variant does not pass the task's own stated
   acceptance test.
4. **Broaden to a general inline-emphasis boundary rule** (`**`, `*`, `_`, `__`). Rejected as
   over-scoped: neither the real DIR-126-D incident nor the task's own fixture motivates anything
   beyond `**`; each additional marker adds over-splitting risk surface with no evidence requiring
   it now.
5. **Treat `**` as a `splitListAwareBlocks` boundary instead of a `splitSentences` punctuation
   boundary.** Rejected: `splitListAwareBlocks` is line-anchored (`^\s*...`), but bold markers
   occur mid-line, so a line-anchored bullet-style regex cannot express this boundary; the
   existing punctuation-level split in `splitSentences` is the correct layer, and is already
   line-internal.
6. **Do nothing, treat manual prose restructuring as standing practice.** Rejected: the defect
   already cost one real, measured convergence round per the task's Finding, and the "explanatory
   prose with bold-prefixed claim markers" / "whose own" phrasing pattern is a generic authoring
   habit in this repo's own Proposal-writing convention, not a one-off unlikely to recur.

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
  create one — see Proposal's "Alternatives considered and rejected" #2: only 2 of 24
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
  `checkGapSections`, `checkDirectiveSections`, `ProposalReview`, `splitSentences(sectionText)`,
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
  invention.

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
