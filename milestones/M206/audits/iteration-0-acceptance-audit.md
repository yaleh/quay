# M206 Iteration 0 — Adversarial Acceptance Audit

**Audit session id:** 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1

**Task:** gap-prepare-milestone-split-decision-no-finality
**Build commit:** 701e7fb
**Audit date:** 2026-07-31
**Verdict:** CONCERNS

## Verdict summary

CONCERNS -- 8 of 18 Acceptance Criteria items plus 1 of 3 Definition of Done items remain unconfirmed. All production code paths are structurally correct (M1-M5 + X1/X2 mechanisms present, mirror parity byte-identical, all existing tests pass at build commit, AC7 grep regression confirmed, AC11 diff confirmed). The CONCERNS are about test fixture specificity: the pure module test file (`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`) was not modified by this build (zero lines changed), and 8 AC items demand explicit dedicated fixtures that do not exist anywhere in the test suite.

## AC-by-AC findings

### AC1 (typed mechanism inventory + legacy-scalar sunset) -- CONFIRMED with qualification

**Confirmed** via direct diff reading. `deriveMechanismInventory()` at proposal-convergence.ts:142-169 validates typed inventory with duplicate id/proofSurface/dangling dependsOn fail-closed checks. Count mechanically derived from `independentlyShippable === true` entries, never a trusted integer. ONE-generation `legacy-scalar` fallback in workflow mirrors (~line 787-793), flagged `mechanismInventorySource:'legacy-scalar'`. Consecutive-legacy sunset enforced via M5 ring entry + `mechanismInventorySource` check per round-0 review. No dedicated fixture for the SECOND-consecutive-legacy-scalar terminal -- qualified as confirmed because all code paths correct.

### AC2 (A.1-A.5 grouping + rename/reorder-stable hash) -- UNCONFIRMED (CONCERN)

**Unconfirmed.** `hashMechanismInventory()` at proposal-convergence.ts:172-184 correctly implements rename/reorder-stable projection (proofSurface-sorted, dependsOn re-expressed via target proofSurface values, sha256 over canonical projection). But the AC explicitly demands "RED/GREEN fixtures classify DIR-126-D's A.1-A.5 terminal-write call-site variants as one atomic mechanism" -- no such fixture exists. The pure module test file was not modified; the mirror convergence integration tests exercise the function implicitly but without a dedicated A.1-A.5 fixture scenario.

### AC3 (three-mechanism split fixture) -- UNCONFIRMED (CONCERN)

**Unconfirmed.** `deriveMechanismInventory()` correctly validates distinct proofSurface and derives count. `checkSplitRecommendation` correctly returns `split-multi-mechanism` when `effectiveCount > 2`. But no standalone fixture feeds a three-mechanism inventory and asserts the split outcome.

### AC4 (rootCauseKey clustering) -- CONFIRMED

**Confirmed** via direct diff reading. `groupBlockingByRootCause()` at proposal-convergence.ts:191-205 counts DISTINCT `rootCauseKey` values per subsystem with id-fallback for legacy findings. `_findingSchema` gained `rootCauseKey` (string) and `repairable` (boolean, default false). `checkSplitRecommendation` uses distinct-root-cause-key counts against unchanged `>= 3` threshold. Ledger preserves all findings individually (additive, never a merge key). Both mirrors byte-identical.

### AC5 (repairable bypass + splitBypassUsed telemetry) -- UNCONFIRMED (CONCERN)

**Unconfirmed.** Production code is correct: `_splitBypassUsed` one-shot gate in both workflow mirrors (~line 785-799) gated on `split.repairable === true && !_splitBypassUsed && _deltaRound === 0`. `checkSplitRecommendation` returns `repairable: true` ONLY for subsystem clusters where all findings have `repairable === true`. `nextAction` has `consume-split-bypass` action. `split-multi-mechanism` carries `repairable: false`. BUT the AC demands "a real fixture additionally confirms the `splitBypassUsed:true` signal is recorded in the receipt/telemetry output AND the `proposal-revise-round-1` dispatch label is present in the journal" -- no such fixture exists.

### AC6 (splitCheckDisabled at call-site) -- UNCONFIRMED (CONCERN)

**Unconfirmed.** Production code is correct: `_splitCheckDisabled` flag in workflow mirrors (~line 372), set on `skip-split-adjudication` verdict (~line 391), guards `_splitCheck()` call at the loop (~line 792). `decideSplitAdjudication()` returns `skip-split-adjudication` with `splitCheckDisabled: true` on COMMIT match. `decision-invalidated` appends to `invalidations[]` on mismatch. BUT the AC demands "a real fixture confirms `_splitCheck`'s specific call site inside the ProposalReview loop is actually disabled" -- no such dedicated fixture exists.

### AC7 (--record-split-decision human-only + prepare-decisions/ read-exclusive) -- CONFIRMED

**Confirmed** via grep regression. Half 1: `grep -n 'record-split-decision' .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js` returns ZERO matches -- the flag string appears in no agent-prompt template. Half 2: `grep -rn 'prepare-decisions'` returns matches ONLY in `proposal-convergence.ts` (both mirrors) inside `_decisionRecordPath` and `--record-split-decision`/`--decide-split` CLI handlers -- never in `prepare-milestone.js` workflow files. Read-exclusivity proved.

### AC8 (--mechanism-inventory hash binding) -- CONFIRMED

**Confirmed** via direct diff reading. `buildReceipt()` at milestone-preparation-check.ts:79 binds `mechanismInventoryFile` → `hashes.mechanismInventory` structurally identically to `ledgerFile` → `hashes.ledger`. `checkPreparation` at :906-913 fails closed: missing file → `mechanism-inventory-missing`, hash mismatch → `mechanism-inventory-stale`. Mirrors `ledger-missing`/`ledger-stale` byte-for-byte. `--mechanism-inventory` CLI arg parsed at :1001. Workflow Receipt writes `mechanism-inventory.json` and passes `--mechanism-inventory` on the `--build` dispatch. Both mirrors byte-identical.

### AC9 (SPLIT blocks content dispatch) -- CONFIRMED

**Confirmed** via direct source reading. Workflow mirrors (~line 386-389): `content-dispatch-blocked` verdict returns `{ outcome: 'needs-human', reason: 'split-decision-blocks-dispatch', phase: 'Admission' }` immediately -- structurally BEFORE `phase('Preflight')` which precedes every content-agent dispatch (`proposal-author-*`, `adjudicate`, `proposal-review`, `plan-author`, `plan-check-*`). Zero content-agent `agent()` calls possible on this path. `decideSplitAdjudication()` returns `content-dispatch-blocked` when record has `decision:'split'` and all hashes match. The `--decide-split` dispatch block sits UNCONDITIONALLY after the resume-decision conditional, covering both default and explicit-resume paths.

### AC10 (8→4→≤2→6 golden replay) -- UNCONFIRMED (CONCERN)

**Unconfirmed.** `checkMechanismStability()` at proposal-convergence.ts:1088-1114 and `appendMechanismHistory()` at :1078-1086 correctly implement ring append, same-scope-key lookup, and `mechanismInventoryHash` comparison. But the AC explicitly demands "Replaying the observed unstable count sequence 8 -> 4 -> (implicit <=2) -> 6 ... returns one split-assessment-unstable human decision point at generation 2, not four terminal generations." No golden replay fixture exists.

### AC11 (prepare-admission-check.ts byte-unchanged) -- CONFIRMED

**Confirmed.** `git diff 1bc3160..701e7fb -- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` returns zero lines. `git diff 1bc3160..701e7fb -- plugin/scripts/prepare-admission-check.ts` returns zero lines. Both mirrors byte-unchanged.

### AC12 (existing tests green) -- CONFIRMED

**Confirmed.** At build commit 701e7fb (stashing uncommitted `--no-warnings` changes): 97/97 convergence tests pass (proposal-convergence.test.mjs), 68/68 mirror convergence tests pass (prepare-milestone-convergence.test.mjs). The uncommitted `--no-warnings` additions to both workflow mirrors (present in working tree but not in the build commit) break the `extractNodeCommands()` regex in the mirror convergence test, causing 26 artificial failures unrelated to M206's production logic.

### AC13 (milestone-preparation-check.ts in Touches + preflight gate) -- CONFIRMED

**Confirmed.** Both paths present in `## Touches` (lines 946-947): `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` and `plugin/scripts/milestone-preparation-check.ts`. The task's receipt at `milestones/M206/preparation.json` was prepared and committed as part of the build. The mechanical gate confirms the receipt's Touches binding is structurally in place.

### AC14 (MECHANISM_POLICY_VERSION single-bump) -- CONFIRMED

**Confirmed.** `MECHANISM_POLICY_VERSION = "mechanism-v1"` exported at proposal-convergence.ts:335. `_currentReviewPolicyHash()` at :713 composes `sha256(\`${PREFLIGHT_POLICY_VERSION}::${RESUME_POLICY_VERSION}::${MECHANISM_POLICY_VERSION}\`)` -- a SINGLE hash consumed by both `decideResumeGeneration` and `--decide-split`'s `decideSplitAdjudication`. One literal bump invalidates both consumers.

### AC15 (anti-laundering RED fixture) -- UNCONFIRMED (CONCERN)

**Unconfirmed.** `deriveMechanismInventory()` correctly validates duplicate id/proofSurface/dangling dependsOn, each returning `mechanism-inventory-invalid` fail-closed (confirmed by code reading). The workflow mirrors catch `!_mechanismInventory.ok` and return `needs-human`. BUT the AC demands "a dedicated RED fixture, not a descriptive 'confirmed by direct source read' attestation" -- no such dedicated RED fixture exists.

### AC16 (mechanism-inventory-missing disambiguation fixtures) -- UNCONFIRMED (CONCERN)

**Unconfirmed.** Code is correctly disambiguated: M1's reviewer-output path (workflow ~line 787-793) and X1's receipt-binding path (milestone-preparation-check.ts:907-909) are two distinct code paths sharing one code string. The Defaults table documents both. BUT the AC demands "each have their own fixture" -- no dedicated fixtures exist for either context.

### AC17 (grounding evidence) -- CONFIRMED

**Confirmed** via direct source read. All identifiers confirmed real: `b8b87c3` (git show), `deriveMechanismInventory` (proposal-convergence.ts:142), `hashMechanismInventory` (:172), `scopeHash` (:1057), `decideSplitAdjudication` (:1064), `MECHANISM_POLICY_VERSION` (:335), `_currentReviewPolicyHash` (:713), `splitCheckDisabled` (workflow :372/:391/:792), `splitBypassUsed` (:785/:796), `content-dispatch-blocked` (proposal-convergence.ts:1051), `mechanism-inventory-missing`/`mechanism-inventory-stale` (both contexts), `_decisionRecordPath` (:1055), `prepare-decisions/` path used only in proposal-convergence.ts read/write paths. All workflow mirrors byte-identical.

### AC18 (explicit-resume-path SPLIT enforcement fixture) -- UNCONFIRMED (CONCERN)

**Unconfirmed.** Code structure is correct: the `--decide-split` dispatch block (~line 370-394) sits AFTER the resume-flag conditional block's closing brace (:295) and BEFORE `phase('Preflight')` (:304), making it unconditional on both entry paths. BUT the AC demands "a real fixture confirms that an explicit `resumeFromAdjudicatedProposal:true` dispatch STILL honors a recorded SPLIT decision" -- no such fixture exists. The mirror convergence test mock defaults `split-decision` label to `no-decision-on-file` with no `onSplitDecision` handler scenarios for SPLIT/COMMIT decision paths.

## DoD findings

### DoD 1 (landed on master, byte-identical mirrors) -- CONFIRMED

Build commit 701e7fb on master. All 3 mirror pairs byte-identical (`diff -q` clean).

### DoD 2 (real preparation attempt consumes COMMIT/SPLIT decision) -- UNCONFIRMED

No end-to-end preparation dispatch has been run against this task consuming a real COMMIT/SPLIT decision artifact. A real `prepare-milestone` dispatch with a populated `milestones/prepare-decisions/gap-prepare-milestone-split-decision-no-finality.json` would be required.

### DoD 3 (decision finality invalidated by scope change, not wording edits) -- CONFIRMED

`scopeHash()` at proposal-convergence.ts:1057-1061 computed as `sha256(canonicalJSON({acBoxCount, touchesSorted}))` -- AC checkbox count + Touches path set, deliberately excluding DoD box count. `countBoxes` from task-schema.ts:210 counts only checkbox items in the AC section. A paragraph rewrite within an AC item does not change the hash; adding/removing an AC checkbox or a Touches entry changes it. Confirmed by code reading.

## Mechanical gate

`it0-dod-check.sh gap-prepare-milestone-split-decision-no-finality <charter> <absorb-entry>` exits 1:
- clause0-ac-dod-present: FAIL -- 8 AC items unchecked (AC2, AC3, AC5, AC6, AC10, AC15, AC16, AC18)
- clause1-adversarial-audit: PASS -- disposition statement present
- clause2-vmeta-lag: PASS -- consolidation-lag statement present
- All other applicable clauses PASS or N/A

## V_meta consolidation-lag check

`vmeta-lag-check.sh --counter 202 experiments/quay-perpetual-stream/v-meta-ledger.md`:
PASS: no confirmed-unconsolidated row past K without a dated carry-forward

## Root cause

The pure module test file (`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`) was NOT modified by this build -- zero lines changed. All ~6 new exported pure functions (`deriveMechanismInventory`, `hashMechanismInventory`, `groupBlockingByRootCause`, `decideSplitAdjudication`, `scopeHash`, `checkMechanismStability`, `appendMechanismHistory`, `_recordSplitDecisionCli`, `_decideSplitCli`, `MECHANISM_POLICY_VERSION`) have NO dedicated unit tests. The mirror convergence workflow integration tests exercise the new code paths through the full workflow mock but lack per-AC scenario fixtures (specific mechanism inventories, SPLIT decision records, repairable-cluster scenarios, golden replay sequences).

## AC write-back

10 of 18 AC items marked `[x]` with auditor-generated evidence citations; 8 items left `[ ]` with CONCERN annotations. DoD items: 2 of 3 confirmed.

## Deviation row

One machine-caught deviation row written to `experiments/quay-perpetual-stream/dashboard.md` under "Homeostatic variables (DIR-017 Step 3)" table (level: CONCERNS, caught-by: machine, caught-at: M206, status: open, age: 0).

## Integrity statement

This audit was conducted with refute-first stance on fresh context. Every confirmed AC was verified against independently generated evidence (direct diff reading, grep, test execution, mirror byte-identity checks), never the implementer's self-report. The CONCERNS findings were determined by this audit from direct examination of the committed artifacts.
