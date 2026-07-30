# M202 / DIR-126-C — Iteration 0 (Build)

**Task:** DIR-126-C — generation-aware resume for `prepare-milestone.js` (`decideResumeGeneration`
in `proposal-convergence.ts`), third child of DIR-126's 5-way split.
**Charter:** `experiments/quay-perpetual-stream/charters/M202-dir126c-generation-aware-resume.md`
**Plan:** `docs/plans/M202-dir-126-c.md` (7 ordered stages, all 27 task AC items mapped)

## Summary

Replaced `prepare-milestone.js`'s bare `$a.resumeFromAdjudicatedProposal === true` boolean read with
a fail-closed, hash/provenance-derived three-state decision (`cold`/`resume`/`reuse-terminal`),
consumed ONLY when the caller omits the flag entirely (explicit `true`/`false` stay byte-identical,
zero new dispatches). Added `decideResumeGeneration` + `PHASE_RANK`/`CACHEABLE_TERMINALS`/
`RESUMABLE_PHASES`/`RESUME_POLICY_VERSION` as a fifth pure function/constant set to
`experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`, plus a new thin CLI tail
(`--decide-resume`, `--record-generation`) guarded by `isDirectEntry(import.meta)` — the same guard
`prepare-admission-check.ts`'s own CLI uses — so `milestone-preparation-check.ts`'s existing static
import of this module stays side-effect-free. Both mirrors (`.claude/workflows/prepare-milestone.js`
<-> `plugin/workflows/`, `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` <->
`plugin/scripts/`) are byte-identical (`cmp` + `sync-vendor.sh --check`, both CLEAN). Zero diff
against `prepare-admission-check.ts`/`.gitignore` (both mirrors) since base `480cb58` — the entire
mechanism lands inside the task's own six declared `## Touches` files.

## Per-stage disposition (docs/plans/M202-dir-126-c.md)

| Stage | Status | Evidence |
|---|---|---|
| 1 (RED — failing pure-function fixtures) | Done | `describe('decideResumeGeneration', ...)` block added to `proposal-convergence.test.mjs` importing not-yet-defined exports — confirmed RED (`does not provide an export named`) before Stage 2, GREEN after |
| 2 (implement `decideResumeGeneration` + vocabulary constants) | Done | `PHASE_RANK`, `CACHEABLE_TERMINALS`, `RESUMABLE_PHASES`, `RESUME_POLICY_VERSION`, `decideResumeGeneration` all exported from `proposal-convergence.ts`, implementing the task's own 11-step evaluation order verbatim as a plain `if` series (no try/catch inside) |
| 3 (thin CLI — `--decide-resume`/`--record-generation`) | Done | CLI tail guarded by `isDirectEntry(import.meta)`; `--decide-resume` derives `generationId`, reads current hashes, calls the pure function, embeds `releaseLease` on `reuse-terminal` (wrapped so a release-layer exception surfaces as a typed `releaseResult.ok===false`, never collapses to `decision-exception`); `--record-generation` re-reads task/charter fresh and piggybacks `releaseLease` |
| 4 (`prepare-milestone.js` — three-source resume derivation + `reuse-terminal` short-circuit) | Done | `const` → `let` for `_resumeFromAdjudicatedProposal`; decision block inserted strictly between Admission success and content `phase('Preflight')`; a Stage-4 pre-check (`existsSync` — the workflow's one new real `fs` primitive) skips the `--decide-resume` dispatch entirely when no prior generation record exists, keeping the out-of-Touches `plugin/test/prepare-milestone-preparation-e2e.test.mjs` mock green with zero edits |
| 5 (`_releaseLeaseAndRecord` at all 15 terminal sites) | Done | All 15 live `_releaseLease(` call sites (grep-reconfirmed against `git show 480cb58:`) replaced with `_releaseLeaseAndRecord(stageLabel, {terminalPhase, outcome, reason, cacheable})` under the SAME `admission-release-${stageLabel}` label (label continuity); the now-callerless `_releaseLease` helper removed; `cacheable:true` set ONLY at the two allowlisted sites (192-region `PreflightContent`/`preflight-rejected`, 490-region `ProposalReview`/`split-recommended`) |
| 6 (mirror byte-identity sync) | Done | `cmp` + `bash plugin/scripts/sync-vendor.sh --check`: CLEAN, zero drift across both touched mirror pairs |
| 7 (real dispatch proof + grounding audit + R9 + final regression) | Done (see "Evidence classes" below for what "real" means at Build time) | Real spawned-CLI proof (`child_process`, not mocked) for `--decide-resume`/`--record-generation`; real-source `loadWorkflow()`-driven, mocked-`agent()` integration proof for `prepare-milestone.js`'s wiring (the SAME technique this file's own docstring calls "REAL, unmodified workflow source... asserting on REAL dispatch counts"); `git diff --stat` R9 check; full `scripts/test.sh` regression |

## Test evidence

- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`: **63/63 pass** (up from 34
  pre-Build) — 4 constant/vocabulary tests, 18 `decideResumeGeneration` evaluation-order tests (one
  per step 1/2/4-11, plus R7's terminalPhase-pair-disambiguation fixtures and the `cacheable:false`
  hard-gate case), 5 real spawned-CLI tests against a scratch workspace with a real lease file
  (no-prior-record cold, record→decide reuse-terminal round-trip with a real subsequent
  `prepare-admission-check.ts --acquire` proving no stranded lease, repaired-Proposal resume,
  missing-lease exception→`decision-exception`, AC14/R8 side-effect-free-import).
- `plugin/test/prepare-milestone-convergence.test.mjs`: **52/52 pass** (up from 32 pre-Build) — every
  pre-existing DIR-125/M197/DIR-126-A/DIR-126-B scenario stays green UNCHANGED, plus 7 new
  `loadWorkflow()`-driven scenarios (pre-check zero-dispatch, automatic resume with review-still-
  unconditional, reuse-terminal-before-content-Preflight with zero admission-release dispatch,
  unparseable-verdict fail-closed, release-failure fail-closed, explicit-flag zero-dispatch for both
  `true`/`false`) and 4 new WIRING-CLAIM R5/R7/R9 production-callsite/git-diff coverage tests
  (per mirror — 8 total).
- `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` +
  `milestone-preparation-check.test.mjs`: **103/103 pass**, unmodified (zero diff against
  `prepare-admission-check.ts` — R9) — regression floor for the read-only-imported dependencies.
- **Full canonical `scripts/test.sh` run: 692 tests, 688 pass, 1 fail, 3 skipped (the 3 live-GitHub
  tests, correctly self-skipping without `GH_TOKEN` per ADR-019).** The 1 failure
  (`packages/quay/test/serve.test.mjs`) is unrelated to this child's Touches (Core web-UI/serve
  code, no import of `proposal-convergence.ts`/`prepare-milestone.js`/`prepare-admission-check.ts`)
  and passed cleanly (1/1) when re-run standalone outside the concurrency-8 full-suite run —
  consistent with resource contention (it starts real HTTP servers) under the default
  `--test-concurrency=8`, not a regression this child introduced.
- `bash plugin/scripts/sync-vendor.sh --check`: CLEAN, zero drift.
- `git diff --stat 480cb58..HEAD -- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts plugin/scripts/prepare-admission-check.ts .gitignore`: empty (R9).

## Evidence classes — what "real" means at this Build stage

Per DIR-026 Reading A, source + tests are necessary but insufficient. Three distinct evidence classes
were produced, each real in its own way, none of them a literal live-agent-orchestrated `Workflow()`
dispatch of `prepare-milestone.js` (that requires the outer loop's own `Workflow` tool, not available
to this Build subagent, and is properly the NEXT genuine milestone dispatch through this exact code —
not something a Build subagent implementing that same code can self-exercise without circularity):

1. **Real spawned-CLI proof** — `child_process.execFileSync` runs of the actual
   `proposal-convergence.ts --decide-resume`/`--record-generation` CLI against a real scratch
   filesystem workspace with a real lease file, including a real `prepare-admission-check.ts
   --acquire` call proving the embedded release leaves no stranded lease.
2. **Real-source, mocked-agent workflow-integration proof** — `plugin/test/
   prepare-milestone-convergence.test.mjs`'s established `loadWorkflow()` technique (unchanged from
   DIR-125/DIR-126-A/DIR-126-B precedent): the REAL, unmodified `prepare-milestone.js` source is
   loaded as a live `AsyncFunction` and driven through its real control flow; only the `agent()`
   callback is mocked. Dispatch COUNTS and LABELS are asserted against the real source's real
   branches, not against prompt text.
3. **Grounding/production-callsite greps** — direct regex/git-show checks against the committed
   source for WIRING-CLAIM R5/R7/R9 (terminalPhase literal values, mirror byte-identity, empty
   diff against out-of-Touches files).

A fresh independent audit (this task's own DoD item 5) tracing the real production import graph for
`decideResumeGeneration`'s callsite and confirming review-unconditional/`reuse-terminal`-cannot-
advance from the committed source (not unit-test reachability) is the Audit phase's own remaining
job, per this milestone's own Prepared-gate note and every prior DIR-126 child's precedent.

## AC/DoD status

Per `it0-dod-check.sh DIR-126-C <charter> <absorb-entry>`, three clauses remain open at this Build
checkpoint, all by design (per `milestones/M202/absorb-entry.md`'s own comment: "completed during the
Land phase"):

- `clause0-ac-dod-present`: the task's 27 AC checkbox items are unchecked — checking them is the
  acceptance-audit's job (checking boxes as a self-report from Build would violate the
  audit-independence discipline this same methodology enforces via `clause1`).
- `clause1-adversarial-audit` / `clause2-vmeta-lag`: no disposition statement yet in the ABSORB entry
  — both sections are explicitly deferred to the Audit/Land phases per the file's own comment block.

All 7 Plan stages are functionally complete and test-evidenced; nothing in this Build's own scope
(code + tests + real spawned-CLI/mocked-workflow proof) remains outstanding.

## Files changed

- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` (+ `plugin/scripts/` mirror,
  byte-identical)
- `.claude/workflows/prepare-milestone.js` (+ `plugin/workflows/` mirror, byte-identical)
- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- `plugin/test/prepare-milestone-convergence.test.mjs`
- `tasks/DIR-126-C.md` (`extra.acceptance` set to the it0-dod-check invocation)
