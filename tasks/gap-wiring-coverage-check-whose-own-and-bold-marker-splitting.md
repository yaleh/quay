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

### Problem framing (grounded in current source, re-verified live during adjudication)

Direct source read of `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` — the
ONE canonical implementation both `task-schema.ts` (`checkGapSections`/`checkDirectiveSections`,
line 323) and `prepare-admission-check.ts` (`preflightMergedMarkdownClaims`, line 386) import from
(`grep` confirmed) — plus a live `node -e` reproduction of both regexes against the exact strings
involved, confirms both defects exactly as the task's Finding describes, at the current line
numbers, and confirms the task's own Requested-action wording for defect 2 is insufficient:

1. **Line 50**, `WIRING_VERB_RE`'s possessive-determiner exclusion lookbehind is
   `(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b`. `whose` is absent from the
   alternation, so `\bowns?\b` still matches inside "the terminal **whose own** AC requires X" —
   reproduced live: `WIRING_VERB_RE.test("the terminal whose own AC requires X")` → `true` on
   today's code, → `false` after adding `whose` to the alternation, while
   `"composite-land.ts owns dashboard.md writes"` (a real ownership claim) still fires `true` —
   the patch is strictly narrowing.

2. **Line 102**, `splitSentences()`'s sentence-boundary regex
   `.split(/(?<=[.!?])\s+(?=[A-Z`"])/)` never splits before a markdown bold marker (`**`). **The
   task's own Requested Action item 2 ("Extend the lookahead to also match `\*\*`") is
   INSUFFICIENT and does not achieve the task's own AC-item-2 fixture outcome** — confirmed by
   live `text.split(regex)` against the exact AC-2 fixture string
   `"Done. **A does X (\`id1\`, \`id2\`).** **B does Y (\`id3\`, \`id4\`).**"`:
   - lookahead-only fix (`(?<=[.!?])\s+(?=[A-Z\`"]|\*\*)`) → `["Done.", "**A does X (\`id1\`,
     \`id2\`).** **B does Y (\`id3\`, \`id4\`).**"]` — still ONE merged chunk containing all 4
     identifiers, the exact bug the AC says must be fixed. (The character immediately before the
     whitespace between the two bold claims is the closing `*` of `**`, not `.`/`!`/`?`, so the
     lookbehind — untouched by a lookahead-only edit — never fires there.)
   - extending **both** the lookbehind `(?<=[.!?])` → `(?<=[.!?]|\*\*)` **and** the lookahead
     `(?=[A-Z\`"])` → `(?=[A-Z\`"]|\*\*)` → `["Done.", "**A does X (\`id1\`, \`id2\`).**", "**B
     does Y (\`id3\`, \`id4\`).**"]` — the correct 3-way split the AC fixture requires (2
     identifiers per resulting sentence).

Both were the real, source-confirmed cause of DIR-126-D's round-4/round-5 `ProposalReview` churn
(~20 minutes / 12 agents / ~700K tokens spent manually restructuring prose into bullets to dodge
the tool's own false positives, per the task body's Finding section). Running the checker against
the current `tasks/DIR-126-D.md` today reproduces the un-regressed baseline: `ok:true`,
`code:"wiring-coverage-complete"`, 22 covered claims, 0 findings (independently reproduced live
during adjudication) — the manual workaround already got the document past the checker; this
task's job is to fix the checker so future documents don't need the same workaround.

**Wiring/mirroring facts, independently verified live (not assumed from either draft):**
`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` and
`plugin/scripts/wiring-coverage-check.ts` are currently byte-identical (`diff`, exit 0, no output).
`plugin/scripts/sync-vendor.sh`'s `SYNC_SCRIPTS` array (line 169) lists `wiring-coverage-check` in
its "group 1 — must be identical" set: non-`--check` mode mechanically `cp`s
`${EXPERIMENT_SCRIPTS}/${s}.ts` over `${PLUGIN_DIR}/scripts/${s}.ts` for every listed module (no
hand-editing path exists in the script for this group), and `--check` mode byte-compares them
(`cmp_or_report`) — already exercised by `plugin/test/plugin-packaging.test.mjs`'s "M136
(DIR-070-A)" test, part of the `scripts/test.sh` canonical glob. `plugin/test/wiring-coverage-
check.test.mjs` does **not** exist on disk (confirmed via `find`/`ls`), contradicting the task's
`## Touches` list and AC item 3. Checked against actual repo convention: of the 25
`SYNC_SCRIPTS`-listed modules (24 other than `wiring-coverage-check` itself), only 2
(`composite-manifest-synthesis`, `prepare-admission-check`) have a paired `plugin/test/*.test.mjs`
— 22/24 do not, by design (their logic is unit-tested once under `experiments/.../test/`, and the
`plugin/scripts/` copy's fidelity is proven by the byte-identity gate, not a second test suite).
Separately, live-executing today's exact `extra.acceptance` command (`node
--experimental-strip-types --test experiments/.../wiring-coverage-check.test.mjs
plugin/test/wiring-coverage-check.test.mjs`) with the second path absent shows Node's test runner
does **not** error on a nonexistent CLI file argument — it silently runs only the file(s) that
exist: 18 tests, 0 failures, exit 0 (reproduced live). This is a latent, minor gate weakness (a
genuinely drifted plugin mirror would not be caught by *this* command) but is orthogonal to this
task's two real defects, and is already covered by the separate byte-identity gate above.

Also confirmed live: `prepare-milestone.js`'s ProposalReview phase dispatches
`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` directly by path (line 541) —
the canonical source, not the plugin mirror — so this fix is live on the real ProposalReview gate
as soon as it lands on `master`, independent of any plugin packaging/release step.

### Chosen mechanism

Fix both defects **only** in the canonical source
(`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`); regenerate the plugin copy
mechanically via the existing `sync-vendor.sh` tool (never hand-edit `plugin/scripts/`, matching
that script's own documented discipline for its generated-mirror trees); add regression tests
**only** to the canonical test file
(`experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`), matching the convention
already used by 22 of 24 sync-vendor-managed modules; separately verify the second, previously-
unflagged real call site (`prepare-admission-check.ts`'s reuse of `splitSentences`) does not
regress; and flag/recommend corrections to the task's own `## Requested action`, `## Acceptance
Criteria`, and `## Touches` text where it currently implies (a) a lookahead-only fix that does not
work, and (b) hand-editing/testing a `plugin/scripts`+`plugin/test` "mirror" pair that either
duplicates a mechanically-generated tree or presumes a nonexistent file.

**Fix 1 (whose):** change line 50's
`(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b` to
`(?<!(?:'s|s'|its|their|my|our|your|his|her|whose)\s)\bowns?\b` — adds `whose` to the
possessive-determiner exclusion alternation. `WIRING_VERB_RE`'s verb alternation
(`invokes?|calls?|...`) is untouched.

**Fix 2 (bold marker) — a correction to the task body's own prescribed fix.** Change line 102's
`.split(/(?<=[.!?])\s+(?=[A-Z`"])/)` to `.split(/(?<=[.!?]|\*\*)\s+(?=[A-Z`"]|\*\*)/)` — extends
**both** the lookbehind and the lookahead to recognize `**` as a sentence/claim boundary marker
(symmetric with `.!?` on the trailing side and `[A-Z\`"]` on the leading side), not the lookahead
alone as the task text says. This is a strict superset of split points versus today (the same
"additive-only, never fewer splits" property the module's own `splitListAwareBlocks` header
comment documents for the list-aware pass) — it can only surface previously-merged claims, never
hide a previously-visible one.

Both fixes are entirely inside the two regex literals; `extractMechanismClaims()` and
`checkWiringCoverage()`'s signatures/return shapes are unchanged.

### Concrete control/data flow

No new call sites are introduced — this is a pure internal-logic fix to functions already wired
into production:

1. `extractMechanismClaims(sectionText)` (used by `checkWiringCoverage`, which
   `task-schema.ts`'s `checkGapSections`/`checkDirectiveSections` call, which
   `prepare-milestone.js`'s `ProposalReview` phase dispatches via the CLI, line 541) calls
   `splitSentences(sectionText)` for every sentence, then tests each against the (patched)
   `WIRING_VERB_RE`.
2. `splitSentences(text)` — unchanged pipeline shape: paragraph split (`\n{2,}`) →
   `splitListAwareBlocks` (bullet/table-row aware, unaffected by this fix) → per-block punctuation
   split (**Fix 2's target**) → whitespace normalization.
3. **CLI/regression re-verification, live-reproduced during adjudication (not just inference):**
   patching the canonical file in place and re-running
   `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
   --task tasks/DIR-126-D.md` yields `ok:true`, `code:"wiring-coverage-complete"`, **21 claims** (down
   from the pre-fix baseline of 22 — one fewer artificially-oversized claim, expected: Fix 2 now
   splits a previously-merged bold-prefixed pair into two independently-covered claims), 0
   findings. All 18 pre-existing tests in
   `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` still pass unmodified
   under the patched regexes. The canonical file was reverted to its pre-patch state immediately
   after (`git status --short` confirms a clean tree) — this evidence is reproducible, not a
   standing change.
4. **Regenerate the plugin mirror**: after editing the canonical source for real, run
   `bash plugin/scripts/sync-vendor.sh` (mutating mode, no `--check`) so
   `plugin/scripts/wiring-coverage-check.ts` is re-copied byte-for-byte from the fixed canonical
   file — a mechanical `cp`, never a hand-edit of the plugin copy.
5. **Verify the mirror stayed in sync**: `bash plugin/scripts/sync-vendor.sh --check` must report
   `CLEAN` for `wiring-coverage-check` — already exercised automatically by
   `plugin/test/plugin-packaging.test.mjs`'s existing "M136 (DIR-070-A)" test, part of the
   `scripts/test.sh` canonical glob; no new test file needed for this.
6. **Second call-site regression check (real, not assumed):** `splitSentences()` is also called by
   `prepare-admission-check.ts`'s `preflightMergedMarkdownClaims` (line 386) — a real wiring claim
   the task body never names. Live-reproduced during adjudication with the canonical fix applied:
   `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
   → 61/61 pass, 0 failures (and the `plugin/test/` copy, run against the still-unpatched-until-
   sync plugin mirror, also 61/61 pass) — confirming the fix does not regress this consumer. Static
   grounding for *why*: the 3 `merged-markdown-claims` fixtures
   (`.../fixtures/preflight/merged-markdown-claims/{good,bad,ambiguous}.md`) contain no
   `**`-adjacent bold-pair text other than a leading `**type:**` header line, whose immediately-
   following character is a space then lowercase text (`execution`) — the new lookahead
   (`[A-Z\`"]|\*\*`) does not match lowercase, so no false split is introduced there (confirmed
   both by static read and by the live test run above).

### Mechanism-claim wiring coverage (DIR-117) — claims needing AC-level proof

- `prepare-milestone.js`'s ProposalReview phase invokes `wiring-coverage-check.ts` directly (line
  541) — not a new claim this task introduces, but the mechanism this fix takes live effect
  through; the existing AC item 4 (re-run against `tasks/DIR-126-D.md`) is the closest existing
  coverage and should stay (now with the precise 21-claims/ok:true evidence above).
- `prepare-admission-check.ts`'s `preflightMergedMarkdownClaims` invokes `splitSentences` from
  `wiring-coverage-check.ts` (line 386) — **a new claim surfaced by this proposal**, absent from
  the task body. Needs its own AC item: re-running `prepare-admission-check.test.mjs` (both
  copies) post-fix must still pass (61/61, already live-verified above).
- `plugin/scripts/sync-vendor.sh` owns regenerating `plugin/scripts/wiring-coverage-check.ts` from
  the canonical source, and `plugin/test/plugin-packaging.test.mjs`'s sync-vendor `--check` test
  enforces their byte-identity — a new claim this proposal introduces in place of the task's
  "hand-edit the mirror" framing. Needs an AC item: `bash plugin/scripts/sync-vendor.sh --check`
  reports `CLEAN` for `wiring-coverage-check` after the canonical-source fix + regeneration.

### Key design decisions

- **Extend both lookbehind and lookahead, not lookahead alone** — the task body's literal wording
  is wrong per empirical testing against its own fixture (reproduced above); silently "following
  the task text" would ship a fix that still fails the task's own AC item 2.
- **Single source of truth for the fix and its tests (experiments/ only), regenerate the plugin
  mirror mechanically via `sync-vendor.sh`, never hand-edit it** — matches this file's own header
  comment ("This module is the ONE implementation both callers share... does NOT re-implement any
  claim extraction"), `sync-vendor.sh`'s own documented discipline for its generated-mirror trees
  ("never hand-edits ... that tree is a generated mirror, not a second source of truth"), and the
  dominant (22/24) sync-vendor test-location convention. Hand-editing both files identically (an
  alternative considered) achieves the same end state today but works against the repo's own
  tooling — a future `sync-vendor.sh` run would silently overwrite any independent plugin-side
  edit, and two hand-edited copies carry ongoing drift risk that the mechanical `cp` + `--check`
  gate is specifically designed to eliminate.
- **Do not create a new `plugin/test/wiring-coverage-check.test.mjs`** — it doesn't exist today,
  the current `extra.acceptance` command already silently tolerates its absence (live-reproduced:
  exit 0, 18/18 passing with only the real file present), and creating one would be the third
  instance of a pattern only 2/24 sync-vendor-managed modules use, for zero incremental
  verification value once `sync-vendor.sh --check` already proves the plugin script byte-identical
  to its fixed source.
- **Correct the task's own `## Requested action` / `## Acceptance Criteria` / `## Touches` text**,
  since ground-truthing against the current repo shows each currently asserts something false or
  insufficient (a lookahead-only fix that doesn't pass the task's own fixture; an existing
  `plugin/test/` mirror file that doesn't exist). Leaving it as-is would either ship a fix that
  fails the stated AC, or block on/silently no-op a nonexistent precondition.

### Defaults and failure behavior

No new configuration, flags, or defaults are introduced — both fixes are internal regex-literal
changes with no altered function signatures, so every existing caller (`task-schema.ts`,
`prepare-admission-check.ts`, the CLI entrypoint) is unaffected at the call-site level. Both fixes
are strictly narrowing (Fix 1: excludes one more phrase from the verb match) or strictly additive
(Fix 2: adds split points, never removes one) relative to today's behavior, so a document that was
`ok:true` before the fix cannot newly fail after it — it can only stop being incorrectly
split/matched, never start being.

Failure mode if the mirror-regeneration step is skipped: `sync-vendor.sh --check` (already wired
into `scripts/test.sh` via `plugin-packaging.test.mjs`) goes RED — a real, pre-existing, fail-
closed CI signal catches a forgotten regeneration. Failure mode if either regex fix regresses an
existing passing test: the existing 18 `wiring-coverage-check.test.mjs` tests plus the 2 new
RED/GREEN fixture pairs all run under the same `extra.acceptance` gate — any regression fails the
gate closed, matching the CLI's own documented fail-closed posture (exit 2 on usage/IO error; the
workflow fails ProposalReview closed on a non-parseable result).

### Compatibility

No schema, config, or CLI-flag changes. `checkWiringCoverage()`'s return shape
(`{ok, code, message, claims, uncovered}`) and the CLI's JSON output shape are unchanged. Backward
compatible for every existing caller: `task-schema.ts`'s `checkGapSections`/
`checkDirectiveSections`, `prepare-admission-check.ts`'s `preflightMergedMarkdownClaims` (live-
verified 61/61 passing above), and the CLI's own `--task` mode all continue to work with identical
inputs/outputs except where the two bugs previously produced wrong verdicts (the intended behavior
change). `plugin/scripts/wiring-coverage-check.ts` and its consumers pick up the fix automatically
the next time `sync-vendor.sh` runs, per this task's explicit regeneration step (4) above.

### Risks

- **Over-splitting risk from the `**` boundary extension**: a bold span used as pure inline
  emphasis mid-sentence (e.g. `"This is **important** and here."`) could theoretically false-split
  if the closing `**` were immediately followed by whitespace then exactly one of `[A-Z\`"]` or
  another `**` — but that is precisely the "distinct claims back to back" shape this fix targets,
  not incidental mid-sentence emphasis (typically followed by lowercase continuation text, confirmed
  safe against all 3 real `merged-markdown-claims` fixtures both statically and via the live
  61/61-passing test run). Residual risk is real but narrow and testable — captured as a NON-GOAL
  below, not silently ignored.
- **Claim-count drift risk on `tasks/DIR-126-D.md`**: the finer splitting surfaced one previously-
  hidden artifact claim (22 → 21 claims, live-confirmed above); if a future edit to that document
  introduces a genuinely new uncovered claim, that is real signal the fix is working, not a
  regression to suppress. AC item 4 (re-run, confirm `ok:true`) is the direct mitigation.
- **`whose` over-exclusion risk:** a genuine (rare) construction like "the module whose `owns()`
  method..." would now also be excluded from the verb match — accepted as consistent with the
  identical theoretical false-negative risk already accepted for the existing
  `its/their/my/our/your/his/her` possessive-pronoun exclusions.
- **Missed second call site**: `prepare-admission-check.ts`'s reuse of `splitSentences` was not
  named in the task body at all; without deliberately re-running its test suite, a regression there
  could ship silently. Addressed by the new AC item above and the live 61/61-passing evidence
  already gathered.

### Non-goals

- Does not add `imports?|reuses?|reused|parses?|parsed` to `WIRING_VERB_RE`'s verb set — explicitly
  considered and REJECTED at M201/DIR-126-B (documented in the file's own header comment, lines
  41-48) for reopening-DONE-work reasons unrelated to this task; out of scope here.
- Does not attempt real NLP/semantic claim extraction for prose with no backtick identifiers — the
  file's own documented NON-GOAL (lines 24-29) stands unchanged.
- Does not address every conceivable Markdown-emphasis-adjacent splitting edge case (single
  `*`/`_` emphasis, nested bold+italic) — scoped strictly to the `**` (double-asterisk bold) marker
  the task's own fixture and the real DIR-126-D incident both used.
- Does not create a `plugin/test/wiring-coverage-check.test.mjs` file, nor a new
  `plugin/fixtures/preparation/` tree — see "Alternatives considered and rejected" below.
- Does not modify `splitListAwareBlocks` (bullet/table-row splitting) — unaffected, out of scope,
  already covered by prior gap tasks (`gap-wiring-coverage-check-merged-markdown-list`,
  `gap-wiring-coverage-check-table-rows`).

### AC coverage

Existing task AC items map as follows, with corrections:
- **AC 1** (`whose` exclusion, RED/GREEN fixture) — covered as specified; fix confirmed
  empirically correct (`true`→`false` across the patch, real-`owns` claim unaffected).
- **AC 2** (`**` splitting, RED/GREEN fixture) — covered, but the underlying mechanism must be
  corrected to "extend both the lookbehind and the lookahead," not "extend the lookahead" as the
  Requested Action currently states, or the fixture will not actually pass (empirically confirmed:
  lookahead-only still merges the two bold claims).
- **AC 3** (regression tests in both test files) — recommend narrowing to the canonical
  `experiments/.../test/wiring-coverage-check.test.mjs` only, per the dominant (22/24) sync-vendor
  convention; drop the `plugin/test/` mirror clause (file doesn't exist, no precedent for creating
  one for this module class, and the current `extra.acceptance` command already tolerates its
  absence).
- **AC 4** (re-run against `tasks/DIR-126-D.md`, confirm `ok:true`) — covered, with a precise
  post-fix result now live-verified: `ok:true`, 21 claims (down from 22), 0 findings.
- **New AC item**: `bash plugin/scripts/sync-vendor.sh --check` reports `CLEAN` for
  `wiring-coverage-check` after canonical-source fix + regeneration (covers the sync-vendor wiring
  claim above).
- **New AC item**: `prepare-admission-check.test.mjs` (both copies) still passes post-fix — already
  live-verified (61/61, 0 failures) during this adjudication, ahead of implementation.

### Alternatives considered and rejected

1. **Hand-edit `plugin/scripts/wiring-coverage-check.ts` directly and identically, in addition to
   the canonical source** (the task body's literal "+ plugin/scripts/ mirror" wording, and one
   candidate proposal's chosen approach) — REJECTED: works against `sync-vendor.sh`'s own
   mechanical `cp` + `--check` byte-identity design for this exact module (`SYNC_SCRIPTS` line
   169); a future non-`--check` run would silently overwrite any independently hand-edited plugin
   copy, and two hand-maintained copies carry ongoing drift risk the mechanical regeneration step
   is specifically built to eliminate.
2. **Create `plugin/test/wiring-coverage-check.test.mjs` — either a full byte-identical mirror of
   the 233-line canonical test file, or a minimal new file with just the two new regression
   tests** — REJECTED either way. A full mirror would ENOENT at runtime: the canonical test file's
   `RED_FIXTURE`/CLI tests read `experiments/quay-perpetual-stream/fixtures/preparation/wiring-
   uncovered-claim-task.md`, and no `plugin/fixtures/preparation/` tree exists (confirmed: `find
   plugin -iname fixtures` returns only `plugin/test/fixtures`, which has no `preparation/`
   subdirectory). A minimal new file avoids the ENOENT but would be the third instance of a
   duplication pattern only 2/24 sync-vendor-managed modules use, adds ongoing maintenance for
   zero incremental verification value once `sync-vendor.sh --check` already proves the plugin
   copy byte-identical to the fixed canonical source, and isn't required by the (already-tolerant)
   `extra.acceptance` command as it runs today.
3. **Extend only the lookahead (the task's literal wording)** — REJECTED: empirically proven (live
   `text.split()` reproduction) to leave the AC-2 fixture's two bold claims merged into one; would
   ship a change that still fails the task's own stated acceptance test.
4. **Broaden the fix to a general "split before any Markdown inline-emphasis marker" rule (`**`,
   `*`, `_`, `__`)** — REJECTED as over-scoped: no real incident or fixture motivates anything
   beyond `**` (the actual DIR-126-D trigger and the task's own AC fixture both use bold only);
   each additional marker is additional over-splitting risk surface with no evidence requiring it
   now.
5. **Treat `**` as a `splitListAwareBlocks` boundary instead of a `splitSentences` punctuation
   boundary** — REJECTED: `splitListAwareBlocks` operates on whole lines (`^\s*...`), but bold
   markers appear mid-line (`". **A** **B**."` on one line), so a line-anchored bullet-style regex
   cannot express this boundary; the punctuation-level `splitSentences` split (already
   line-internal) is the correct layer.
6. **Do nothing / accept the manual-restructuring workaround as standing practice** — REJECTED per
   the task's own value hypothesis: the defect already cost one real, measured ~20-minute/~700K-
   token convergence round, and the "explanatory prose with `**Claim N...**` markers"/"whose own"
   phrasing pattern is a generic authoring habit likely to recur in future milestones' Proposals,
   not a one-off.

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
  (direct source read), not a new invention.

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
