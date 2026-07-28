# M195 / DIR-117-B — adversarial acceptance audit (iteration-0)

**Audit session id:** ef014e6f-7f2a-4c7a-a7ce-a2c6f5e5ab78

**Task:** DIR-117-B · **Charter:** experiments/quay-perpetual-stream/charters/M195-dir117b-prepared-gate-real-proof.md
**Milestone root:** milestones/M195 (resolved via `gate_resolve_milestone_root 195`)
**Audit date:** 2026-07-28 · **Stance:** refute-first, fresh context (no prior exposure to the build)

## Verdict: CONCERNS

No Acceptance Criterion is refuted — all 5 are independently confirmed against real artifacts (not the
implementer's self-report), and the mechanical DoD gate passes (exit 0, 12/12 clauses). The verdict is
CONCERNS, not "NO REFUTATION FOUND", because DoD clause 3 (updating the parent `tasks/DIR-117.md`'s
`dirStatus`/Resolution to point at M195's real evidence) is genuinely UNSATISFIED at audit time, is NOT
enforced by the mechanical gate, and belongs to a class of post-Land bookkeeping that has been skipped
before (commit `05992a0`). It must be verified complete after Land.

## AC satisfaction (refute-first)

For each criterion I attempted to refute it from artifacts; all resisted refutation.

### AC #1 — real prepare→execute route on a real task → CONFIRMED
- Real `prepare-milestone.js` journal `wf_c265f7ee-f08` (this session): 2 ProposalAuthors → Adjudicate →
  ProposalReview → PlanAuthor → 3 PlanCheck rounds (1→3→0 findings) → Receipt phase builds
  `milestones/M195/preparation.json` (journal line: `receiptFile: milestones/M195/preparation.json`,
  `detail: "PASS: prepared …"`).
- I re-ran the receipt in verify mode during THIS audit:
  `milestone-preparation-check.ts --task tasks/DIR-117-B.md --charter … --receipt milestones/M195/preparation.json --ledger …`
  → `PASS: prepared — … review/plan-check both zero-finding (3 round(s))`, exit 0.
- Real `execute-milestone.js` journal `wf_977c3bab-c59` CONSUMES that receipt: 6 Verify it0 checks pass,
  then Prepared phase `code:"PASS: prepared"` (journal line 13), then Build reached with
  `outcome:"done", mergeCommit:"c9ef805"` (journal line 15). `c9ef805` is an ancestor of `master`
  (`git merge-base --is-ancestor c9ef805 master` true).
- `docs/plans/M195-dir-117-b.md` present (343 lines).

### AC #2 — Prepared phase enforces the receipt (negative + positive) → CONFIRMED
- Negative control #1 (stale receipt), real journal `wf_d9cf4f54-0f5`: doctored receipt
  `negative-control/preparation-tampered.json` (proposal hash `f931…`→`0931…`, confirmed to differ from
  the real receipt). Journal: 6 Verify checks PASS, then Prepared `ok:false, code:"FAIL: proposal-stale"`;
  ZERO Build/Audit/Gate/Land entries (grep count 0). Workflow return `{outcome:"revision-needed",
  reason:"FAIL: proposal-stale", phase:"Prepared"}` (per `negative-control-evidence.md`).
- Negative control #2 (missing receipt, post-flip), committed journal
  `negative-control/post-flip-omitted-receipt-journal.jsonl`: BOTH mirrors return
  `{outcome:"revision-needed", reason:"preparation-receipt-missing", phase:"Prepared"}`,
  `buildReached:false`, `phasesDispatched:["Verify","Prepared"]`.
- Positive run `wf_977c3bab-c59` reaches Build (see AC #1).
- Conformance suite `plugin/test/execute-milestone-preparation-gate.test.mjs`: 14/14 (both mirrors),
  incl. stale-hash + omitted-receipt FAIL-CLOSED and valid-receipt-reaches-Build — independently re-run
  green during this audit.
- Note (transparency, not a refutation): NC#2 was driven by loading the real, unmodified workflow source
  as an AsyncFunction with the 6 Verify checks stubbed (the repo's documented conformance method, identical
  to the passing test suite), not a full Workflow-tool dispatch. The behavior is mechanically demonstrated
  on both mirrors and encoded RED→GREEN in the passing suite.

### AC #3 — opt-in → enforced-by-default flip in both mirrors + OUTER-LOOP.md → CONFIRMED
- `diff -q` byte-identical for `.claude/workflows/execute-milestone.js` vs `plugin/workflows/…`;
  `sync-vendor.sh --check` CLEAN.
- `phase('Prepared')` unconditional (line 196); missing receipt → `{outcome:"revision-needed",
  reason:"preparation-receipt-missing", phase:"Prepared"}` before Build (lines 197-199); header phase-table
  (line 6) updated to ENFORCED-BY-DEFAULT. No live else-skip remains (the old "Prepared phase SKIPPED"
  exists only as a retired comment; the `else {` at lines 147/342 are the composite-branch and post-Build
  blocks, not a Prepared skip).
- `OUTER-LOOP.md` disclosure updated in BOTH places (prepare(c) STATUS note ~lines 57-65; execute() signature
  ~lines 124-131): "not yet proven / omitting accepted / `preparationReceiptFile?` optional" → enforced
  contract with the M195 evidence pointer + known-exposure note.

### AC #4 — ProposalReview calls the REAL checkWiringCoverage() (not prompt-only) → CONFIRMED
- Both `prepare-milestone.js` mirrors (byte-identical) dispatch
  `agent({label:'wiring-coverage-check', phase:'ProposalReview'})` running the CLI
  (`node --experimental-strip-types …/wiring-coverage-check.ts --task tasks/<id>.md`, line ~238), and the
  SCRIPT merges `verdict.findings` via the existing `_upsertFindings(..., 0)` path (line 248) — a
  grep-confirmable real call site, not LLM prose.
- The CLI's main calls the single exported `checkWiringCoverage()` — exactly ONE definition
  (`wiring-coverage-check.ts:105`), called at `:224`; no reimplemented extraction (the module stays the one
  source DIR-122 imports). `plugin/scripts/wiring-coverage-check.ts` byte-identical.
- Fixture `fixtures/preparation/wiring-uncovered-claim-task.md` (2 claimed mechanisms, no matching AC):
  I ran the CLI on it directly → exactly 2 BLOCKING typed findings from the function's real return value.
- Convergence suite (both mirrors) 20/20, incl. "AC#4: ProposalReview finding count increments from
  checkWiringCoverage()'s real return value (not LLM judgment)" — I read the test source: it stubs the LLM
  full-review to ZERO findings, runs the real CLI on the fixture, and asserts `ledger.length ===
  functionReturn.length` ("LLM review added nothing"). Wiring CLI suite 13/13. Both independently re-run
  green this audit.

### AC #5 — task-schema-check exits 0 → CONFIRMED
- Re-run this audit: `PASS: tasks/DIR-117-B.md — schema v1 conformant (kind=directive)`, exit 0.
- Confirmed the AC/DoD checklist write-back (below) did NOT invalidate the receipt (only `## Proposal` is
  hash-bound): re-verified PASS after edits, and schema-check still exits 0.

## DoD satisfaction

- **Clause 1 (one REAL milestone: checked Proposal, checked Plan, matching receipt, Build only after
  Prepared, landed on master) → CONFIRMED.** M195/DIR-117-B is real (not scratch): review.findings 0,
  planCheck 3 rounds → 0 findings, matching receipt (re-verified PASS), journal `wf_977c3bab-c59` shows
  Prepared `PASS: prepared` before Build (`mergeCommit c9ef805`, on `master`).
- **Clause 2 (Prepared enforced default + real negative control) → CONFIRMED** (see AC #2/#3).
- **Clause 3 (parent `tasks/DIR-117.md` dirStatus/Resolution updated to point at M195) → NOT SATISFIED at
  audit time.** `tasks/DIR-117.md` is still `dirStatus: applied` / `status: needs-human`, with no Resolution
  pointer to M195. This is disclosed-deferred to Land by the build (`iteration-0.md`: "DEFERRED to Land by
  design"; `tasks/DIR-117.md` is not in `## Touches`; Proposal sequencing step 6). Left `- [ ]` unticked.

## Checklist write-back (DIR-020)
- AC #1–#5: ticked `- [x]` in `tasks/DIR-117-B.md` with per-item evidence citations.
- DoD clauses 1–2: ticked `- [x]` with evidence. DoD clause 3: left `- [ ]` (unconfirmed pre-Land).

## Disposition append + mechanical gate (steps 2a/3)
- Appended to `milestones/M195/absorb-entry.md`: `adversarial-audit disposition: CONCERNS …` and
  `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward`
  (verbatim from `vmeta-lag-check.sh --counter 192 experiments/quay-perpetual-stream/v-meta-ledger.md`,
  exit 0; milestone_counter 193 − 1 = 192, K=2, both rows [ok]).
- Mechanical gate `it0-dod-check.sh DIR-117-B <charter> milestones/M195/absorb-entry.md` → **exit 0**
  (12/12 clauses: clause0 ACs 5/5 checked; clause1 audit disposition (verdict); clause2 vmeta disposition;
  clause3 line-budget PASS; clause4 impl-row N/A; clause5 no-self-exemption; clause6 escrow N/A; clause7
  test-floor N/A [method-infra]; clause8 lifecycle N/A [no milestone:M label]; clause9 split-or-commit N/A;
  clause10 tree-hygiene clean; clause11 worktree-branch-hygiene clean; clause12 audit-independence N/A
  documented no-op). Not REFUTED by construction.

## Deviation-log write-back (step 4)
- Appended one CONCERNS row (caught-by: human — transcription of the build's disclosed clause-3 deferral,
  independently confirmed; with the machine-side risk framing that the gate does not enforce it and commit
  `05992a0` shows this class skipped before) to dashboard.md's "Homeostatic variables (DIR-017 Step 3)"
  table: level CONCERNS / status open / age 0.

## Transparency notes (not refutations)
1. **Audit-independence signal:** every provenance sessionId in `preparation.json` equals THIS audit's
   session id (ef014e6f…). Per commit `5e3a25b` ("provenance-sessionid-not-independence-signal") session-id
   distinctness is no longer an independence signal, and substantive independence is preserved — this is a
   fresh-context subagent that derived every conclusion from on-disk artifacts, not from the build's
   self-report. Clause 12 is a documented no-op at THIS gate; the real audit-independence check runs at the
   later ABSORB gate against this artifact.
2. **Negative control #2 method:** AsyncFunction-load of the real workflow source with Verify stubbed (the
   repo's documented conformance method, same as the passing suite), not a full Workflow-tool dispatch — see
   AC #2 note.

## Recommendation
APPROVE to proceed to Land, conditioned on the Land phase actually completing DoD clause 3 (update
`tasks/DIR-117.md`'s `dirStatus`/Resolution to point at M195's real evidence) and a post-Land confirmation
that it landed — this is the one open obligation and it is not gate-enforced.
