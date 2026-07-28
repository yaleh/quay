---
id: DIR-117-B
title: Prove the Prepared-gate preparation pipeline via one real subsequent
  milestone (DIR-117 AC#11/DoD real-landing)
status: todo
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-117
children: []
extra:
  schema: v1
  dirStatus: applied
---
**type:** execution

## Proposal

**Problem framing (grounded in current code).** DIR-117/M191 landed the preparation pipeline as
mechanism but not as proven operations, and the current on-disk state shows four concrete gaps:

1. **The Prepared gate is opt-in, so the enforcement relationship is conditional.**
   `.claude/workflows/execute-milestone.js` lines 185–221 (byte-identical in
   `plugin/workflows/execute-milestone.js`, confirmed by `diff -q`) wrap the entire `Prepared`
   phase in `if ($a.preparationReceiptFile)`. The `else` branch logs
   `Prepared phase SKIPPED — no preparationReceiptFile supplied (pre-DIR-117-B dispatch shape; not
   yet the enforced default)` and proceeds to Build. Any dispatch that simply omits the parameter
   bypasses the gate silently. `OUTER-LOOP.md`'s `prepare(c)` STATUS note (~lines 57–63) and the
   `execute()` note (~lines 123–127) disclose this as accepted back-compat pending DIR-117-B, and
   still show `preparationReceiptFile?` as optional.
2. **The real end-to-end route has never run.** `prepare-milestone.js` has only ever been exercised
   against fixtures/unit tests (`milestone-preparation-check.test.mjs` ~43 test cases; the
   canonical `experiments/quay-perpetual-stream/fixtures/preparation/` dir holds one checked-in
   negative mutation fixture (`fixture-plan-malformed.md`) plus positive fixtures and
   `dir120-replay-findings.json`; wiring-coverage-check's 9). No live
   `milestones/M<NN>/preparation.json` receipt has
   ever been produced by a real SELECT cycle and consumed by a real `execute-milestone.js`
   dispatch. This is DIR-117's own AC #11 / DoD real-landing clause, split out per DIR-026
   SPLIT-OR-COMMIT (same pattern as DIR-119-A/B/C); DIR-117's bootstrap paradox (it could not
   traverse its own not-yet-built gate) made the split mandatory.
3. **`ProposalReview`'s mechanism-claim wiring coverage is prompt-only, not wired.** `grep -rn
   checkWiringCoverage` (excluding tests) returns exactly one real production call site:
   `experiments/quay-perpetual-stream/scripts/task-schema.ts:354–357` (`checkGapWiringCoverage`,
   DIR-122). `prepare-milestone.js`'s ProposalReview phase (line ~196, reviewer-prompt item 2)
   merely *asks the LLM reviewer in prose* to approximate the equivalent check. This is precisely
   the "prompt-guidance mistaken for production wiring" defect class DIR-117's own Proposal names
   as its motivating case, confirmed recurring inside M191 itself by M191's independent acceptance
   audit (`milestones/M191/audits/iteration-0-acceptance-audit.md` §3, DIR-122 re-audit: "one real
   call site … and one prompt-only side"; DIR-122's AC left unticked for that honest reason and
   tracked onto this task).
4. **The task itself currently fails its own AC #5.** Newly confirmed while grounding this
   Proposal: `node experiments/quay-perpetual-stream/scripts/task-schema-check.ts
   tasks/DIR-117-B.md` currently exits 1 — `touches-overbroad: ## Touches has overbroad glob(s):
   "milestones/**"` — while AC #5 demands exit 0. The task's `## Touches` must be narrowed (e.g.
   `milestones/M195/**`, `docs/plans/M195-*.md`, both satisfying the ≥2-concrete-leading-segments
   rule) as part of this milestone.

**Chosen mechanism.** This milestone is vehicle and payload at once (the self-referential shape
DIR-117's Plan anticipated, minus the bootstrap paradox — the mechanism being proven already
exists): M195 is itself prepared by the real `prepare-milestone.js` run for DIR-117-B and executed
through the real `Prepared` gate, producing the positive evidence; the Build phase then lands the
three code/task changes (direct `checkWiringCoverage()` call site in ProposalReview; opt-in →
enforced-default flip in both mirrors; `## Touches` narrowing) and proves them with a real
negative-control run and a real wiring fixture, in the same milestone.

**Concrete control/data flow.**

- **Positive run (happens first, is M195's own preparation):** OUTER-LOOP SELECT picks DIR-117-B →
  charter authored (`charters/M195-dir117b-prepared-gate-real-proof.md`, exists) → real dispatch of
  `.claude/workflows/prepare-milestone.js` (via absolute `scriptPath`, never `name:` — CLAUDE.md
  M176 stale-script-cache rule) with `{taskId: DIR-117-B, milestoneId: M195, charterFile, class}`
  → proposal authors → adjudication/write-back → ProposalReview bounded loop (DIR-125: 1 full
  synthesis + ≤2 delta rounds, typed finding ledger, zero open blocking findings required) →
  PlanAuthor writes `docs/plans/M195-*.md` → grounded PlanCheck → Receipt phase runs
  `milestone-preparation-check.ts --build … --out milestones/M195/preparation.json --ledger
  milestones/M195/proposal-ledger.json` and immediately re-verifies it in verify mode
  (prepare-milestone.js lines 413–417 already do both). Outputs: real
  `milestones/M195/preparation.json` + `proposal-ledger.json` + `docs/plans/M195-*.md`. → real
  dispatch of `execute-milestone.js` with `preparationReceiptFile:
  milestones/M195/preparation.json` → phases run Verify (5 it0 checks) → `Prepared` (agent runs
  `milestone-preparation-check.ts --task tasks/DIR-117-B.md --charter <charter> --receipt
  milestones/M195/preparation.json`, exit 0 required) → Build → Audit → Gate → Land.
  **Mechanism-claim C1** (`prepare-milestone.js` dispatches `milestone-preparation-check.ts`,
  build + verify) and **C2** (`execute-milestone.js`'s `Prepared` phase invokes the checker and
  gates Build on it) are proved by this run's workflow journals + receipt — AC #1 and the positive
  half of AC #2. Evidence set jointly shows Build began only after zero-finding Proposal/Plan
  checks.
- **Build work item A — wire ProposalReview to the real function (AC #4):** `prepare-milestone.js`
  is a workflow script and, by established convention (its own line 98–100 comment), has **no
  import statements** — it cannot `import { checkWiringCoverage }`. The Receipt and Prepared phases
  already solve the same problem by dispatching an agent to run `node --experimental-strip-types
  …` and consuming structured output. Apply the identical pattern: (a) add a CLI mode to
  `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` (the canonical module
  DIR-122's `checkGapWiringCoverage` already imports — single source, no logic duplication) —
  `node --experimental-strip-types …/wiring-coverage-check.ts --task <task.md>` — that extracts
  the task's `## Proposal` and `## Acceptance Criteria` sections, calls the real exported
  `checkWiringCoverage(sourceSectionText, acSectionText)` (line 102), and prints a typed JSON
  verdict whose `findings` array maps each `uncovered` claim to a BLOCKING typed finding in the
  exact ledger shape `ProposalReview` already uses (`{subsystem, summary, severity:"blocker",
  blocking:true, evidence, claimRef, disposition}`); (b) in `prepare-milestone.js`'s
  `ProposalReview` phase, add a deterministic agent dispatch (`label: 'wiring-coverage-check'`,
  `phase: 'ProposalReview'`) that runs the CLI and returns the parsed verdict; (c) the workflow
  script itself (not the LLM) merges the returned findings via the existing
  `_upsertFindings(rawFindings, 0)` path — so the phase's open-blocking finding count increments by
  `result.findings.length`, **from the function's real return value**, and the ledger (hash-bound
  into the receipt via `--ledger`) carries the proof. The LLM reviewer's prompt-level wiring step
  is retained as a complementary heuristic but is no longer the only check. Grep-confirmable: the
  literal CLI command string plus the ledger-merge lines exist in both
  `.claude/workflows/prepare-milestone.js` and `plugin/workflows/prepare-milestone.js`, kept
  byte-identical (`diff -q` in Verify). Two M195-PlanCheck-confirmed build necessities: (d)
  `plugin/scripts/wiring-coverage-check.ts` is the vendor-mirrored copy of the canonical
  experiments-side file (`sync-vendor.sh`'s SYNC_SCRIPTS "must be identical" group) — the CLI-mode
  edit must be propagated byte-identically or `sync-vendor.sh --check` and the plugin-packaging
  M136 test (both in the canonical suite) FAIL; (e) both workflow mock harnesses
  (`plugin/test/prepare-milestone-convergence.test.mjs` ~line 188,
  `plugin/test/prepare-milestone-preparation-e2e.test.mjs` ~line 208) fail closed (`throw`) on any
  agent label outside their enumerated set, so the new `wiring-coverage-check` dispatch turns the
  entire prepare-milestone suite RED unless both mocks are extended to return a stub typed verdict
  for that label — budgeted in the same stage.
  **Mechanism-claim C3** — covered by AC #4's fixture
  requirement.
- **Build work item B — flip the default (AC #3):** in both `execute-milestone.js` mirrors, delete
  the `else`-skip branch and make the phase unconditional: `phase('Prepared')` always runs; a
  **missing** `preparationReceiptFile` now returns `{outcome: 'revision-needed', reason:
  'preparation-receipt-missing', phase: 'Prepared'}` before Build — the same fail-closed shape a
  stale/failed receipt already produces (line 216), with a reason code distinct from the checker's
  existing file-level `receipt-missing` code. Update
  `plugin/test/execute-milestone-preparation-gate.test.mjs` (14/14 currently green against the
  opt-in shape; its line-273 case per mirror, "Prepared phase is SKIPPED (back-compat) when
  preparationReceiptFile is omitted — reaches Build unconditionally", is the suite that ACTUALLY
  encodes the skip behavior — M195 PlanCheck round 1 confirmed
  `execute-milestone-disposition-conformance.test.mjs` contains ZERO Prepared-phase/
  `preparationReceiptFile` cases and needs no edit) — RED-then-GREEN honest, not just
  re-baselined — and
  update the header phase-table entry (line 6) and the `OUTER-LOOP.md` STATUS notes (lines 57–63
  and ~123–127) from "not yet proven / omitting accepted / `preparationReceiptFile?` optional" to
  the enforced contract with the M195 evidence pointer. **Mechanism-claim C4** (missing receipt ⇒
  fail-closed return before Build) — covered by AC #3 plus the post-flip negative control.
- **Build work item C — narrow `## Touches` (AC #5):** replace the overbroad `milestones/**` /
  `docs/plans/**` globs with concrete-segment paths (`milestones/M195/**`, `docs/plans/M195-*.md`,
  plus the two workflow-mirror paths and `OUTER-LOOP.md` as needed) so
  `task-schema-check.ts tasks/DIR-117-B.md` exits 0; re-run the check after any task-body edits
  this Proposal phase writes back.
- **Negative control (AC #2's negative half + flip proof):** a real throwaway
  `execute-milestone.js` dispatch (scratch task id + scratch milestoneId + scratch charter under
  `milestones/M195/negative-control/`, temp workspace, no real Build intent) with (i) a
  doctored-stale copy of the real M195 receipt (hash invalidated — e.g. a deliberate post-receipt
  edit to the task's Proposal section so `computeCurrentHashes` mismatches) and/or (ii) a
  nonexistent receipt path — both must return `{outcome:"revision-needed", phase:"Prepared"}` with
  no Build-phase entry in the journal. After the flip lands, the omitted-parameter variant is
  demonstrated the same way. Cost note: the current phase order is Verify → Prepared → Build
  (execute-milestone.js lines 180–223), so each control run burns one it0-check round — accepted,
  because routing the control through the real workflow (not a bare
  `milestone-preparation-check.ts` invocation) is exactly what AC #2's `{outcome, phase}`
  return-shape demand requires. Evidence: workflow journal output captured into
  `milestones/M195/`.
- **Wiring fixture (AC #4):** a fixture task under
  `experiments/quay-perpetual-stream/fixtures/preparation/` (the canonical preparation-fixtures
  root — M195 PlanCheck round 1 confirmed `experiments/quay-perpetual-stream/test/fixtures/`
  is an empty tree) whose Proposal claims a mechanism (wiring
  verb + ≥2 backtick identifiers) with no matching AC item, driven through the new ProposalReview
  sub-step — showing the phase's own finding count increments by exactly the number of uncovered
  claims the function returns, with the LLM review stubbed/irrelevant (workflow test harness
  pattern already used by `proposal-convergence.test.mjs`). A new unit test beside
  `experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` asserts the CLI verdict
  emits ≥1 blocking finding from the function's return value — demonstrating the increment path
  end-to-end at the module boundary the workflow consumes. RED/GREEN: fixture without the new
  dispatch → 0 wiring findings; with it → N findings from the function.
- **Parent bookkeeping (DoD):** on Land, `tasks/DIR-117.md`'s `dirStatus`/Resolution is updated to
  point at M195's real evidence (its DoD clause "task remains dirStatus: pending until that real
  milestone lands").

**Sequencing inside M195.** Order matters because the receipt hash-binds the task file: (1) narrow
DIR-117-B's `## Touches` and confirm `task-schema-check.ts` exits 0 BEFORE the Receipt phase builds
`preparation.json` — any post-receipt edit to `tasks/DIR-117-B.md` instantly stales the receipt via
the Proposal/sources hashes, and the receipt is built last in `prepare-milestone.js`, so all task
edits must precede it; (2) positive-path preparation + execute dispatch with the CURRENT opt-in
`Prepared` phase (proves AC #1 / AC #2-happy before the flip, so the proof of enforcement is
against the shipped gate, not a gate modified mid-proof); (3) Build lands the ProposalReview wiring
+ fixture, the flip in both mirrors, and the OUTER-LOOP.md updates; (4) post-flip negative-control
run(s); (5) Audit/Gate/Land; (6) post-Land, update `tasks/DIR-117.md`'s Resolution/dirStatus.

**Key design decisions.**

- *CLI-dispatch, not import, for the wiring check.* Workflow scripts cannot import
  (sandboxed/resumable scripts; no workflow script imports TS today). The agent-dispatched
  `node --experimental-strip-types` call is the same pattern the Receipt and Prepared phases
  already use — no new mechanism class introduced — and keeps the call site grep-confirmable in a
  plain-text workflow file.
- *Extend `wiring-coverage-check.ts` with the CLI, not `milestone-preparation-check.ts`.* The
  wiring module is the single source DIR-122 already calls in production; duplicating its
  claim-extraction into a second script would recreate exactly the two-implementations drift
  DIR-122's AC forbids.
- *Findings enter the ledger as BLOCKING via the script's own `_upsertFindings` path, not via
  reviewer judgment* — an uncovered mechanism claim is one of DIR-125's enumerated blocking
  categories ("a new behavior with no falsifiable AC"), so this is consistent with the existing
  typed-ledger contract and gets hash-bound into the receipt for free. A false-positive claim can
  only be cleared by an explicit ledger disposition (e.g. `accepted-risk`), never silently.
- *Fail-closed reason `preparation-receipt-missing` reuses the existing `revision-needed` outcome*
  rather than `needs-human`: a missing receipt is a caller-shape error the caller can fix by
  preparing first, identical in kind to a stale receipt — not a human-decision terminal state.
- *The flip is uniform at the args level* (missing param fails closed for every dispatch shape,
  including DIR-119-B composite dispatches, which supply a receipt for their primary task) — no
  shape carve-out, because a carve-out recreates the back-compat hole this milestone exists to
  close.
- *M195 prepares itself* (real candidate = DIR-117-B). The M193/M194 prepare-skip precedent is
  explicitly inapplicable (charter §"Why this milestone does NOT skip prepare-milestone"): the skip
  exists for tasks already carrying review-derived Proposals, and here it would destroy the
  milestone's own primary evidence.

**Defaults and failure behavior.** After the flip, the default for every `execute-milestone.js`
dispatch is: receipt required, checker must exit 0, else `revision-needed` at phase `Prepared`
before any Build work. Stale proposal/charter/plan/source/ledger hashes, N/A Plan, touch-set
expansion, and now a missing parameter all fail closed with distinct actionable codes
(milestone-preparation-check.ts's existing per-reason codes plus `preparation-receipt-missing`). A
`ProposalReview` wiring verdict with uncovered claims → blocking findings in the ledger → the
DIR-125 convergence loop's existing caps apply (delta-round cap/budget exhaustion → `needs-human`,
never silent retry). The wiring-check sub-step failing to return parseable output (agent crash, CLI
exit 2) fails the ProposalReview phase closed (`needs-human`, mirroring the existing revise-failed
path) rather than silently skipping coverage. Receipt self-check failure in the Receipt phase →
`{outcome:"revision-needed", reason:"receipt-selfcheck-failed", phase:"Receipt"}` (existing
behavior, unchanged).

**Compatibility.** Both `.claude/workflows/` and `plugin/workflows/` mirrors edited together and
verified byte-identical (`diff -q` / `plugin/scripts/sync-vendor.sh --check` CLEAN); the new CLI
surface in `wiring-coverage-check.ts` propagates through the existing `SYNC_SCRIPTS` mirror group.
The flip is deliberately **not** backward compatible for receipt-less dispatches — that is the
point (AC #3) — and `OUTER-LOOP.md`'s `prepare(c)` step already runs before final dispatch in the
live loop, so legitimate dispatches always have a receipt. Known exposure: any ad-hoc/manual
`execute-milestone.js` dispatch without a receipt (e.g., the pending DIR-119-D composite dispatch
and DIR-124-series dispatches in the current task list) must route its primary task through
`prepare-milestone.js` first once the flip lands; the OUTER-LOOP note update must say so
explicitly. If DIR-119-D must land first for external reasons, sequence the flip commit after it —
but the flip is not scoped down. Pre-existing receipts and the receipt format itself are unchanged
— `buildReceipt`/`checkPreparation` signatures untouched.

**Risks.** (1) *Self-referential evidence integrity*: M195's receipt must carry real provenance
(distinct per-phase `$CLAUDE_CODE_SESSION_ID`s per the DIR-093 pattern) — mitigated by
`checkPreparation`'s existing mechanical distinctness verification. (2) *Self-reference staleness*:
editing DIR-117-B after receipt build invalidates the positive proof — mitigated by the sequencing
decision above. (3) *Stale-script-cache*: this session edits the very workflows it dispatches — all
dispatches via absolute `scriptPath` (CLAUDE.md M176 rule), and diff the materialized script when
in doubt. (4) *Heuristic false positives* from `checkWiringCoverage` become mechanically blocking —
mitigated by the module's deliberately narrow claim definition (wiring verb + ≥2 backtick
identifiers) and the explicit-disposition escape hatch; a noisy proposal surfaces as `needs-human`,
never as a silent pass or silent block. (5) *Conformance-test drift*: the disposition conformance
suite encodes the opt-in shape; updating it is in-scope and must stay RED-then-GREEN honest.
(6) *Negative-control pollution*: scratch dispatches must use throwaway task/milestone ids so no
real gate-events, dashboard state, or `milestones/M<NN>/` content is corrupted. (7) *Mirror drift*
between `.claude/workflows/` and `plugin/workflows/` — mitigated by byte-identity diff in Verify.
(8) *Ordering hazard*: the flip lands in the same milestone whose own positive run used the opt-in
path — acceptable because AC #2's positive evidence is captured before the flip, and the flip's own
fail-closed behavior is proven by the post-flip negative control; a fresh independent
wiring-focused audit after Land (charter Done-when) re-checks the final state. (9) *The flip
stranding in-flight human-steered dispatches that predate receipts* — mitigated by the
OUTER-LOOP.md disclosure update and by this milestone's own journal documenting the transition.

**Non-goals.** No preparation enforcement beyond the uniform args-level flip on the
composite/DIR-119-B `milestoneCandidate` dispatch path (composite dispatches supply a primary-task
receipt; per-member receipts are separate directive material if desired). No wiring of
`checkPreparation`'s `touches-expanded` result into `concurrent-batch-scheduler.ts`'s re-assembly
loop (DIR-117's own deferred AC5 follow-up, explicitly in scope for a future milestone once
DIR-117-B's real-landing proof exists). No changes to `checkWiringCoverage`'s claim-extraction
heuristics (the heuristic stays mechanical and narrow, per the module's own NON-GOAL — no
NLP-grade extraction). No retroactive receipts for pre-DIR-117 milestones. No changes to the
bounded-convergence policy (DIR-125 caps/budgets and ledger schema untouched beyond appending
wiring findings). No changes to the `quay-task-to-plan` skill policy/templates. No batch-scheduler
changes beyond what OUTER-LOOP already documents.

**AC coverage.** AC #1 → positive real run's journals + `preparation.json` +
`docs/plans/M195-*.md` (claims C1, C2-positive). AC #2 → negative control (stale + missing receipt)
and positive run reaching Build (C2 both halves, C4-behavior). AC #3 → the flip in both
byte-identical mirrors + OUTER-LOOP.md disclosure update (C4, C5). AC #4 → the CLI + dispatch +
`_upsertFindings` wiring in both `prepare-milestone.js` mirrors + the incrementing-finding-count
fixture/unit test (C3). AC #5 → `## Touches` narrowing, then
`task-schema-check.ts tasks/DIR-117-B.md` exit 0, re-run after any task-body edits this Proposal
phase writes back. DoD items → the M195 real landing itself, the enforced default with real
negative control, and DIR-117's `dirStatus`/Resolution update at Land.

**Mechanism-claim wiring coverage flags (DIR-117 required-on-itself).** This Proposal claims the
following call/dispatch/ownership/enforcement relationships, each flagged for review-phase AC
matching: **C1** `prepare-milestone.js` dispatches `milestone-preparation-check.ts` (build +
verify) — matched by AC #1. **C2** `execute-milestone.js`'s `Prepared` phase invokes
`milestone-preparation-check.ts` and returns `revision-needed` before Build on failure — matched by
AC #2. **C3** `ProposalReview` dispatches an agent running `wiring-coverage-check.ts`'s CLI (real
`checkWiringCoverage()`) and the script mechanically upserts the returned findings into the typed
ledger — matched by AC #4. **C4** a missing `preparationReceiptFile` becomes fail-closed
(enforcement default flip, both mirrors) — matched by AC #3. **C5** `OUTER-LOOP.md` and
`tasks/DIR-117.md` are updated to reflect the enforced contract and real evidence — matched by
AC #3 and the DoD third clause. No claim in this Proposal is left without a matching falsifiable
AC/DoD item.

**Alternatives considered and rejected.** (1) *Keep ProposalReview's wiring coverage as LLM-prompt
guidance / strengthen the prompt language* — rejected: that is the exact defect (M191 audit §3)
this milestone exists to close; prompt text is not a production call site, and DIR-122's corrected
AC6 forbids it. (2) *Direct `import` of `checkWiringCoverage` into `prepare-milestone.js`* —
rejected: violates the workflow-script no-import convention (sandboxed, resumable scripts); the
CLI-dispatch pattern is already proven in the same file. (3) *Move/duplicate the wiring logic into
`milestone-preparation-check.ts`* — rejected: two implementations of one check = the drift
DIR-122's AC forbids; `wiring-coverage-check.ts` stays the single source. (4) *Land the default
flip first and prove later* — rejected: DIR-026 Reading A; fail-closed enforcement without a real
positive + negative proof is exactly the disclosed-not-proven state M191 was audited for. (Also:
flipping at M191 landing time was impossible — bootstrap paradox; this child exists precisely
because the flip must follow the real proof.) (5) *Return `needs-human` for a missing receipt* —
rejected: it is a caller-fixable shape error, semantically identical to a stale receipt;
`needs-human` is reserved for human-decision terminals (split recommendation, budget exhaustion).
(6) *Leave the gate permanently opt-in and only document the route* — rejected: prose documentation
without enforcement is the drift class this repo's single-source/executable-invariant principle
exists to eliminate; the opt-in hole would silently persist. (7) *Prove on a scratch task /
fixture-only proof instead of a real candidate* — rejected: DIR-026 Reading A and DIR-117-B's DoD
explicitly require one REAL milestone, not a synthetic fixture; M195 being its own vehicle is the
honest, self-referential proof DIR-117's Plan anticipated. (8) *Skip `prepare-milestone` for M195
per the M193/M194 precedent* — rejected (the charter's own section argues this): the skip exists
for tasks already carrying review-derived Proposals, and here it would destroy the milestone's
primary evidence. (9) *Negative control via direct `milestone-preparation-check.ts` invocation* —
rejected: AC #2 demands the workflow-level `{outcome, phase}` return shape, which only a real
`execute-milestone.js` dispatch produces. (10) *Carve the composite dispatch shape out of the
flip* — rejected: it recreates the back-compat hole; composite dispatches supply a primary-task
receipt instead.

## Plan

Checked milestone Plan: `docs/plans/M195-dir-117-b.md` (authored for M195, charter
`experiments/quay-perpetual-stream/charters/M195-dir117b-prepared-gate-real-proof.md`). It declares
the complete touch set, maps every AC item to ordered stages in the mechanical stage format, and
records RED/GREEN checks, line budgets, dependencies, guardrails, rollback, and real-landing
verification.

## Finding

See `tasks/DIR-117.md`'s own `## Finding`/`## Requested action`/`## Acceptance Criteria` for the
full original problem statement — unchanged, this child only carries the one real-landing proof
DIR-117 itself could not self-certify.

## Requested action

1. Real SELECT → `prepare-milestone.js` → `execute-milestone.js(preparationReceiptFile=...)` run on
   one real candidate task, with the resulting task/`docs/plans/*.md`/`preparation.json`/workflow
   journal/iteration report jointly showing implementation began only after Proposal and Plan
   checks reached zero findings.
2. A real negative-control run (stale/missing receipt) shows `execute-milestone.js` returns before
   Build with `phase: "Prepared"` and `outcome: "revision-needed"`.
3. Flip `execute-milestone.js`'s `Prepared` phase from opt-in to the enforced default (a MISSING
   `preparationReceiptFile` becomes fail-closed, not skip-with-INFO) once (1)/(2) are proven; update
   `OUTER-LOOP.md`'s disclosure note.
4. **Added 2026-07-28, per M191's independent audit finding (`milestones/M191/audits/
   iteration-0-acceptance-audit.md` §3) and DIR-122's corrected AC6:** `prepare-milestone.js`'s
   `ProposalReview` phase must call `wiring-coverage-check.ts`'s real `checkWiringCoverage()`
   function directly (the same function DIR-122's `checkGapWiringCoverage` already calls in
   production) rather than only prompting an LLM reviewer, in prose, to approximate the equivalent
   check. This closes the exact "prompt-guidance mistaken for production wiring" pattern DIR-117's
   own Proposal names as its motivating case — which recurred inside DIR-117's own M191 delivery.

## Acceptance Criteria

- [ ] Real production evidence (workflow journal + `preparation.json` + `docs/plans/*.md`) confirms
  `prepare-milestone.js` actually dispatches `milestone-preparation-check.ts` for a real (non-
  fixture) task and produces a receipt that a real subsequent `execute-milestone.js` call consumes.
- [ ] Real production evidence confirms `execute-milestone.js`'s `Prepared` phase enforces the
  receipt supplied via `preparationReceiptFile` — a real run with a stale/missing receipt returns
  `{outcome:"revision-needed", phase:"Prepared"}` before Build; a real run with a valid receipt
  reaches Build.
- [ ] `execute-milestone.js`'s `Prepared` phase default is flipped from opt-in-skip to enforced-by-
  default (both `.claude/workflows/` and `plugin/workflows/` mirrors, byte-identical), and
  `OUTER-LOOP.md`'s M191 disclosure note is updated to reflect the real-landing proof instead of
  "not yet proven."
- [ ] `prepare-milestone.js`'s `ProposalReview` phase calls `wiring-coverage-check.ts`'s real
  `checkWiringCoverage()` function directly — grep-confirmable real import/call site in both
  `.claude/workflows/` and `plugin/workflows/` mirrors, not prompt-only LLM guidance — with a real
  fixture Proposal (claimed mechanism, no matching AC item) showing the phase's own finding count
  increments from the function's real return value, not an LLM's independent judgment.
- [ ] `node experiments/quay-perpetual-stream/scripts/task-schema-check.ts tasks/DIR-117-B.md` exits
  0.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply, including
adversarial acceptance audit, V_meta consolidation-lag, line budget, test floor, tree/worktree
hygiene, and audit independence. Per DIR-026 Reading A, a synthetic fixture alone is necessary but
insufficient — done only when:

- [ ] One REAL milestone (not a scratch task) shows checked Proposal, checked Plan, matching
  preparation receipt, and workflow evidence that Build started only after the Prepared gate
  passed — landed on `master`.
- [ ] `execute-milestone.js`'s `Prepared` phase is the enforced default (not opt-in) in both
  mirrors, with a real negative-control run proving fail-closed behavior.
- [ ] Parent `tasks/DIR-117.md`'s own DoD item ("task remains dirStatus: pending until that real
  milestone lands") is satisfied by THIS child's landing, and DIR-117's own `dirStatus`/Resolution
  is updated to point at this child's real evidence.

## Touches

- tasks/DIR-117-B.md
- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- plugin/scripts/wiring-coverage-check.ts
- experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs
- experiments/quay-perpetual-stream/fixtures/preparation/wiring-uncovered-claim-task.md
- plugin/test/execute-milestone-preparation-gate.test.mjs
- plugin/test/prepare-milestone-convergence.test.mjs
- plugin/test/prepare-milestone-preparation-e2e.test.mjs
- experiments/quay-perpetual-stream/OUTER-LOOP.md
- docs/plans/M195-dir-117-b.md
- milestones/M195/**
