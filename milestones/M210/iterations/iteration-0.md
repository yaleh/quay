# M210 / DIR-119-D2 — iteration-0 (Build phase)

**Task:** DIR-119-D2 — Wire Build into a real phase-DAG dispatcher (composite-build.ts)
**Charter:** `experiments/quay-perpetual-stream/charters/M210-dir119d2-build-phase-dag.md`
**Plan:** `docs/plans/M210-dir-119-d2.md`
**Class:** development · capability-growth · human-steered
**Dispatch base:** `094adabe` (094adabea2a7ed6de00548d51ff9133b5933732b — `master` HEAD at Build start)
**Iteration count:** 1
**Outcome:** done (Stages 1–5 implemented and verified; Stage 6 real-dispatch proof is post-Land by plan design)

## What was built

Wired `execute-milestone.js`'s composite Build path to a REAL per-phase DAG dispatcher instead of
the single monolithic Build agent, exactly per the Plan's 6-stage design. Two halves:

1. **`composite-build.ts` non-selftest CLI wraps** (`--plan-json`, `--map-evidence-json`) — PURE
   wraps over the already-exported `planPhaseExecution`/`mapEvidenceToTasks`. The ONLY input handling
   is CLI-layer shape normalization: a bare `CompositePhase[]` is used as-is; the `{manifest,
   context}` envelope `composite-manifest-synthesis.ts` L524 writes (the shape the production
   callsites pass via `--phases`) is unwrapped to `.manifest.phases`; any other shape exits 1.
   `planPhaseExecution`/`mapEvidenceToTasks`/`topoOrder`/`selftest()` received ZERO edits (guardrail
   G7) — both `--selftest` runs pass unchanged.
2. **`execute-milestone.js` production wiring** — new async `_compositePhaseDagBuild()`:
   `build-plan` (one labeled helper running the literal `--plan-json` command, returns the
   `PhaseExecutionPlan` + per-phase scoping descriptors) → per-batch SERIAL `parallel()` of exactly
   one labeled `` label: `build-phase-${phaseId}` `` agent per phase, each prompt scoped ONLY to its
   own phase's task IDs / predecessor phases / invariant / allowed Touches / evidence schema →
   `build-integrate` (one serial helper, the SOLE commit-creator, runs the literal
   `--map-evidence-json` command). Dispatch predicate is EXACT: fires IFF `_isComposite &&
   _taskIds.length > 1` (the width-1 path and the composite-shaped singleton stay on the
   byte-identical single-agent prompt — additive branch, never a rewrite). Fail-closed mid-batch:
   any non-`done` phase worker → `needs-human` immediately, no further batches, `build-integrate`
   does NOT run, no commit created (partial changes left in place for DIR-119-D3/D4 Audit/Reconcile).

## Stage evidence

### Stage 1 — RED (recorded before implementation)
`node --experimental-strip-types --test experiments/quay-perpetual-stream/test/composite-build.test.mjs`
and `scripts/test.sh plugin/test/composite-build.test.mjs` BOTH: `tests 14, pass 9, fail 5`, runner
exit 1. The 5 new CLI-wrap tests fail (empty stdout → `JSON.parse` throws, as the Plan predicted —
the base argv block only recognizes `--selftest`); the 8 existing tests + the AC7 cap property pass.
The plugin mirror `plugin/test/composite-build.test.mjs` was created byte-identical (NEW file).

### Stage 2 — implementation
`--plan-json`/`--map-evidence-json` argv modes added to `composite-build.ts` (+ byte-identical
mirror). Re-running the Stage-1 command flipped the 5 CLI-wrap tests from fail to pass.

### Stage 3 — GREEN
- experiments-side test: `tests 14, pass 14, fail 0`
- plugin mirror via `scripts/test.sh`: `tests 14, pass 14, fail 0`
- both `--selftest` runs: `all fixture cases PASS`
- `diff` of the script pair AND the test pair: byte-identical (exit 0)
- Full `scripts/test.sh`: `tests 816, pass 811, fail 2`. **Both failures are PRE-EXISTING and
  OUTSIDE this milestone's touch set** — `plugin/test/plugin-packaging.test.mjs` (DIR-070-B:
  "universal-gate plugin files … zero exp5/experiment-path references" and the twin "no
  shipped/foreign-workspace-facing file leaks … exp5" test) flag `plugin/scripts/tree-hygiene-check.sh`
  lines 55/68, which reference `experiments/.../sweep-fixture-orphans.mjs`. Proven pre-existing:
  with my changes `git stash`-ed, `scripts/test.sh plugin/test/plugin-packaging.test.mjs` STILL fails
  `tests 34, pass 32, fail 2`. That file is committed (last touched by `e8c363d5`), unmodified by me,
  and outside the declared touch set — editing it would violate guardrail G1. **This child introduces
  ZERO new test failures.**

### Stage 4 — production wiring
- `node --check` on both mirrors: exit 0 (base also passes — top-level `return` is valid CJS, no
  root `"type":"module"`).
- `diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js`: byte-identical.
- AC1/AC6 literal callsite greps (count 0 at base, now ≥1 per mirror): `composite-build.ts --plan-json`
  = 2/mirror; `composite-build.ts --map-evidence-json` = 2/mirror.
- AC2/AC3/AC5 label-form grep (fixed-string `` label: `build-phase-${phaseId}` ``, count 0 at base):
  = 1/mirror.
- Three golden-replay test files (`execute-milestone-build-phase-gate`,
  `execute-milestone-disposition-conformance`, `execute-milestone-preparation-gate`): `tests 40,
  pass 40, fail 0`.

### Stage 5 — legacy width-1 golden replay
- Content-anchored prompt-region diff (Plan Stage 5 command) for BOTH mirrors:
  `diff <(git show 094adabe:<mirror> | sed -n '/BUILD the inner iteration/,/on failure/p') <(sed -n
  '/BUILD the inner iteration/,/on failure/p' <mirror>)` → exit 0 (byte-identical). The width-1
  (`_isComposite===false` / `{taskId,...}`) Build prompt is UNCHANGED.
- The dispatch predicate guard `_isComposite && _taskIds.length > 1` is on the ADDED (`+`) side of the
  diff and `const buildResult = await agent(` on the deleted (`-`) side — exactly as the Plan's
  Stage-4 wiring spec anticipated (the prompt REGION is pinned, the call-site wrapper may change).
- The three `execute-milestone-*.test.mjs` golden-replay files materialize the real workflow source
  (`new AsyncFunction(...)`) and drive a width-1 Build dispatch through a mock `agent()`; passing
  40/40 with these changes proves the width-1 path still dispatches exactly ONE Build agent with the
  unchanged prompt and the `buildResult?.outcome !== 'done'` gate still propagates through the new
  ternary. A live nested `execute-milestone` dispatch is deliberately NOT run from inside this Build
  agent — guardrail G6 (single-driver serialization on the shared working tree; `.halt` hygiene).

## AC status (Build-phase scope)

| AC | Status | Evidence |
|---|---|---|
| 1 (MASTER) production callsites | DONE (wiring) | Stage-4 greps: `--plan-json`/`--map-evidence-json` callsites ≥1 in BOTH mirrors; zero-importer state flipped |
| 2 build-phase count == phase count (>1) | structural DONE; real-dispatch proof = Stage 6 (post-Land) | label-form grep present; batches.flat() == all phases by construction |
| 3 requires-edge observance | structural DONE; real-dispatch proof = Stage 6 | batches dispatched SERIALLY (`for` loop awaiting each `parallel()`) |
| 4 per-phase prompt scoping | structural DONE; raw-agent-record proof = Stage 6 | each build-phase prompt interpolates ONLY its own phase's taskIds/requires/invariant/touches |
| 5 build-plan/build-integrate exactly once | structural DONE; real-dispatch proof = Stage 6 | one `agent()` call per label in the wiring |
| 6 literal `plan` command string | DONE | Stage-4 grep ≥1/mirror |
| 7 cap bounds concurrency, never ownership | DONE | AC7 unit test: cap ∈ {1,2,5} → each phase id batched exactly once (label count == 5) while agentCount ≤ cap |
| 8 build-integrate sole commit-creator + `--map-evidence-json` caller | structural DONE; git-log/RESULT-record proof = Stage 6 | only build-integrate runs `git commit` and the `--map-evidence-json` command |
| 9 legacy width-1 behavior-identical | DONE | Stage-5 prompt-region byte-identity + 40/40 golden-replay |
| 10 fresh independent wiring audit | Stage 6 (post-Land) | — |

AC2/3/4/5/8/10 carry a real-composite-dispatch evidence half that the Plan explicitly assigns to
**Stage 6 (post-Land)** — "Depends on: Stages 1–5 landed; DIR-119-D1 landed on `master`." The
structural/wiring halves are complete and verified; the real-dispatch journal/RESULT-record evidence
and the fresh independent wiring audit are captured at Land against the landed `master` state, per
the Plan's Real-landing verification section.

## Line budget (numstat vs dispatch base `094adabe`)

| File | +added | -deleted | Budget | Status |
|---|---|---|---|---|
| `experiments/.../scripts/composite-build.ts` | 65 | 2 | ≤ +90/file | ✓ |
| `plugin/scripts/composite-build.ts` | 65 | 2 | ≤ +90/file | ✓ |
| `experiments/.../test/composite-build.test.mjs` | 132 | 0 | ≤ +165 | ✓ |
| `plugin/test/composite-build.test.mjs` (NEW, byte-identical) | 206 | 0 | ≤ +240 | ✓ |
| `.claude/workflows/execute-milestone.js` | 131 | 1 | ≤ +130 net | ✓ (net +130) |
| `plugin/workflows/execute-milestone.js` | 131 | 1 | ≤ +130 net | ✓ (net +130) |

## Accepted-risk note (carried from the task Proposal)

The skip-`build-integrate`-on-failure control-flow branch is a documented, ACCEPTED residual risk of
this child, not gated by a dedicated failure-injection AC/DoD item: (a) its commit-safety half (no
candidate-generation commit on a failed batch) is structurally entailed by `build-integrate` being
the sole commit-creator (AC8); (b) its working-tree-rollback half is explicitly out of scope
(DIR-119-D3/D4 Audit/Reconcile). Named here so it is a bounded, visible residual.

## Notes for Audit / Land

- `milestones/M210/absorb-entry.md` is NOT present at Build time — per the Plan's touch set it is a
  Land-phase writeback (created when the Audit phase appends dispositions). When its `## Backlog row`
  is authored, the accurate `surface:` token for this milestone's `## Touches` (all
  workflow/script/test/plan files, no `packages/quay*` product code) is **`method-infra`**.
- `extra.acceptance` was set at pre-flight (and `dirStatus: applied` / `schema: v1` preserved) on
  `tasks/DIR-119-D2.md`.
- The 2 pre-existing `plugin-packaging.test.mjs` failures (tree-hygiene-check.sh exp5-path leak) are
  out of this child's touch set and predate the dispatch base; they belong to whoever owns
  `plugin/scripts/tree-hygiene-check.sh` packaging.
