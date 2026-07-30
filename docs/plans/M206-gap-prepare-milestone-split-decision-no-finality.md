# M206 Plan — gap-prepare-milestone-split-decision-no-finality

**Milestone:** M206 · **Task:** gap-prepare-milestone-split-decision-no-finality
**Charter:** experiments/quay-perpetual-stream/charters/M206-gap-split-decision-finality.md
**Base revision:** b28cfdb (current HEAD short-sha, re-pinned 2026-07-30; supersedes the
fe3898e-based draft and the later 2d67a92 pin — the prepare-admission-check.ts mirrors moved
+35 lines each post-2d67a92 (commit c82efac, markdown-irrelevant to this task's touch set), which
broke the AC11/P7 `git diff <base> -- */prepare-admission-check.ts` EMPTY checks as written against
the old pin; production file sizes/mirror identity verified unchanged at b28cfdb)
**Class:** development / execution · **highRisk:** yes · **Discipline:** human-steered, direct-to-master

## 0. Problem in one line

prepare-milestone's split recommendation trusts a bare self-reported integer mechanismCount
(DIR-126-D/M203 observed 8 → 4 → ≤2 → 6 across otherwise-similar rounds, no two consecutive rounds
agreeing, 11 dispatches) and has no hash-bound human decision finality — the real resolution was a
human prose ruling (commit b8b87c3) that no code path reads. This Plan productionizes that ruling:
typed mechanism inventory with mechanically derived count, root-cause-aware clustering, one bounded
repair attempt for repairable clusters, a git-committed hash-bound COMMIT/SPLIT decision record with
admission-time adjudication, cross-generation instability detection, Receipt-phase inventory
hash-binding, and a single policy-version invalidator.

## 1. Complete touch set (matches task `## Touches` exactly)

Source:
1. `.claude/workflows/prepare-milestone.js` (863 lines @ b28cfdb)
2. `plugin/workflows/prepare-milestone.js` (byte-identical mirror of 1, verified `diff -q` clean @ b28cfdb)
3. `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` (851 lines)
4. `plugin/scripts/proposal-convergence.ts` (byte-identical mirror of 3)
5. `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (587 lines)
6. `plugin/scripts/milestone-preparation-check.ts` (byte-identical mirror of 5)

Tests:
7. `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
8. `plugin/test/prepare-milestone-convergence.test.mjs`

Plan/self:
9. `docs/plans/M206-gap-prepare-milestone-split-decision-no-finality.md` (this file)
10. `tasks/gap-prepare-milestone-split-decision-no-finality.md` (Plan-section reference update only)

Data artifacts created at runtime (declared, not hand-authored sources; NOT in Touches by design):
- `milestones/prepare-decisions/<taskId>.json` — NEW git-committed decision-record tree (M4),
  written ONLY by --record-split-decision, read ONLY by --decide-split.
- `.quay/prepare-leases/<taskId>.mechanism-history.json` — NEW gitignored bounded-5 ring (M5).
- `milestones/M<NN>/mechanism-inventory.json` — NEW Receipt-phase artifact beside
  `proposal-ledger.json` (X1).

Explicitly NOT touched (AC11 / WIRING CLAIM P7):
- `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` and its
  `plugin/scripts/` mirror — consumed read-only via existing imports
  (extractSection @ task-schema.ts:73, PREFLIGHT_POLICY_VERSION — defined @
  prepare-admission-check.ts:226, consumed read-only via the existing import @
  proposal-convergence.ts:27; one additive countBoxes import is added to proposal-convergence.ts:26,
  not to the admission-check file).

## 2. Ordered stages

Line budgets are additive deltas @ b28cfdb sizes. Dependencies are strict ordering constraints
(a stage may start only after its predecessors are GREEN). Every stage keeps both mirror pairs
byte-identical (`diff -q` clean) at its end. Every stage carries the mechanical
`- AC:` / `- Files:` / `- Command:` block parsed by milestone-preparation-check.ts's
parsePlanStages/validatePlanStructure; each `- Command:` is a single-line RED → IMPLEMENT → GREEN
sequence with expected exit behavior, prefixed with a runnable interpreter token.

---

### Stage 1: Typed mechanism inventory — derive + hash (pure module, M1 core)

- AC: 1, 2, 3, 16, 17
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs, plugin/test/prepare-milestone-convergence.test.mjs
- Command: bash -c "RED: node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs plugin/test/prepare-milestone-convergence.test.mjs → expect exit ≠ 0 (new tests fail: deriveMechanismInventory/hashMechanismInventory not yet exported — fixtures assert duplicate id, dangling dependsOn, and duplicate proofSurface each yield ok:false code mechanism-inventory-invalid; absent mechanisms field yields mechanism-inventory-missing; DIR-126-D A.1-A.5 terminal-write-variants fixture yields count 2 grouped per the b8b87c3 Mechanism-A/Mechanism-B rule; rename/reorder permutations yield identical count and inventoryHash; a genuine three-distinct-proofSurface fixture yields count 3). IMPLEMENT deriveMechanismInventory(mechanisms) and hashMechanismInventory(mechanisms) in proposal-convergence.ts — proofSurface-sorted canonical projection with dependsOn re-expressed via target entries proofSurface values, sha256 over sorted-key JSON.stringify; count = inventory.filter(m => m.independentlyShippable).length, never a reviewer integer; copy result byte-identically to the plugin/scripts mirror. GREEN: re-run the same node --test → expect exit 0. MIRROR-SYNC: diff -q experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts → expect exit 0."

Classification: code. Budget: ~120 lines module (+ both mirrors), ~150 lines tests.
Depends on: none.
RED exit behavior: test runner exit 1 (missing exports). GREEN exit behavior: exit 0.

### Stage 2: Root-cause-aware blocking clustering (pure module, M2)

- AC: 4
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs, plugin/test/prepare-milestone-convergence.test.mjs
- Command: bash -c "RED: node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs plugin/test/prepare-milestone-convergence.test.mjs → expect exit ≠ 0 (fixtures assert three findings sharing one rootCauseKey count as ONE cluster member against the unchanged >= 3 threshold — no split; three findings with three distinct rootCauseKey values, or absent keys falling back to finding id, still trigger split-subsystem-blocking-cluster; all findings remain individually present in the ledger after grouping). IMPLEMENT optional rootCauseKey/repairable (default false, fail-closed) ledger fields and groupBlockingByRootCause(ledger) superseding groupBlockingBySubsystem — per subsystem count DISTINCT rootCauseKey with id fallback; checkSplitRecommendation keeps its exported name and recommend/code/reason shape; sync mirror. GREEN: re-run the same node --test → expect exit 0. MIRROR-SYNC: diff -q experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts → expect exit 0."

Classification: code. Budget: ~40 lines module (+ mirrors), ~60 lines tests.
Depends on: Stage 1.

### Stage 3: One-shot repairable-cluster bypass (pure module, M3)

- AC: 5
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs, plugin/test/prepare-milestone-convergence.test.mjs
- Command: bash -c "RED: node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs plugin/test/prepare-milestone-convergence.test.mjs → expect exit ≠ 0 (fixtures assert nextAction() with splitBypassAvailable:true and a repairable subsystem cluster at round 0 returns the new consume-split-bypass action, not stop-split; a second occurrence with the bypass consumed returns stop-split; split-multi-mechanism is NEVER bypass-eligible; a non-repairable cluster returns stop-split immediately; the existing inline-caps-match-capsFor cross-check convention at the module header :18-20 extends to the new action). IMPLEMENT checkSplitRecommendation/_splitCheck return gaining repairable (true ONLY for split-subsystem-blocking-cluster when every contributing finding has repairable === true) and nextAction() gaining the additive splitBypassAvailable input plus the consume-split-bypass action; sync mirror. GREEN: re-run the same node --test → expect exit 0. MIRROR-SYNC: diff -q experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts → expect exit 0."

Classification: code. Budget: ~30 lines module (+ mirrors), ~50 lines tests.
Depends on: Stage 2.

### Stage 4: Hash-bound decision record + admission adjudication (pure module, M4)

- AC: 6, 7, 9, 15, 17, 18
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs, plugin/test/prepare-milestone-convergence.test.mjs
- Command: bash -c "RED: node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs plugin/test/prepare-milestone-convergence.test.mjs → expect exit ≠ 0 (fixtures cover decideSplitAdjudication(record, hashes) four verdicts — no record → no-decision-on-file; COMMIT + all three hashes match → skip-split-adjudication with splitCheckDisabled:true; COMMIT + any hash mismatch → decision-invalidated with mismatchedFields and an invalidations[] append on the SAME record object; SPLIT + hashes match → content-dispatch-blocked returning outcome needs-human, reason split-decision-blocks-dispatch, phase Admission; plus scopeHash = sha256(canonicalJSON(acBoxCount + touchesSorted)) tests proving insensitivity to sentence rewording and sensitivity to an AC checkbox or Touches path add/remove with DoD box count excluded; plus CLI fixtures — --record-split-decision requires --decision and --reason, writes schemaVersion-1 JSON under milestones/prepare-decisions/, never infers; --decide-split is read-only). IMPLEMENT scopeHash (additive countBoxes import at proposal-convergence.ts:26), decideSplitAdjudication, and the two CLI submodes on the established agent()-wraps-CLI seam (_convergenceAgentCall, prepare-milestone.js:157); sync mirror. GREEN: re-run the same node --test → expect exit 0. MIRROR-SYNC: diff -q experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts → expect exit 0."

Classification: code. Budget: ~180 lines module (+ mirrors), ~200 lines tests.
Depends on: Stage 1 (uses hashMechanismInventory for the audit-only mechanismInventoryHash field).

### Stage 5: Cross-generation instability ring + detection (pure module, M5)

- AC: 10
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs, plugin/test/prepare-milestone-convergence.test.mjs
- Command: bash -c "RED: node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs plugin/test/prepare-milestone-convergence.test.mjs → expect exit ≠ 0 (golden-replay fixture built from DIR-126-D's REAL recorded sequence — rounds 6/7/9/10 counts 8 → 4 → ≤2 → 6, cross-checked against git show -s --format=%B 7808f0c 1170b25 a449053 b8b87c3 — asserts gen 1 with no prior same-scope entry yields normal split-recommended; gen 2 with differing inventory hash at unchanged scope hashes yields exactly ONE needs-human/split-assessment-unstable; gens 3/4 are never reached, i.e. not four terminals; a matching-hash predecessor yields normal evaluation; the ring is bounded to 5 entries; a ring-append I/O failure is non-fatal — never gates, never falsely passes). IMPLEMENT append/compare over .quay/prepare-leases/<taskId>.mechanism-history.json — a SEPARATE file from .generation.json, preserving the wholesale-overwrite ok:false no-release contract at proposal-convergence.ts:639/:677-697 — round-0-only appends; sync mirror. GREEN: re-run the same node --test → expect exit 0. MIRROR-SYNC: diff -q experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts → expect exit 0."

Classification: code. Budget: ~70 lines module (+ mirrors), ~120 lines tests (incl. golden-replay fixture).
Depends on: Stage 1, Stage 4 (scopeHash key).

### Stage 6: Single policy-version invalidator (pure module, X2)

- AC: 14
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs, plugin/test/prepare-milestone-convergence.test.mjs
- Command: bash -c "RED: node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs plugin/test/prepare-milestone-convergence.test.mjs → expect exit ≠ 0 (unit test asserts MECHANISM_POLICY_VERSION = mechanism-v1 composes into _currentReviewPolicyHash() at :482-484 — currently sha256 of PREFLIGHT_POLICY_VERSION :: RESUME_POLICY_VERSION, becoming the triple including MECHANISM_POLICY_VERSION — and that bumping the ONE literal changes the hash consumed by BOTH decideResumeGeneration's reviewPolicyHash match and --decide-split's suppression). IMPLEMENT the literal and fold it into the same hash; sync mirror. GREEN: re-run the same node --test → expect exit 0. MIRROR-SYNC: diff -q experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts → expect exit 0."

Classification: code. Budget: ~5 lines module (+ mirrors), ~30 lines tests.
Depends on: Stage 4.

### Stage 7: Workflow mirrors — prompt/schema, loop integration, unconditional --decide-split dispatch (P1/P2/P3/P4/P8/P9/P12)

- AC: 1, 5, 6, 9, 12, 15, 18
- Files: .claude/workflows/prepare-milestone.js, plugin/workflows/prepare-milestone.js, plugin/test/prepare-milestone-convergence.test.mjs, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- Command: bash -c "RED: node --test plugin/test/prepare-milestone-convergence.test.mjs experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs → expect exit ≠ 0 (fixtures for the import-free inline twins _deriveMechanismInventory/_hashMechanismInventory/_groupBlockingByRootCause/_decideSplitAdjudication — inlined per the no-import DSL constraint documented at prepare-milestone.js:250-264 — cross-checked against the pure module outputs via an extended fixture battery on the header :18-20 convention; a SPLIT-record fixture asserting ZERO agent() dispatches of proposal-author-*/adjudicate/proposal-review/plan-author/plan-check-* on BOTH the default path AND an explicit resumeFromAdjudicatedProposal:true dispatch; a COMMIT-record fixture asserting _splitCheck's in-loop call site at :567 is skipped via splitCheckDisabled — instrumentation level, not verdict level; a repairable-cluster fixture asserting the bypass falls through the :568 break, records splitBypassUsed:true in telemetry/receipt metadata, and produces a proposal-revise-round-1 journal label at :588). IMPLEMENT in BOTH mirrors: round-0 prompt (:506) and schema (:508) emit mechanisms typed entries and no longer request bare mechanismCount (one-generation flagged legacy-scalar fallback only, mechanismInventorySource legacy-scalar, mirroring :519-525); the UNCONDITIONAL --decide-split dispatch between the resume-decision block's closing brace (:295) and phase('Preflight') (:304) on BOTH entry paths, fail-closed on unparseable/non-zero exit mirroring resume-decision-failed :269; splitCheckDisabled threaded to the loop; the _splitBypassUsed one-shot gate before while(true) (:563); rootCauseKey/repairable flowing through _upsertFindings (:445-468). GREP: grep -n mechanismCount .claude/workflows/prepare-milestone.js shows the raw field read only inside the legacy-fallback branch (P3 dead-field evidence). GREEN: re-run the same node --test → expect exit 0. MIRROR-SYNC: diff -q .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js → expect exit 0."

Classification: code. Budget: ~125 lines per mirror (~250 combined), ~150 lines tests.
Depends on: Stages 1-6 (all pure-module functions must exist to inline and cross-check).

### Stage 8: Receipt-phase inventory hash-binding (both milestone-preparation-check.ts mirrors + workflow Receipt, X1)

- AC: 8, 12, 13, 17, 18
- Files: experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts, plugin/scripts/milestone-preparation-check.ts, .claude/workflows/prepare-milestone.js, plugin/workflows/prepare-milestone.js, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs, plugin/test/prepare-milestone-convergence.test.mjs
- Command: bash -c "RED: node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs plugin/test/prepare-milestone-convergence.test.mjs → expect exit ≠ 0 (fixtures assert --mechanism-inventory <file> is the THIRD instance of the verified hash-binding pattern — buildReceipt binds hashes.mechanismInventory mirroring :86/:100, checkPreparation fails closed on mechanism-inventory-missing and mechanism-inventory-stale exactly mirroring ledger-missing/ledger-stale at :354-369, argv parsed at :464; a receipt naming a missing file yields mechanism-inventory-missing and a hash-mismatched file yields mechanism-inventory-stale; AND a disambiguation fixture proves the reviewer-output mechanism-inventory-missing terminal from Stage 1 and this receipt-binding one are distinct contexts with separate fixtures, never conflated). IMPLEMENT the binding in both milestone-preparation-check.ts mirrors and, in both workflow mirrors' Receipt phase (:754), write milestones/<milestoneId>/mechanism-inventory.json beside proposal-ledger.json (:775/:818 convention) and add --mechanism-inventory <file> to the --build invocation (:824). GREEN: re-run the same node --test → expect exit 0. MIRROR-SYNC: diff -q experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts plugin/scripts/milestone-preparation-check.ts AND diff -q .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js → expect exit 0 each."

Classification: code. Budget: ~30 lines per check-script mirror (~60 combined), ~40 lines workflow Receipt (additive to Stage 7's ~125/mirror budget — both stages edit the same workflow mirrors, so the combined prepare-milestone.js delta is ~165/mirror, matching the §4 table), ~80 lines tests.
Depends on: Stage 1 (inventory artifact shape), Stage 7 (workflow Receipt edits land on top of Stage 7's file state).

### Stage 9: Lockstep verification, byte-identity, regression, Touches gate, golden replay (prose + mechanical checks)

- AC: 2, 10, 11, 12, 13, 18
- Files: docs/plans/M206-gap-prepare-milestone-split-decision-no-finality.md, experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, .claude/workflows/prepare-milestone.js, plugin/workflows/prepare-milestone.js, experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts, plugin/scripts/milestone-preparation-check.ts, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs, plugin/test/prepare-milestone-convergence.test.mjs
- Command: bash -c "scripts/test.sh → expect exit 0 (zero-finding, legitimate-split, receipt, lease-release, fail-closed tests all green in both mirrors); then diff -q .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js && diff -q experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts && diff -q experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts plugin/scripts/milestone-preparation-check.ts → expect exit 0 (three mirror pairs byte-identical); then git diff b28cfdb -- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts plugin/scripts/prepare-admission-check.ts → expect EMPTY output, exit 0 (AC11 / WIRING CLAIM P7 byte-unchanged); then grep -c record-split-decision .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js → 0 inside agent-prompt template regions plus the companion grep that the prepare-decisions/ path string appears only in the --decide-split read path and the --record-split-decision write path (AC7 both halves); then node --experimental-strip-types experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts --preflight-plan --taskId gap-prepare-milestone-split-decision-no-finality --workspace <repo-root> --planFile docs/plans/M206-gap-prepare-milestone-split-decision-no-finality.md → expect ok:true with zero findings, no preflight-touches-mismatch (AC13 / P10), exit 0; then node --test on both test files re-running the DIR-126-D real-sequence fixture (8 → 4 → ≤2 → 6) plus a legitimate 3-mechanism split fixture plus a COMMIT-then-unchanged-rerun fixture → expect exit 0 with split-assessment-unstable firing exactly once at generation 2 (golden replay, charter Done-when); the independent-audit replay result is recorded as prose evidence in the landing commit message, not a gate."

Classification: prose + mechanical checks (no new production code; this stage only RUNS checks and records evidence). Budget: 0 new production lines; ~100 lines of fixture consolidation if the replay fixtures are deduplicated into a shared file; evidence recorded in the commit message.
Depends on: Stages 1-8 all GREEN.

---

## 3. AC coverage matrix (every 1-based AC index 1-18 appears above)

| AC# | Stage(s) | Evidence kind |
|---|---|---|
| 1 | 1, 7 | fixture + grep (bare int dead on production path) |
| 2 | 1, 9 | RED/GREEN rename/reorder fixture + golden replay |
| 3 | 1 | positive 3-mechanism fixture |
| 4 | 2 | clustering fixture, ledger-entry preservation |
| 5 | 3, 7 | splitBypassUsed:true + proposal-revise-round-1 journal fixture |
| 6 | 4, 7 | call-site splitCheckDisabled instrumentation fixture + invalidation append |
| 7 | 4, 9 | grep regression, both halves |
| 8 | 8 | receipt fail-closed fixtures mirroring ledger pair |
| 9 | 4, 7 | zero-dispatch structural fixture |
| 10 | 5, 9 | real-sequence golden replay (one unstable at gen 2) |
| 11 | 9 | git diff EMPTY against b28cfdb (P7) |
| 12 | 7, 8, 9 | scripts/test.sh exit 0, both mirrors |
| 13 | 8, 9 | live --preflight-plan run ok:true (P10) |
| 14 | 6 | single-bump unit test (P11) |
| 15 | 4, 7 | explicit-resume-path SPLIT fixture, zero dispatch (P12) |
| 16 | 1 | anti-laundering RED fixture |
| 17 | 1, 4, 8 | two-context disambiguation fixtures |
| 18 | 4, 7, 8, 9 | grounding-evidence bundle (identifiers co-located in AC text) |

Union of stage AC lists: {1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18} — complete.

## 4. Line budgets summary

| Target | Δ lines |
|---|---|
| proposal-convergence.ts (×2 mirrors) | +~445 each |
| prepare-milestone.js (×2 mirrors) | +~165 each (Stage 7 ~125 + Stage 8 ~40, additive) |
| milestone-preparation-check.ts (×2 mirrors) | +~30 each |
| test files (2) | +~830 combined |
| prepare-admission-check.ts (×2) | 0 (AC11/P7) |
| Total production | ~+1300 |

## 5. Guardrails

- **Fail-closed everywhere:** missing inventory → mechanism-inventory-missing; invalid inventory
  → mechanism-inventory-invalid; unparseable --decide-split/--record-split-decision verdict →
  phase fails closed (mirrors :269/:550-553); repairable defaults false. No new branch may
  silently pass.
- **Mirror lockstep is a per-stage invariant**, not a final-stage afterthought: every code stage
  ends with `diff -q` exit 0 on the pair it touches (no-import DSL convention — inline twins, never
  imports, prepare-milestone.js:250-264).
- **Human-only write boundary:** --record-split-decision is invoked by no agent-prompt template
  (grep-enforced, AC7); mirrors the .halt/restart-readiness-check.sh trust model and the real
  precedent (b8b87c3 was a human git commit).
- **Observability never gates:** mechanism-history.json append failure is non-fatal (telemetry
  discipline); the DURABLE artifact is the git-committed decision record.
- **Generation-record write semantics untouched:** .generation.json wholesale-overwrite +
  ok:false no-release contract (:639/:677-697) stays byte-for-byte (decision 9 — separate ring).
- **No concurrent milestone execution:** per CLAUDE.md, execute-milestone dispatches against this
  repo must never overlap (shared working tree); wait for this milestone's Land commit before the
  next dispatch.
- **One-time cold-cache pass at cutover** accepted (X2 hash composition change); both consumers
  treat reviewPolicyHash opaquely.

## 6. Rollback

Every element is additive and degrades to today's behavior when its inputs are absent. Rollback =
`git revert` the milestone's land commit(s): the legacy one-generation mechanismCount fallback
keeps in-flight generations running during a partial revert; decision records under
milestones/prepare-decisions/ are inert data (never read unless hashes match) and need no
cleanup; the gitignored mechanism-history.json ring is disposable. No schema migration exists to
reverse. If only the X2 policy literal must be reverted, both consumers resume prior-cache behavior
after one cold pass.

## 7. Real-landing verification

1. scripts/test.sh exit 0 on master post-land.
2. Three `diff -q` pairs exit 0; `git diff b28cfdb..HEAD -- */prepare-admission-check.ts` EMPTY.
3. Live --preflight-plan run against this Plan file returns ok:true with zero findings (re-run
   post-land to prove the landed Plan/Touches state, not just the pre-land draft).
4. A REAL preparation attempt consumes a recorded COMMIT or SPLIT decision; journal evidence confirms
   the same split question is not re-sent to a full reviewer (DoD clause 2).
5. Independent audit confirms finality is invalidated by real scope change (AC checkbox / Touches
   path add/remove) but NOT by wording-only Proposal/AC edits (DoD clause 3 + scopeHash design),
   and golden-replays DIR-126-D's real 11-round oscillation history against the new mechanism
   (charter Done-when) — stable, non-oscillating decision, not merely green synthetic tests.

## 8. Stopping rule (standardized)

At most **3 Plan-check rounds**. Round i produces a finding count F_i. Success ONLY at F_i = 0
(the live prepare-admission-check.ts --preflight-plan gate returns ok:true with zero findings,
including no preflight-touches-mismatch and no ambiguous-plan-command). If F_3 > 0, STOP and
escalate to human steering — do not dispatch a fourth round. This matches the bounded-convergence
discipline this task itself extends.
