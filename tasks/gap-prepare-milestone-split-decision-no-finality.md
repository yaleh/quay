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

Every structural claim below was verified by direct read of the current tree in THIS session
(2026-07-30), not restated from the task body's prior prose. All three mirror pairs are
byte-identical right now (`diff -q` clean): `.claude/workflows/prepare-milestone.js` ≡
`plugin/workflows/prepare-milestone.js` (863 lines each),
`experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` ≡
`plugin/scripts/proposal-convergence.ts` (851 each), and
`experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` ≡
`plugin/scripts/milestone-preparation-check.ts` (587 each). The "pure logic in the module +
import-free inline twin in both workflow mirrors" convention is real and is a CONSTRAINT, not a
style choice: the workflow DSL has no fs/import capability (documented at
`prepare-milestone.js:250-264`), and `_convergenceAgentCall` (`:157`) is the established
`agent()`-wraps-CLI dispatch seam any fix must preserve.

The bounded-convergence machinery this task sits on top of is real and landed: `_splitCheck()` at
`prepare-milestone.js:474-484`, the DIR-125 typed-finding ledger (`_upsertFindings` :445-468,
`_findingSchema` :486-493), the round-0 full review (:498-509) plus bounded `while(true)` delta loop
(:563-617), the DIR-117-B wiring-coverage-check sub-step with its fail-closed
`wiring-coverage-check-failed` terminal (:542-555, fail-closed branch :550-553), and DIR-126-C's
generation-aware resume (`decideResumeGeneration` at `proposal-convergence.ts:284`,
`RESUME_POLICY_VERSION = "resume-v1"` :238, `CACHEABLE_TERMINALS` :247-250, `reuse-terminal`
short-circuit consumed in the workflow at :275-289, returning strictly before `phase('Preflight')`
:304).

None of that addresses the four defects that actually produced DIR-126-D/M203's real, git-log-
verifiable failure — 11 dispatches against substantially the same scope (`git log --follow
tasks/DIR-126-D.md`: `decdc79`→`7808f0c`→`1170b25`→`28a0a4a`→`e96e453`→`a449053`→`dbb6026`→
`b8b87c3`→`ee4296f`), whose semantic review rounds reported `mechanismCount` **8 → 4 → (implicit ≤2)
→ 6** across rounds 6/7/9/10 with no two consecutive rounds agreeing:

1. **The split count is a bare self-reported integer.** The round-0 full-review prompt
   (`prepare-milestone.js:506`) literally asks for `mechanismCount: <integer count of independently
   landable mechanisms>`; the schema (:508) declares `mechanismCount: { type: 'number' }`; :558
   extracts it; and `_splitCheck` (:480-482) trusts it directly: `if (Number.isFinite(mechanismCount)
   && mechanismCount > 2) return { recommend: true, code: 'split-multi-mechanism', ... }`. There are
   no IDs, no ownership, no proof surfaces, no dependency edges behind that number, so two
   independent reviewers cannot even disagree on a shared object — each emits a scalar from its own
   private grouping. The real history is verbatim in git: `7808f0c` ("round-6 fix -- consolidate 8
   WIRING CLAIM headers into 2 mechanisms"), `1170b25` ("round-7 fix … mechanismCount dropped 8->4"),
   `a449053` ("…mechanismCount counting-guidance experiment"). The terminal ruling `b8b87c3`
   ("human-adjudicated SPLIT-OR-COMMIT final ruling (mechanismCount=2, frozen)") records, verbatim:
   "mechanismCount is a noisy, non-monotonic LLM self-report (8->4-><=2->6 across rounds 6/7/9/10)
   that never converged under repeated automated re-review", resolved by "a human coordinator makes
   the count determination once: Mechanism A (A.0-A.5, one committed-write contract across its
   necessary call-site variants) + Mechanism B (the read-only --telemetry-report query, genuinely
   independently-landable) = 2. This ruling is final … COMMIT." (Note: the ruling commit text says
   A.0-A.5; the frozen AC says A.1-A.5 — the fixture must cover the variant set the ruling names,
   per the AC wording.) That ruling lives as commit-message/task-body prose that **no code path
   reads, stores, or enforces** — a fresh `prepare-milestone` dispatch tomorrow reopens the identical
   question from scratch.
2. **Subsystem clustering is raw string equality, blind to root cause.** Both `_splitCheck`'s inline
   grouping (:475-478) and the module's `groupBlockingBySubsystem` (`proposal-convergence.ts:119-123`,
   feeding `checkSplitRecommendation` :130-134) count findings per `f.subsystem` string and trip
   `split-subsystem-blocking-cluster` at `count >= 3` (:478 / :133-134). Worse, the merged
   `wiring-coverage-check.ts` findings land in the SAME ledger (:555), so three identifiers of one
   broken-claim class are indistinguishable from three independently-rooted blockers.
3. **Split preempts the only repair machinery.** Inside the loop, `const split =
   _splitCheck(_mechanismCount)` (:567) and its `break` (:568) execute on *every* iteration —
   including `_deltaRound === 0` — strictly before the soft-budget check (:571), the delta-cap check
   (:573), and the focused-revise (`:579-597`, label `proposal-revise-round-${_deltaRound}` at :588)
   + delta-review (:599-616) dispatches. A mechanically repairable finding cluster gets zero
   convergence attempts; the very machinery DIR-125 built to converge findings is unreachable for
   this terminal class.
4. **There is no human decision finality — only byte-cache reuse.** DIR-126-C's `reuse-terminal`
   (`proposal-convergence.ts:315-323`) suppresses a repeat generation only when
   `charterHash`/`taskContractHash`/`proposalHash`/`reviewPolicyHash` are *all* byte-identical to a
   prior record. Verified: `taskContractHash = sha256(`${ac}\n${dod}\n${touches}`)` (:500) is
   compared at `decideResumeGeneration` step 7 (:309), strictly before reuse-terminal — so any
   AC/DoD/Touches wording edit forces cold — and independently, `proposalHash` churns on every
   revision round (the workflow pushes `_proposalHashes` at both :514 and :592). The actual
   resolution was the human prose ruling at `b8b87c3` that **no code path reads**.

Confirmed greenfield in this session: `grep -E
'decide-split|record-split-decision|splitCheckDisabled|mechanismInventory|priorMechanismAttempts|mechanism-history|rootCauseKey|MECHANISM_POLICY_VERSION|deriveMechanismInventory'`
across all three production files returns **0 matches**; `milestones/prepare-decisions/` does not
exist (`ls`: No such file or directory), while `milestones/prepare-telemetry/` does (committed
records exist, including a subdirectory for this very task; schemaVersion 2 — the durability
precedent). And the reproduction is not merely historical — it is in this task's own generation-
record chain.
`.quay/prepare-leases/gap-prepare-milestone-split-decision-no-finality.generation.json` recorded,
at generationId `0eba810e4ccb`, a `{terminalPhase: "ProposalReview", outcome: "needs-human",
reason: "split-recommended", cacheable: true}` terminal: the split defect firing against the very
task that would fix it (that record survives as HISTORY — the file is overwritten wholesale per
terminal, decision 9 — with the durable copy in `milestones/prepare-telemetry/`'s subdirectory for
this task). A direct read of the SAME file in THIS session (2026-07-30) shows its CURRENT record is
a LATER generation — `{terminalPhase: "PreflightPlan", outcome: "revision-needed", reason:
"preflight-rejected", cacheable: false}` (generationId `31161d095578`, recordedAtMs
1785437137089): that generation PASSED ProposalReview and was then rejected at the next gate,
independently demonstrating AC13's live `preflight-touches-mismatch` risk reproducing against this
very task. The defect class is **grouping / counting / finality**, not caching, which is why
DIR-126-C (M202, landed) did not prevent the recurrence.

One pre-existing asymmetry this task must respect: the pure `checkSplitRecommendation`
(`proposal-convergence.ts:130`) has a third trigger, `split-touch-set-too-large` (:140-142), that is
**not wired into production `_splitCheck`** — verified via `grep -c split-touch-set-too-large`
returning 0 in BOTH workflow mirrors; it is exercised only by the module's own test suite. Wiring it
into production is out of scope; the design below stays correct whether or not a future child wires
it.

### Chosen mechanism

Six additive elements (M1-M5 plus two cross-cutting elements X1-X2), all preserving the "pure logic
in `proposal-convergence.ts` + import-free inline twin in both workflow mirrors" constraint. Every
new input degrades to today's behavior when absent; nothing replaces the bounded-convergence loop.
Elements map 1:1 onto the task's Requested action items: M1↔RA1+RA2, M2↔RA3, M3↔RA4, M4↔RA5,
M5↔RA6, X1/X2↔AC8/AC11.

**(M1) Typed mechanism inventory; the count is derived, never reported (RA1+RA2).** The round-0
prompt (:506) and schema (:508) replace the bare `mechanismCount` field with
`mechanisms: [{id, owner, proofSurface, dependsOn: [id...], independentlyShippable: boolean,
rationale}]`. The prompt embeds the ONE grouping rule (RA2, grounded verbatim in `b8b87c3`'s
Mechanism A / Mechanism B ruling): call-site variants required to satisfy one atomic behavior
contract fold into ONE entry unless a strict subset can ship independently with a complete safety
contract and independent user value. The reviewer fills typed entries and judges
`independentlyShippable` per entry; it never reports a bare integer. Two new pure functions in
`proposal-convergence.ts` (inlined as `_deriveMechanismInventory`/`_hashMechanismInventory` in both
mirrors, same convention as `_splitCheck`):

- `deriveMechanismInventory(mechanisms)` validates fail-closed (`mechanism-inventory-invalid`) on a
  duplicate `id`, a dangling `dependsOn` edge, or two entries sharing an identical `proofSurface`
  (anti-laundering: one provable contract cannot become two cosmetically distinct "mechanisms" —
  this is what mechanically enforces AC3's "distinct proof surface"). On success → `{ok:true, count,
  inventoryHash}` with `count = inventory.filter(m => m.independentlyShippable).length` — **a
  script-side mechanical derivation, never a trusted reviewer integer, on any steady-state production branch**
  (AC1 — the ONE-generation `legacy-scalar` fallback below is the sole flagged, sunset-enforced
  exception). `_splitCheck`/`checkSplitRecommendation` gain a `mechanismInventory` parameter and perform
  the derivation themselves; `mechanismCount` as a directly-trusted input disappears from every
  non-legacy production path.
- A *missing* `mechanisms` field (absent — distinct from an explicit `[]`) is a new fail-closed
  terminal `needs-human`/`mechanism-inventory-missing`, mirroring the existing
  `wiring-coverage-check-failed` pattern (:550-553) — never silently "zero mechanisms."
- `hashMechanismInventory(mechanisms)` computes a canonical, rename/reorder-stable projection:
  entries sorted by `proofSurface`, each reduced to `{proofSurface, independentlyShippable,
  dependsOn}` with `dependsOn` re-expressed via the target entries' `proofSurface` values (sorted —
  not free-text `id`s), then sha256'd over `JSON.stringify` of the sorted-key projection. This is the
  same "anchor identity on a stable field, not prose" idiom `fingerprintFinding` (:64) and
  `_fingerprint` (:436-442) already use, applied one level up. Relabeling/reordering entries changes
  neither `count` nor `inventoryHash` (AC2).

The pure module's `nextAction()` (`proposal-convergence.ts:155-165`, verified action set
`dispatch-full-synthesis|stop-prepared|stop-split|stop-needs-human|dispatch-delta-round`) — the ONE
decision function the loop consults — keeps its signature shape via an ADDITIVE `splitCheck` payload
field plus an additive `splitBypassAvailable` input and a matching `consume-split-bypass` action for
(M3), so the module's single-decision-function property survives.

**Legacy compatibility:** a reviewer output carrying only the legacy scalar `mechanismCount` (no
`mechanisms` array) is accepted for exactly ONE generation as a synthetic single-entry inventory
(`{id:'legacy-0', proofSurface:'legacy', independentlyShippable: mechanismCount > 2}`), flagged
`mechanismInventorySource:'legacy-scalar'` in ledger/telemetry so the fallback is auditable, never
silent — mirroring DIR-125's own bare-number `findings` fallback precedent at :519-525 and keeping
existing mocks/fixtures green (AC12). The production prompt no longer requests the bare field.

**The ONE-generation sunset is mechanically enforced, not audit-only.** The M5 ring entry carries
one additive field, `mechanismInventorySource` (`'typed' | 'legacy-scalar'`), and on ring append
the phase compares against the immediately-preceding same-`(charterHash, scopeHash,
reviewPolicyHash)` entry: if BOTH the current and the preceding entry carry
`mechanismInventorySource:'legacy-scalar'`, the generation fails closed with the SAME
`needs-human`/`mechanism-inventory-missing` terminal the reviewer-output path produces — a second
consecutive scalar-only output IS a missing inventory once the one-generation allowance is
exhausted (the same ProposalReview/reviewer-output context AC17's disambiguation names, not a third
code). The fallback is therefore self-terminating on any real production stream: at most one
consecutive legacy-format generation per scope key; a reviewer that keeps emitting the scalar hits
a human decision point, not an indefinite fallback. AC12's fixtures still pass because they
exercise the legacy shape in isolation — a single generation against an empty or typed ring
history never presents two consecutive `legacy-scalar` entries at one key.

**(M2) Root-cause-aware blocking clustering (RA3).** `_findingSchema` (:486-493) gains two OPTIONAL
fields: `rootCauseKey` (reviewer-supplied string) and `repairable` (boolean, **default `false` —
fail-closed**). `groupBlockingBySubsystem` is superseded by `groupBlockingByRootCause(ledger)`: per
subsystem, count DISTINCT `rootCauseKey` values, falling back to the finding's own `id` when
`rootCauseKey` is absent (exactly today's one-finding-one-member behavior for legacy findings). Three
findings sharing one `rootCauseKey` count as ONE cluster member toward the unchanged `>= 3`
threshold; three independently-rooted blockers still trip it. All findings remain individually
visible in the ledger — `rootCauseKey` is additive to `id`/`subsystem`, never a merge key — so AC4's
"remain three ledger entries" holds by construction.

**(M3) One bounded focused revision before a REPAIRABLE cluster becomes terminal (RA4).**
`_splitCheck`'s return gains `repairable: boolean`, `true` ONLY for `split-subsystem-blocking-cluster`
and ONLY when every finding contributing to the triggering cluster has `repairable === true`.
`split-multi-mechanism` is never eligible — it denotes scope that cannot be repaired without changing
the charter, exactly the immediate-split case RA4 preserves. (`split-touch-set-too-large` exists only
in the pure trigger set — verified absent from production `_splitCheck` — so it needs no carve-out
today; the exclusion applies if/when a future child wires it in.)

The loop introduces `let _splitBypassUsed = false` before `while(true)` (:563). When
`split.recommend && split.repairable && !_splitBypassUsed` at `_deltaRound === 0`, the loop does NOT
`break` at :568 — it sets `_splitBypassUsed = true`, records the bypass in telemetry/receipt metadata
(`splitBypassUsed: true`, so golden replay can prove the bypass FIRED, not merely that the function
returned `repairable:true`), and falls through to the existing unchanged focused-revise +
delta-review dispatch (:579-616, now carrying `rootCauseKey`/`repairable` through `_upsertFindings`).
On the next iteration a still-recommended split terminates normally — exactly one focused revision +
one delta review, never an unbounded retry (AC5). A non-repairable split still breaks on the first
check, unchanged. In the pure module the bypass is expressed in `nextAction()` as the additive
`splitBypassAvailable` input / `consume-split-bypass` action, cross-checked by extending the existing
"inline caps match `capsFor()`"-style cross-check test (module header :18-20 names it).

**(M4) Hash-bound human decision record + admission-time adjudication (RA5).**

*Decision record.* A new git-committed additive sibling tree
`milestones/prepare-decisions/<taskId>.json` beside the existing permanently-committed
`milestones/prepare-telemetry/` tree (verified via `git ls-files milestones/prepare-telemetry/` —
committed records exist, schemaVersion 2, including a subdirectory for this very task) — same
durability class, distinct purpose (a human ruling, not derived verification output):
```json
{ "schemaVersion": 1, "taskId": "...",
  "charterHash": "sha256...", "scopeHash": "sha256...", "reviewPolicyHash": "sha256...",
  "mechanismInventoryHash": "sha256...",
  "decision": "commit" | "split", "reason": "...",
  "authorizingSessionId": "...", "decidedAtMs": 0,
  "invalidations": [{"atMs":0,"generationId":"...","mismatchedFields":["scopeHash"],"priorValue":"...","currentValue":"..."}] }
```
Two new CLI submodes on `proposal-convergence.ts` (same `agent()`-wraps-CLI dispatch pattern via
`_convergenceAgentCall`, `prepare-milestone.js:157`):
- `--record-split-decision --taskId --workspace --charterFile --decision commit|split --reason
  --sessionId` — **human-invoked only**; performs no adjudication of its own, only persistence of a
  human-supplied decision (`--decision`/`--reason` required, never inferred). Enforced by a
  grep-based regression test asserting the literal string `record-split-decision` appears in no
  agent-prompt template anywhere in either workflow mirror (AC7), plus a companion grep that the
  `prepare-decisions/` path string appears only in the `--decide-split` read path and the
  `--record-split-decision` write path. This mirrors the actual precedent (`b8b87c3` was a human
  `git commit`, no agent authored it) and the same trust model as
  `.halt`/`restart-readiness-check.sh`.
- `--decide-split --taskId --workspace --charterFile` — a pure read-only evaluator
  (`decideSplitAdjudication`) invoked at a single integration point: **unconditionally** immediately
  AFTER the resume-decision conditional block's closing brace (:295) and strictly BEFORE
  `phase('Preflight')` (:304). Unconditional placement (NOT inside the
  `if ($a.resumeFromAdjudicatedProposal === undefined)` block :250-295) is deliberate and is the key
  divergence from an "inside the block" placement: that block is skipped entirely when a caller passes
  the flag explicitly, so an explicit-resume dispatch would bypass a recorded SPLIT — an unrecorded
  scope-reset back door. A SPLIT block at this slot guarantees ZERO new content-agent dispatch this
  generation on EVERY entry path (the return precedes every `proposal-author-*`/`adjudicate`/
  `proposal-review`/`plan-author`/`plan-check-*` `agent()` call in file order — the same
  structural-zero-dispatch property Admission's :223-236 and Preflight's :318-325 returns already
  rely on). Ordering note: on the default path the block still runs `--decide-resume` → `reuse-
  terminal` (which may return at :275-289) BEFORE the block closes and `--decide-split` runs — so
  `reuse-terminal` strictly precedes decision-record consultation, which is correct: a byte-identical
  cache hit is the STRONGER condition and must return without reading the record; the record governs
  the case DIR-126-C cannot (hashes changed, scope unchanged). Evaluation order:
  1. No record for `(charterHash, scopeHash, reviewPolicyHash)` → `no-decision-on-file`: normal
     live adjudication per (M1)-(M3)/(M5).
  2. Record `decision:'commit'`, all three hashes unchanged → `skip-split-adjudication`: proceed,
     with a `splitCheckDisabled` flag threaded to the ProposalReview loop — `_splitCheck` is NOT
     CALLED AT ALL this generation (ordinary blocking-finding review still runs). Scope-level
     suppression at the loop call site, not per-round re-comparison (AC6).
  3. Record `decision:'commit'`, any of the three hashes differ → `decision-invalidated`: append an
     entry to that SAME committed record's `invalidations` array (mismatched fields + old/new values —
     a git-diffable evidence edit, never a disappearing log line), then proceed as
     `no-decision-on-file`.
  4. Record `decision:'split'`, all three hashes unchanged → `content-dispatch-blocked`: return
     `{outcome:'needs-human', reason:'split-decision-blocks-dispatch', phase:'Admission'}`
     immediately — zero ProposalAuthors/Adjudicate/ProposalReview/PlanAuthor/PlanCheck dispatches
     (AC9). (The `phase:'Admission'` label is pinned to match this task's frozen grounding-evidence
     AC verbatim; it is a return-shape tag, not a phase-ordering claim — the call site physically
     sits between `phase('Admission')` :130 and `phase('Preflight')` :304.)

  **`mechanismInventoryHash` is recorded for audit but deliberately EXCLUDED from the match
  condition.** A regenerated Proposal yields a syntactically different (structurally equivalent)
  inventory nearly every round; requiring exact equality would make COMMIT re-match almost never —
  silently reproducing the exact defect being fixed. The ruling binds to reviewed SCOPE, not one
  generation's inventory bytes.

**(M5) Cross-generation instability detection (RA6).** A NEW gitignored bounded ring file
`.quay/prepare-leases/<taskId>.mechanism-history.json` (last 5 entries — `.quay/prepare-leases/`
verified gitignored via `git check-ignore`), each `{charterHash, scopeHash, reviewPolicyHash,
mechanismInventoryHash, mechanismCount, mechanismInventorySource, generationId, atMs}`, appended
once per full-review round
(round 0 only — delta rounds reuse the round-0 inventory). This is a SEPARATE file from
`.quay/prepare-leases/<taskId>.generation.json` on verified write-semantics grounds: the generation
record is overwritten wholesale per terminal (`proposal-convergence.ts:639`
`fs.writeFileSync(_generationPath(...))`) under a pre-existing `{ok:false}` no-release failure
contract (the shared release/telemetry try block at :677-697 — a `.generation.json` write failure
must keep yielding no release, byte-for-byte); a cross-generation history field cannot survive a
wholesale overwrite without a read-modify-write that would entangle that release path. A separate
gitignored sibling keeps each writer's contract simple and a history-write failure non-fatal
(observability, never a gate). The DURABLE human artifact remains the committed decision record (M4);
the instability signal is transient in-flight stream state, so keeping its churn off git avoids a
commit per review round, and a fresh clone forgetting a mid-stream comparison costs at most one extra
auto-dispatch before the detector re-arms — never a lost human ruling.

Before a live (non-suppressed) `split-multi-mechanism`-class recommendation is honored, the phase
compares the current `mechanismInventoryHash` against the SINGLE immediately-preceding entry sharing
the same `(charterHash, scopeHash, reviewPolicyHash)` key:
- no prior entry at this key, or prior hash MATCHES → normal `_splitCheck` evaluation (two
  consecutive generations agreeing is a consistent signal, not instability);
- prior entry exists and DIFFERS → `needs-human`/`split-assessment-unstable`, stop — does not
  auto-dispatch another generation; requests exactly one human decision (RA6).

Replay of the REAL recorded sequence (8 → 4 → ≤2 → 6, no two consecutive rounds agreeing): gen 1
(count 8, no prior) → normal `split-recommended`; gen 2 (count 4, differs) →
`split-assessment-unstable`, stop. Rounds 9/10 (≤2, 6) would never have been auto-dispatched — the
human decision point lands at generation 2, exactly where DIR-126-D's real saga (`b8b87c3`)
eventually had to land anyway, after 2 generations instead of 11 (AC10).

**(X1) Receipt-phase inventory hash-binding (AC8).** `milestone-preparation-check.ts` (both mirrors,
verified byte-identical) gains `--mechanism-inventory <file>` as the THIRD instance of its verified
hash-binding pattern — after `--ledger` (`buildReceipt` binding `:86`
`ledgerHash = ledgerFile ? sha256(fs.readFileSync(ledgerFile, "utf8")) : undefined`, `hashes.ledger`
`:100`, `checkPreparation` fail-closed codes `ledger-missing` :354-355 / `ledger-stale` :358-359 /
`ledger-malformed` :363-365 / `ledger-blocking-findings-open` :367-369, argv parsed :464) and
`--telemetry` (DIR-126-D A.5/B.1, :467): `buildReceipt` binds `hashes.mechanismInventory`;
`checkPreparation` fails closed on `mechanism-inventory-missing`/`mechanism-inventory-stale`
mirroring `ledger-missing`/`ledger-stale` exactly. Workflow side: the Receipt phase writes
`milestones/${_milestoneId}/mechanism-inventory.json` beside `proposal-ledger.json` (verified
convention :775/:818) and adds `--mechanism-inventory ${_inventoryFile}` to the `--build` invocation
(:824). **Touches status verified, not assumed:** the task's own `## Touches` list ALREADY contains
both `milestone-preparation-check.ts` paths (confirmed by direct read of the task file this session),
so AC13's remaining obligation is that the Plan's `- Files:` lines carry both paths so the live
`preflightTouchesMismatch` detector (`prepare-admission-check.ts:492-493`, code
`preflight-touches-mismatch` :259, CLI `--preflight-plan` :619) returns `ok:true` against the
resulting Plan — verified by a real `--preflight-plan` run, not prose.

**(X2) One policy-version source of truth (AC11).** A new `MECHANISM_POLICY_VERSION = "mechanism-v1"`
folds into the SAME `_currentReviewPolicyHash()` (verified :482-484, currently
`sha256(`${PREFLIGHT_POLICY_VERSION}::${RESUME_POLICY_VERSION}`)`, becoming
`sha256(...::MECHANISM_POLICY_VERSION)`). One bump invalidates BOTH DIR-126-C's resume cache and this
task's COMMIT/SPLIT suppression — never two independently-bumpable literals that drift. Consequence:
one one-time cold-cache pass at cutover; both existing consumers treat the hash opaquely.

### Concrete control/data flow

```
phase('Admission') (:130, unchanged)
  -> acquire / prepare-already-running / fail-closed (:219-238, unchanged)
  -> resume-decision conditional block (:250-295, unchanged, DIR-126-C; runs ONLY when resumeFromAdjudicatedProposal is omitted)
     -> --decide-resume (:265) -> reuse-terminal? inline release + return, 0 dispatches (:275-289, unchanged — strictly precedes the NEW step)
  -> NEW (UNCONDITIONAL, after the block's closing brace :295, still before phase('Preflight') :304 — fires on BOTH the default and explicit-resume paths):
     --decide-split {charterHash, scopeHash, reviewPolicyHash}
     -> content-dispatch-blocked (SPLIT match)    -> needs-human/split-decision-blocks-dispatch, phase:'Admission', 0 dispatches
     -> decision-invalidated (COMMIT, mismatch)   -> append invalidations[] to SAME committed record, proceed as no-decision
     -> skip-split-adjudication (COMMIT match)    -> proceed, splitCheckDisabled=true carried to loop
     -> no-decision-on-file                       -> proceed, normal live adjudication
     -> unparseable/non-zero-exit verdict         -> fail phase CLOSED (mirrors resume-decision-failed :269)
phase('Preflight') (:304, unchanged)
phase('ProposalAuthors')/Adjudicate (unchanged; skipped under resume as today :334-339)
phase('ProposalReview') (:406)
  -> round-0 full review (:498) returns {findings(+rootCauseKey,+repairable), mechanisms, proposalHash, nowMs, sessionId}
     (mechanisms replaces mechanismCount in prompt :506/schema :508; legacy scalar accepted ONE gen, flagged)
  -> wiring-coverage-check agent (:542, unchanged call/merge/fail-closed)
  -> NEW: deriveMechanismInventory(mechanisms) -> {count, inventoryHash} | needs-human
     (mechanism-inventory-missing / mechanism-inventory-invalid, fail closed)
  -> NEW: append ring entry (carries mechanismInventorySource) to .quay/prepare-leases/<taskId>.mechanism-history.json (bounded 5; write failure non-fatal)
     (second consecutive 'legacy-scalar' at the same scope key -> mechanism-inventory-missing, stop — M1 sunset)
  -> NEW: compare vs immediately-preceding same-scope entry -> differs -> split-assessment-unstable, stop
  -> while(true) (:563, existing structure, parameterized):
     - zero open blocking -> zero-finding PASS (unchanged)
     - splitCheckDisabled -> _splitCheck NOT called this generation
     - else split = _splitCheck(inventory-derived count, ledger-with-rootCauseKey)
         - recommend && repairable && !_splitBypassUsed && deltaRound===0
             -> consume bypass, record splitBypassUsed=true, fall through (NO break at :568)
         - recommend (otherwise) -> split-recommended, break (:568, existing terminal, inventory attached)
     - budget/delta-cap checks (:571/:573, unchanged)
     - focused-revise (label proposal-revise-round-N :588) + delta-review dispatch (:579-616, unchanged machinery)
phase('PlanAuthor') (:637) / PlanCheck (:710, unchanged)
phase('Receipt') (:754)
  -> write milestones/M<NN>/mechanism-inventory.json beside proposal-ledger.json (:775/:818 convention)
  -> --ledger binding (unchanged) + --telemetry binding (unchanged) + NEW --mechanism-inventory <file> binding (:824)
     (third sibling of the pattern; fails closed: mechanism-inventory-missing / mechanism-inventory-stale)
```

### Key design decisions

1. **`scopeHash` is a NEW deliberately prose-insensitive hash, NOT a reuse of DIR-126-C's
   `taskContractHash`.** Verified: `taskContractHash = sha256(`${ac}\n${dod}\n${touches}`)` (:500)
   is compared at `decideResumeGeneration` step 7 (:309), before `reuse-terminal` — it flips on a
   typo fix, by design correct for caching, wrong here: the DoD requires finality be "invalidated by
   real scope change but not by wording-only Proposal or AC edits." `scopeHash =
   sha256(canonicalJSON({acBoxCount, touchesSorted}))` with keys canonicalized, derived via the
   EXISTING `extractSection` (`task-schema.ts:73`) + `countBoxes` (`task-schema.ts:210`) exports —
   both already imported by `prepare-admission-check.ts:43` and used at its :586 — sensitive to an AC
   checkbox item or Touches path added/removed, insensitive to sentence-level rewording. Micro-choice:
   the DoD box count is deliberately EXCLUDED from `scopeHash` — adding an audit-obligation checkbox
   to the DoD is not a change to the work's scope, and including it would over-invalidate committed
   rulings. This is the one deliberate divergence from "reuse an existing hash," required by the
   task's own acceptance language, not a style choice.
2. **`charterHash` stays the existing raw-text hash** (:499) — the DoD calls out Proposal/AC wording,
   not charter wording, and charters are milestone-scoped artifacts that rarely change mid-stream.
3. **`mechanismInventoryHash` is audit-only, excluded from the match condition** (see M4) — exact
   equality would degrade the whole mechanism back to "no finality."
4. **Identity and counting are fully mechanical; grouping stays bounded, TYPED reviewer judgment.** A
   purely mechanical prefix/naming-convention grouper was rejected (Alternatives): it would encode a
   formatting convention as ground truth and move the "who decides the grouping" ambiguity up one
   layer. The LLM surface shrinks from "report an integer" to "fill typed entries with stable proof
   surfaces" — strictly more auditable, and fail-closed validated.
5. **`repairable` defaults `false` (fail-closed), is eligible only for
   `split-subsystem-blocking-cluster`, and is one-shot.** Every contributing finding must be
   affirmatively marked; legacy/unmarked findings behave exactly as today.
6. **Only a human-invoked CLI call writes a decision record; no agent path can self-grant
   COMMIT/SPLIT** — mirroring the actual precedent (`b8b87c3` was a human `git commit`) and the
   `.halt`/`restart-readiness-check.sh` trust model. The guarantee is procedural + regression-tested
   (grep), not cryptographic — accepted, consistent with this repo's other human-steering points.
7. **One policy-version literal (X2)** — a future split-semantics change invalidates both consumers
   through one bump; two separately-bumpable versions would drift, violating this repo's
   single-source-of-truth principle.
8. **Instability detection compares only the immediately-preceding same-scope attempt** — the observed
   defect is consecutive-round non-monotonic drift (8→4→≤2→6, no two consecutive rounds agreeing); a
   longer window or majority vote invents an ungrounded statistical parameter (window size, vote
   threshold) catching no additional observed failure mode.
9. **Separate `mechanism-history.json` ring, NOT a field appended to `.generation.json`** — on the
   verified wholesale-overwrite (:639) + `{ok:false}` no-release contract (:677-697) (M5 rationale);
   a read-modify-write would change the very write-semantics the addition claims to leave untouched.
10. **`--decide-split` dispatches UNCONDITIONALLY, outside the resume-flag conditional** — see (M4):
    the resume-decision block (:250-295) runs ONLY when the caller omits `resumeFromAdjudicatedProposal`;
    an explicit-true dispatch must ALSO honor a recorded SPLIT, or the flag is an unrecorded
    scope-reset back door. Cost: one non-content CLI dispatch per generation on the explicit-flag
    path (already that path's norm). `reuse-terminal` still strictly precedes decision-record
    consultation on the default path (the stronger condition returns first), so DIR-126-C's landed
    evaluation order is preserved.
11. **The SPLIT-block `needs-human` return uses `phase:'Admission'`** to match this task's frozen
    grounding-evidence AC verbatim (`{outcome:'needs-human', reason:'split-decision-blocks-dispatch',
    phase:'Admission'}`), keeping Proposal and AC self-consistent. The label is a return-shape tag,
    not a phase-ordering claim.

### Defaults and failure behavior

- Missing `mechanisms` on a fresh (non-legacy) dispatch → `needs-human`/`mechanism-inventory-missing`
  — today's silent-undefined behavior (`_mechanismCount` → `undefined` → `_splitCheck` skips the
  count branch at :558) is removed, never silently skipped.
- Second consecutive `legacy-scalar` reviewer output at the same `(charterHash, scopeHash,
  reviewPolicyHash)` scope key → `needs-human`/`mechanism-inventory-missing` (M1's sunset: the
  one-generation allowance is exhausted, so the scalar-only output is now treated as a missing
  inventory); a FIRST legacy-format output at a scope key is still accepted as the synthetic
  single-entry inventory.
- Invalid inventory (duplicate `id`, dangling `dependsOn`, duplicate `proofSurface`) →
  `needs-human`/`mechanism-inventory-invalid`.
- `rootCauseKey`/`repairable` omitted → each finding is its own cluster member (legacy behavior) and
  non-repairable (immediate-split-eligible) — safe defaults, no silent leniency.
- No decision record for current hashes → exactly today's behavior (default no-op path).
- Record exists, hashes mismatch → `decision-invalidated` with explicit `mismatchedFields` and an
  `invalidations[]` append on the SAME committed file — never a silent "doesn't apply."
- Inventory hash matches the immediately-preceding same-scope entry → normal evaluation (consistent
  signal); differs → `split-assessment-unstable`, stop.
- Unparseable/non-zero-exit verdict from `--decide-split`/`--record-split-decision` → phase fails
  closed, mirroring `wiring-coverage-check-failed` (:550-553) / `resume-decision-failed` (:269) —
  never conflated with "no decision applies."
- `mechanism-history.json` append failure (I/O) → non-fatal, logged only (mirrors `telemetryWriteOk`
  discipline) — observability never gates; a write failure never blocks or falsely passes.

### Compatibility

- All three mirror pairs stay byte-identical (`diff -q`-verified today; the Plan must preserve it).
- `_findingSchema` gains two OPTIONAL properties; legacy findings behave exactly as today.
- `checkSplitRecommendation`'s exported name and `{recommend, code, reason}` shape preserved;
  `mechanismInventory`/`repairable` are additive — existing destructuring callers unaffected.
  `nextAction` gains only an additive input and one additive action value.
- Reviewer schema retains `mechanismCount: {type:'number'}` for one generation as a flagged legacy
  fallback only (`mechanismInventorySource:'legacy-scalar'`, the ONE-generation sunset mechanically
  enforced via consecutive-legacy ring detection — M1), mirroring DIR-125's bare-number
  `findings` fallback precedent (:519-525) — keeps existing mocks/fixtures green (AC12).
- `CACHEABLE_TERMINALS`/`decideResumeGeneration` evaluation order untouched; `split-recommended`
  stays a cacheable terminal on unchanged `proposalHash` (verified :247-250 — this task's own
  `.generation.json` recorded `cacheable: true` at its `split-recommended` generation
  `0eba810e4ccb`; the file's CURRENT record is the later `preflight-rejected` generation cited in
  the Problem framing). This task adds a PARALLEL coarser (scope-keyed, not
  proposal-text-keyed) short-circuit that fires before a reviewer would even run — complementary, not
  replacing. Only `_currentReviewPolicyHash()`'s internal composition changes (X2); both existing
  consumers treat it opaquely.
- `milestones/prepare-telemetry/` (schemaVersion 2) untouched; `milestones/prepare-decisions/` is a
  new additive sibling tree, not a migration. `.quay/prepare-leases/*.generation.json` write semantics
  (including no-write-on-reuse-terminal and the `{ok:false}` no-release contract) stay byte-for-byte
  untouched (decision 9); the instability signal lives in the separate `mechanism-history.json` ring.
- Existing zero-finding, legitimate-split, receipt, lease-release, and fail-closed tests stay green
  because every new field/branch degrades to today's behavior when absent, in BOTH mirrors.

### Risks

- **Repairable-carve-out gaming.** A reviewer could mis-mark a genuinely non-repairable cluster
  `repairable:true`. Blast radius bounded to at most one extra delta round by the one-shot guard;
  terminal regardless afterward.
- **Legacy-scalar compatibility window.** For exactly one consecutive generation per scope key the
  bare reviewer integer still drives the split outcome through the synthetic `legacy-0` inventory.
  Accepted-risk note: this is the flagged compat window that keeps existing mocks/fixtures green
  (AC12); it is audited (`mechanismInventorySource:'legacy-scalar'` in ring/ledger/telemetry, never
  silent) and self-terminating — consecutive-legacy ring detection fires
  `mechanism-inventory-missing` on a second consecutive scalar-only output, so the window cannot
  extend itself.
- **Procedural human-authorship guarantee** for `--record-split-decision` — accepted, consistent with
  `.halt`/`restart-readiness-check.sh`; mitigated by the grep-based regression test (both halves,
  AC7).
- **`scopeHash` under/over-sensitivity.** Insensitive to wording by design (DoD-required): a subtle
  meaning change inside an unchanged AC item count + Touches set would NOT invalidate a COMMIT.
  Accepted: "cosmetic reword" vs "meaning changed" is not mechanically decidable; item-count/path-set
  change is the actually-observed proxy in this repo's history.
- **Inline/pure-function mirror drift.** This task adds several new pure functions
  (`_deriveMechanismInventory`, `_hashMechanismInventory`, `groupBlockingByRootCause`,
  `decideSplitAdjudication`) that must stay in lockstep across `proposal-convergence.ts` and both
  workflow mirrors (no-imports convention). Mitigated by extending the existing "inline caps match
  `capsFor()`" cross-check test (module header :18-20) to a fixture battery over the new functions'
  outputs.
- **Golden-replay obligation (charter Done-when).** The Plan must build a fixture from DIR-126-D's
  REAL recorded sequence (rounds 6/7/9/10: 8 → 4 → ≤2 → 6; cross-check `git show -s --format=%B
  7808f0c`/`1170b25`/`a449053`/`b8b87c3`) and confirm `split-assessment-unstable` fires exactly once
  at generation 2 — not an invented approximation — plus replay a legitimate 3-mechanism split case
  and a COMMIT-then-unchanged-rerun case.
- **Plan/Touches alignment risk.** Mechanism (X1) requires the Plan's `- Files:` lines to name both
  `milestone-preparation-check.ts` paths; the task's `## Touches` already lists them (verified this
  round), so the live `preflightTouchesMismatch` gate (`prepare-admission-check.ts:492-493`) is the
  mechanical check the Plan must pass — flagged at author/review time (AC13). (An earlier round's body
  claimed the Touches list omitted them; that is now stale — they are present, and the obligation is
  Plan alignment, not a Touches edit.)
- **One-time cold-cache pass at cutover** (X2's policy-hash composition change) — accepted; both
  consumers treat the hash opaquely, so the only observable effect is one non-reused generation.
- **Unbounded growth of `milestones/prepare-decisions/`** over repo lifetime — accepted, identical
  already-accepted risk class as `milestones/prepare-telemetry/`.

### Non-goals

- Not weakening safety review or auto-accepting large/risky tasks — immediate-split paths
  (`split-multi-mechanism`, non-repairable subsystem clusters, and `split-touch-set-too-large` if a
  future child ever wires that currently-test-only trigger into production) are unchanged.
- Not automating the COMMIT/SPLIT decision — strictly human-authored; no agent path writes a decision
  record for itself.
- Not making mechanism GROUPING fully mechanically deterministic — the inventory is LLM-authored, now
  typed/validated/hash-stable, not correct by construction.
- Not wiring `split-touch-set-too-large` into production `_splitCheck` (test-only today; verified 0
  grep matches in both mirrors) — out of scope.
- Not touching `prepare-admission-check.ts` (not in Touches; byte-unchanged is an AC-level check,
  WIRING CLAIM P7) — `extractSection` and `PREFLIGHT_POLICY_VERSION` are consumed read-only via
  `proposal-convergence.ts`'s already-existing imports (:26 imports `extractSection` from
  `task-schema.ts`; :27 imports `PREFLIGHT_POLICY_VERSION` from `prepare-admission-check.ts`).
  `countBoxes` is NOT yet imported by `proposal-convergence.ts` (it is imported by
  `prepare-admission-check.ts:43`); the scopeHash computation needs ONE additive `countBoxes` import
  added to `proposal-convergence.ts:26` — an additive import in a file already in Touches, so
  `task-schema.ts` itself stays read-only and correctly absent from Touches, and WIRING CLAIM P7
  (`prepare-admission-check.ts` byte-unchanged) is unaffected.
- Not touching PlanCheck's separately-bounded loop (`milestone-preparation-check.ts`'s
  `plancheck-rounds-exceeded`) beyond the additive Receipt binding (X1).
- Not migrating historical `prepare-telemetry/` schemaVersion-2 records; not retrofitting old
  `.generation.json` files.
- Not implementing an automated "perform the split" action — a SPLIT decision only blocks further
  content-agent dispatch; actually splitting into children stays a human/DIR-028 `quay-directive`
  action.
- Not solving LLM self-report noise in phases other than ProposalReview's split path.

### AC coverage

- AC1 (typed inventory; mechanically derived count; no bare int trusted on steady-state production
  paths; one-generation legacy fallback sunset-enforced) → (M1): `_splitCheck` consumes only
  `deriveMechanismInventory`'s derived count on every non-legacy production path, and the
  consecutive-legacy ring detection mechanically enforces the fallback's ONE-generation limit.
- AC2 (A.1-A.5 grouped as one mechanism; read-only report as a second; rename/reorder-stable
  hash/count) → (M1)'s grouping-rule prompt instruction (grounded in `b8b87c3`'s verbatim Mechanism A
  / Mechanism B ruling — commit text says A.0-A.5) + `proofSurface`-sorted `inventoryHash` +
  RED/GREEN fixture.
- AC3 (genuine 3-mechanism fixture still splits; distinct proof surfaces) → (M1)'s
  duplicate-`proofSurface` rejection + unchanged `> 2` threshold over the derived count.
- AC4 (rootCauseKey clustering; three ledger entries preserved; independently-rooted blockers still
  trigger) → (M2), `groupBlockingByRootCause` with id-fallback.
- AC5 (repairable cluster gets exactly one focused revision + delta review; non-repairable stops
  immediately; `splitBypassUsed:true` in receipt/telemetry AND `proposal-revise-round-1` in the
  journal) → (M3), `_splitBypassUsed` one-shot gate + `nextAction`'s `consume-split-bypass` +
  telemetry evidence field.
- AC6 (COMMIT skips split adjudication on unchanged hashes, proven at the loop CALL SITE via
  `splitCheckDisabled`; material scope change invalidates + records reason) → (M4) steps 2-3,
  `scopeHash` decision 1, `invalidations[]` append.
- AC7 (`--record-split-decision` human-invoked only, grep-proven; `prepare-decisions/` path string
  read-exclusive) → (M4) record submode + decision 6, both grep halves.
- AC8 (Receipt `--mechanism-inventory` binding structurally identical to `--ledger`; fails closed
  mirroring `ledger-missing`/`ledger-stale`) → (X1), precedent lines :86/:100/:354-369/:464 verified
  above.
- AC9 (SPLIT blocks dispatch: zero new content agents until task-graph change or authorized scope
  reset) → (M4) step 4 + decision 10, unconditional integration point before `phase('Preflight')`
  :304.
- AC10 (8→4→≤2→6 replay → one `split-assessment-unstable` at generation 2, not four terminals) →
  (M5) instability detection over `mechanism-history.json`.
- AC11-pre (`prepare-admission-check.ts` byte-unchanged, both mirrors) → Non-goals + wiring claim P7
  (diff/cmp evidence).
- AC12 (existing zero-finding/legitimate-split/receipt/lease-release/fail-closed tests green, both
  mirrors) → Compatibility section.
- AC13 (both `milestone-preparation-check.ts` paths in `## Touches` — verified already present — and
  `preflight-touches-mismatch` gate passes on the Plan) → (X1) + wiring claim P10.
- AC14 (`MECHANISM_POLICY_VERSION` single-bump invalidator of both mechanisms) → (X2) + wiring claim
  P11.
- AC (grounding evidence) → Problem framing's verbatim commit-subject citations
  (`7808f0c`/`1170b25`/`a449053`/`b8b87c3`), the verbatim `b8b87c3` ruling quote, the current-tree
  line numbers verified by direct read in this session, the grep-verified greenfield, and this
  task's own `.generation.json` split-recommended record (historical generation `0eba810e4ccb`,
  with the current record being the later `preflight-rejected` generation `31161d095578`).

### Alternatives considered and rejected

1. **Average/median `mechanismCount` across N reviewers.** Smooths the symptom without explaining it;
   still trusts a bare integer — fails the typed-inventory AC outright, and N>1 full reviews per round
   burn the exact token budget the bounded loop exists to cap.
2. **Purely mechanical grouping from naming-prefix/WIRING-CLAIM conventions.** Brittle to
   validy-different Proposal formatting; silently substitutes one ungrounded convention for another;
   RA2 explicitly preserves the semantic "unless a strict subset can ship independently" judgment.
   (Folding `wiring-coverage-check.ts` `claimIds` into `proofSurface` is DEFERRED, not rejected
   forever — it needs a Proposal-format dependency not required by the AC wording; a future task may
   adopt it once the base mechanism has production observation.)
3. **Raise the delta-round cap instead.** DIR-126-D's 11 dispatches already vastly exceeded normal
   caps without converging; more rounds of the same ungrounded signal reproduce the defect more
   slowly, not differently.
4. **Re-run the split check with a fresh reviewer every delta round.** Reintroduces the
   DIR-120/M192 unbounded-restart risk DIR-125 was built to close; no natural stopping point distinct
   from the budget/delta-cap machinery tuned for a different purpose.
5. **Gitignored/ephemeral decision record (parallel to `.generation.json`).** Defeats finality
   durability: a fresh clone/worktree/`git clean` would forget a human ruling, reproducing the
   original defect one layer down. (The *instability signal*, by contrast, is transient and correctly
   lives in the gitignored ring file — decision 9.)
6. **Let the ProposalReview agent write the decision record on self-assessed zero blockers.**
   Precisely the trust boundary this task protects — self-report must never become self-authorization.
7. **Store the decision as a task field (`extra.splitDecision`) via `task_write`.** The task body is
   the Proposal/Plan/AC/DoD single source of truth (DIR-028); a ruling belongs beside the other
   preparation-stage derived artifacts, hash-bound to the same `(charterHash, scopeHash,
   reviewPolicyHash)` triple the module already uses.
8. **Unconditional (not `repairable`-gated) one-time bypass.** Would burn a real delta-round dispatch
   on genuinely non-repairable multi-mechanism/safety clusters no wording revision can fix — the
   DIR-120 token-burn defect on a different axis; RA4 explicitly preserves immediate split there.
9. **Windowed/majority-vote instability detection.** Immediate-predecessor comparison already
   reproduces the required behavior on the real sequence, is trivially auditable, and avoids an
   invented statistical policy with no basis in the observed defect (consecutive-round drift, not a
   modal-outlier problem).
10. **Hand-maintained `scopeEpoch` integer.** A manually-bumped counter is itself an unenforced,
    driftable artifact; content hashes are the established idiom in this exact module
    (`decideResumeGeneration`) for the identical purpose.
11. **Fold the lookup into `--decide-resume` instead of a new `--decide-split` mode.** Resume decides
    whether to re-run generation from scratch; "may ProposalReview recommend split at all this
    generation" is logically prior and orthogonal — conflating them risks regressing DIR-126-C's
    landed multi-step evaluation order (verified steps at :284, :309, :317), and would inherit the
    resume block's explicit-flag conditional hole (decision 10).
12. **Reuse `taskContractHash` as the scope key.** Wording-sensitive by construction (verified: raw
    `sha256(`${ac}\n${dod}\n${touches}`)` at :500, compared at step 7 :309) — cannot satisfy the DoD's
    "not invalidated by wording-only edits" clause; `scopeHash` (decision 1) is required, not a style
    choice.
13. **Append `priorMechanismAttempts` to `.generation.json` itself.** Rejected on verified
    write-semantics grounds: the generation record is overwritten wholesale per terminal (:639) under
    a pre-existing `{ok:false}` no-release failure contract (:677-697); a cross-generation history
    field cannot survive a wholesale overwrite without a read-modify-write change that would entangle
    the release path — see decision 9; the separate ring file is strictly safer.
14. **Place `--decide-split` INSIDE the resume-decision conditional block.** Verified hole: that block
    (:250-295) is skipped entirely when a caller passes `resumeFromAdjudicatedProposal` explicitly, so
    an explicit-resume dispatch would bypass a recorded SPLIT — an unrecorded scope-reset back door.
    Unconditional placement after :295 (decision 10) closes it at the cost of one non-content CLI
    dispatch on that path, while still preserving `reuse-terminal` precedence on the default path.
15. **Enforce the SPLIT block at Receipt instead of admission.** A Receipt-phase block would let all
    content agents run first and then refuse to certify the result — the maximum-cost failure shape.
    The admission slot (M4) guarantees zero dispatch, which is what AC9 actually requires.

### Mechanism-claim wiring coverage (DIR-117) — claims requiring AC-level proof

Each new call/dispatch/ownership/enforcement relationship below is flagged as a claim needing a
matching falsifiable Acceptance Criteria item with real production-call-site, fixture, grep, or diff
evidence — never descriptive prose restating the claim. (Byte-unchanged `prepare-admission-check.ts`
keeps the P7 identifier, and the Touches/policy-version claims keep P10/P11, to match this task's
frozen AC references "WIRING CLAIM P7/P10/P11".)

- **P1** — `prepare-milestone.js` dispatches a NEW `--decide-split` CLI call UNCONDITIONALLY between
  the resume-decision block's closing brace (:295) and `phase('Preflight')` (:304), keyed on
  `{charterHash, scopeHash, reviewPolicyHash}`, on BOTH the default and explicit-resume paths → needs
  AC evidence at this real call site (both paths), not only in the pure `decideSplitAdjudication`.
- **P2** — the round-0 reviewer prompt/schema (:506/:508) emit `mechanisms` and the production prompt
  no longer requests the bare `mechanismCount` → needs AC evidence (prompt text + schema diff, both
  mirrors).
- **P3** — `_splitCheck`/`checkSplitRecommendation` (both mirrors) consume
  `deriveMechanismInventory(...)`'s derived count on the production path;
  `_fullReviewResult.mechanismCount` (:558) is no longer read anywhere in the split path outside the
  one-generation legacy fallback → needs grep-level AC evidence that the raw field is dead in that
  path.
- **P4** — a COMMIT verdict's `skip-split-adjudication` actually reaches and disables `_splitCheck`'s
  call site INSIDE the loop (`splitCheckDisabled` flag at :567), not merely that the CLI returns the
  right verdict in isolation → needs call-site/instrumentation-level AC evidence.
- **P5** — `--record-split-decision` writes `milestones/prepare-decisions/<taskId>.json`, read ONLY by
  `--decide-split`, and is invoked from NO agent-prompt string in either mirror → needs the grep-based
  regression test (both halves) as real evidence (AC7), plus the companion read-exclusivity grep, not
  prose.
- **P6** — round-0 ProposalReview appends to and reads
  `.quay/prepare-leases/<taskId>.mechanism-history.json`, producing `split-assessment-unstable` on an
  inventory-hash mismatch at unchanged scope hashes, on every full-review round (not only the first)
  → needs replay-fixture AC evidence from DIR-126-D's real sequence.
- **P7** — `prepare-admission-check.ts` (both mirrors) is byte-unchanged by this task → needs
  `git diff`/`cmp` evidence, not prose (matches the frozen AC's "WIRING CLAIM P7" reference).
- **P8** — `_splitCheck`'s subsystem-cluster branch gates the loop's delta-round dispatch (falls
  through :568 instead of breaking) only when every contributing finding has `repairable === true` and
  the one-shot bypass is unconsumed → needs AC evidence that a real `proposal-revise-round-1` dispatch
  (:588) occurs before the second split check, plus `splitBypassUsed` telemetry, not just that the
  function returns `repairable:true` in isolation.
- **P9** — `groupBlockingByRootCause` replaces per-finding counting in the subsystem branch of both
  mirrors while the ledger retains every finding individually → needs the rootCauseKey AC evidence.
- **P10** — the Receipt phase (:754, `--build` at :824) invokes the new `--mechanism-inventory <file>`
  binding on `milestone-preparation-check.ts` (both mirrors), structurally identical to the
  `--ledger` binding at :86/:100/:354-369/:464, failing closed as
  `mechanism-inventory-missing`/`mechanism-inventory-stale` → needs AC evidence AND a real
  `--preflight-plan` run proving the live `preflight-touches-mismatch` detector
  (`prepare-admission-check.ts:492-493`) passes against the Plan's `- Files:` lines (the task's
  `## Touches` already lists both paths — verified — so the obligation is Plan alignment, not a
  Touches edit).
- **P11** — `_currentReviewPolicyHash()` (:482-484) composes `MECHANISM_POLICY_VERSION` into the SAME
  hash consumed by both `decideResumeGeneration` and `--decide-split` → needs AC evidence (unit test
  over the composition) that one bump invalidates both mechanisms, never two drift-able versions.
- **P12** — the SPLIT-block `needs-human` return (`{outcome:'needs-human',
  reason:'split-decision-blocks-dispatch', phase:'Admission'}`) precedes EVERY content-agent `agent()`
  call in file order on both entry paths → needs structural/file-order AC evidence (zero dispatches on
  the SPLIT match), not only a unit test of the pure evaluator.

Each of P1-P12 maps to a falsifiable Acceptance Criteria item demanding production-call-site,
fixture, grep, or diff evidence — never descriptive prose restating the claim.

## Plan

See docs/plans/M206-gap-prepare-milestone-split-decision-no-finality.md (re-authored 2026-07-30,
base revision 2d67a92, live `--preflight-plan` gate verified ok:true with zero findings). Nine
ordered stages (typed inventory M1 → root-cause clustering M2 → repairable bypass M3 → decision
record + admission adjudication M4 → instability ring M5 → policy version X2 → workflow mirrors →
Receipt binding X1 → lockstep/golden-replay verification) each carry the mechanical
`- AC:`/`- Files:`/`- Command:` block, RED/implementation/GREEN checks with expected exit
behavior, code/prose classification, line budgets, and strict dependencies; every 1-based AC index
(1-18) appears in at least one stage’s `- AC:` list. Standardized stopping rule: at most 3
Plan-check rounds, success only at F_i=0 (live `prepare-admission-check.ts --preflight-plan`
returns `ok:true` with zero findings). Golden replay of DIR-126-D’s real 8→4→≤2→6 sequence
plus a legitimate split case and a COMMIT-rerun case gates production cutover (charter Done-when).

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
  mechanically derived from that inventory and no steady-state production branch trusts a bare
  reviewer integer — the sole exception is the flagged ONE-generation `legacy-scalar` fallback,
  whose sunset is mechanically enforced: a dedicated fixture confirms that a SECOND consecutive
  `legacy-scalar` reviewer output at the same `(charterHash, scopeHash, reviewPolicyHash)` scope
  key yields the `needs-human`/`mechanism-inventory-missing` terminal (not an indefinite
  fallback), while a single legacy-format output against an empty/typed ring history is still
  accepted as the synthetic single-entry inventory.
- [ ] RED/GREEN fixtures classify DIR-126-D's A.1-A.5 terminal-write call-site variants as one
  atomic mechanism and its read-only report as a second mechanism; renaming or reordering entries
  does not change the inventory hash or count.
- [ ] A genuine three-mechanism fixture still produces split-multi-mechanism, with each counted
  mechanism independently shippable and backed by a distinct proof surface.
- [ ] Three wiring findings with one rootCauseKey remain three ledger entries but count as one
  independent split-cluster member; three independently rooted semantic blockers still trigger the
  subsystem split threshold.
- [ ] A repairable wiring cluster receives exactly one focused revision and delta review before a
  terminal split decision; a non-repairable safety/scope split fixture still stops immediately. A
  real fixture additionally confirms the `splitBypassUsed:true` signal is recorded in the
  receipt/telemetry output AND the `proposal-revise-round-1` dispatch label is present in the
  journal — not merely that exactly one revision occurred.
- [ ] A hash-bound human COMMIT decision causes a second attempt with unchanged task/charter/scope/
  policy hashes to skip split adjudication — proven at the call-site/instrumentation level (a real
  fixture confirms `_splitCheck`'s specific call site inside the ProposalReview loop is actually
  disabled via `splitCheckDisabled`), not merely that the CLI function returns the right verdict in
  isolation; a material scope change invalidates that decision and records the invalidation reason.
- [ ] `--record-split-decision` (writing `milestones/prepare-decisions/<taskId>.json`, read only by
  `--decide-split`) is confirmed human-invoked only via a grep-based regression test asserting the
  literal flag string appears in no agent-prompt template anywhere in `prepare-milestone.js`/mirror
  — real evidence, not prose. A companion grep additionally confirms the `prepare-decisions/` path
  string itself appears only inside the `--decide-split`/`decideSplitAdjudication` read path (and
  the `--record-split-decision` write path it mirrors), never in any other production file or
  agent-prompt template — proving read-exclusivity, not write-authorship alone.
- [ ] The Receipt phase's new `--mechanism-inventory <file>` hash binding on
  `milestone-preparation-check.ts` is structurally identical to the existing `--ledger` binding — a
  receipt naming a missing or hash-mismatched mechanism-inventory file fails closed
  (`mechanism-inventory-missing`/`mechanism-inventory-stale`), mirroring the existing
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
- [ ] **`milestone-preparation-check.ts` is added to `## Touches` and the preflight Touches gate
  passes (WIRING CLAIM P10 / mechanism (E)):** both
  `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` and
  `plugin/scripts/milestone-preparation-check.ts` appear in the task's own `## Touches` list, and
  the repo's own `preflight-touches-mismatch` gate (a live fail-closed detector in
  `prepare-admission-check.ts`) returns `ok:true` against the resulting Plan's `- Files:` lines —
  verified by a real `prepare-admission-check.ts --preflight-plan` run, not prose.
- [ ] **`MECHANISM_POLICY_VERSION` is a single-bump invalidator of both mechanisms (WIRING CLAIM
  P11):** a unit test over `_currentReviewPolicyHash()` confirms that bumping the new
  `MECHANISM_POLICY_VERSION='mechanism-v1'` literal changes the hash output, thereby invalidating
  BOTH `decideResumeGeneration`'s `reviewPolicyHash` match (the DIR-126-C resume cache) AND the new
  `--decide-split`'s COMMIT/SPLIT suppression in a single literal change — never two
  separately-bumpable version strings that can drift from each other.
- [ ] **Explicit-resume-path SPLIT enforcement (WIRING CLAIM P12 / M4 "key divergence"):** the new
  `--decide-split` dispatch sits UNCONDITIONALLY, outside the `resumeFromAdjudicatedProposal`
  resume-flag conditional — proven on BOTH entry paths. A real fixture confirms that an explicit
  `resumeFromAdjudicatedProposal:true` dispatch (the skip-ProposalAuthors/Adjudicate path) STILL
  honors a recorded SPLIT decision, dispatching `--decide-split` and returning ZERO new content-agent
  dispatch — i.e. none of `proposal-author-*`, `adjudicate`, `proposal-review`, `plan-author`, or
  `plan-check-*` `agent()` dispatches occurs on that path. This closes the rejected-alt-14 back door
  (placing `--decide-split` inside the conditional), which a path-agnostic AC9 fixture alone would
  not catch.
- [ ] **Anti-laundering inventory validation is fail-closed (WIRING CLAIM P3 / M1, RED fixture):** an
  inventory containing a duplicate `proofSurface`, a duplicate `id`, or a dangling `dependsOn` yields
  the `needs-human`/`mechanism-inventory-invalid` terminal — a dedicated RED fixture, not a
  descriptive "confirmed by direct source read" attestation. Distinct from AC3's positive path (a
  genuine three-mechanism fixture still splits) and from the receipt-binding fail-closed pair below.
- [ ] **`mechanism-inventory-missing` is disambiguated by context (WIRING CLAIM P3/P10):** the single
  literal code string serves two distinct fail-closed triggers that each have their own fixture —
  M1's reviewer-output path (ProposalReview terminates `mechanism-inventory-missing` when the
  reviewer returns no `mechanisms` field at all) versus X1's receipt-binding path (Receipt fails
  closed when the bound `--mechanism-inventory` file is absent). The Defaults table distinguishes the
  two contexts; neither is conflated with the other, and the receipt case stays mirrored on
  `ledger-missing`.
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
  direct-source-read standard as above. Round-4 additionally flagged these exact-form identifiers
  for the same claims, all confirmed real by the same direct-source-read standard:
  `git log --follow tasks/DIR-126-D.md`, `decdc79`, `7808f0c`, `1170b25`, `28a0a4a`, `e96e453`,
  `a449053`, `dbb6026`, `b8b87c3`, `ee4296f` (the real, git-log-verifiable DIR-126-D convergence
  commit chain this task's worked example replays); `deriveMechanismInventory(mechanisms)`,
  `mechanism-inventory-invalid`, `id`, `dependsOn`, `proofSurface` (the structural-validation
  fail-closed inputs); `phase:'Admission'`, `phase('Admission')` (distinct literal forms of the
  Admission-phase marker in the split-decision-blocks-dispatch control flow); `invalidations[]`
  (the array field a material scope change appends alongside a COMMIT decision's invalidation
  reason); `--decide-resume` (the existing resume-decision dispatch this task's new `--decide-split`
  is integrated immediately after); `## Touches` (the task's own declared scope list, extended this
  round to include both `milestone-preparation-check.ts` paths per WIRING CLAIM P10). Round-5
  additionally flagged these exact-form identifiers for the same claims, all confirmed real by the
  same direct-source-read standard: `const split = _splitCheck(_mechanismCount)` (the in-loop split
  call at `:567` this task replaces with the inventory-derived check), `break` (the loop exit a
  pre-loop SPLIT block makes redundant), `_deltaRound === 0` (the guard gating the only focused
  revision), `:579-597` (the focused-revision dispatch block), `proposal-revise-round-${_deltaRound}`
  (the real revision dispatch label); `--build` (the Receipt-phase build dispatch at `:824` that
  gains the `--mechanism-inventory <file>` flag), `--preflight-plan`, `preflight-touches-mismatch`,
  `prepare-admission-check.ts:492-493` (the live fail-closed Touches gate the P10 extension must
  satisfy), `- Files:` (the Plan stage file lines that cross-check against `## Touches`); and
  `agent()` (the content-agent dispatch primitive a SPLIT block guarantees is never newly invoked).

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

- tasks/gap-prepare-milestone-split-decision-no-finality.md
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts
- plugin/scripts/milestone-preparation-check.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/prepare-milestone-convergence.test.mjs
- docs/plans/M206-gap-prepare-milestone-split-decision-no-finality.md
