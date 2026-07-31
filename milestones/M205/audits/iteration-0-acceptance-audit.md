# M205 iteration-0 acceptance audit — gap-wiring-coverage-check-whose-own-and-bold-marker-splitting

**Audit session id:** 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1

**Verdict: REFUTED** (6 of 7 AC confirmed; AC 7 refuted; mechanical gate exit 1 — REFUTED by construction)

**Date:** 2026-07-31 · **Auditor:** fresh-context adversarial acceptance subagent (refute-first stance)
**Charter:** experiments/quay-perpetual-stream/charters/M205-gap-wiring-coverage-checker-fixes.md
**Task:** tasks/gap-wiring-coverage-check-whose-own-and-bold-marker-splitting.md
**Milestone root:** milestones/M205 (resolved via `gate_resolve_milestone_root 205`)

## Method & independence disclosure

Every verdict below rests on the audit's OWN live executions against the working tree (HEAD
`1bc3160` + uncommitted Build changes), never on the implementer's iteration-0 self-report. The
RED baseline was reproduced faithfully WITHOUT touching the working tree: a temp copy of
`experiments/quay-perpetual-stream/` with the module restored from `git show HEAD:` (pre-fix
literals verified by grep: no `whose` in the lookbehind, old split regex at line 102).

**Independence disclosure (required honesty):** this audit's `CLAUDE_CODE_SESSION_ID`
(`9b3ffa31-5bd7-4274-86f3-74def2f0a1f1`) is the SAME session whose task list carried the M205
Build phase (session tasks #47–#50). The audit was invoked as a fresh-context turn with no build
transcript; independence was maintained at the EVIDENCE level — all findings derive from the
audit's own runs, and the determining finding REFUTES the implementer's AC-7 self-report, which is
the strongest available demonstration of substantive independence. The absorb-entry deliberately
carries NO `## Audit-independence check` section (it0-dod-check clause 12 therefore records a
documented no-op N/A); this audit refutes that no-op's implicit "no audit ran" reading HEREBY,
with the session-overlap disclosed rather than papered over by a self-congratulatory section.

## AC satisfaction (refute-first)

### AC 1 — `whose` in `WIRING_VERB_RE` exclusion; "whose own" not a claim (RED/GREEN) — **CONFIRMED**

- Source: canonical module line 50 literal is now
  `(?<!(?:'s|s'|its|their|my|our|your|his|her|whose)\s)\bowns?\b` (git diff: exactly one word
  added; verb branch and `/i` flag untouched).
- RED: pre-fix module (temp tree at HEAD) — the new "whose own" 0-claims test FAILS
  (`extractMechanismClaims("The terminal whose own AC requires `a.ts` and `b.ts` stays out of
  scope.")` returns a claim under the old literal).
- GREEN: post-fix canonical suite 22/22.
- Strict narrowing: the genuine-`owns` control test passes under BOTH literals (asserts 1 claim,
  identifiers `{composite-land.ts, dashboard.md, x.ts, y.ts}`).

### AC 2 — `splitSentences()` splits before `**` on BOTH sides; AC-2 paragraph → 3 chunks, disjoint sets — **CONFIRMED**

- Source: line 102 literal is now `/(?<=[.!?]|\*\*)\s+(?=[A-Z`"]|\*\*)/` (symmetric both-sides
  widening, exactly as the Requested action demanded; the lookahead-only variant was disproved at
  Proposal adjudication).
- RED: pre-fix module — split-layer test on the EXACT AC text
  `"Done. **A does X (`id1`, `id2`).** **B does Y (`id3`, `id4`).**"` FAILS (1 merged chunk).
- GREEN: post-fix — 3 chunks `["Done.", "**A does X (`id1`, `id2`).**", "**B does Y (`id3`,
  `id4`).**"]` with disjoint identifier sets `{id1,id2}` / `{id3,id4}` (asserted in the test,
  verified live).
- Claim-layer pair (real wiring verb "calls"): RED pre-fix (1 merged 4-identifier claim) / GREEN
  post-fix (2 disjoint claims `{x1.ts,y1.ts}` / `{x2.ts,y2.ts}`).

### AC 3 — regression tests in the canonical test file only, no plugin mirror — **CONFIRMED**

- 4 new tests added to `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs`
  (which also adds `splitSentences` to the line-10 import, per the Proposal).
- `plugin/test/wiring-coverage-check.test.mjs` does NOT exist (directory listing verified — 9
  test files, none for this module). Mirror fidelity instead proven by the byte-identity gate
  (AC 5).

### AC 4 — CLI vs `tasks/DIR-126-D.md` still `ok:true`/0 findings — **CONFIRMED**

- Post-fix live: `{ok:true, code:"wiring-coverage-complete", claims:21, findings:[]}`, exit 0.
- Pre-fix baseline (temp tree, HEAD module): `ok:true`, 22 claims, 0 findings — matches the
  Proposal's claimed baseline exactly.
- Claim count drifted 22→21 (finer `**` re-chunking); verdict INVARIANT, which is what the AC
  requires ("still reports ok:true/0 findings") and what the Proposal's Risks section explicitly
  disclosed as acceptable ("verdict invariance, not claim-count invariance").

### AC 5 — `sync-vendor.sh --check` CLEAN after mechanical regeneration — **CONFIRMED**

- Live: `bash plugin/scripts/sync-vendor.sh --check` → exit 0, `OK (identical):
  scripts/wiring-coverage-check.ts`, `CLEAN: all files verified, no drift detected`.
- Independent corroboration: `diff` canonical vs plugin mirror → byte-identical.

### AC 6 — `prepare-admission-check.test.mjs` both copies pass — **CONFIRMED**

- Live: canonical copy 74/74 pass / 0 fail, exit 0; plugin copy 74/74 pass / 0 fail, exit 0
  (148 total — consistent with iteration-0's "148/148 both copies"; the Proposal's older "63/63"
  figure predates suite growth, non-issue).

### AC 7 — grounding evidence / wiring-coverage completeness — **REFUTED**

The AC's substantive grounding standard holds (every backtick identifier the bullet enumerates is
a real, source-confirmed name — I relied on several in this audit). But the bullet's binding
self-coverage assertion is empirically FALSE under the shipped code:

- AC 7's round-5 addendum asserts: "this bullet makes the directive-mode check return `ok:true`
  on this task's own file", and defines its evidence as "the exhaustive union of every claim this
  Proposal's own `## Proposal` text extracts under the CLI `--task` mode".
- Live POST-fix: `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/
  wiring-coverage-check.ts --task tasks/gap-wiring-coverage-check-whose-own-and-bold-marker-
  splitting.md` → **`ok:false`, `wiring-coverage-uncovered`, 1 of 28 claims uncovered**.
- Live PRE-FIX (temp tree at HEAD module, SAME task file): **`ok:true`, 29 claims, 0 findings**.
  The flip is CAUSED by the delivered fix.
- Mechanism: Fix 2's both-sides `**` boundary splits the Proposal's Fixture-design bullet at
  `y1.ts`.**` + whitespace + `**B`, so the claim-layer EXAMPLE prose
  (`**B calls `x2.ts` from `y2.ts`.**`") asserting `extractMechanismClaims` yields 2 claims …`)
  becomes its own extracted claim (verb "calls" + ≥2 backtick identifiers). Its identifier set
  under `/`([^`]+)`/g` is `{x2.ts, y2.ts, ") asserting"}` — the third element is a backtick-
  pairing artifact of the escaped example string — and `checkWiringCoverage` requires EVERY
  identifier as a substring of one evidence-carrying AC bullet; no AC bullet contains
  `") asserting"`, so the claim is mechanically uncovered.
- The round-5 union was computed under the PRE-fix extractor (it was authored during
  ProposalReview, before either fix existed). Under the shipped extractor it is no longer
  exhaustive — the AC text is stale with respect to the very fix it describes.
- The Build's iteration-0 AC-7 disposition ("Done: the exhaustive-identifier union lives in the
  task's own AC item 7") never re-ran the self-check post-fix — the one execution the AC text
  itself invites.
- Blast radius (bounded, verified): the gap-path check this task is subject to as a `kind=gap`
  task (`checkWiringCoverage(Requested action, AC)`, the `task-schema.ts` [W3] surface) returns
  `ok:true` (1 claim, covered) POST-fix, so Land-phase lifecycle writes are not mechanically
  blocked; DIR-126-D stays ok:true (AC 4). The violation is confined to the task file's own
  directive-mode self-coverage assertion — but that is precisely the executable-vs-prose
  contradiction this repo's single-source-of-truth principle forbids landing on `master`.

This is an instance of the Proposal's OWN disclosed risk ("finer splitting can surface a
previously-hidden claim as newly 'uncovered' somewhere not examined here") — except the task's
own file was not "not examined": AC 7 examined it and asserted ok:true. The mitigation the
Proposal named ([W1] re-run) was scoped to DIR-126-D only.

## Charter done-when — **CONFIRMED**

"A fresh independent audit confirms both regex fixes are real, source-confirmed, and the new
regression fixtures actually fail before the fix and pass after (RED/GREEN, not GREEN-only)."
All three conjuncts verified live (see AC 1/2 evidence: pre-fix 3 fail / 19 pass of 22, genuine-
`owns` control green under both literals; post-fix 22/22; both literals read from source).

## Definition of Done

- **Landed on `master` — NOT CONFIRMED (left `- [ ]`).** The Build is UNCOMMITTED in the working
  tree (`git status`: modified canonical module/test/mirror/task-file; untracked
  `milestones/M205/iterations/`). iteration-0's Stage-9 row claims "single commit to `master`" —
  that commit does not exist; the claim is premature (audit runs pre-Land by design; Land owns
  this box).
- **Real, non-fixture evidence — CONFIRMED (ticked `- [x]`).** Real CLI runs against the
  committed `tasks/DIR-126-D.md` pre- and post-fix (verdict-invariant, ok:true both); live
  RED/GREEN fixtures; admission suites both copies.

## Mechanical gate (step 3)

`bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh gap-wiring-coverage-check-
whose-own-and-bold-marker-splitting experiments/quay-perpetual-stream/charters/M205-gap-wiring-
coverage-checker-fixes.md milestones/M205/absorb-entry.md` → **exit 1** (REFUTED by construction):

- `FAIL: clause0-ac-dod-present: checklist-form AC has 1 unchecked item(s) remaining
  (REFUTED-equivalent, HARD-blocks …): "Grounding evidence (exhaustive identifiers,
  wiring-coverage completeness) …"` — the deliberately-unticked AC 7.
- PASS: clause1 (adversarial-audit disposition present, verdict REFUTED), clause2 (V_meta
  consolidation-lag disposition — verbatim from `vmeta-lag-check.sh --counter 201`:
  "PASS: no confirmed-unconsolidated row past K without a dated carry-forward", exit 0),
  clause3 (line-budget), clause4 (impl-row N/A, not design-only), clause5 (no self-exemption),
  clause10 (tree-hygiene clean), clause11 (worktree-branch-hygiene clean).
- N/A: clause6, clause7, clause8 (no `milestone:M<N>` label — legacy task predates cutover),
  clause9, clause12 (no `## Audit-independence check` section — documented no-op; refuted-as-
  no-op by this artifact's independence disclosure above).

## Write-backs performed by this audit (steps 1a / 2a / 4)

- Task file: AC 1–6 ticked `- [x]` with per-item evidence citations; AC 7 left `- [ ]` with an
  inline REFUTED annotation; DoD evidence item ticked `- [x]`; DoD "Landed on master" left
  `- [ ]` with pre-Land annotation.
- `milestones/M205/absorb-entry.md`: "## Adversarial audit disposition (M205)" completed with
  `adversarial-audit disposition: REFUTED` + full rationale + `V_meta consolidation-lag:`
  verbatim script output. "## ABSORB gate run" left TBD (Land phase).
- `experiments/quay-perpetual-stream/dashboard.md`: one deviation row appended (REFUTED / machine
  / M205 / open / age 0) per DIR-017 Step 3 — caught-by machine (this audit's own finding; the
  Build did NOT disclose it).

## Non-determining observations (not verdict-relevant)

1. `tasks/T-ADR001-e2e-fixture.md` sits UNTRACKED in the working tree and is outside M205's
   touch set — possible residue of a concurrent/other-milestone dispatch (the exact shared-tree
   collision CLAUDE.md warns about). Not attributable to M205's Build; Land should confirm it is
   not swept into M205's commit.
2. The absorb-entry backlog row says "per the 22/25 SYNC_SCRIPTS convention" while the Proposal
   derives 25 entries with 2 paired (23/25 without). Cosmetic numbering slip in a generated row,
   non-binding.
3. iteration-0 Stage-9 "single commit to master" self-report contradicts the actual uncommitted
   tree — evidence the report was authored ahead of its commit step; the audit's DoD write-back
   reflects reality (uncommitted), not the report.

## Recommended repair path (implementer's call, not the audit's)

- (a) Qualify AC 7's round-5 assertion to disclose that post-fix the task's own Proposal prose
  self-extracts one artifact claim the union does not cover (honest stale-claim disclosure), OR
- (b) Restructure the Proposal's claim-layer example prose (e.g. break the backtick pairing that
  manufactures the `") asserting"` identifier, or move the example out of `## Proposal`) so the
  self-check honestly returns ok:true again.
- NOT acceptable: adding contrived AC text whose only purpose is to substring-cover
  `") asserting"` — that is gate-gaming the heuristic, the anti-pattern DIR-117 exists to prevent.

Until one of (a)/(b) lands and the self-check is re-run live (ok:true, or an honestly-qualified
assertion), AC 7 stays unchecked and the gate stays exit 1.
