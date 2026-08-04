---
id: gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files
title: 8 of 9 status:ready tasks Touch files physically deleted by ADR-022's
  pipeline retirement — dispatching any of them wastes an agent recreating
  retired infrastructure
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

Found while picking orthogonal ready tasks to dispatch during the 2026-08-04 second-OOM
recovery tick (outer session). `mcp__quay__task_list({status:'ready', label:'milestone-candidate'})`
returns 9 tasks. Checked every one's `## Touches` against the real tree:

```
$ ls .claude/workflows/execute-milestone.js .claude/workflows/prepare-milestone.js \
     plugin/workflows/execute-milestone.js plugin/workflows/prepare-milestone.js \
     experiments/quay-perpetual-stream/scripts/composite-build.ts
ls: cannot access '.claude/workflows/execute-milestone.js': No such file or directory
ls: cannot access '.claude/workflows/prepare-milestone.js': No such file or directory
ls: cannot access 'plugin/workflows/execute-milestone.js': No such file or directory
ls: cannot access 'plugin/workflows/prepare-milestone.js': No such file or directory
ls: cannot access 'experiments/quay-perpetual-stream/scripts/composite-build.ts': No such file or directory
```

| Task | status | Touches a deleted file? |
|---|---|---|
| DIR-119-D2 | ready | `.claude/workflows/execute-milestone.js`, `composite-build.ts` (both sides) — **all gone** |
| DIR-119-D3 | ready | same pattern, `composite-audit.ts` — **all gone** |
| DIR-119-D4 | ready | same pattern, `composite-reconcile.ts` — **all gone** |
| gap-plancheck-blocking-only-convergence | ready | `.claude/workflows/prepare-milestone.js` (both sides) — **gone** |
| gap-plancheck-no-diminishing-returns-exit | ready | same — **gone** |
| gap-prepare-milestone-no-worktree-isolation | ready | `.claude/workflows/prepare-milestone.js` (both sides), and its own `## Touches` includes `CLAUDE.md` — **gone** |
| gap-recursive-guard-only-covers-multi-mechanism | ready | `.claude/workflows/prepare-milestone.js` (both sides) — **gone** |
| gap-split-decision-finality-not-enforced | ready | only `proposal-convergence.ts` (exists), but its Proposal/AC are scoped against `prepare-milestone.js`'s split-decision recording flow, which is retired |
| DIR-103-C | ready | all real, live `packages/quay/*` files — **the one genuinely dispatchable task** |

**Root cause**: `CLAUDE.md`'s ADR-022 retirement notice ("the classic milestone loop —
`OUTER-LOOP.md` + `prepare-milestone.js` + `execute-milestone.js` + the `composite-*` phases +
... — is retired... physically deleted at `gap-retire-the-prepare-execute-pipeline-cluster`
(2026-08-03)") never propagated to these 8 task bodies' `status`/Touches. They were authored
against the classic-loop pipeline before ADR-022, and nothing marked them `todo`/`needs-human`
or noted their target no longer exists when the pipeline was deleted the next day.

**Why this matters**: a tick that mechanically picks "any `status:ready` task" (as
`plugin/loop/fast-mode-loop-tick.md` step 4 does) has an 8/9 chance of picking a task whose
entire `## Touches` list is dead files — the dispatched subagent would either fail immediately
or, worse, silently recreate the retired pipeline, directly undoing ADR-022's -23648-line
deletion. This tick avoided it only because a human-authored prompt happened to eyeball the
Touches lists before dispatching; the mechanical `checkTouchesPair` gate does not check
file-existence, only pairwise overlap.

## Chosen mechanism

Two candidate fixes (pick one, or do both — they're not mutually exclusive):

1. **Retire-tag these 8 task bodies**: re-triage each — either close as `status: needs-human`
   with a note "target deleted by ADR-022, scope no longer applies" (if genuinely obsolete), or
   rewrite `## Touches`/`## Proposal` against the fast-mode-loop replacement mechanisms if the
   underlying concern still applies to the new two-layer loop (e.g. DIR-119-D2/D3/D4's
   phase-DAG-dispatcher concern might still be real for whatever replaced `execute-milestone.js`,
   or might not — check before assuming either way).
2. **Add a mechanical dispatch-eligibility check**: before a tick dispatches a `status:ready`
   task, verify every entry in `## Touches` that is NOT tagged `(new)`/`(delete)` actually exists
   in the tree; a ready task whose Touches are majority-nonexistent should be flagged, not
   silently dispatched. This generalizes the existing "Touches expansion" work
   (`touches-orthogonality-check.ts`) rather than inventing a new instrument.

**Not doing**: not deleting these 8 task bodies outright — some of them may carry a real,
still-applicable concern that just needs re-scoping against current infrastructure; deleting
would erase whatever thinking already went into them.

## Acceptance Criteria

- [x] AC1: each of the 8 tasks is re-triaged: either `status: needs-human` with an explicit
      "ADR-022 made this target obsolete" note, or `## Touches`/`## Proposal` rewritten against
      real, currently-existing files (real-run `ls`/`grep` evidence pasted per task)
- [x] AC2: a mechanical check (new or extended) that a `status:ready` task's `## Touches` file
      list resolves against the real tree is wired into the dispatch-eligibility path used by
      `plugin/loop/fast-mode-loop-tick.md` step 4, so this class can't recur silently
- [x] AC3: negative control — a genuinely ready task with real, existing Touches (e.g. DIR-103-C)
      is NOT flagged by the new check

## Definition of Done

- [x] `mcp__quay__task_list({status:'ready'})` no longer contains any task whose `## Touches`
      majority-resolve to nonexistent files, OR each surviving one carries a documented reason
      the check doesn't apply
- [x] AC1-AC3 real-run evidence pasted into this task body

## Execution record (2026-08-04, worktree `task/gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files`)

### AC1 — re-triage of the 8 tasks

Each task body now carries a `## ADR-022 RE-TRIAGE` note with its own `--resolve` evidence. Summary:

| Task | New status | Disposition |
|---|---|---|
| DIR-119-D2 | needs-human | 6/7 Touches missing; composite-Build mechanism landed, remaining ACs demand real-dispatch evidence against the deleted `execute-milestone.js` composite pipeline |
| DIR-119-D3 | needs-human | 6/7 missing; composite-Audit landed, remaining ACs target deleted pipeline |
| DIR-119-D4 | needs-human | 6/7 missing; Reconcile landed, remaining ACs target deleted pipeline |
| gap-plancheck-blocking-only-convergence | needs-human | `planCheckNextAction` landed + tested (proposal-convergence.ts, retained); only remaining AC wires into deleted `prepare-milestone.js` PlanCheck loop |
| gap-plancheck-no-diminishing-returns-exit | needs-human | `priorBlocking` exit landed + tested; only remaining AC wires into deleted `prepare-milestone.js` |
| gap-prepare-milestone-no-worktree-isolation | needs-human | 2/3 missing; CLAUDE.md explicitly documents this mechanism as RETIRED under ADR-022 |
| gap-recursive-guard-only-covers-multi-mechanism | needs-human | hoisted `wbsLevel>=2` guard landed + tested in retained `checkSplitRecommendation`; only remaining AC wires into deleted `prepare-milestone.js` `_splitCheck()` |
| gap-split-decision-finality-not-enforced | ready (kept) | NOT an ADR-022 casualty — split-decision flow lives in retained `proposal-convergence.ts`; `splitScopeHash` landed; dead `plugin/test/proposal-convergence.test.mjs` touch removed |

No task body was deleted. Real-run evidence per task is pasted in each task's own `## ADR-022 RE-TRIAGE` section.

### AC2 — mechanical dispatch-eligibility resolve check

Extended `plugin/scripts/touches-orthogonality-check.ts` (the same single-source module that owns
`checkTouchesPair`) with:

- `parseTouchEntriesWithTags(section)` in `plugin/scripts/touches-parser.ts` — the tag-aware read
  (path byte-identical to `parseTouchEntries`; `(new)`/`(delete)` captured).
- `touchExists(p, root)` — exact path via `fs.existsSync`, glob / trailing-slash dir via
  `expandGlobs`.
- `checkTouchesResolve(entries, root)` / `checkTaskTouchesResolve(taskBody, root)` — per-entry
  resolution + `majorityMissing` verdict (`(new)` entries exempt; flagged iff > half of non-`(new)`
  entries are missing).
- CLI `--resolve <task.md>` mode (exit 1 = MAJORITY-MISSING → not dispatchable).
- Wired into `plugin/loop/fast-mode-loop-tick.md` step 4 as the new eligibility gate **1. 触摸可解析性**
  (before dependency-readiness and `checkTouchesPair` concurrency), so a ready task whose Touches
  majority-resolve to nonexistent files is flagged and not silently dispatched.
- Tests: `experiments/quay-perpetual-stream/test/touches-orthogonality-check.test.mjs` (11 new tests:
  `touchExists`, `checkTouchesResolve`, `checkTaskTouchesResolve`, `main --resolve`) +
  `plugin/test/touches-parser-parity.test.mjs` (3 new tests: tag capture, byte-identity, empty).
  Scoped run: 42/42 (orthogonality + parity), plus concurrent-batch-scheduler / workflow-baseline /
  symlink-mirror / select-preflight / config-wiring / quay-init-loop all green.

### AC3 — negative control

```
$ node --no-warnings --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts --resolve tasks/DIR-103-C.md --root "$(pwd)"
  ok: packages/quay/src/gate/acceptance-runner.ts
  ok: packages/quay/src/gate/registry.ts
  ok: packages/quay/src/gate/config/utils.ts
  ok: packages/quay/src/gate/config/types.ts
  ok: packages/quay/bin/quay.ts
  ok: packages/quay/src/mcp-handlers.ts
  ok: packages/quay/src/mcp-server.ts
  ok: packages/quay/test/acceptance.test.mjs
  ok: README.md
  ok: packages/quay-native/examples/sample-workspace/.quay/config.yml
  ok: docs/plans/M225-dir-103-c.md
RESOLVE tasks/DIR-103-C.md: 0/11 non-(new) touches missing — resolves (dispatchable)
exit=0
```
DIR-103-C is NOT flagged (0/11 missing), even though in the worktree snapshot it is `status: ready`
(main checkout moved it to `done` at commit `5cba0cae` — status is irrelevant to the check, which
is existence-based).

### DoD — ready queue after re-triage

Run with the native provider in the worktree (the MCP provider resolves against the main checkout,
not the worktree, so the native CLI is the reliable surface here):

```
$ node --no-warnings --experimental-strip-types packages/quay-native/bin/quay-native.ts task list --status ready --json
ready count: 4
ids: DIR-103-C, QENG-5-DEMO-FAIL, QENG-5-DEMO-PASS, gap-split-decision-finality-not-enforced
```

Every ready task's Touches resolve: DIR-103-C 0/11 missing; QENG-5-DEMO-* have no `## Touches`
section (nothing to verify); gap-split-decision-finality-not-enforced 0/3 missing (dead
`plugin/test/proposal-convergence.test.mjs` entry removed). No ready task's Touches
majority-resolve to nonexistent files.

### REFUTE record (internal adversarial review, 2 rounds, both resolved)

- **Round 1 (found + fixed):** `checkTouchesResolve` originally required `(delete)`-tagged entries to
  exist, but the task's AC2 wording ("verify every entry ... that is NOT tagged `(new)`/`(delete)`")
  exempts BOTH tags — a delete of an already-gone file is a no-op and cannot make a task
  undispatchable. Fixed: `(delete)` now skips existence like `(new)`; CLI prints `skip (delete)`;
  two new tests cover the exemption. Also found the majority-missing CLI branch lacked a trailing
  newline (the `exit=$?` ran onto the RESOLVE line) — fixed; and two stale comments (parser said
  `(delete)` "MUST exist", tick doc mentioned only `(new)`) — corrected.
- **Round 2 (no real findings):** confirmed the fast-mode dispatch path uses the tick doc's
  `checkTouchesPair` inline eligibility (NOT the retired `concurrent-batch-scheduler.ts`
  `assembleBatch`, whose only live caller is a golden-replay script), so the tick-doc wiring is the
  correct hook; updated this task's `## Touches` to include all 4 additionally-modified files;
  `task-status-drift-check.ts` and `test-framework-policy-check.ts` both pass.

## Touches

- tasks/DIR-119-D2.md
- tasks/DIR-119-D3.md
- tasks/DIR-119-D4.md
- tasks/gap-plancheck-blocking-only-convergence.md
- tasks/gap-plancheck-no-diminishing-returns-exit.md
- tasks/gap-prepare-milestone-no-worktree-isolation.md
- tasks/gap-recursive-guard-only-covers-multi-mechanism.md
- tasks/gap-split-decision-finality-not-enforced.md
- plugin/scripts/touches-orthogonality-check.ts
- plugin/scripts/touches-parser.ts
- plugin/test/touches-parser-parity.test.mjs
- experiments/quay-perpetual-stream/test/touches-orthogonality-check.test.mjs
- plugin/loop/fast-mode-loop-tick.md

## Dispatch review

reviewer: none
at: 2026-08-04T09:12:00Z
changed: 无（外层建任务，未经正式闸口审查——这正是 `reviewer: none` 是被记录的选择）
