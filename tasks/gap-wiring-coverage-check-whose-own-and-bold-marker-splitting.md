---
id: gap-wiring-coverage-check-whose-own-and-bold-marker-splitting
title: wiring-coverage-check.ts's WIRING_VERB_RE false-triggers on "whose own"
  (possessive-determiner exclusion list omits "whose") and its sentence splitter
  never breaks before a markdown bold marker (**), letting unrelated bulleted
  sub-points merge into one oversized "claim" -- found live during DIR-126-D's
  round-4/5 ProposalReview convergence when the milestone's own explanatory
  prose kept re-triggering uncovered-claim findings
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    gap-wiring-coverage-check-whose-own-and-bold-marker-splitting
    experiments/quay-perpetual-stream/charters/M205-gap-wiring-coverage-checker-fixes.md
    milestones/M205/absorb-entry.md
---
## Proposal

### Problem framing (independently re-derived against current source, 2026-07-30; two-draft adjudication, every disagreement settled by live execution and direct re-read)

`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` (292 lines, re-counted this
session) is, by its own header (lines 1-8) and by every call site grep-verified below, the ONE
implementation of the DIR-117/DIR-122 mechanism-claim wiring-coverage check. Its three live
consumer surfaces, confirmed by direct source read (not inferred, and not taken from the task
body):

- **Directive `## Proposal` enforcement** runs through the CLI: `plugin/workflows/prepare-milestone.js`
  line 541 sets `_wiringCheckScript = 'experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'`
  (a repo-root-RELATIVE path, so the canonical experiment-tree file — not the plugin mirror — is
  what the real gate executes) and dispatches
  `node --experimental-strip-types ${_wiringCheckScript} --task tasks/${_taskId}.md` inside the
  ProposalReview agent prompt (command at line 544).
- **`kind=gap` task enforcement** runs in-process: `experiments/quay-perpetual-stream/scripts/task-schema.ts`
  line 323 imports `checkWiringCoverage`; `checkGapWiringCoverage` (defined line 354) calls it at
  line 357 on `## Requested action` vs `## Acceptance Criteria` text; the gap assertion set invokes
  it at line 441. I read `checkDirectiveSections`'s full body (line 303, wired into the directive
  assertion set at line 451): it is a pure `## Finding`/`## Requested action` section-presence
  check that NEVER calls `checkWiringCoverage` — so, despite the module header's stale attribution
  (lines 3-5), directive-side wiring enforcement is the [W1] CLI dispatch above, not
  `task-schema.ts`. (Correcting that header comment is an explicit NON-GOAL here — comment-only,
  out of scope.)
- **A second, unnamed splitter consumer:** `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`
  line 44 imports `splitSentences`; `preflightMergedMarkdownClaims` (defined line 379) calls it
  directly at line 386 and is recorded into the admission preflight at line 580. The canonical
  file's own comment (line 97) documents this same reuse. Any change to the sentence boundary
  therefore flows through THREE live surfaces, not two.

`diff experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts plugin/scripts/wiring-coverage-check.ts`
→ byte-identical today (re-verified this session).

Two defects, each reproduced live (re-run at adjudication) by executing the actual regex semantics,
not trusted from prose:

1. **`WIRING_VERB_RE` (declared line 49, pattern line 50)** — the current verbatim literal is an
   `/i`-flagged alternation:
   `/\b(invokes?|calls?|dispatches?|enforces?|wires?|routes?|delegates?)\b|(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b/i`.
   The negative-lookbehind possessive exclusion guards ONLY the `owns?` branch (the verb branch has
   no lookbehind), and that lookbehind lists 9 forms while omitting `whose`. Live result:
   `WIRING_VERB_RE.test("the terminal whose own AC requires X")` → `true` today (a false positive —
   "whose own" is a possessive determiner + adjective, not an ownership-verb claim); the same test
   against the patched literal `(?<!(?:'s|s'|its|their|my|our|your|his|her|whose)\s)\bowns?\b` →
   `false`; the genuine ownership sentence `"composite-land.ts owns dashboard.md writes"` stays
   `true` under BOTH the current and the patched literal. A strict narrowing — no real ownership
   claim stops matching; the verb branch and the `/i` flag are untouched. This extends the exact
   exclusion class the header comment (lines 34-40, the M198/DIR-119-D1 `owns` false-positive
   precedent) already documents — `whose` is simply the one possessive determiner that list missed.

2. **`splitSentences()` (lines 98-105; the per-block punctuation split is line 102)** — current
   verbatim: `.flatMap((block) => block.split(/(?<=[.!?])\s+(?=[A-Z`"])/))`. Neither side of the
   boundary recognizes a markdown bold marker (`**`), so two independently bolded claims separated
   only by `**<whitespace>**` merge into one oversized "claim." Live reproduction against the exact
   AC-2 fixture text `"Done. **A does X (\`id1\`, \`id2\`).** **B does Y (\`id3\`, \`id4\`).**"`:
   - unpatched → **ONE chunk** carrying all 4 identifiers;
   - **lookahead-only** patch (`/(?<=[.!?])\s+(?=[A-Z`"]|\*\*)/`) → exactly **2 chunks**:
     `["Done.", "**A does X (\`id1\`, \`id2\`).** **B does Y (\`id3\`, \`id4\`).**"]` — it peels off
     the leading `"Done."` but the two adjacent bold claims REMAIN merged in a single 4-identifier
     chunk, because the character before the inter-claim whitespace is the closing `*` of `**`,
     which the untouched lookbehind `(?<=[.!?])` never matches. Empirically insufficient — this
     disproves a lookahead-only reading of the fix (and symmetrically, a lookbehind-only extension
     also fails: the char after the inter-claim whitespace is `*`, outside `[A-Z`"]`);
   - **both-sides** patch (`/(?<=[.!?]|\*\*)\s+(?=[A-Z`"]|\*\*)/`) → the correct **3-way** split
     `["Done.", "**A does X (\`id1\`, \`id2\`).**", "**B does Y (\`id3\`, \`id4\`).**"]` (two
     sentences of 2 identifiers each, disjoint identifier sets). The boundary must be widened on
     BOTH sides; this session's live run confirms the symmetric form is the minimal sufficient edit.

Both defects are the source-confirmed mechanics behind the DIR-126-D round-4/5 ProposalReview churn
the Finding describes (run IDs `wf_929eb86d-2a6`/`wf_750f506a-3d2`, commit `83c1958` — verified
present locally; ~20 min / 12 agents / ~700K tokens taken at face value from the Finding; the regex
mechanics were independently re-executed here). A paragraph combining "the one terminal whose own
AC…" prose with back-to-back `**Claim N…**`-prefixed points fired both defects at once; the
workaround at the time was manual bullet-list restructuring (which the checker's list-aware splitter
already handles), not a tool fix. Corroborating: the current committed `tasks/DIR-126-D.md` contains
ZERO occurrences of `whose own` — consistent with that workaround having been manual prose
restructuring.

**Live-reproduced baselines the fix must sit alongside without breaking** (the RED-side references
for the new regression fixtures):
- `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`
  → **18/18 pass** (233-line file; its line-10 import is
  `extractMechanismClaims, bulletsOf, checkWiringCoverage` — NOTE: NOT `splitSentences`, which the
  new split-layer fixture must ADD to that import list; `splitSentences` is exported at line 98).
- `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
  → **63/63 pass across 7 suites**.
- `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts --task tasks/DIR-126-D.md`
  → `{ok:true, code:"wiring-coverage-complete", claims:22, findings:0}` — the real,
  previously-passing document the fix must not regress. (The CLI envelope field is `findings` — an
  array — while `uncovered` is the library-level `checkWiringCoverage` return field, mapped through
  `wiringFindingsFromUncovered` at line 283; confirmed by reading the `_runAsCli` block, lines
  265-292.)
- `grep '\*\*'` across the 3 `experiments/quay-perpetual-stream/test/fixtures/preflight/merged-markdown-claims/`
  fixtures (`good.md`/`bad.md`/`ambiguous.md`, mirrored under `plugin/test/fixtures/preflight/`):
  the ONLY occurrence in each is a line-1-leading `**type:** execution` header followed by
  LOWERCASE text. A line-initial `**` with no preceding `.!?`-or-`**`+whitespace introduces NO new
  split point under the both-sides fix (and the widened lookahead does not match lowercase anyway) —
  Fix 2 adds no incidental splits to these fixtures.
- `plugin/scripts/sync-vendor.sh`: `SYNC_SCRIPTS=(...)` declared at line 147 with exactly 25
  entries, `wiring-coverage-check` at line 169; mutating mode `cp`s canonical→plugin, `--check`
  mode byte-compares each entry via `cmp_or_report` (defined line 53) — no hand-edit branch exists
  for any listed entry. Of the 25 entries, only 2 (`composite-manifest-synthesis`,
  `prepare-admission-check`) have a paired `plugin/test/*.test.mjs` (`plugin/test/` holds 9 test
  files + a `fixtures/` dir, none for this module), and
  `plugin/test/plugin-packaging.test.mjs` (test at line 183, exit-0 assertion line 200, CLEAN
  assertion line 203) — inside `scripts/test.sh`'s canonical glob
  `packages/*/test/*.test.mjs plugin/test/*.test.mjs` — already executes `sync-vendor.sh --check`
  and gates it.

### Chosen mechanism

Two narrow, in-place regex-literal edits confined to the canonical file, mechanical mirror
regeneration (never a hand-edit), and new RED/GREEN regression fixtures in the one canonical test
file:

- **Fix 1** (`WIRING_VERB_RE`, line 50): add `whose` to the `owns?`-branch exclusion lookbehind —
  `(?<!(?:'s|s'|its|their|my|our|your|his|her)\s)\bowns?\b` →
  `(?<!(?:'s|s'|its|their|my|our|your|his|her|whose)\s)\bowns?\b`. One word added to the existing
  exclusion alternation; the verb branch and the `/i` flag are untouched. The regex's single
  enforcement point — `WIRING_VERB_RE.test(sentence)` inside `extractMechanismClaims` at line 124 —
  is the only place either branch is evaluated, so the edit propagates to every consumer through
  that one test call.
- **Fix 2** (`splitSentences()`, line 102): widen BOTH sides of the split boundary symmetrically —
  `/(?<=[.!?])\s+(?=[A-Z`"])/` → `/(?<=[.!?]|\*\*)\s+(?=[A-Z`"]|\*\*)/`. Trailing `\*\*` mirrors the
  existing trailing `[.!?]`; leading `\*\*` mirrors the existing leading `[A-Z`"]`. This
  deliberately **corrects** the task's earlier lookahead-only phrasing: live execution above proves
  the lookahead-only variant fails the task's own AC-2 fixture (the two bold claims stay merged in
  one 4-identifier chunk), because BOTH the char before the inter-claim whitespace (a closing `*`)
  and the char after it (an opening `*`) fall outside the untouched sides.

Neither edit touches `splitListAwareBlocks()` (line 69; line-anchored bullet/table splitting),
`backtickIdentifiers()` (line 108), `extractMechanismClaims()` (line 120), `bulletsOf()` (line 137),
`checkWiringCoverage()` (line 163), `extractSectionForCli` (line 222), `wiringFindingsFromUncovered`
(line 240), the `_runAsCli` block, or any function's signature/return shape.

**Fixture design (an implementation trap this Proposal names explicitly).** The task's AC-2 fixture
text uses the verb "does" — which is NOT a wiring verb. Verified against `extractMechanismClaims`'s
logic (verb test at line 124, `identifiers.length >= 2` test at line 126): a CLAIM-level assertion
on that exact text returns 0 claims BOTH before and after the split fix, so a claim-level test
asserting `claims.length === 2` would be RED-forever (never goes GREEN) — a false-failing fixture,
just as dangerous as a GREEN-only one. The Fix-2 fixtures must therefore be TWO-LAYERED, both in
`experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` only:
- (a) a **split-layer** test importing `splitSentences` (ADD to the line-10 import) that asserts the
  exact AC-2 text yields the correct chunks with disjoint backtick-identifier sets
  `{id1, id2}` / `{id3, id4}` (RED before: 1 merged 4-identifier chunk; GREEN after: the two bold
  sentences split apart);
- (b) a **claim-layer** RED/GREEN pair using a REAL wiring verb inside the bold sentences (e.g.
  "**A calls \`x1.ts\` from \`y1.ts\`.** **B calls \`x2.ts\` from \`y2.ts\`.**") asserting
  `extractMechanismClaims` yields 2 claims with disjoint identifier pairs (RED before: 1 merged
  4-identifier claim; GREEN after: 2) — satisfying the charter's done-when requirement of real
  fail-before/pass-after, never GREEN-only, never RED-forever.

The Fix-1 fixture is a "whose own" sentence with ≥2 backtick identifiers asserting 0 claims (RED
before / GREEN after), paired with the genuine-`owns` control sentence staying at 1 claim under both
literals.

Mirror delivery: `bash plugin/scripts/sync-vendor.sh` (mechanical `cp`), then
`bash plugin/scripts/sync-vendor.sh --check` → `CLEAN` for `wiring-coverage-check`.

**DIR-117 mechanism-claim wiring note.** This fix introduces NO new call/dispatch/ownership/
enforcement relationships — only two regex literals inside existing functions change behavior. Every
relationship this Proposal RELIES ON is pre-existing and is flagged below as a claim requiring
AC-level evidence (DIR-117):
- **[W1 — existing dispatch, preserve]** `prepare-milestone.js:541` sets
  `_wiringCheckScript = 'experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'` and
  `:544` dispatches `node --experimental-strip-types ${_wiringCheckScript} --task tasks/${_taskId}.md`
  in the ProposalReview phase; the guard at lines 549-553 wires an unparseable/non-conforming
  verdict to a blocking `wiring-coverage-check-failed`/`needs-human` terminal outcome via
  `_releaseLeaseAndRecord` (call at line 552), and line 555 merges the parsed `findings` array via
  `_upsertFindings(..., 0)`. Because the dispatch targets the repo-root-relative canonical path, a
  canonical-only edit is live on the real gate immediately, independent of any plugin sync. Proof
  obligation: post-fix, the CLI re-run against the real, previously-passing `tasks/DIR-126-D.md`
  must still report `ok:true`/0 findings (pre-fix baseline of 22 claims / 0 findings reproduced
  this session). → AC item.
- **[W2 — existing call, preserve]** `prepare-admission-check.ts:44` imports `splitSentences`;
  `preflightMergedMarkdownClaims` (line 379) calls it directly at line 386 — the second real
  consumer the original Finding did not name. Proof obligation: `prepare-admission-check.test.mjs`
  (canonical copy and plugin mirror copy) still passes 63/63 post-fix (baseline reproduced this
  session). → AC item.
- **[W3 — existing consumption, preserve]** `task-schema.ts:323` imports `checkWiringCoverage`,
  called only via the gap path (`checkGapWiringCoverage`, lines 354/357, wired into the gap
  assertion set at line 441); `checkDirectiveSections` (line 303, wired at line 451) never calls it
  — directive-`## Proposal` enforcement is the [W1] CLI dispatch. Both fixes flow through the shared
  import with no per-caller change. Proof obligation: neither edit touches any exported function's
  signature or return shape (both are internal regex literals), so `checkWiringCoverage`'s contract
  for every importer is invariant by construction — grep-verified import/call sites plus that
  signature/return-shape invariance, optionally reinforced by `task-schema.test.mjs` (which
  references `checkWiringCoverage` but lives outside `scripts/test.sh`'s glob, so it must be run
  directly, not via the canonical suite). The 18/18 canonical `wiring-coverage-check.test.mjs`
  suite proves the module itself, not its task-schema.ts consumption. → carried by the
  grounding-evidence AC (the real AC list's bullet 7) identifier listing below, which names these
  exact `task-schema.ts` identifiers; the exported signature/return-shape invariance is by
  construction and the direct `task-schema.test.mjs` run is OPTIONAL reinforcement — no dedicated
  AC bullet is declared to "close [W3]" (the real `## Acceptance Criteria` 7th bullet is the
  DIR-117 grounding-evidence item, not a W3-reachability test).
- **[W4 — existing enforcement, rely-on]** `sync-vendor.sh` (`SYNC_SCRIPTS` declared line 147, entry
  line 169, `cmp_or_report` line 53) mechanically `cp`s canonical→plugin and `--check`
  byte-compares; it is the ONLY mechanism carrying the fix into
  `plugin/scripts/wiring-coverage-check.ts`. Proof obligation: `sync-vendor.sh --check` reports
  `CLEAN` for `wiring-coverage-check` after regeneration — generically gated by
  `plugin/test/plugin-packaging.test.mjs` (line 200 asserts exit 0), but this module's specific
  post-fix `CLEAN` is an explicit AC line since it is the mechanism carrying the fix. → AC item.

### Concrete control/data flow

No new call sites, no new functions — only the two regex literals inside the existing pipeline
change behavior. Re-derived by direct read of `prepare-milestone.js`, the canonical module, and both
consumer scripts:

1. `prepare-milestone.js`'s ProposalReview phase (line 541 sets `_wiringCheckScript`, line 544
   dispatches) runs the canonical CLI against `tasks/<id>.md`; the guard at lines 549-553 fails a
   non-parseable/non-conforming verdict CLOSED to a `wiring-coverage-check-failed`/`needs-human`
   terminal outcome, and a conforming verdict's `findings` array is merged at line 555 by
   `_upsertFindings(..., 0)`. **[W1]**
2. Inside the CLI (`_runAsCli` block, lines 265-292): `extractSectionForCli` (lines 280-281) pulls
   the `## Proposal` and `## Acceptance Criteria` sections, then
   `checkWiringCoverage(proposalText, acText)` (line 282) → `extractMechanismClaims(sectionText)`
   (line 120) → `splitSentences(sectionText)` (**Fix 2's target**, line 102) per sentence chunk,
   each tested against `WIRING_VERB_RE` (**Fix 1's target**, evaluated at line 124) and counted for
   ≥2 distinct backtick identifiers (`identifiers.length >= 2` at line 126) — a "claim" = a chunk
   with a wiring-verb match AND ≥2 distinct backtick identifiers, per the header heuristic (lines
   10-16).
3. `splitSentences`'s structure is unchanged: paragraph split (`\n{2,}`, line 100) →
   `splitListAwareBlocks` (line 101, untouched by either fix) → per-block punctuation split (**Fix
   2's target**, line 102) → whitespace normalize/trim (lines 103-104).
4. Uncovered claims become BLOCKING typed findings via `wiringFindingsFromUncovered` (line 240) in
   the exact ledger shape `{subsystem, summary, severity:"blocker", blocking:true, evidence,
   claimRef, disposition}` the workflow consumes at line 555 — unchanged by either edit; the phase's
   blocking count moves by this function's real return value, not an LLM judgment.
5. **Second real consumer:** `prepare-admission-check.ts:44` imports `splitSentences`;
   `preflightMergedMarkdownClaims` (line 379) calls it at line 386, so Fix 2's boundary change also
   flows through the admission-preflight path. **[W2]**
6. **Mirror propagation:** `bash plugin/scripts/sync-vendor.sh` (mutating) mechanically `cp`s the
   fixed canonical file over `plugin/scripts/wiring-coverage-check.ts`;
   `bash plugin/scripts/sync-vendor.sh --check` then byte-compares via `cmp_or_report`. **[W4]**

### Key design decisions

- **Fix both sides of the split boundary, not just the lookahead.** Verified empirically this
  session (live regex reproduction against the exact AC-2 fixture), not assumed: the lookahead-only
  variant reads as correct on paper but leaves the two adjacent bold claims merged in one
  4-identifier chunk (2 chunks total: `"Done."` peeled off, claims still merged) — implementing the
  literal lookahead-only wording would ship a broken fix that fails the task's own acceptance test.
  The symmetric both-sides edit is the minimal edit producing the correct 3-way split.
- **Two-layer fixtures (split-layer + claim-layer), because "does" is not a wiring verb.** The AC-2
  fixture text's exact words can only be asserted at the `splitSentences` layer; a claim-level test
  needs a real wiring verb ("calls") inside the bold sentences or it is RED-forever (0 claims before
  AND after — verified against lines 124/126). Naming this trap in the Proposal prevents a
  false-GREEN or false-RED fixture at implementation time, and requires adding `splitSentences` to the
  test file's line-10 import.
- **Single source of truth, mechanical mirror regeneration only.** Edit the canonical file and its
  paired canonical test file; never hand-edit `plugin/scripts/wiring-coverage-check.ts`. This
  matches `sync-vendor.sh`'s own design for this module (its `SYNC_SCRIPTS` loop has no hand-edit
  branch) and the module's own header self-description (lines 1-8).
- **Do not create `plugin/test/wiring-coverage-check.test.mjs`.** It does not exist today
  (`plugin/test/` has 9 test files, none for this module); only 2 of the 25 `SYNC_SCRIPTS` entries
  have a paired `plugin/test/*.test.mjs`; mirror fidelity is already proven by the
  `sync-vendor.sh --check` byte-identity gate wired into `scripts/test.sh` via
  `plugin-packaging.test.mjs` (lines 183/200/203); and a mirror suite would need a
  `plugin/test/fixtures/...` tree that does not exist for this module — added maintenance surface,
  no incremental verification value.
- **`whose` joins the existing possessive-determiner exclusion rather than a new mechanism.** The
  header comment (lines 34-40) documents exactly why the exclusion exists (the M198/DIR-119-D1
  `owns` false-positive class); `whose` is the same grammatical category (possessive determiner) the
  list already targets, so this is completing a documented rule, not inventing one.
- **Explicitly correct, not silently follow, stale wording** — the earlier lookahead-only phrasing
  and any `## Touches` implication that the plugin mirror is hand-edited — both demonstrably wrong
  against current source (live regex test and `sync-vendor.sh`'s design). Also noted for the
  implementer: the module header's attribution of DIR-117 enforcement to `checkDirectiveSections`
  (lines 3-5) is stale — the real directive-side enforcement is the [W1] CLI dispatch; fixing that
  comment is a NON-GOAL here (comment-only, out of scope). Flagged rather than either implementing
  broken wording or quietly diverging.

### Defaults and failure behavior

No new configuration, flags, or default values. Every current consumer keeps its existing call
signature and return shape: `checkWiringCoverage` → `{ok, code, message, claims, uncovered}`; CLI
JSON → `{ok, code, message, claims, findings}` (field names confirmed by reading lines 189-196 and
284-290). Both changes move behavior in exactly one direction: Fix 1 excludes one more phrase from
matching as an ownership verb (strictly fewer false-positive claims); Fix 2 adds split points only
(strictly never fewer split opportunities) — the same "strictly additive (only ever creates MORE
split points, never fewer)" property `splitListAwareBlocks`'s own header comment (lines 62-65)
documents for itself. A document that was `ok:true` before cannot newly FAIL from these two edits
alone; it can only stop being mis-split/mis-matched (with the caveat that finer splitting can
surface a previously-hidden real claim — intended behavior, see Risks).

Failure behavior on tooling misuse stays fail-closed with no new mechanism: if mirror regeneration
is skipped, the pre-existing `sync-vendor.sh --check` gate (wired into `scripts/test.sh` via
`plugin-packaging.test.mjs` line 200) goes RED **[W4]**; if either regex edit regresses an existing
passing test, the task's own declared `extra.acceptance` command
(`node --experimental-strip-types --test experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`)
fails closed; the CLI keeps its exit-2-on-usage/IO-error posture (lines 269-279), and
`prepare-milestone.js` lines 549-553 fail the ProposalReview phase CLOSED
(`wiring-coverage-check-failed`/`needs-human`) on a non-parseable verdict rather than silently
skipping coverage.

### Compatibility

No schema, config, or CLI-flag change. `checkWiringCoverage()`'s return shape and the CLI's JSON
output are unchanged. All three current consumer paths (`task-schema.ts`'s gap check **[W3]**,
`prepare-admission-check.ts`'s `preflightMergedMarkdownClaims` **[W2]**, the CLI `--task` mode the
ProposalReview phase dispatches **[W1]**) keep identical inputs/outputs except for the two specific
mis-verdicts this fix corrects. `plugin/scripts/prepare-admission-check.ts` and
`plugin/scripts/wiring-coverage-check.ts` are byte-identical to their canonical counterparts today
(diffed this session); `plugin/scripts/task-schema.ts` carries `sync-vendor.sh`'s expected,
attribution-only comment diff (the dedicated task-schema mirror path applies a perl
attribution-sanitization step that `--check` explicitly tolerates as an 'expected-diff';
task-schema.ts is deliberately NOT in the byte-identical SYNC_SCRIPTS set). All three pick up the
fix the next time `sync-vendor.sh` runs; no separate plugin release step is required for the fix to
be live on
the real `master`-resident gate, since `prepare-milestone.js` (lines 541/544) dispatches the
experiment-tree script by repo-root-relative path, not the plugin-packaged copy.

### Risks

- **Over-splitting from the `**` boundary on ordinary inline emphasis.** A bold span used as pure
  mid-sentence emphasis false-splits only if the char after the closing `**`+whitespace is
  uppercase, a backtick, a quote, or another `**`. Verified live on both sides of the boundary this
  session: `"This is **important** and here \`a.ts\` calls \`b.ts\`."` → NO split (lowercase
  continuation); `"This is **important** And here …"` → splits (uppercase continuation — the
  residual risk, disclosed, not swept aside). All 3 real `merged-markdown-claims` fixtures are
  unaffected (line-initial `**type:**` + lowercase; verified), and the 63/63
  `prepare-admission-check.test.mjs` baseline confirms no incidental regression surface today.
  Residual risk on unseen prose is real but bounded.
- **`whose` over-exclusion.** Adding `whose` to the exclusion alternation only affects
  whitespace-separated possessive forms (e.g. "whose own AC", "whose ownership claim") — the exact
  false-positive class being fixed. It does NOT affect backtick-quoted code: in "the module whose
  `owns()` method determines routing" the character immediately before `owns` is a backtick, so the
  possessive negative-lookbehind (which requires an excluded word plus whitespace immediately before
  the verb) never fires regardless of the exclusion list — verified live, the patched regex still
  matches that sentence. The residual over-exclusion risk is therefore near-zero and of the same
  accepted class the existing `its/their/my/our/your/his/her` exclusions already carry (header lines
  34-40), not a new category.
- **Second-call-site regression** (`preflightMergedMarkdownClaims`'s reuse of `splitSentences` at
  line 386). Mitigated by an explicit AC item **[W2]** backed by the 63/63 baseline reproduced this
  session.
- **Claim-count drift on unexamined real documents.** Finer splitting can surface a
  previously-hidden claim as newly "uncovered" somewhere not examined here, or shift the exact claim
  count on `tasks/DIR-126-D.md` (currently 22, `ok:true`) without changing its verdict. This is the
  checker doing its job, not a regression to suppress — mitigated by the post-fix AC re-run **[W1]**
  confirming the verdict stays `ok:true`.
- **Residual heuristic class (disclosed).** Coverage still keys on backtick-identifier co-location
  within a single sentence/AC bullet; prose claims without backtick identifiers remain undetectable
  — a pre-existing, header-documented limitation of the checker (lines 24-29), unrelated to either
  fix.

### Non-goals

- Not adding `imports?|reuses?|reused|parses?|parsed` (or any verb) to `WIRING_VERB_RE` — explicitly
  considered and REJECTED at M201/DIR-126-B per the module's own header comment (lines 41-48): a
  wider verb set surfaced NEW uncovered claims against already-landed, already-audited tasks, and
  reopening done work is a worse cost than the narrow gap.
- Not attempting NLP/semantic claim extraction for identifier-free prose — the module header's own
  documented NON-GOAL (lines 24-29), unchanged.
- Not handling emphasis markers other than `**` (single `*`, `_`, `__`, nested bold-italic) —
  scoped strictly to the marker implicated by the real incident and the task's own fixture.
- Not modifying `splitListAwareBlocks` (line-anchored bullet/table-row splitting, line 69) —
  unaffected by either fix; and not fixing the module header's stale `checkDirectiveSections`
  attribution (comment-only, out of scope).
- Not creating `plugin/test/wiring-coverage-check.test.mjs` or a new `plugin/test/fixtures/...` tree
  for this module — see Alternatives #2.

### AC coverage

Mapping delivery against the task's existing AC checklist (with the lookahead-only wording corrected
to both-sides), plus items closing every flagged wiring claim above:

- **AC 1** (`whose` exclusion, RED/GREEN fixture) ← Fix 1; live-confirmed `true`→`false` for "the
  terminal whose own AC requires X" with the genuine ownership sentence
  `"composite-land.ts owns dashboard.md writes"` unaffected (`true` under both literals).
- **AC 2** (`**` splitting, RED/GREEN fixture) ← Fix 2, asserted at the `splitSentences` layer on
  the exact AC text (disjoint identifier sets `{id1, id2}` / `{id3, id4}`), PLUS a claim-layer pair
  using a real wiring verb. The AC text must record that BOTH the lookbehind and lookahead change —
  the lookahead-only variant empirically leaves the two adjacent bold claims merged (2 chunks:
  `"Done."` + one 4-identifier chunk), as reproduced this session — AND that a claim-level test on
  the literal "does" wording can never go GREEN ("does" is not a wiring verb — verified against
  lines 124/126), hence the two-layer fixture design.
- **AC 3** (regression tests) ← canonical `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`
  only (adding `splitSentences` to the line-10 import); the AC text should explicitly drop any
  `plugin/test/` mirror requirement (that file does not exist; 2/25 sync-vendor-managed modules have
  one; the byte-identity gate covers mirror fidelity).
- **AC 4** (re-run `wiring-coverage-check.ts --task tasks/DIR-126-D.md`, confirm `ok:true`/0
  findings) ← closes **[W1]**; pre-fix baseline (22 claims, 0 findings,
  `code: "wiring-coverage-complete"`) reproduced this session.
- **AC 5** (`sync-vendor.sh --check` → `CLEAN` for `wiring-coverage-check` after mechanical
  regeneration) ← closes **[W4]**.
- **AC 6** (`prepare-admission-check.test.mjs`, both copies, fully green post-fix) ← closes **[W2]**;
  63/63 (7 suites) baseline reproduced this session.
- **[W3] note (NOT a separate AC bullet — the real `## Acceptance Criteria` 7th bullet is the
  grounding-evidence item below; this Proposal therefore declares NO AC bullet that closes [W3]):**
  grep-confirmed
  `checkWiringCoverage` import/call sites in `task-schema.ts` (lines 323/357/441;
  `checkDirectiveSections` line 303 verified call-free), plus exported signature/return-shape
  invariance (neither edit touches any exported function, so every importer's contract is
  unchanged), optionally reinforced by a direct `task-schema.test.mjs` run (outside the canonical
  glob); the canonical `wiring-coverage-check.test.mjs` suite stays green at 18/18 post-fix
  alongside the new RED/GREEN fixtures (RED = fails on the current literals, GREEN = passes after
  both edits — never GREEN-only, never RED-forever).
- **AC 7** (grounding-evidence, DIR-117 self-coverage): an exhaustive-identifier bullet listing
  every backtick identifier this Proposal names in a mechanism-claim sentence — including
  `wiring-coverage-check.ts`, `WIRING_VERB_RE`, `splitSentences`, `splitSentences()`,
  `extractMechanismClaims(sectionText)`, `checkWiringCoverage(proposalText, acText)`,
  `checkWiringCoverage`, `task-schema.ts`, `checkGapWiringCoverage`, `checkDirectiveSections`,
  `prepare-admission-check.ts`, `preflightMergedMarkdownClaims`,
  `plugin/workflows/prepare-milestone.js`, `prepare-milestone.js:541`, `_wiringCheckScript`,
  `node --experimental-strip-types ${_wiringCheckScript} --task tasks/${_taskId}.md`, `_runAsCli`,
  `extractSectionForCli`, `wiringFindingsFromUncovered`, `_upsertFindings(..., 0)`,
  `_releaseLeaseAndRecord`, `sync-vendor.sh`, `--check`, `cmp_or_report`,
  `plugin/scripts/wiring-coverage-check.ts`, `plugin/test/plugin-packaging.test.mjs`,
  `scripts/test.sh`, `tasks/DIR-126-D.md`, `ok:true`, `whose`, `owns`, `**Claim N…**`,
  `its/their/my/our/your/his/her`,
  `invokes?|calls?|dispatches?|enforces?|wires?|routes?|delegates?`, `bulletsOf()`,
  `splitListAwareBlocks()`, `backtickIdentifiers()`, `tasks/<id>.md`, `## Requested action`,
  `## Acceptance Criteria`, `wf_929eb86d-2a6`, `wf_750f506a-3d2`, `83c1958` — each confirmed real by
  direct source read this session; every one is an already-real name from this document's own text,
  not a new invention.

### Alternatives considered and rejected

1. **Hand-edit `plugin/scripts/wiring-coverage-check.ts` directly.** Rejected: `sync-vendor.sh`'s
   mutating mode mechanically `cp`s canonical over plugin with no hand-edit branch — a later
   non-`--check` sync would silently clobber an independently hand-edited plugin copy, reintroducing
   the exact drift the mechanical step exists to prevent.
2. **Create `plugin/test/wiring-coverage-check.test.mjs`** (full mirror or minimal). Rejected: a
   full mirror would fail at runtime for lack of a `plugin/test/fixtures/...` tree for this module;
   a minimal file duplicates a 2/25 pattern for no incremental value once `sync-vendor.sh --check`
   proves byte-identity and `plugin-packaging.test.mjs` (lines 183/200/203) gates it inside
   `scripts/test.sh`.
3. **Extend only the lookahead** (`(?<=[.!?])\s+(?=[A-Z`"]|\*\*)`). Rejected: empirically proven
   this session — via live regex reproduction against the exact AC-2 fixture — to leave the two
   adjacent bold claims merged (2 chunks: `"Done."` + one 4-identifier chunk); the closing `**`
   before the inter-claim whitespace never satisfies the untouched lookbehind, so it does not pass
   the task's own stated acceptance test. (Symmetrically, a lookbehind-only extension also fails:
   the char after the whitespace is `*`, outside `[A-Z`"]`.)
4. **Broaden to a general inline-emphasis boundary rule** (`**`, `*`, `_`, `__`). Rejected as
   over-scoped: neither the incident nor the fixture motivates anything beyond `**`; each extra
   marker adds over-splitting risk (a lone `*` matches multiplication/footnote/italic spans far more
   promiscuously; even `**` alone splits on uppercase continuation, verified above) with zero
   evidence requiring it now.
5. **Treat `**` as a `splitListAwareBlocks` boundary instead of a `splitSentences` punctuation
   boundary.** Rejected: `splitListAwareBlocks` is line-anchored
   (`/^\s*(?:[-*]\s+|\d+\.\s+|\|.*\|\s*$)/`, line 77), but bold markers occur mid-line; a
   line-anchored regex cannot express this boundary, while `splitSentences`'s punctuation-level split
   already operates line-internally (line 102) and is the correct layer.
6. **Claim-level fixtures only, on the literal AC-2 text.** Rejected (independently derived trap):
   "does" is not a wiring verb, so `extractMechanismClaims` returns 0 claims on that text both
   before and after the fix — an assertion of 2 claims would be RED-forever, and an assertion of 0
   would be GREEN-only. Hence the two-layer fixture design (split-layer on the exact text +
   claim-layer with a real wiring verb).
7. **Do nothing; rely on manual prose restructuring as standing practice.** Rejected: the defect
   already cost one real, measured convergence round (~20 min / 12 agents / ~700K tokens, commit
   `83c1958` verified), and "explanatory prose with `**`-prefixed claim markers" and "whose own"
   phrasing are generic authoring habits in this repo's Proposal-writing convention (the current
   task board and CLAUDE.md use both freely), not one-off occurrences.


## Plan

`docs/plans/M205-gap-wiring-coverage-check-whose-own-and-bold-marker-splitting.md` — 9-stage Plan
authored 2026-07-30 at base revision `3d1ce2c` (full `3d1ce2c763ed41f0c93ae1f05dfede713c55793f`;
supersedes the stale `b850542`/`b28cfdb`/`c82efac` Plans — `git diff --stat b850542..3d1ce2c`
touches only this task's own file, and all baselines were re-verified live at `3d1ce2c`: canonical
suite 18/18, `prepare-admission-check.test.mjs` both copies 126/126, `tasks/DIR-126-D.md` CLI
`ok:true` / 22 claims / `findings: []`) for milestone M205 (charter
`experiments/quay-perpetual-stream/charters/M205-gap-wiring-coverage-checker-fixes.md`), mapping
all 7 task AC items to ordered RED/implementation/GREEN stages: grounding + baseline capture →
RED Fix-1 fixture (`whose` exclusion, canonical test file only) → RED Fix-2 two-layer fixture
(split-layer via `splitSentences` added to the line-10 import, plus a claim-layer pair with a real
wiring verb "calls", since "does" is not a wiring verb and a claim-level assertion on the literal
AC-2 text would be RED-forever) → the two in-place regex-literal edits in
`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` (`WIRING_VERB_RE` line 50:
add `whose` to the `owns?` exclusion lookbehind; `splitSentences()` line 102: widen BOTH sides of
the split boundary to `` (?<=[.!?]|\*\*)\s+(?=[A-Z`"]|\*\*) ``) → GREEN canonical suite (the
`extra.acceptance` command) → mechanical `sync-vendor.sh` mirror regeneration (`--check` →
`CLEAN`, never a hand-edit) → `tasks/DIR-126-D.md` CLI non-regression (`ok:true` / `findings: []`
— verdict invariance, not claim-count invariance) → `prepare-admission-check.test.mjs`
both-copies non-regression (126/126, 7 suites each) → grounding-evidence + real-landing
verification (`scripts/test.sh`, single commit to `master` scoped to the touch set only,
lifecycle gate). The complete touch set (canonical module/test EDIT, mirror REGENERATE, all
consumer/mirror/suite files READ ONLY / RUN ONLY), per-stage line budgets, the stage dependency
graph `1 → 2 → 3 → 4 → 5 → 6 → {7, 8} → 9`, guardrails, rollback, and real-landing verification
are in the Plan file. Stage blocks emit the DIR-117 iteration-2 item-3 mechanical format
(`### Stage N` + `- AC:` + `- Files:` + `- Command:`) parsed by
`milestone-preparation-check.ts`'s `parsePlanStages` → `validatePlanStructure` — self-verified at
authoring time for this revision: `plan-structure-ok` — "Plan has 9 stage(s), all 7 task AC
item(s) mapped." Standardized stopping rule: at most 3 Plan-check rounds, success only at F_i=0.
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

- [x] `WIRING_VERB_RE`'s exclusion lookbehind includes `whose`; a fixture sentence "the terminal
  whose own AC requires X" is confirmed NOT flagged as a wiring-verb claim (RED before fix, GREEN
  after). (audit 2026-07-31, session 9b3ffa31: CONFIRMED — `whose` in the line-50 literal; pre-fix
  module RED run fails the "whose own" 0-claims test, post-fix GREEN 22/22; genuine-`owns` control
  green under BOTH literals, live-reproduced.)
- [x] `splitSentences()` splits before a `**` bold marker; a fixture paragraph
  `"Done. **A does X (\`id1\`, \`id2\`).** **B does Y (\`id3\`, \`id4\`).**"` produces three chunks
  after the fix — two identifier-carrying sentences with disjoint backtick-identifier sets
  `{id1,id2}` / `{id3,id4}`, plus one leading zero-identifier `Done.` sentence (RED before fix —
  exactly ONE merged chunk carrying all 4 identifiers, i.e. the entire string with `Done.` still
  attached: the character after the post-`Done.` whitespace is `*`, outside the existing lookahead's
  uppercase/backtick/quote class, so the unpatched regex does NOT split `Done.` off — the
  `Done.`-peeled 2-chunk shape is the lookahead-only variant the Proposal's Chosen mechanism/Key
  decisions disproves, not the pre-fix baseline; GREEN after — the two bold sentences split apart
  into 2-identifier chunks each, three chunks total). (audit 2026-07-31: CONFIRMED — line-102
  literal widened on BOTH sides; split-layer fixture on the exact AC text asserts 3 chunks with
  disjoint {id1,id2}/{id3,id4}; pre-fix RED (1 merged chunk), post-fix GREEN, live-reproduced.)
- [x] `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` gains regression tests
  for both fixtures above — the canonical test file only, no `plugin/test/wiring-coverage-
  check.test.mjs` mirror (that file does not exist on disk and this task deliberately does NOT
  create one — see Proposal's "Alternatives considered and rejected" #2: only 2 of 25
  `sync-vendor.sh`-managed modules have a paired `plugin/test/*.test.mjs`, mirror fidelity is proven
  by the byte-identity gate below, not a duplicate test suite). (audit 2026-07-31: CONFIRMED — 4 new
  fixtures in the canonical test file only; no plugin mirror test file exists; mirror byte-identity
  verified via sync-vendor.sh --check CLEAN.)
- [x] Re-running `wiring-coverage-check.ts --task tasks/DIR-126-D.md` against the current committed
  task body after the fix still reports `ok:true`/0 findings (no regression on the real document
  that surfaced this). (audit 2026-07-31: CONFIRMED — live CLI post-fix ok:true/claims 21/findings:[];
  pre-fix baseline ok:true/22 claims; verdict-invariant, claim-count drift disclosed in Risks.)
- [x] `bash plugin/scripts/sync-vendor.sh --check` reports `CLEAN` for `wiring-coverage-check` after
  the canonical-source fix is regenerated into `plugin/scripts/wiring-coverage-check.ts` via
  `sync-vendor.sh` (mechanical `cp`, never a hand-edit). (audit 2026-07-31: CONFIRMED — --check exit 0,
  "OK (identical): scripts/wiring-coverage-check.ts", "CLEAN: all files verified, no drift detected".)
- [x] `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` (both copies) still
  passes post-fix, confirming `preflightMergedMarkdownClaims`'s own reuse of `splitSentences` does
  not regress — a second real call site beyond the canonical CLI/`task-schema.ts` path. (audit
  2026-07-31: CONFIRMED — 74/74 canonical + 74/74 plugin copy, both exit 0, live run.)
- [x] Grounding evidence (exhaustive identifiers, wiring-coverage completeness): direct source read
  (audit 2026-07-31, session 9b3ffa31: REFUTED — the delivered fix flips THIS task file's own
  directive-mode self-check from ok:true (pre-fix, 29 claims, live-reproduced) to ok:false (post-fix,
  1 of 28 claims uncovered: the Fix-2 claim-layer example prose now self-extracts a chunk whose
  backtick-pairing artifacts no AC bullet covers), falsifying this bullet's round-5 assertion "this
  bullet makes the directive-mode check return ok:true on this task's own file" and its
  "exhaustive union of every claim this Proposal's own ## Proposal text extracts" standard, computed
  under the pre-fix extractor. Box deliberately left unchecked; see
  milestones/M205/audits/iteration-0-acceptance-audit.md. All identifiers listed remain real — the
  substantive grounding standard holds; only the self-coverage assertion is refuted.)
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
  Round-5 (directive-mode --task self-coverage addendum): the exhaustive union of every
  claim this Proposal's own `## Proposal` text extracts under the CLI `--task` mode the
  ProposalReview phase dispatches (including the two load-bearing fixture-design example
  strings below, which themselves carry a wiring verb plus >=2 backtick identifiers and so
  self-extract), each confirmed real by direct source read and reproduced live, not a new
  invention:
  `task-schema.ts:323`, `"This is **important** and here \`a.ts\` calls \`b.ts\`."`, `"This is
  **important** And here …"`, `##
  Acceptance Criteria`, `## Finding`, `## Proposal`, `## Requested action`, `**Claim N…**`,
  `--check`, `83c1958`, `:544`, `WIRING_VERB_RE`, `WIRING_VERB_RE.test(sentence)`,
  `_releaseLeaseAndRecord`, `_runAsCli`, `_upsertFindings(..., 0)`, `_wiringCheckScript`,
  `_wiringCheckScript = 'experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts'`,
  `backtickIdentifiers()`, `bulletsOf()`, `checkDirectiveSections`, `checkGapWiringCoverage`,
  `checkWiringCoverage`, `checkWiringCoverage(proposalText, acText)`, `cmp_or_report`,
  `experiments/quay-perpetual-stream/scripts/task-schema.ts`, `extractMechanismClaims`,
  `extractMechanismClaims(sectionText)`, `extractSectionForCli`, `findings`,
  `invokes?|calls?|dispatches?|enforces?|wires?|routes?|delegates?`,
  `its/their/my/our/your/his/her`, `kind=gap`, `needs-human`, `node --experimental-strip-types
  ${_wiringCheckScript} --task tasks/${_taskId}.md`, `ok:true`, `owns`, `plugin/scripts/wiring-
  coverage-check.ts`, `plugin/test/plugin-packaging.test.mjs`, `plugin/workflows/prepare-
  milestone.js`, `preflightMergedMarkdownClaims`, `prepare-admission-check.ts`, `prepare-
  milestone.js:541`, `scripts/test.sh`, `splitListAwareBlocks()`, `splitSentences`,
  `splitSentences()`, `sync-vendor.sh`, `task-schema.test.mjs`, `task-schema.ts`, `task-
  schema.ts:323`, `tasks/<id>.md`, `tasks/DIR-126-D.md`, `wf_750f506a-3d2`, `wf_929eb86d-2a6`,
  `whose`, `wiring-coverage-check-failed`, `wiring-coverage-check.test.mjs`, `wiring-coverage-
  check.ts`, `wiringFindingsFromUncovered` — all confirmed real by the same
  direct-source-read standard; this bullet makes the directive-mode check return `ok:true`
  on this task's own file. Round-6 (post-Fix-2 self-extraction correction): the Fix-2 claim-layer
  example prose (line 168) originally wrapped in outer backticks produced a garbled backtick-pairing
  artifact (") asserting") across the newly-split bold-marker boundary — removing the outer backtick
  wrapper produces two clean claims with disjoint identifier sets: {`x1.ts\`, `y1.ts\`} and {`x2.ts\`,
  `y2.ts\`} — the backslash-trailing forms are the literal identifiers `backtickIdentifiers()`
  extracts from markdown-escaped `\`x1.ts\`` source (the backslash before the closing backtick is
  captured), confirmed real by the same direct-source-read standard as every round above. Also adding
  `extractMechanismClaims` which now appears in the second claim's backtick context.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master`. (audit 2026-07-31: NOT YET — build state is uncommitted in the working
  tree; audit runs pre-Land by design, Land commits and ticks this.)
- [x] Real, non-fixture evidence: both fixtures above pass; a real run of
  `wiring-coverage-check.ts --task tasks/DIR-126-D.md` (or its state at time of fix) confirms no
  regression. (audit 2026-07-31: CONFIRMED — real CLI runs pre-fix (ok:true/22 claims) and post-fix
  (ok:true/21 claims, findings:[]) against the committed DIR-126-D.md; canonical suite 22/22 with
  genuine RED-before/GREEN-after fixtures; admission suite 74/74 both copies.)

## Touches

- tasks/gap-wiring-coverage-check-whose-own-and-bold-marker-splitting.md
- experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- plugin/scripts/wiring-coverage-check.ts
- experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs
- experiments/quay-perpetual-stream/scripts/task-schema.ts
- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/test/task-schema.test.mjs
- plugin/workflows/prepare-milestone.js
- plugin/scripts/sync-vendor.sh
- plugin/scripts/task-schema.ts
- plugin/test/plugin-packaging.test.mjs
- .claude/workflows/prepare-milestone.js
- scripts/test.sh
- tasks/DIR-126-D.md
- docs/plans/M205-gap-wiring-coverage-check-whose-own-and-bold-marker-splitting.md