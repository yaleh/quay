# Charter M45-cryst-d1-doc-management — D1: quay DOCUMENT-MANAGEMENT capability
# (contract-validator as a quay feature; DIR-030's leading eligible capability-growth candidate)

**Milestone id:** M45-cryst-d1-doc-management · **surface:** cli (adds real code to
`packages/quay-native/src/{document-store,contract-validator,frontmatter-store-base}.js` and
`packages/quay/src/gate/registry.js`, product files — Clause 7 test-floor APPLIES) · **type:**
capability-growth (primary — a genuinely new, reusable quay engine capability: doc-management +
contract-validator) + governance-integrity (secondary — unblocks D2/D3-§9's "contracts validated BY
quay" and E2's back-link mechanism).
**Source:** `DIR-030` (`tasks/DIR-030.md`, restart-steering directive — window closed at m43, D1
eligible since m44) → `exp5-M-CRYST-D1` (`tasks/exp5-M-CRYST-D1.md`).
**Charter authored:** m44→m45 boundary, 2026-07-20. Base commit: `master` HEAD `e800326`.
**Built by:** an isolated background subagent per DIR-032 (this session cannot dispatch further
subagents — see the pipeline process-fidelity note below and `pipeline/proposals.md`'s own
disclosure). ABSORB's adversarial-audit sub-step is explicitly NOT run by this session — see the
draft ABSORB entry's PENDING placeholder.

## SELECT reasoning
DRAIN (this pass): 0 pending directives (`task_list --label directive`, filtered to
`extra.dirStatus:"pending"`); no new human-authored/`human-steered`-cleared milestone-candidate
landed since M44 ABSORB; no out-of-band human commit on `master` since M44 (`git log`/`git status`
clean, `e800326` current HEAD). DIR-032 (the item that outranked D1 at M44 SELECT) is now
`done`/`resolved` — no competing governance-integrity/risk-option candidate at the same urgency is
open. Compared against the other open, non-`human-steered` crystallization candidates (`INV`, `B4`,
`E2`, `D4-LEDGER-STRUCTURED-STATUS`, `C1`, `B6-VALIDATOR-COVERAGE`, `B5-PARSER-UNIFY`) — each a
small design/instrument-correction fix, none carrying DIR-032's active-degradation urgency, none
cited by a pending directive.

**Chosen: `exp5-M-CRYST-D1`** — per M44 ABSORB's own note, "the FIRST candidate considered at the
m45 SELECT" once DIR-032 landed. Foundational capability-growth candidate unblocking D2/D3-§9/E2.
`## SELECTed (M45)` note appended to the task; `## Not selected (M45)` note appended to
`exp5-M-CRYST-INV` (the next-closest candidate compared against). `milestone:M45-cryst-d1-doc-
management` label written onto the task.

**Value-typed SELECT ledger entry:** value type = **capability-growth** (primary — a new, reusable
quay engine capability: doc-management kind + self-verifying contract validator + a named gate) +
**governance-integrity** (secondary — unblocks D2/D3-§9/E2's dependent work). No VT chart-1 cell
(method-infra-adjacent capability, matching the E1/E3 no-VT-cell precedent); Δv̂ judged on the
capability-growth/governance-integrity axis directly.
**Governance/infra hard floor check:** D1's scope INCLUDES its own real-landing half (a real method
doc managed + validated end-to-end, not merely the schema/store code) — passes the hard floor.

**Class routing (5a) — MANDATORY, dev-class applies:** D1's deliverable is real product code — runs
the `quay-task-to-plan` pipeline FIRST (N=2 draft proposals → adjudication → write-back → milestone-
level plan → grounded check → THEN implementation), per DIR-014/5a. **Process-fidelity note (same
finding as M41/M42/M43/M44):** no genuinely isolated Task-agent dispatch tool reachable from this
nested session — `mcp__plugin_manda_manda__Agent` errors "cap request requires to=" (no addressed
broker). Fell back to the SAME established pattern: N=2 proposals drafted sequentially by this same
orchestrator context (honestly flagged, proposal 2 does not re-read proposal 1's Approach section
before drafting), adjudicated by this session, written back to the task. See
`milestones/M45-cryst-d1-doc-management/pipeline/{proposals,adjudication,plan}.md` for the full
record. Independence for THIS dev-class milestone is spent upstream (the N=2 proposal step, weaker
than genuine subagent isolation but the same honest-limitation pattern M42/M43/M44 already used) and
downstream (the adversarial-audit gate — deferred to top-level dispatch per DIR-032, NOT run by this
session).

## Acceptance Criteria
Mirrors the task's own 2 Acceptance Criteria (`tasks/exp5-M-CRYST-D1.md`) exactly:
- [ ] quay validates a document's self-`contracts:` (grep/not-grep, `target:self`) and surfaces
  conformance; a non-conforming doc is flagged (not silently passed).
- [ ] A real method doc (e.g. a skill or OUTER-LOOP) is managed + validated through quay end-to-end;
  single-source (the contract logic lives once, a gate wraps it).

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware, task already checklist-form], 1 per-milestone acceptance audit [unconditional —
**deferred to top-level dispatch per DIR-032**, this session stops before it], 2 V_meta
consolidation-lag, 3 line-budget, 4 impl-row — N/A [this milestone's own output IS the real-landing
proof, not a design doc awaiting a future `-IMPL` row], 5 no-self-exemption, 6 escrow-Δv — N/A [not
design-only; ships real, tested product code], 7 test-floor — **APPLIES** [`surface:cli`, real
product code added across 4 new/touched files; strict TDD ≥80% coverage per the quay-task-to-plan
pipeline's own hard gate — re-confirm the ACTUAL coverage number at ABSORB], 8 task
canonical-lifecycle-record [task carries `## Proposal`/`## Plan` per the pipeline's write-back], 9
split-or-commit [D1 was NOT split — fully completable within one milestone per the sizing check
below, following the E1/E3 precedent's scope]). No task-specific exemption from any clause.

## Value hypothesis
- Value type(s): **capability-growth** (primary) + **governance-integrity** (secondary), per the
  value-typed SELECT ledger above.
- **Δv̂:** no VT chart cell expected (method-infra-adjacent surface, matches the E1/E3 no-VT-cell
  precedent); value measured directly by the metric `Y` below.
- Metric `Y`: the task's 2 Acceptance Criteria, verbatim — specifically, whether the
  contract-validator genuinely flags a non-conforming doc (fixture-pinned, both directions), and
  whether a REAL method doc (`.claude/skills/quay-directive/SKILL.md`) is managed + validated
  end-to-end through quay with the contract logic living once (wrapped by a `doc-<id>` gate).

## Current-state notes (re-verified directly against source at charter-authoring time)
- `packages/quay-native/src/adr-store.js` (209 lines): the direct structural precedent this
  milestone reuses — frontmatter parse/serialize, lockfile-guarded writes, `{list,get,write}` API.
  Confirmed present, unchanged since M44.
- `packages/quay/src/gate/registry.js`: `makeAdrGate` (E3, M42) is the direct gate-factory
  precedent for the new `doc-<id>` gate — same wrap-a-check, fail-closed-on-missing discipline.
- No existing `document`/`docs-managed` object kind or `contract-validator.js` exists anywhere in
  the repo (confirmed via `find`/`grep`) — this is genuinely new work, not a rename/refactor.
- `.claude/skills/quay-directive/SKILL.md` exists, is stable, and carries clear load-bearing prose
  rules suitable for a real `contracts:` retrofit (chosen over `OUTER-LOOP.md` itself for the
  DIR-013/DIR-018 concurrent-edit race risk reason recorded in `pipeline/adjudication.md`).

## In scope
1. `packages/quay-native/src/frontmatter-store-base.js` (NEW) — shared frontmatter
   parse/serialize/lock/list-filter helper, factored out of `adr-store.js` (behavior-preserving;
   existing ADR tests must stay green unchanged).
2. `packages/quay-native/src/document-store.js` (NEW) — `createDocumentStore(docDir)` →
   `{list,get,write}`, same shape as `adr-store.js`, using the shared helper. New `contracts:`
   frontmatter field (reserved/round-tripped by the store itself).
3. `packages/quay-native/src/contract-validator.js` (NEW) — single-source pure function
   `validateContracts(doc)` implementing `grep`/`not-grep`/`target:self` assertions.
4. `packages/quay/src/gate/registry.js` — new `makeDocumentContractGate(docId, docDir)` gate-factory
   (parallel to `makeAdrGate`, in-process validation, no shell-out), registered for the real wired
   case.
5. Real end-to-end retrofit: `.claude/skills/quay-directive/SKILL.md` managed as a document with a
   real `contracts:` block; one synthetic non-conforming fixture proving the FAIL path.
6. A CLI/MCP consult surface (`quay-native doc validate <id>`) printing per-assertion results.
7. TDD ≥80% coverage on all new/touched product code, test-first per ADR-001.

## Explicitly OUT of scope
- Retrofitting `OUTER-LOOP.md` itself (considered, rejected — see `pipeline/adjudication.md`).
- A generic regex-DSL or cross-file `target` beyond `target:"self"` (task AC1 scopes to
  grep/not-grep/self only).
- Wiring EVERY future methodology doc as a managed document this milestone — only the one real
  wired case (`quay-directive` SKILL.md) is required by the task's own AC2.
- D2 (skill rewrites), D3 (OUTER-LOOP/inherited-core rewrite), E2 (ADR extraction), F1 — untouched,
  `human-steered`-fenced or simply out of this milestone's scope.

## Done-when (binary clauses)
Mirrors the task's 2 Acceptance Criteria exactly (see task file) plus:
1. `quay gate <task> --gate doc-<id>` exits 0 against the real retrofitted `quay-directive` doc and
   1 against the synthetic violating fixture; both leave real GateEvents in `quay gate-log`.
2. `node --test --experimental-test-coverage` on the touched packages shows ≥80% line coverage on
   every new/touched product file (paste real output, not restated from memory).
3. `quay-native doc validate <id>` invoked live against the real retrofitted doc returns the
   per-assertion pass table (not asserted from memory).

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`
lines 100-131 for the full literal text; both dispatched iteration prompts must include it
verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged. The manda healthz gate and port-4173
reachability gate are N/A this milestone (no Web UI surface touched) — state N/A explicitly in each
iteration's report, do not silently omit.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-check.sh`: N/A — this milestone cites no `gap-list.md` gap/directive ID as in-scope
  (its source is a live task, `exp5-M-CRYST-D1`, and a resolved directive, `DIR-030`, both read
  directly).
- `it0-ceiling-line-budget-check.sh` against this charter: run before dispatch (below); ~450-line
  plan-time budget declared in `pipeline/plan.md`, single-phase (small-milestone norm), well under
  the ≤2000 ceiling.
- `it0-impl-row-check.sh`: N/A — this milestone's own output is the real-landing proof itself.
- Domain-misfit audit-channel: an independent mechanism IS reachable — the adversarial audit can
  independently re-run `quay gate <task> --gate doc-<id>` against both the conforming and violating
  fixtures and confirm the GateEvents/exit codes match the claimed AC, exactly as E3/M42-M44's own
  audits have done.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
**PER DIR-032 — this session (a nested background subagent) does NOT dispatch or perform this
audit.** ABSORB stops before this sub-step with an explicit `PENDING — top-level dispatch`
placeholder, per this task's own dispatch instructions and the M44 precedent
(`milestones/M44-dir032-audit-independence/audits/iteration-0-acceptance-audit.md`). When
dispatched, the audit should specifically probe: (a) does `doc-<id>` gate genuinely invoke
`validateContracts()` (re-run independently, confirm no hardcoded pass), (b) does the synthetic
violating fixture genuinely FAIL the gate (re-run independently), (c) is the GateEvent real and
queryable via `quay gate-log --json` (paste raw output), (d) does the consult surface actually run
against the real retrofitted doc and return the correct per-assertion table, (e) is coverage
genuinely ≥80% on every new/touched file (re-run independently, diff against the claimed number).

## Note for ABSORB
1. Remember the Clause 2 exact-phrase requirement: dashboard text must contain the literal substring
   "V_meta consolidation-lag" (or "V_meta consolidation lag").
2. Remember the `it0-dod-check.sh` invocation convention: task id (not milestone id) as the first
   argument — `exp5-M-CRYST-D1`.
3. This milestone's ABSORB does NOT invoke `quay gate exp5-M-CRYST-D1` as a completion claim from
   THIS session — that gate is wired but its full pass (incl. `audit-independence`) requires the
   real top-level-dispatched audit artifact, which this session does not produce.
4. **Checkpoint cadence:** last checkpoint written was cp-40 at m40 (every-5-milestone cadence, next
   DUE at m45 — `milestone_counter` would become 45 if this ABSORB completes, which is a multiple of
   5). **NOT written by this session** — deferred along with `milestone_counter++` to the top-level
   session that completes the audit and ABSORB.
5. `milestone_counter` MUST NOT be incremented by this session (currently 44) — per this build's own
   dispatch constraint.

## Dispatcher notes
Dev-class routing (5a): this session (itself a nested background subagent per DIR-032, forbidden
from dispatching further subagents) drafted N=2 sequential same-context proposals → adjudicated →
wrote back → authored + self-checked the plan → implemented directly in an isolated worktree. ABSORB
STOPS before the adversarial-audit sub-step; a draft ABSORB entry with an explicit `PENDING —
top-level dispatch` placeholder is left for the top-level session, exactly mirroring
`milestones/M44-dir032-audit-independence/audits/PENDING.md`'s (now-finalized) pattern.
