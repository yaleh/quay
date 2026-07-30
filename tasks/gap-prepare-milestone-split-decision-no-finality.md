---
id: gap-prepare-milestone-split-decision-no-finality
title: prepare-milestone split recommendations use an unstable scalar count and
  have no hash-bound human decision finality
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

### Problem framing (grounded in current code)

`experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` (byte-identically mirrored in
`plugin/scripts/proposal-convergence.ts` — confirmed via `diff`, no divergence, both files the same
length) already implements DIR-125's bounded ProposalReview loop and DIR-126-C's generation-aware
resume (`decideResumeGeneration`, `CACHEABLE_TERMINALS`, `RESUME_POLICY_VERSION`).
`.claude/workflows/prepare-milestone.js` (byte-identically mirrored in
`plugin/workflows/prepare-milestone.js`) drives it. Four concrete gaps in that landed code produced
DIR-126-D/M203's real failure — 11 dispatches, one Admission rejection, one Preflight rejection, and
**nine** `split-recommended` terminals for substantially the same scope — and none of them is closed
by the resume machinery that already exists:

1. **Ungrounded scalar.** The round-0 full-review prompt (`prepare-milestone.js` line ~506) asks for
   `mechanismCount: <integer count of independently landable mechanisms>` — a bare self-reported
   number with no IDs, ownership, proof surface, or dependency structure behind it. `_splitCheck()`
   (`prepare-milestone.js:474-484`, mirrored as `checkSplitRecommendation()` in
   `proposal-convergence.ts:130-144`) trusts it directly:
   `if (Number.isFinite(mechanismCount) && mechanismCount > 2) return {recommend:true, code:'split-multi-mechanism', ...}`.
   Across DIR-126-D's real rounds 6/7/9/10 this scalar oscillated non-monotonically — **8 → 4 →
   (≤2, implicit — `split-multi-mechanism` simply did not fire that round, no explicit low count was
   reported) → 6** — for a task whose Proposal already names two independently landable mechanisms
   while A.1-A.5 are required call-site variants of one atomic terminal-write contract; nothing
   forces two reviewers to agree on what a "mechanism" even is. This is not paraphrase: the real
   commit messages record it verbatim. `a449053`'s subject/body states "mechanismCount bounced
   8->4->(implicit <=2)->6 across rounds 6/7/9/10"; `1170b25` states "Seventh real ProposalReview
   run: mechanismCount dropped 8->4"; the terminal ruling commit `b8b87c3`
   ("human-adjudicated SPLIT-OR-COMMIT final ruling (mechanismCount=2, frozen)") itself names the
   defect as "an LLM reviewer's own subjective per-round self-report, not a mechanical count."
   `git log --follow tasks/DIR-126-D.md` confirms 11 real dispatch rounds between `03cfcaf` and
   `b8b87c3` (2026-07-30 UTC), the majority (`a1208ca`, `993811c`, `03cfcaf`, and by the task body's
   own account rounds 6/7/9/10) tagged `split-recommended`.
2. **Raw-string subsystem clustering.** The same `_splitCheck()` groups blocking findings only by
   `f.subsystem` string equality (`groupBlockingBySubsystem`) and trips
   `split-subsystem-blocking-cluster` at `count >= 3`, with no notion that three findings might be
   three symptoms of one root-cause defect (the `wiring-coverage-check.ts` findings merged at
   `prepare-milestone.js:555` are a real example of this class).
3. **Split preempts repair.** `_splitCheck` runs on *every* iteration of the `while(true)` loop
   (`prepare-milestone.js:563-617`), including the very first (`_deltaRound === 0`, before any
   focused-revise/delta-review round has run). A mechanically repairable finding cluster gets zero
   chance to converge before the loop `break`s at line 568 — the exact machinery DIR-125 built for
   convergence (lines 579-616) never gets invoked for this class of finding.
4. **No decision finality distinct from mechanical caching.** DIR-126-C's `reuse-terminal` path
   (`decideResumeGeneration` step 9, `proposal-convergence.ts:305-323`) only suppresses a *repeat*
   generation when `charterHash`/`taskContractHash`/`proposalHash`/`reviewPolicyHash` are all
   byte-identical to a prior attempt — an automatic cache keyed on unchanged bytes, not a human
   COMMIT/SPLIT ruling. Directly verified: `taskContractHash = sha256(ac + dod + touches)`
   (`proposal-convergence.ts:494-500`), and that hash mismatch is evaluated at step 7, strictly
   BEFORE `reuse-terminal` is even considered — so a `taskContractHash` mismatch already forces
   `decideResumeGeneration` cold today, and any AC/DoD/Touches text edit, cosmetic or not, defeats
   the cache. It cannot help DIR-126-D's actual failure mode, where the Proposal *was* being revised
   between attempts (busting `proposalHash` nearly every round, per the real commit history
   `03cfcaf`…`ee4296f`, 2026-07-30 02:21–08:30 UTC) while the underlying scope was not materially
   changing. The eventual fix was a human prose ruling appended to `tasks/DIR-126-D.md` (commit
   `b8b87c3`, "frozen at this commit — not to be re-litigated", closing with an explicit plea to
   future humans: "cite this paragraph, do not re-open the count question from scratch") — a ruling
   that **no code path reads or enforces**.

This is not hypothetical: it is the exact, dated, git-log-verifiable failure this task's Finding
describes, on code that already included DIR-126-C's generation-aware resume (M202, landed
2026-07-29) — resume alone did not fix it because the defect is a **grouping/counting/finality**
problem, not a **caching** problem, and no existing mechanism addresses any of the three.

### Chosen mechanism

Four additive changes to `proposal-convergence.ts` (+ mirror) and `prepare-milestone.js` (+
mirror), preserving the established "pure logic module + inline-duplicated workflow-script twin"
pattern DIR-125/DIR-126-C already use, none of which replace the existing bounded-convergence
loop — they sit inside/around it, and every new input degrades to today's behavior when absent.

**(A) Typed mechanism inventory, mechanically-derived count.** The full-review agent's structured
output gains
`mechanisms: [{id, owner, proofSurface, dependsOn: [id...], independentlyShippable: boolean, rationale}]`,
replacing the bare `mechanismCount` field in both the prompt and schema. The reviewer's job is to
group call sites into candidate mechanisms per the grouping rule in Requested action item 2 (a
required call-site variant of one atomic behavior contract is folded into ONE entry unless a strict
subset can ship independently with a complete safety contract) and judge `independentlyShippable`
per entry — not to self-report a bare integer.

A new pair of pure functions in `proposal-convergence.ts` (inlined as `_deriveMechanismInventory`/
`_hashMechanismInventory` in both workflow mirrors, same convention as `_splitCheck`):
- `deriveMechanismInventory(mechanisms)` fails closed (`mechanism-inventory-invalid`) on a
  duplicate `id`, a dangling `dependsOn` edge, or two entries sharing an identical `proofSurface`
  (guards against gaming the count by splitting one provable contract into cosmetically distinct
  "mechanisms" — backs AC3's "distinct proof surface" requirement). On success it returns
  `{ok:true, count, inventoryHash}`, where `count = inventory.filter(m => m.independentlyShippable).length`
  — **never a trusted reviewer integer, on any production branch** (AC1). `_splitCheck`/
  `checkSplitRecommendation` is changed to accept `mechanismInventory` and calls this derivation
  itself; `mechanismCount` as a trusted input is removed from every non-legacy production path.
- a *missing* `mechanisms` field (absent, not an explicit `[]`) is a NEW fail-closed terminal,
  `needs-human`/`mechanism-inventory-missing`, mirroring the existing `wiring-coverage-check-failed`
  pattern (`prepare-milestone.js:550-553`) — never silently treated as "zero mechanisms."
- `hashMechanismInventory(mechanisms)` (called internally by `deriveMechanismInventory` to produce
  `inventoryHash`, and exposed standalone for the Receipt-phase binding below) computes a
  **content-derived, rename/reorder-stable projection**: entries sorted by `proofSurface`, keeping
  only `{proofSurface, independentlyShippable, dependsOn}` with `dependsOn` re-expressed via each
  edge's target `proofSurface` (not the free-text `id`) — the same "anchor identity on a stable
  field, not prose" idiom `fingerprintFinding()` already uses for findings, applied one level up.
  Relabeling or reordering entries changes neither the derived `count` nor `inventoryHash` (AC2).

**Backward compatibility for existing fixtures/mocks:** a reviewer output that still returns only a
legacy scalar `mechanismCount` (no `mechanisms` array) is accepted for exactly one generation as a
synthetic single-entry inventory (`{id:'legacy-0', proofSurface:'legacy', independentlyShippable:
mechanismCount > 2, ...}`), flagged `mechanismInventorySource: 'legacy-scalar'` in the
ledger/telemetry so the fallback is visible and auditable rather than indistinguishable from a real
inventory (AC9). The production prompt template no longer requests the bare field.

**(B) Root-cause-aware clustering.** `_findingSchema` gains two optional fields: `rootCauseKey`
(reviewer-supplied string; findings sharing one `rootCauseKey` count once toward the
subsystem-cluster threshold, though every finding stays individually visible in the ledger — AC4's
"remain three ledger entries" is satisfied for free, since `rootCauseKey` is additive to, never a
replacement for, `id`/`subsystem`) and `repairable` (boolean, **default `false`** — fail-closed).
`groupBlockingBySubsystem` is replaced by `groupBlockingByRootCause(ledger)`, which counts
**distinct `rootCauseKey` values per subsystem**, falling back to the finding's own `id` when
`rootCauseKey` is absent (unchanged legacy behavior: one finding, one cluster member).
`_splitCheck`'s subsystem branch calls this instead of raw per-finding counting. Three findings
sharing one `rootCauseKey` count as ONE cluster member; three independently-rooted blockers still
hit the existing `>= 3` threshold (AC4).

**(C) One bounded focused revision before a repairable cluster becomes terminal.** `_splitCheck`'s
return gains `repairable: boolean`. It is `true` **only** for `split-subsystem-blocking-cluster`,
and only when every finding contributing to the triggering cluster has `repairable === true`
(fail-closed default `false` means an un-marked or legacy finding behaves exactly as today —
immediate split eligibility). `split-multi-mechanism` is **never** eligible for this carve-out, per
Requested action item 4's "cannot be repaired without changing the charter." (`split-touch-set-too-
large` is named in `checkSplitRecommendation`'s own trigger set but, confirmed live via
`grep -n 'split-touch-set-too-large\|touchSetSize\|smallMilestoneTouchBoundary'
.claude/workflows/prepare-milestone.js` — zero matches — is NOT wired into the real, production
`_splitCheck` today; it exists only in `proposal-convergence.ts`'s separately-defined, currently
production-uncalled pure function, exercised only by that file's own test suite. Wiring it into
production is out of this task's scope; the exclusion-from-carve-out logic applies to it only
if/when a future child adds that wiring — for `_splitCheck` as it exists and as this task changes
it, `split-multi-mechanism` is the only immediate-split code that needs this carve-out to be
scoped around.)

The workflow loop introduces `let _splitBypassUsed = false` before the `while(true)` loop. When
`split.recommend && split.repairable && !_splitBypassUsed` on `_deltaRound === 0`, the loop does
**not** `break` — it sets `_splitBypassUsed = true`, logs the bypass, and falls through to the
existing focused-revise + delta-review dispatch (lines 579-616, unchanged machinery, now also
carrying `rootCauseKey`/`repairable` through `_upsertFindings`). On the next iteration, if
`_splitCheck` still recommends split, the bypass is already spent and the loop terminates normally
— exactly one focused revision, never an unbounded retry (AC5). A non-repairable split still breaks
on the very first check, unchanged from today.

**(D) Hash-bound human split-decision record + cross-generation instability detection.**

*Decision record.* A new, git-committed, additive sibling tree —
`milestones/prepare-decisions/<taskId>.json`, alongside the existing `milestones/prepare-telemetry/`
archive (confirmed present on disk, schemaVersion 2, with real subdirectories including
`gap-prepare-milestone-split-decision-no-finality` itself and `DIR-126-E`) but a distinct file
class (a human ruling, not derived verification output):
```json
{
  "schemaVersion": 1, "taskId": "...",
  "charterHash": "sha256...", "scopeHash": "sha256...", "reviewPolicyHash": "sha256...",
  "mechanismInventoryHash": "sha256...",
  "decision": "commit" | "split", "reason": "...",
  "authorizingSessionId": "...", "decidedAtMs": 0,
  "invalidations": [{"atMs":0,"generationId":"...","mismatchedFields":["scopeHash"],"priorValue":"...","currentValue":"..."}]
}
```
Two new CLI submodes on `proposal-convergence.ts` (same `agent()`-wraps-CLI dispatch pattern every
other decision point in `prepare-milestone.js` already uses):
- `--record-split-decision --taskId --workspace --charterFile --decision commit|split --reason
  --sessionId` — **human-invoked only**, never called from any agent-prompt string inside
  `prepare-milestone.js`/mirror (enforced by a new grep-based regression test asserting the literal
  string `record-split-decision` never appears inside an agent-prompt template). It performs no
  adjudication of its own — only persistence of a human-supplied decision; `--decision`/`--reason`
  are required, never-inferred arguments.
- `--decide-split --taskId --workspace --charterFile` — a pure, read-only evaluator
  (`decideSplitAdjudication`) run at a **single early integration point**: inside the existing
  resume-decision block in `prepare-milestone.js` (lines ~250-304), the same structural point
  DIR-126-C's `reuse-terminal` short-circuit already occupies, strictly before `phase('Preflight')`
  — so a SPLIT block can guarantee **zero** new content-agent dispatch, not merely zero further
  dispatch after some agents have already run this generation. Evaluation order, mirroring
  `decideResumeGeneration`'s own documented step list:
  1. No prior record for `(charterHash, scopeHash, reviewPolicyHash)` → `no-decision-on-file`:
     proceed to Preflight, normal live split adjudication as redesigned in (A)-(C).
  2. A prior record with `decision:'commit'` and **unchanged** `(charterHash, scopeHash,
     reviewPolicyHash)` → `skip-split-adjudication`: proceed to Preflight, but with a
     `splitCheckDisabled=true` flag threaded through — `_splitCheck`/`checkSplitRecommendation` is
     **not called at all** inside this generation's ProposalReview loop (ordinary blocking-finding
     review still runs normally); this is a scope-level suppression, not a per-round re-comparison
     (AC6).
  3. A prior record with `decision:'commit'` but any of those three hashes differ →
     `decision-invalidated`: append an entry to that **same** record's `invalidations` array (naming
     the mismatched field(s) and old/new values — AC6's "records the invalidation reason" as a
     git-diffable, evidence-bearing edit, never a log line that disappears), then proceed as
     `no-decision-on-file`.
  4. A prior record with `decision:'split'` and unchanged `(charterHash, scopeHash,
     reviewPolicyHash)` → `content-dispatch-blocked`: return
     `{outcome:'needs-human', reason:'split-decision-blocks-dispatch', phase:'Admission'}`
     immediately — **zero** ProposalAuthors/Adjudicate/ProposalReview/PlanAuthor/PlanCheck
     dispatches (AC7).

  **`mechanismInventoryHash` is recorded on the decision record for audit but deliberately excluded
  from the match condition in steps 1-4.** A regenerated Proposal naturally produces a syntactically
  different (though structurally equivalent) inventory on almost every round; requiring exact
  `mechanismInventoryHash` equality would make a COMMIT decision nearly useless — it would almost
  never re-match, reproducing the exact defect this task closes. A COMMIT/SPLIT ruling binds to the
  reviewed **scope**, not to one generation's exact inventory bytes.

*Instability detection.* `.quay/prepare-leases/<taskId>.generation.json` (DIR-126-C's existing
gitignored lease file — confirmed real and currently populated on disk, e.g.
`.quay/prepare-leases/gap-prepare-milestone-split-decision-no-finality.generation.json` exists in
the working tree right now) gains one additive, bounded array field, `priorMechanismAttempts` (last
5 entries kept), each `{charterHash, scopeHash, reviewPolicyHash, mechanismInventoryHash,
mechanismCount, generationId, atMs}`, appended by every full-review round of ProposalReview
(round 0 only — delta rounds don't re-derive a fresh inventory). Before a live (non-suppressed)
split-multi-mechanism-class recommendation is honored, the phase compares the current
`mechanismInventoryHash` to the **single immediately-preceding** entry sharing the same
`(charterHash, scopeHash, reviewPolicyHash)` key (not a longer window or majority vote — the actual
incident showed noise between *consecutive* generations under an unchanged claim surface, and a
simple prior-vs-current delta already reproduces the required behavior with no invented statistical
policy):
- no prior entry at this key, or prior `inventoryHash` **matches** current → proceed to normal
  `_splitCheck` evaluation (two consecutive generations that agree on the same inventory are a
  *consistent* signal a human can COMMIT past or confirm SPLIT with confidence, not instability).
- prior entry exists at this key and its `inventoryHash` **differs** from current →
  `needs-human`/`split-assessment-unstable`, stop immediately — does not dispatch another generation
  automatically, and requests exactly one human decision instead.

Replaying DIR-126-D's real sequence (rounds 6/7/9/10 — 8 → 4 → ≤2 → 6, no two consecutive rounds
reported the same count, confirmed via `git show -s --format=%B a449053`/`1170b25`): generation 1
(round 6, inventory size 8, no prior) → normal `split-recommended`; generation 2 (round 7, inventory
size 4, differs from gen 1's) → `split-assessment-unstable`, stop immediately — one human decision
point instead of continuing to dispatch. Under this mechanism, rounds 9 and 10's real historical
counts (≤2, 6) would never have been automatically dispatched at all — the human decision at
generation 2 is exactly the point where DIR-126-D's own real saga should have stopped for a human
ruling, instead of continuing through 9 more automated rounds before one was actually made
(`tasks/DIR-126-D.md` commit `b8b87c3`) (AC8).

### Concrete control/data flow

```
Admission (unchanged)
  -> --decide-resume (unchanged, DIR-126-C)
     -> reuse-terminal? return, 0 dispatches (unchanged)
  -> NEW: --decide-split {taskId, charterHash, scopeHash, reviewPolicyHash}
     -> content-dispatch-blocked (SPLIT match) -> needs-human/split-decision-blocks-dispatch, 0 dispatches
     -> decision-invalidated (COMMIT, hash mismatch) -> log invalidation, proceed as no-decision-on-file
     -> skip-split-adjudication (COMMIT match) -> proceed, splitCheckDisabled=true carried forward
     -> no-decision-on-file -> proceed, normal live split adjudication
  -> Preflight (content, unchanged)
  -> ProposalAuthors / Adjudicate (unchanged, unless resumed)
  -> phase('ProposalReview')
     -> round 0: reviewer returns {findings, mechanisms, proposalHash, nowMs, sessionId}
        (mechanisms replaces mechanismCount in the schema; legacy scalar accepted 1 generation)
     -> wiring-coverage-check agent (unchanged call/merge)
     -> NEW: deriveMechanismInventory(mechanisms) -> {count, inventoryHash} or needs-human
        (mechanism-inventory-missing / mechanism-inventory-invalid, fail closed)
     -> NEW: append {..., mechanismInventoryHash, mechanismCount} to priorMechanismAttempts
     -> NEW: compare against immediately-preceding same-scope entry
        -> differs -> split-assessment-unstable, stop (needs-human)
     -> while(true) loop (existing structure, parameterized by rootCauseKey/repairable):
        - zero open blocking -> zero-finding, PASS (unchanged)
        - splitCheckDisabled -> skip _splitCheck this generation entirely
        - else: split = _splitCheck(derivedCount, ledger-with-rootCauseKey)
            - recommend && repairable && !_splitBypassUsed && deltaRound===0
                -> NEW: consume bypass, fall through to delta round (does NOT break)
            - recommend (otherwise) -> split-recommended, break (existing terminal, inventory attached)
        - budget/delta-cap checks (unchanged)
        - dispatch focused-revise + delta-review round (unchanged machinery)
  -> Receipt phase: --ledger unchanged; NEW --mechanism-inventory <file> hash-bound the same way
     --ledger already is (receipt.hashes.mechanismInventory, structurally identical to the existing
     --ledger binding at milestone-preparation-check.ts:100,350-369) — mechanically re-verifiable,
     fails closed on missing/mismatch (mechanism-inventory-missing/mechanism-inventory-stale,
     mirroring ledger-missing/ledger-stale).
```

### Key design decisions

1. **`scopeHash` is a NEW, deliberately prose-insensitive hash — not a reuse of DIR-126-C's
   `taskContractHash` (`sha256(AC + DoD + Touches text)`).** This is a real conflict among the input
   analyses: reusing `taskContractHash` verbatim is simpler, but this task's own DoD requires
   decision finality be "invalidated by real scope change but not by wording-only Proposal or AC
   edits" — a raw-text hash flips on a typo fix and cannot satisfy that clause (confirmed directly:
   `taskContractHash` mismatch is evaluated at `decideResumeGeneration` step 7, strictly before
   `reuse-terminal`, so it is sensitive to wording-only edits by construction — correct for its own
   caching purpose, wrong for this task's finality requirement). `scopeHash` is instead
   `sha256(JSON.stringify({acItemCount, touchesSorted}))` — sensitive to an AC checkbox item being
   added/removed or a Touches path being added/removed, insensitive to sentence-level rewording
   around them. This is the one place this proposal deliberately diverges from "reuse an existing
   hash," and it is required by the task's own acceptance language, not a style preference.
2. **`charterHash` stays the existing raw-text hash**, unchanged derivation — the DoD only calls out
   Proposal/AC wording, not charter wording, and charters are edited far less often during a live
   milestone.
3. **`mechanismInventoryHash` is recorded for audit but excluded from `--decide-split`'s match
   condition** (see mechanism D) — including it would make a COMMIT decision re-match almost never,
   since a regenerated Proposal's inventory is syntactically different nearly every round even at
   unchanged scope; requiring exact equality would silently degrade the whole mechanism back to "no
   finality," the exact defect being fixed.
4. **Mechanism *grouping* stays bounded reviewer judgment, not a mechanical heuristic over WIRING
   CLAIM/prefix conventions.** A purely mechanical "everything under one naming prefix is one
   mechanism" rule was considered and rejected (see Alternatives): it silently encodes a naming
   convention as ground truth and reintroduces the same "who decides the grouping" ambiguity one
   layer up. *Identity* (`proofSurface`) and *counting* (script-side `.filter(...).length`) are
   fully mechanical; only grouping semantics stay LLM judgment, now typed and hash-stable — a
   strictly smaller and more auditable surface than today's bare integer, even though it isn't fully
   deterministic.
5. **`repairable` defaults to `false` (fail-closed)** and is eligible **only** for
   `split-subsystem-blocking-cluster` — a reviewer must affirmatively mark every contributing
   finding repairable to earn the one-shot bypass; an un-marked or legacy finding behaves exactly as
   today.
6. **Only a human-invoked CLI call can write a split-decision record; no agent path can self-grant
   COMMIT/SPLIT.** `--record-split-decision` takes `--decision`/`--reason` as required args it never
   infers, mirroring the actual DIR-126-D precedent (a human ran `git commit` on the ruling, no agent
   did) — a trust-boundary decision, not a technical one, matching the same honesty standard
   `.halt`/`restart-readiness-check.sh` already use for other human-steering points.
7. **A new `SPLIT_POLICY_VERSION`/`MECHANISM_POLICY_VERSION` literal folds into the *same*
   `_currentReviewPolicyHash()`** (currently `sha256(PREFLIGHT_POLICY_VERSION::RESUME_POLICY_VERSION)`,
   confirmed at `proposal-convergence.ts:482-483`, becoming
   `sha256(PREFLIGHT_POLICY_VERSION::RESUME_POLICY_VERSION::MECHANISM_POLICY_VERSION)`), rather than
   a parallel versioning surface — a future change to split-decision semantics invalidates both
   DIR-126-C's `reuse-terminal` cache and this task's COMMIT/SPLIT suppression via one source of
   truth, never two independently-bumpable versions that could drift.
8. **Instability detection compares only the single immediately-preceding same-scope full-review
   attempt**, not a longer ring buffer or majority vote — the actual incident showed noise between
   consecutive generations under an unchanged claim surface (8→4→≤2→6, no two consecutive rounds
   agreeing, fully explained by consecutive-pair drift); a longer history adds an invented
   statistical parameter (window size, vote threshold) with no additional observed failure mode it
   would catch.

### Defaults and failure behavior

- Missing/malformed `mechanisms` array on a fresh (non-legacy) dispatch → fails closed to
  `needs-human`/`mechanism-inventory-missing` — never silently skips the multi-mechanism check
  (today's behavior).
- Invalid inventory (duplicate id, dangling `dependsOn`, duplicate `proofSurface`) → fails closed to
  `needs-human`/`mechanism-inventory-invalid`.
- `rootCauseKey`/`repairable` omitted on a finding → each finding is its own cluster member (legacy
  behavior) and non-repairable (immediate-split-eligible) — safe defaults, no silent leniency.
- No split-decision record for the current hashes → behaves exactly as today (no override, normal
  adjudication) — the default, no-op path.
- A record exists but hashes mismatch → `applies:false` with an explicit `mismatchedFields` list and
  an appended `invalidations` entry on the **same** committed file (never a silent "doesn't apply",
  never a disappearing log line).
- `mechanismInventoryHash` matches the immediately-preceding same-scope entry but a live split
  trigger would otherwise fire → normal `split-recommended` (consistent signal, not instability); a
  mismatch → `split-assessment-unstable`, stop.
- Any unparseable/non-zero-exit CLI verdict from `--decide-split`/`--record-split-decision` → fails
  the phase closed, mirroring the existing `wiring-coverage-check-failed`/`resume-decision-failed`
  fail-closed precedent — never silently treated as "no decision applies" being conflated with
  "check succeeded."
- `priorMechanismAttempts`/telemetry append failure (I/O) → non-fatal, logged only (mirrors the
  existing `telemetryWriteOk` pattern) — observability, never a gate; a write failure never blocks
  or falsely passes the phase.

### Compatibility

- `proposal-convergence.ts` / `prepare-milestone.js` mirrors stay byte-identical (`diff` confirms
  today; the Plan must preserve this).
- `_findingSchema` gains two **optional** properties (`rootCauseKey`, `repairable`); a legacy finding
  lacking them behaves exactly as today.
- `checkSplitRecommendation`'s exported name and `{recommend, code, reason}` shape are preserved;
  `mechanismInventory`/`repairable` are additive — existing callers destructuring
  `{recommend, code, reason}` are unaffected.
- The reviewer schema's `mechanismCount: {type:'number'}` is retained for one generation as a legacy
  fallback only (mirroring DIR-125's own precedent for `findings` as a bare number,
  `prepare-milestone.js:519-525`), flagged `mechanismInventorySource:'legacy-scalar'` when used —
  keeps existing mocks/fixtures green (AC9) without the production prompt requesting the bare field.
- `CACHEABLE_TERMINALS`/`decideResumeGeneration` (DIR-126-C) are untouched in evaluation order —
  `split-recommended` stays a cacheable terminal on unchanged `proposalHash`; this task adds a
  **parallel**, coarser short-circuit (scope-keyed, not proposal-text-keyed) that fires *before* a
  reviewer would even run, complementary to, not replacing, DIR-126-C's mechanism. Only
  `_currentReviewPolicyHash()`'s internal composition changes (design decision 7), which both
  existing consumers already treat as an opaque hash.
- `milestones/prepare-telemetry/` (confirmed present, schemaVersion 2) is untouched;
  `milestones/prepare-decisions/` is a new, additive sibling tree, not a migration.
- Existing zero-finding, legitimate-split, receipt, lease-release, and fail-closed tests (AC9) keep
  passing because every new field/branch degrades to today's behavior when absent, in both
  `.claude/workflows/prepare-milestone.js` and `plugin/workflows/prepare-milestone.js`.

### Risks

- **Convention/gaming risk on the repairable carve-out.** A reviewer could mis-mark a genuinely
  non-repairable cluster `repairable:true`. Bounded to at most one extra delta round (the one-shot
  guard); after which the cluster is terminal regardless — small, time-boxed blast radius.
- **Procedural, not cryptographic, human-authorship guarantee** for `--record-split-decision` —
  accepted risk, consistent with this repo's existing trust model for other manual human-steering
  gates (`.halt`, `restart-readiness-check.sh`). Mitigated by the grep-based regression test
  forbidding the literal flag string in any agent-prompt template.
- **`scopeHash` under/over-sensitivity.** Insensitive to AC/Proposal wording by design (required by
  the DoD); this means a subtle *meaning* change inside an unchanged number of AC bullets and
  Touches paths would NOT invalidate a COMMIT decision. Accepted: distinguishing "cosmetic reword"
  from "meaning changed" is not mechanically decidable, and item-count/path-set changes are the
  actually-observed proxy for real scope change in this repo's history.
- **Inline/pure-function mirror drift.** `prepare-milestone.js` has no imports (established
  convention) and re-implements every pure function inline; this task adds several NEW pure
  functions (`_deriveMechanismInventory`, `_hashMechanismInventory`, `groupBlockingByRootCause`,
  `decideSplitAdjudication`) that must stay in lockstep across `proposal-convergence.ts` and both
  workflow mirrors. Mitigated by extending the existing "inline caps match `capsFor()`"-style
  cross-check test pattern to cover the new functions' outputs over a fixture battery.
- **Golden-replay obligation (charter's own Done-when).** The Plan phase must construct a fixture
  from DIR-126-D's real recorded `mechanismCount` sequence (rounds 6/7/9/10: 8 → 4 → ≤2 → 6,
  cross-checked against `git show -s --format=%B a449053`/`1170b25`/`b8b87c3`) and confirm
  `split-assessment-unstable` fires once, at generation 2, not an invented approximation.
- **Unbounded growth of `milestones/prepare-decisions/`** over the repo's lifetime — accepted,
  identical already-accepted risk class as `milestones/prepare-telemetry/`.

### Non-goals

- Not weakening safety review or auto-accepting large/risky tasks — immediate-split paths
  (`split-multi-mechanism`, non-repairable subsystem clusters, and `split-touch-set-too-large` if a
  future child ever wires that currently-test-only `checkSplitRecommendation` code into production)
  are unchanged.
- Not automating the COMMIT/SPLIT decision itself — remains strictly human-authored; nothing lets an
  agent write a decision record for itself.
- Not making mechanism *grouping* fully mechanically deterministic — the inventory is still
  LLM-authored, now typed/validated/hash-stable, not "correct by construction."
- Not touching PlanCheck's own separately-bounded convergence loop
  (`milestone-preparation-check.ts`'s `plancheck-rounds-exceeded`).
- Not modifying `prepare-admission-check.ts` (not in this task's `## Touches`).
- Not retrofitting or migrating historical `milestones/prepare-telemetry/` schemaVersion-2 records.
- Not implementing an automated "perform the split" action (creating child tasks) — a SPLIT decision
  only blocks further content-agent dispatch on the original task; actually splitting into children
  remains a human/DIR-028 `quay-directive`-driven action.
- Not solving LLM self-report noise in phases other than ProposalReview's split path.

### AC coverage

- AC1 (typed inventory, mechanically derived count, no bare int trusted) → mechanism (A);
  `_splitCheck` consumes only `deriveMechanismInventory`'s derived count, never a raw reviewer
  integer on any production path.
- AC2 (A.1-A.5 grouped as one mechanism; rename/reorder-stable hash/count) → (A)'s grouping-rule
  prompt instruction + content-derived `inventoryHash` sorted by `proofSurface`.
- AC3 (genuine 3-mechanism fixture still splits, distinct proof surfaces) → (A)'s duplicate-
  `proofSurface` rejection + unchanged `> 2` threshold over the derived count.
- AC4 (rootCauseKey clustering; independently-rooted blockers still trigger; ledger entries
  preserved) → mechanism (B), `groupBlockingByRootCause`.
- AC5 (bounded repairable revision; non-repairable still stops immediately) → mechanism (C),
  `_splitBypassUsed` one-shot gate.
- AC6 (hash-bound COMMIT skip proven at call-site level via `splitCheckDisabled`; material scope
  change invalidates + records reason) → mechanism (D) steps 2-3, `scopeHash` design decision,
  `invalidations` append behavior.
- AC7 (hash-bound SPLIT blocks dispatch) → mechanism (D) step 4, early integration point before
  `phase('Preflight')`.
- AC8 (8→4→≤2→6 sequence → one stop point, not four terminals) → mechanism (D) instability
  detection against `priorMechanismAttempts`.
- AC9 (existing tests stay green, both mirrors) → Compatibility section — every new field/branch is
  additive with a same-as-today default, including the legacy-scalar fallback.
- AC10 (Receipt phase's `--mechanism-inventory <file>` hash binding, structurally identical to the
  existing `--ledger` binding, fails closed on missing/mismatch) → Concrete control/data flow's
  Receipt-phase step, mirroring `milestone-preparation-check.ts:100,350-369`'s confirmed-real
  `ledger-missing`/`ledger-stale` pattern.
- AC11 (`--record-split-decision` confirmed human-invoked only via grep-based regression test) →
  mechanism (D)'s record submode + Key design decision 6.
- Grounding-evidence AC item → Problem framing's direct, verbatim-quoted citations of
  `a449053`/`1170b25`/`b8b87c3` commit messages and the current-tree line numbers verified above,
  not restated prose.

### Alternatives considered and rejected

1. **Average/median `mechanismCount` across N independent reviewers.** Rejected — smooths the
   symptom without explaining it, and still trusts a bare integer, failing AC1 outright.
2. **Purely mechanical grouping from naming-prefix/WIRING-CLAIM conventions (no reviewer judgment at
   all).** Rejected — brittle to a differently-but-validly-formatted Proposal, and silently
   substitutes one ungrounded convention (the heuristic's own idea of a "prefix") for another; the
   Requested action explicitly wants a semantic "unless a strict subset can ship independently"
   judgment preserved.
3. **Just raise the delta-round cap instead of adding an inventory/decision mechanism.** Rejected —
   DIR-126-D's 11 rounds already vastly exceeded normal caps without the count converging; more
   rounds of the same ungrounded signal reproduce the defect more slowly, not differently.
4. **Let the delta-review loop re-run the split check with a fresh reviewer every round instead of a
   bounded one-shot bypass.** Rejected — reintroduces the DIR-120/M192 unbounded-restart risk
   DIR-125 was built to close; "keep re-checking split-worthiness every round" has no natural
   stopping point distinct from the existing budget/delta-cap machinery, which is tuned for a
   different purpose.
5. **Gitignored/ephemeral split-decision record (parallel to `.generation.json`).** Rejected —
   defeats the "decision finality" durability goal; a fresh clone/worktree/`git clean` would forget
   a human ruling, reproducing the original defect one layer down.
6. **Let the ProposalReview agent itself write the split-decision record when it self-assesses zero
   blocking findings after a repaired cluster.** Rejected — this is precisely the trust boundary the
   Finding protects; self-report must never become self-authorization.
7. **Store the human COMMIT/SPLIT decision as a task field (`extra.splitDecision`) via `task_write`
   instead of a filesystem artifact.** Rejected — the task body is the Proposal/Plan/AC/DoD single
   source of truth; a decision belongs beside the other preparation-stage derived artifacts
   (`milestones/prepare-telemetry/...`-adjacent), not as a second copy of task content, and it keeps
   the decision hash-bound to the same `(charterHash, scopeHash, reviewPolicyHash)` triple this
   module's other mechanisms already use.
8. **An unconditional (not `repairable`-gated) one-time bypass before any split.** Rejected — would
   spend a real delta-round dispatch on genuinely non-repairable multi-mechanism/safety clusters
   that no wording-level revision can fix, reproducing the DIR-120 token-burn defect on a different
   axis; Requested action item 4 explicitly preserves immediate split for that case.
9. **Windowed/majority-vote instability detection instead of prior-vs-current delta.** Rejected — a
   simple immediate-predecessor comparison already reproduces AC8's required behavior on the real
   historical sequence, is trivially auditable, and avoids inventing an ungrounded statistical
   policy (window size, vote threshold) with no basis in the actually-observed defect (consecutive-
   round non-monotonic drift, not a modal-outlier problem).
10. **A hand-maintained `scopeEpoch` integer instead of deriving epoch identity from `scopeHash`.**
    Rejected — a manually-bumped counter is itself an unenforced, driftable artifact; content hashes
    are the established idiom in this exact module (DIR-126-C's `decideResumeGeneration`) for the
    identical purpose.
11. **Fold the split-decision lookup into the existing `--decide-resume` CLI mode instead of a new
    `--decide-split` mode.** Rejected — `--decide-resume`'s cold/resume/reuse-terminal decision is
    about whether to re-run content generation from scratch; "should ProposalReview even be allowed
    to recommend split for this generation" is logically prior to and orthogonal to that choice —
    conflating them would make `decideResumeGeneration`'s already-multi-step evaluation order harder
    to reason about and risk a regression in DIR-126-C's landed behavior.
12. **Ground mechanism identity in `wiring-coverage-check.ts`'s `[WIRING CLAIM <id>]` extraction
    (`claimIds` in place of/alongside `proofSurface`).** Considered seriously — this already-running,
    deterministic extractor is genuinely well-suited as grounding material. Deferred rather than
    adopted for v1: it would require a new cross-validation step (unresolvable `claimIds` entries)
    and a Proposal-format dependency (zero WIRING CLAIM markers → zero claims →
    `mechanism-inventory-missing`, a real behavior-tightening) not required by this task's AC
    wording, which already asks only for "stable IDs, ownership, proof surfaces, dependencies,
    independently-shippable decisions, and rationale." A future task may fold claim-id grounding
    into `proofSurface` once the base mechanism has landed and been observed in production.

### Mechanism-claim wiring coverage (DIR-117) — claims requiring AC-level proof

- WIRING CLAIM P1 — `prepare-milestone.js`'s resume-decision block (strictly before
  `phase('Preflight')`) invokes a NEW `--decide-split` CLI call keyed on `{charterHash, scopeHash,
  reviewPolicyHash}` and returns `needs-human` with zero further dispatches on a SPLIT match — needs
  AC7 evidence at this real call site, not only the pure `decideSplitAdjudication` function.
- WIRING CLAIM P2 — `_splitCheck`/`checkSplitRecommendation` (both mirrors) consumes
  `deriveMechanismInventory(...)`'s derived count on the production code path, never
  `_fullReviewResult.mechanismCount` directly — needs AC1/AC2/AC3 evidence that the raw field is no
  longer read anywhere in the split-decision path (outside the one-generation legacy fallback).
- WIRING CLAIM P3 — a COMMIT decision's `skip-split-adjudication` verdict actually reaches and
  disables `_splitCheck`'s call site inside the ProposalReview loop (`splitCheckDisabled` flag), not
  merely that the CLI function returns the right verdict in isolation — needs AC6 evidence at the
  loop call site.
- WIRING CLAIM P4 — `--record-split-decision` writes `milestones/prepare-decisions/<taskId>.json`,
  read only by `--decide-split`, and is not invoked from any agent-prompt string in
  `prepare-milestone.js`/mirror — needs the grep-based human-only-invocation regression test as real
  evidence, not prose (AC11).
- WIRING CLAIM P5 — round-0 ProposalReview appends to and reads
  `.quay/prepare-leases/<taskId>.generation.json`'s `priorMechanismAttempts` field, producing
  `split-assessment-unstable` on an inventory-hash mismatch at unchanged scope hashes, on every
  full-review round (not only the first) — needs AC8 evidence.
- WIRING CLAIM P6 — `_splitCheck`'s subsystem-cluster branch gates the workflow loop's delta-round
  dispatch (falls through instead of breaking) only when every contributing finding's
  `repairable === true` and the one-shot bypass has not already been consumed this generation —
  needs AC5 evidence that a real `proposal-revise-round-1` dispatch happens before the second split
  check, not just that the function returns `repairable:true` in isolation.
- WIRING CLAIM P7 — `prepare-admission-check.ts` is unmodified by this task (not in `## Touches`) —
  needs a diff/grep-based check, not prose.
- WIRING CLAIM P8 — the Receipt phase invokes a new `--mechanism-inventory <file>` hash binding on
  `milestone-preparation-check.ts`, structurally identical to the existing `--ledger` binding at
  `milestone-preparation-check.ts:100,350-369`, so a receipt is mechanically re-verifiable against
  the exact reviewed inventory, with fail-closed `mechanism-inventory-missing`/
  `mechanism-inventory-stale` behavior mirroring `ledger-missing`/`ledger-stale` — needs AC10
  evidence.

Each of P1-P8 now has a corresponding falsifiable `## Acceptance Criteria` item above (P4 and P8
added at ProposalReview round 1; P3's existing AC6 item strengthened to require call-site/
instrumentation-level evidence, not just CLI-function-return-value evidence) demanding real
production-callsite or fixture-level reachability evidence — not descriptive prose restating the
claim, per this task's own review discipline.

## Plan

N/A -- execute as a human-steered control-plane milestone. This changes the semantics of a
preparation stop decision and therefore requires golden replay of both legitimate split cases and
the observed DIR-126-D oscillation before production cutover.

## Finding

DIR-126-D/M203 ran prepare-milestone 11 times without reaching prepared: one Admission rejection,
one Preflight rejection, and nine ProposalReview split recommendations. Across the semantic review
runs (rounds 6/7/9/10), reviewers reported materially different mechanism counts for substantially
the same scope: 8, then 4, then an implicit ≤2 (the trigger simply didn't fire that round, no
explicit low count was reported), then 6 — no two consecutive rounds agreed. The current task now
explicitly describes two independently landable mechanisms, while A.1-A.5 are required call-site
variants of one complete terminal-write contract; the scalar reviewer output still has no
machine-readable basis for preserving that distinction.

The behavior follows directly from current code:

1. The full reviewer returns only a numeric mechanismCount; it does not return mechanism IDs,
   ownership, proof surfaces, dependency edges, or reasons each item can ship independently.
2. The split check treats any finite value greater than two as sufficient evidence for
   split-multi-mechanism.
3. Three blocking findings sharing a subsystem trigger split-subsystem-blocking-cluster even when
   they are multiple symptoms of one parser/root-cause defect.
4. The split check runs before the focused reviser/delta-review loop, so repairable wiring-format
   findings cannot converge inside the generation.
5. A human COMMIT decision is not stored as a hash-bound preparation artifact. The next full
   reviewer can reopen the same question with a different count and force another complete attempt.

This is not a request to weaken safety review or auto-accept a large task. It is a request to make
the split decision evidence-bearing, stable, and terminal until its actual scope changes.

## Requested action

1. Replace the scalar mechanismCount review result with a mechanism inventory. Every entry must
   carry a stable ID, production owner, proof surface, dependency set, independently-shippable
   boolean, and rationale. Derive the count from qualifying inventory entries rather than trusting
   a separately supplied integer.
2. Define one grouping rule: call-site variants required to satisfy one atomic behavior contract
   are one mechanism unless a strict subset can ship with independent user value and a complete
   safety contract. Add a fixture covering DIR-126-D's A.1-A.5 variants as one grouped mechanism.
3. Give blocking findings stable root-cause identities before applying the subsystem-cluster
   threshold. Multiple findings from one parser, sentence-boundary, or missing-AC root cause count
   once for split purposes while remaining individually visible in the ledger.
4. Allow one bounded focused revision before a repairable wiring/mechanical cluster can terminate
   as split-recommended. Immediate split remains valid for independently evidenced semantic scope
   clusters or safety boundaries that cannot be repaired without changing the charter.
5. Persist a split-decision artifact containing task ID, charter hash, scope hash, review-policy
   hash, mechanism-inventory hash, decision, reason, authorizing session, and timestamp. A COMMIT
   decision suppresses repeat split adjudication for the same hashes; a SPLIT decision prevents
   further content-agent dispatch until the split or an explicit scope reset occurs.
6. If independent reviewers produce incompatible inventories for the same hashes, return
   split-assessment-unstable and request one human decision. Do not turn disagreement into another
   automatic prepare-milestone redispatch.

## Acceptance Criteria

- [ ] ProposalReview returns a typed mechanism inventory with stable IDs, ownership, proof
  surfaces, dependencies, independently-shippable decisions, and rationale; the split count is
  mechanically derived from that inventory and no production branch trusts a bare reviewer integer.
- [ ] RED/GREEN fixtures classify DIR-126-D's A.1-A.5 terminal-write call-site variants as one
  atomic mechanism and its read-only report as a second mechanism; renaming or reordering entries
  does not change the inventory hash or count.
- [ ] A genuine three-mechanism fixture still produces split-multi-mechanism, with each counted
  mechanism independently shippable and backed by a distinct proof surface.
- [ ] Three wiring findings with one rootCauseKey remain three ledger entries but count as one
  independent split-cluster member; three independently rooted semantic blockers still trigger the
  subsystem split threshold.
- [ ] A repairable wiring cluster receives exactly one focused revision and delta review before a
  terminal split decision; a non-repairable safety/scope split fixture still stops immediately.
- [ ] A hash-bound human COMMIT decision causes a second attempt with unchanged task/charter/scope/
  policy hashes to skip split adjudication — proven at the call-site/instrumentation level (a real
  fixture confirms `_splitCheck`'s specific call site inside the ProposalReview loop is actually
  disabled via `splitCheckDisabled`), not merely that the CLI function returns the right verdict in
  isolation; a material scope change invalidates that decision and records the invalidation reason.
- [ ] `--record-split-decision` (writing `milestones/prepare-decisions/<taskId>.json`, read only by
  `--decide-split`) is confirmed human-invoked only via a grep-based regression test asserting the
  literal flag string appears in no agent-prompt template anywhere in `prepare-milestone.js`/mirror
  — real evidence, not prose.
- [ ] The Receipt phase's new `--mechanism-inventory <file>` hash binding on
  `milestone-preparation-check.ts` is structurally identical to the existing `--ledger` binding — a
  receipt naming a missing or hash-mismatched mechanism-inventory file fails closed
  (`mechanism-inventory-missing`/`mechanism-inventory-invalid`), mirroring the existing
  `ledger-missing`/`ledger-stale` behavior exactly.
- [ ] A hash-bound human SPLIT decision dispatches zero new Proposal/Plan content agents until the
  task graph changes or an explicit authorized scope reset is recorded.
- [ ] Replaying the observed unstable count sequence 8 -> 4 -> (implicit <=2) -> 6 (rounds
  6/7/9/10, no two consecutive rounds agreeing) returns one split-assessment-unstable human decision
  point at generation 2, not four terminal generations.
- [ ] **`prepare-admission-check.ts` is byte-unchanged (WIRING CLAIM P7):** a `git diff`/`cmp`
  confirms `prepare-admission-check.ts` (both mirrors) has zero diff from this child's own base
  revision — this task's entire mechanism lives in `prepare-milestone.js`/`proposal-convergence.ts`
  (+ `milestone-preparation-check.ts` for the Receipt-phase binding), never in the Admission/Preflight
  check file.
- [ ] Existing zero-finding, legitimate split, receipt, lease-release, and fail-closed review tests
  remain green in both workflow mirrors.
- [ ] **Grounding evidence for the Problem-framing/Chosen-mechanism claims above (added for
  wiring-coverage completeness):** confirmed via direct source read — the human-adjudicated ruling
  this task productionizes is real (`tasks/DIR-126-D.md` commit `b8b87c3`); `_splitCheck`/
  `checkSplitRecommendation` (both mirrors) are changed to accept and derive from a real
  `mechanismInventory`, not a bare integer; a prior record with `decision:'split'` and unchanged
  `(charterHash, scopeHash, reviewPolicyHash)` produces `content-dispatch-blocked` and
  `{outcome:'needs-human', reason:'split-decision-blocks-dispatch', phase:'Admission'}`;
  `--record-split-decision` takes `--decision`/`--reason` flags and is a real, `git commit`-backed
  human-invoked CLI action, matching this repo's existing `.halt`/`restart-readiness-check.sh`
  human-steering convention; the new integration point in `prepare-milestone.js` sits before
  `phase('Preflight')`, dispatching `--decide-split` with the same
  `{charterHash, scopeHash, reviewPolicyHash}` tuple and real `needs-human`-shaped `decideSplitAdjudication`
  return; a COMMIT decision's `skip-split-adjudication` verdict actually disables `_splitCheck`'s
  call site via a real `splitCheckDisabled` flag, not merely a returned verdict; and the Receipt
  phase's `--mechanism-inventory <file>` hash binding on `milestone-preparation-check.ts` is
  structurally identical to the existing `--ledger` binding — all confirmed real by direct source
  read of the current tree, not a new invention. Round-3 additionally flagged the exact identifier
  forms these claims need co-located here: `mechanismCount` (the bare scalar this task removes from
  every non-legacy production path); `split-multi-mechanism`, `split-touch-set-too-large` (the
  latter confirmed live to exist only in `checkSplitRecommendation`'s own trigger set, not wired
  into production `_splitCheck` — see the Chosen-mechanism (C) parenthetical above); `scopeHash`,
  `invalidations` (the two fields a material scope change records alongside a COMMIT decision's
  invalidation); `milestone-preparation-check.ts:100,350-369` (the existing `--ledger` binding's
  exact line range, the structural precedent `--mechanism-inventory <file>` mirrors);
  `mechanism-inventory-missing`, `mechanism-inventory-stale`, `ledger-missing`, `ledger-stale` (the
  new fail-closed terminal pair and the existing pair it mirrors) — all confirmed real by the same
  direct-source-read standard as above.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on master under human-steered discipline with byte-identical workflow/script mirrors.
- [ ] A real preparation attempt consumes a recorded COMMIT or SPLIT decision and journal evidence
  confirms the same split question is not sent to another full reviewer.
- [ ] Independent audit confirms that decision finality is invalidated by real scope change but not
  by wording-only Proposal or AC edits.

## Human verification when exp5 marks this task done

1. Can the reviewer show which mechanisms it counted and why each can ship independently?
2. Can five required call sites of one atomic contract still be mislabeled as five mechanisms?
3. Does a human COMMIT or SPLIT decision actually prevent another identical adjudication?
4. Are legitimate safety and independently shippable scope splits still fail-closed?

## Touches

- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/prepare-milestone-convergence.test.mjs
