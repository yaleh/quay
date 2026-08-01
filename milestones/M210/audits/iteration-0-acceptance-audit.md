# M210 / DIR-119-D2 — iteration-0 acceptance audit

**Audit session id:** fce11849-b5c4-4ce4-afe5-7b960ca2ad0c
**Date:** 2026-08-01 · **Auditor:** fresh-context adversarial acceptance audit (had NOT seen the build)
**Task:** `tasks/DIR-119-D2.md` · **Charter:** `experiments/quay-perpetual-stream/charters/M210-dir119d2-build-phase-dag.md`
**Build commit:** `efb8ec6f` (master HEAD at audit time) · **Dispatch base:** `094adabe`
**MILESTONE_ROOT:** `milestones/M210` (via `gate_resolve_milestone_root 210`)

## Verdict: REFUTED

- **4 of 10 AC items CONFIRMED** with auditor-generated evidence: AC1 (the master item — production wiring), AC6, AC7, AC9.
- **6 of 10 AC items REFUTED as unconfirmable at iteration-0:** AC2, AC3, AC4, AC5, AC8, AC10 — each demands, in its own text, evidence off a REAL composite dispatch (workflow RESULT record / raw per-dispatch agent records / a candidate-generation commit in `git log`) that does not exist anywhere on disk.
- **DoD: 2 of 4 CONFIRMED** (landed on master under human-steered discipline; legacy width-1 golden replay unregressed), **2 REFUTED** (real non-fixture composite dispatch; fresh audit with zero unresolved findings).
- **Mechanical gate** `it0-dod-check.sh DIR-119-D2 <charter> milestones/M210/absorb-entry.md` → **exit 1**: `clause0-ac-dod-present` FAIL — "checklist-form AC has 6 unchecked item(s) remaining (REFUTED-equivalent, HARD-blocks)"; the other 12 clauses all PASS/N/A (1–8, 10–12 PASS/N/A; 9 N/A, no needs-human declared).
- The audit charge's two REFUTED rules both fire: "Any AC you cannot confirm → REFUTED" and "Non-zero exit = REFUTED by construction."

This is a REFUTED-by-absence-of-required-evidence driven by a Plan/gate sequencing contradiction (root cause below), NOT a finding that anything about the implementation is false. Every structural half this audit could reach was reached and verified; nothing was refuted on the merits.

## REFUTED items — evidence

**Common evidence (auditor-run, 2026-08-01):** NO real composite dispatch through the new dispatcher has ever run.
- `jq '[.workflowProgress[]? | select(.label? // "" | startswith("build-phase-"))] | length'` (and `build-plan` / `build-integrate` variants) over EVERY `wf_*.json` under every `~/.claude/projects/-home-yale-work-quay/*/workflows/` session → **0 labeled entries in every file**. All plain-text "build-phase-" hits in those records are EMBEDDED SOURCE TEXT (the execute-milestone.js script body this very commit modified), not dispatch entries.
- The quay project has **no `subagents/` directories at all** under its sessions (they exist only for the archguard/meta-cc/lan projects) — AC4's raw `agent-*.jsonl` falsification surface is empty by absence of any records.
- `git log` shows **no candidate-generation commit** produced by a `build-integrate` helper; `efb8ec6f` is an ordinary Build-phase commit authored under the OLD (pre-this-commit) single-agent workflow.
- The builder's own `milestones/M210/iterations/iteration-0.md` AC table discloses this openly: AC2/3/4/5/8 = "structural DONE; real-dispatch proof = Stage 6 (post-Land)"; AC10 = "Stage 6 (post-Land)". The charter's Done-when also says "A fresh independent wiring audit after Land".

**AC2 (build-phase-<id> count == phase count >1 off a real RESULT record) — REFUTED.** The AC demands the count "off the real dispatch's workflow RESULT record". No such record with any `build-phase-*` entry exists (jq counts = 0 everywhere). Structural half verified: `_compositePhaseDagBuild()` maps `batches.flat()` to exactly one `agent(..., { label: \`build-phase-${phaseId}\` })` per phase (execute-milestone.js L286-313), so a real dispatch WOULD record one entry per phase — but the AC's evidence contract is the real record, which is absent.

**AC3 (dispatch-time requires-edge observance off the same real record) — REFUTED.** Same absence. Structural half verified: batches run through a serial `for` loop (L286) where each `await parallel(...)` completes before batch i+1 dispatches (L288-308) — batch ordering WOULD be observable off the real record; the record does not exist.

**AC4 (per-phase prompt scoping off raw agent-*.jsonl) — REFUTED.** The named falsification surface (raw per-dispatch agent records) is empty — the quay project has no subagent records at all. Structural half verified by code reading: each build-phase prompt interpolates ONLY its own phase's `taskIds`/`requires`/`integrationInvariant`/`touches` into the scope block (L289-300) with an explicit no-leak instruction. Minor structural observation (unadjudicable without the missing real records): the prompt HEADER line interpolates the milestone's full member-task list (`member tasks: ${_taskIds.join(', ')}`) before the "Task IDs (yours ALONE)" block — reads as identifying context rather than an edit-scope leak, but the AC's literal "references ONLY its own phase's task IDs" wording could only be adjudicated off the absent raw records.

**AC5 (build-plan / build-integrate exactly once in the real RESULT record) — REFUTED.** "in the real workflow RESULT record" — none exists. Structural half verified: exactly one `agent()` call with `label: 'build-plan'` (L254) and one with `label: 'build-integrate'` (L324) per `_compositePhaseDagBuild()` invocation; labels distinct from `build-phase-<id>`.

**AC8 (build-integrate sole commit-creator + --map-evidence-json caller, via import grep + real RESULT record + git log) — REFUTED on the AC's own evidence conjunction.** The import-grep half IS confirmed: the only commit-creation instruction in the composite path is inside the build-integrate prompt (L327 "Create EXACTLY ONE candidate-generation commit … You are the SOLE commit-creator"), phase prompts explicitly forbid `git add`/`git commit` (L299), and the `--map-evidence-json` literal command appears only in the build-integrate prompt (L331). But the AC requires confirmation via import grep AND the real RESULT record AND git log — the latter two are absent (no real dispatch; no candidate-generation commit in `git log`).

**AC10 (fresh independent wiring audit finds no refutation) — REFUTED.** THIS audit is that fresh independent wiring audit (fresh context, explicitly tracing the import graph for `composite-build.ts`). On the import-graph surface it finds no refutation (see AC1). But the audit as performed DID find refutations — the five absent real-dispatch evidence surfaces above — so "finds no refutation" is false as of iteration-0.

## CONFIRMED items — evidence (all auditor-run)

**AC1 (MASTER — real production wiring) — CONFIRMED.**
- `grep` in BOTH mirrors: literal `composite-build.ts --plan-json` command at L257 and `composite-build.ts --map-evidence-json` at L331 of `.claude/workflows/execute-milestone.js` and `plugin/workflows/execute-milestone.js`.
- Mirror byte-identity: `diff` of the two `execute-milestone.js` files, the two `composite-build.ts` files, and the two test files — all exit 0 (identical).
- Import-graph flip: `grep -rln "composite-build"` over the tree (excl. node_modules) shows exactly 2 production references (both workflow mirrors) + 2 test files; at dispatch base the production importer count was zero (the task's own re-verified problem framing, consistent with this audit's trace).
- Non-selftest reachability: `composite-build.ts` L274-294 — `--plan-json`/`--map-evidence-json` are independent `else if` argv branches after `--selftest`, each a pure wrap calling the exported `planPhaseExecution`/`mapEvidenceToTasks` with CLI-layer shape normalization only (bare array or `{manifest, context}` envelope unwrapped to `.manifest.phases`; anything else exits 1 via `cliFail`).
- Live-path reachability: the dispatcher is invoked from the Build phase via `const buildResult = (_isComposite && _taskIds.length > 1) ? await _compositePhaseDagBuild() : await agent(<legacy prompt>)` (L357-359) — the exact predicate the task specifies; the Build phase has NO other dispatch point (auditor enumeration of all `agent(`/`parallel(` calls and `phase()` boundaries).
- CLI-wrap identity tests: 4 dedicated tests (bare-array + envelope shapes, `deepEqual` vs the real exports, plus malformed-input fail-closed) pass — `node --experimental-strip-types --test` on the experiments side: 14/14; `scripts/test.sh plugin/test/composite-build.test.mjs`: 14/14.

**AC6 (literal plan-mode command string in both mirrors) — CONFIRMED.** L257 in both mirrors: `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-build.ts --plan-json --phases ${manifestFile} --mode parallel --max-parallel-agents ${maxParallelAgents}` (auditor grep).

**AC7 (cap bounds concurrency, never phase ownership) — CONFIRMED.** The `AC7: maxParallelAgents bounds concurrency, NEVER phase ownership` test (composite-build.test.mjs L193-206) asserts, for 5 phases and caps {1, 2, 5}: batched slot count == 5, 5 distinct phase ids, every phase present exactly once, and `agentCount <= cap`. Auditor-run: 14/14 pass on both mirrors. The pre-existing `parallel-agentcount-capped-below-task-count` selftest-adjacent test (cap 2 → `agentCount <= 2`) also still passes unchanged (guardrail G7 — planner functions received zero edits; verified: the diff adds only CLI-layer code after the selftest section).

**AC9 (legacy width-1 behavior-identical) — CONFIRMED.**
- Auditor-run content-anchored prompt-region diff vs dispatch base `094adabe`: `diff <(git show 094adabe:<mirror> | sed -n '/BUILD the inner iteration/,/on failure/p') <(sed -n '/BUILD the inner iteration/,/on failure/p' <mirror>)` → exit 0 (byte-identical) for BOTH mirrors.
- The base's `const buildResult = await agent(` (base L229) is now the else branch of the additive ternary (L357-359) — the width-1 prompt text is untouched, the call-site wrapper changed additively.
- Auditor-run golden-replay suites: `scripts/test.sh plugin/test/execute-milestone-build-phase-gate.test.mjs plugin/test/execute-milestone-disposition-conformance.test.mjs plugin/test/execute-milestone-preparation-gate.test.mjs` → 40/40 pass. These materialize the real workflow source and drive a width-1 Build dispatch through a mock `agent()`.

**DoD item 1 (landed on master under human-steered discipline) — CONFIRMED.** `git branch --contains efb8ec6f` → `master`; `efb8ec6f` is master HEAD; the task carries the `human-steered` label; committed directly on master per the loop's corrected no-driver-branch design (DIR-027).

**DoD item 4 (legacy width-1 golden replay confirmed unregressed by a real test comparison) — CONFIRMED.** Same auditor-run evidence as AC9 (prompt-region byte-identity vs base + 40/40 golden-replay tests).

## DoD REFUTED items

- **DoD item 2** ("a real, non-fixture composite Build dispatch exercises the full new per-phase wiring end to end with journal evidence, not asserted") — REFUTED: no such dispatch exists (common evidence above).
- **DoD item 3** ("a fresh independent wiring audit — briefed on this child's own Proposal — finds zero unresolved findings") — REFUTED: this fresh audit HAS unresolved findings (the six items above).

## Standard-DoD / suite evidence (auditor-run)

- Full canonical suite `scripts/test.sh`: **tests 816, pass 811, fail 2, skipped 3**. The 2 failures are the pre-existing `plugin/test/plugin-packaging.test.mjs` tests flagging `plugin/scripts/tree-hygiene-check.sh` lines 55/68 (experiments-path references). Proven pre-existing and outside this milestone's touch set by the auditor: M210's 8-file diff (`git show --name-only efb8ec6f`) touches NEITHER `plugin/scripts/tree-hygiene-check.sh` (last modified `e8c363d5`) NOR `plugin/test/plugin-packaging.test.mjs` (last modified `ac8f4b42` / M198). **This milestone introduced zero new test failures.**
- Gate-adjacent hygiene (auditor-run): `tree-hygiene-check.sh` exit 0 (clean); `worktree-branch-hygiene-check.sh` exit 0 (clean); `vmeta-lag-check.sh --counter 205 experiments/quay-perpetual-stream/v-meta-ledger.md` → "PASS: no confirmed-unconsolidated row past K without a dated carry-forward" (both ledger rows `[ok]`); `it0-ceiling-line-budget-check.sh <charter>` exit 0.

## Mechanical gate result (step 3)

```
it0-dod-check.sh DIR-119-D2 experiments/quay-perpetual-stream/charters/M210-dir119d2-build-phase-dag.md milestones/M210/absorb-entry.md
PASS: clause1-adversarial-audit (verdict present) · clause2-vmeta-lag · clause3-line-budget · clause4-impl-row
PASS: clause5-no-self-exemption · clause6 (N/A, not design-only) · clause7 (N/A, method-infra surface)
PASS: clause8 (N/A, pre-cutover task) · clause10-tree-hygiene · clause11-worktree-branch-hygiene · clause12 (N/A documented no-op)
N/A:  clause9-split-or-commit (no needs-human declared)
FAIL: clause0-ac-dod-present — checklist-form AC has 6 unchecked item(s) remaining (REFUTED-equivalent, HARD-blocks):
      AC2, AC3, AC4, AC5, AC8, AC10 [tasks/DIR-119-D2.md]
GATE EXIT: 1
```

The 6 gate-flagged items are exactly the 6 this audit left unchecked (DIR-020 write-back performed honestly: confirmed items checked with evidence citations, unconfirmable items left unchecked).

## Root cause (machine-caught this pass; deviation row written to dashboard.md)

The checked Plan (`docs/plans/M210-dir-119-d2.md`, Stage 6) sequences the real-dispatch evidence for AC2/3/4/5/8/10 and the fresh wiring audit as **POST-Land** ("Depends on: Stages 1–5 landed"). Three facts make the milestone unsatisfiable BY CONSTRUCTION at iteration-0:
1. the task's ACs are DIR-020 checklist-form, and `it0-dod-check` clause 0 HARD-blocks any unchecked checklist box at gate time (REFUTED-equivalent);
2. the lifecycle runs the iteration-0 acceptance audit BEFORE Land, so post-Land evidence is structurally unreachable at audit time;
3. a real nested composite dispatch from within the Build agent is additionally barred by guardrail G6 (single-driver serialization on the shared working tree — and concurrent prepare dispatches were in fact in flight during this audit).

Method-level repair options (for the loop / a follow-up gap): (a) split the AC set into a structural-wiring child (confirmable pre-Land) and a real-dispatch-proof child run as a dedicated post-Land audit iteration before ABSORB; (b) run Stage 6 between Land and ABSORB and gate ABSORB on its evidence; or (c) add an explicit, waiver-style "post-Land evidence" disposition mechanism to clause 0 (analogous to the needs-human waiver in DIR-026) so a Plan-approved post-Land evidence schedule does not collide with the checklist HARD-block.

## Notes

- **Clause 12 (audit-independence) N/A:** the absorb-entry carries no `## Audit-independence check` section, consistent with the M206 precedent (which also ran a real adversarial audit and passed clause 12 as documented no-op). This audit records its harness-discovered session id (`fce11849-b5c4-4ce4-afe5-7b960ca2ad0c`, distinct from the build/dispatch session) as the first content line of this artifact per DIR-093.
- **Accepted-risk branch** (skip-`build-integrate`-on-failure): the task Proposal names this as a documented, bounded residual risk (commit-safety half structurally entailed by the sole-commit-creator invariant; working-tree-rollback half explicitly out of scope for DIR-119-D3/D4). This audit neither gates nor refutes it, per the task's own AC/DoD which contain no failure-injection item; the fail-closed control flow IS present in code (L268-271 build-plan failure, L302-306 mid-batch failure, L337-340 integrate failure).
- The structural halves of ALL six REFUTED items were verified (serial per-batch dispatch, per-phase scoping, sole-commit-creator wiring, exactly-once helper labels) — see per-item evidence above.

## Write-backs performed by this audit (same pass)

1. `tasks/DIR-119-D2.md` — DIR-020 checklist write-back: 4 AC items (AC1, AC6, AC7, AC9) + 2 DoD items (1, 4) checked `- [x]` with inline evidence citations; 6 AC items (AC2-AC5, AC8, AC10) + 2 DoD items (2, 3) left `- [ ]` (unconfirmable — see evidence above).
2. `milestones/M210/absorb-entry.md` — created: `## Backlog row` (first column `DIR-119-D2`, `surface:method-infra`), `adversarial-audit disposition: REFUTED`, and the verbatim `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward` line (copied from `vmeta-lag-check.sh --counter 205`'s own output).
3. `experiments/quay-perpetual-stream/dashboard.md` — DIR-017 Step 3 deviation row appended: level REFUTED · caught-by machine · caught-at M210 · status open · age 0.
4. This audit artifact staged (`git add`) immediately after writing (DIR-M176).
