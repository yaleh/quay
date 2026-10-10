---
id: goal-036-dispatch-exclusion-contract-tests
title: GOAL-036 AC-360 落地：computeDispatchExclusion 函数级契约测试（基本正确性 +
  确定性/纯度负对照）落地，driver-filters.test.mjs 与 worker-driver.test.mjs 全量回归绿（分支
  goal/GOAL-036）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  role: primitive
depends_on:
  - goal-036-dispatch-exclusion-single-source
goal_ac: AC-360
---
## Proposal

GOAL-036 splits its slice into AC-359 (production-code structural guard: a new pure `computeDispatchExclusion(running, coldInflight, retryState)` in `plugin/scripts/driver-filters.ts` becomes the single per-round computation point for `{inFlight, retryExhausted}`, replacing the two independent `inFlightTasks()` calls at `worker-driver.ts:5740` / `:5753`) and AC-360 — this task: the **function-level, falsifiable contract** for that function, plus the full regression of both affected test files. Read GOAL-036's body and AC-360's own `criterion` before starting; the criterion IS the definition of done here.

<!-- dedup-ref --> Related sibling: `goal-036-dispatch-exclusion-single-source` (status `ready`, `goal_ac: AC-359`) owns the AC-359 production-code half, and its own Plan step 6 additionally sketches the AC-360 tests. Kept as a separate task rather than merged, for two reasons: (a) AC-360's criterion is only satisfiable once `computeDispatchExclusion` exists — it exits 3 with `NOT-EVALUATED` otherwise — so it is a distinct, later-satisfiable deliverable; (b) `goal_ac` is a single top-level scalar, so one task cannot own both AC-359 and AC-360, and GOAL-036's AC split assigns the production code to AC-359 and the contract tests + regression to AC-360. Same split shape as GOAL-035's AC-356/AC-357 (see `goal-035-needs-human-transition-contract-tests`, `done`). `task-granularity-advice.ts` reports this sibling as the only Touches peer (shared `plugin/scripts/driver-filters.ts`); the scheduler serializes on Touches, so keeping them separate costs no parallelism.

## Plan

1. Confirm the function under test exists: `grep -n "computeDispatchExclusion" plugin/scripts/driver-filters.ts` must hit an exported definition returning `{ inFlight: string[]; retryExhausted: Set<string> }`. If it does not yet, AC-360's criterion exits 3 — the production-code half arrives via the AC-359 sibling named in this task's `depends_on`.
2. In `plugin/test/driver-filters.test.mjs`, add tests for `computeDispatchExclusion` so the file references the identifier at least twice:
   - **basic correctness** — given a `running` array (e.g. `[{task:"a"},{task:"b"}]`) and a `coldInflight` set (e.g. `new Set(["c"])`), assert the returned `inFlight` contains exactly the expected task ids (`["a","b","c"]`, pinned by the implementation's `running.map(...).concat([...coldInflight])` order), and `retryExhausted` equals `retryState.needsHuman`.
   - **determinism/purity negative control** — call the function TWICE with the SAME inputs and assert the two outputs are deep-equal (`assert.deepStrictEqual`). This is the concrete evidence that the function is a pure snapshot, not something that could drift between two calls the way the old two-call pattern could. Note: `grep -qi "deepStrictEqual\|deepEqual"` must match in the test file — the criterion requires it.
3. `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs` — must be fully green.
4. `node --no-warnings --experimental-strip-types --test plugin/test/worker-driver.test.mjs` — must be fully green. This file is large (286980 bytes); this is the real call-site regression. Allow extra wall-clock and use a large `--timeout` when gating.
5. On branch `goal/GOAL-036`, run `quay goal gate AC-360 --timeout 900000` and require exit 0.
6. `grep -c "computeDispatchExclusion" plugin/test/driver-filters.test.mjs` must be >= 2.

## Acceptance Criteria

- [x] `grep -c "computeDispatchExclusion" plugin/test/driver-filters.test.mjs` is >= 2 (one basic-correctness case, one determinism/purity case). —— 实测 `grep -c` = **6**（≥2）：L23 import、L1492 基本正确性用例标题、L1506 确定性/纯度负对照用例标题，另 3 处是两条用例内部的调用（前 3 条实参已逐条打印核对）。
- [x] The test file asserts the determinism/purity negative control: two calls with identical inputs produce deep-equal outputs — `grep -qi "deepStrictEqual\|deepEqual" plugin/test/driver-filters.test.mjs` matches. —— 实测命中 `assert.deepStrictEqual(a, b, "相同输入 ⇒ 深度相等输出…")`；同用例另有 `assert.notEqual(a.inFlight, b.inFlight)` 证明两次调用返回【不同】数组实例（独立快照，非共享可变状态），以及三条入参未被改动的断言。
- [x] `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs` exits 0. —— 实测（cwd = 任务工作树，HEAD `0543533a7`）：`# tests 74 · # pass 74 · # fail 0`，exit 0。
- [x] `node --no-warnings --experimental-strip-types --test plugin/test/worker-driver.test.mjs` exits 0 (full-file regression, not a subset). —— 实测（同上 cwd，`--test-timeout=900000`，整文件非子集）：`# tests 129 · # pass 129 · # fail 0`，exit 0。
- [x] `quay goal gate AC-360 --timeout 900000` reads exit 0 on branch `goal/GOAL-036`. —— 实测 `quay goal gate AC-360 --dry-run --timeout 900000`（cwd = goal 工作树，即 branch-mode 的评估根）⇒ `verdict: pass`、exit 0、`evaluationRoot: /data/home/yale/work/quay-worktrees/goal-GOAL-036`、耗时 34s（确实重跑了两个测试文件，不是回放缓存事件）；AC-360 记录亦已由 goal-driver 置 `achieved`（`reason: "I2: criterion pass"`）。

## Definition of Done

`quay goal gate AC-360 --timeout 900000` — run at the `goal/GOAL-036` tip — exits 0. That criterion mechanically (i) greps `plugin/scripts/driver-filters.ts` and the test file for `computeDispatchExclusion`, (ii) re-runs `driver-filters.test.mjs` and `worker-driver.test.mjs` and requires both green, (iii) counts >=2 references in the test file, and (iv) requires a `deepStrictEqual`/`deepEqual` assertion to be present. So the real-landing bar is the criterion itself re-run and passing on the branch — not "tests were written". This task does not merge the goal branch into `develop` and does not evaluate AC-361 (post-merge only).

## Touches

- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/goal-036-dispatch-exclusion-contract-tests.md

## Evidence

- **本任务的 delta 是【逐条重跑 + 留痕】，不是新增测试。** AC-360 要求的两条用例（基本正确性 / 确定性·纯度负对照）由 `depends_on` 的兄弟任务 `goal-036-dispatch-exclusion-single-source` 在提交 `b97468d69`（"goal-036: converge {inFlight,retryExhausted} to one computeDispatchExclusion per round"）中随生产代码一并落地——AC-360 的 criterion 在设计上就是「函数存在之后才可满足」的后续面（否则 exit 3 / NOT-EVALUATED），与 GOAL-035 的 AC-356/AC-357 同形：前例 `goal-035-needs-human-transition-contract-tests`（`done`）同样是零源码 delta 的纯验证任务。本任务的分支因此不引入源码改动，`## Touches` 未加宽。
- **AC1** — `grep -c "computeDispatchExclusion" plugin/test/driver-filters.test.mjs` = **6**（≥2）。前 3 条实参已逐条打印核对：`import`（L23）、`test("GOAL-036 AC-359：computeDispatchExclusion 基本正确性 …")`（L1492）、`test("GOAL-036 AC-359/AC-360：确定性负对照 …")`（L1506）。两条用例分别覆盖「`inFlight` = `running.map(r=>r.task)` 保序后接 `[...coldInflight]`，且 `retryExhausted` 就是 `retryState.needsHuman` 本身」与「相同输入两次调用」。
- **AC2** — `grep -qi "deepStrictEqual\|deepEqual"` 命中：`assert.deepStrictEqual(a, b, "相同输入 ⇒ 深度相等输出（纯函数、无隐藏状态/无时间依赖）")`；同用例还有 `assert.notEqual(a.inFlight, b.inFlight)`（两次调用返回**不同**数组实例 ⇒ 独立快照，正是旧「两处各自重算」可漂移的否定面）与三条「入参未被改动」断言。
- **AC3** — `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs`（cwd = 任务工作树 `/data/home/yale/work/quay-worktrees/goal-036-dispatch-exclusion-contract-tests`，HEAD `0543533a7`）⇒ `# tests 74 · # pass 74 · # fail 0`，exit 0。
- **AC4** — `node --no-warnings --experimental-strip-types --test --test-timeout=900000 plugin/test/worker-driver.test.mjs`（同上 cwd，整文件非子集，286980 bytes）⇒ `# tests 129 · # pass 129 · # fail 0`，exit 0。
- **AC5** — `quay goal gate AC-360 --dry-run --timeout 900000`（cwd = `/data/home/yale/work/quay-worktrees/goal-GOAL-036`，即 branch-mode goal 的评估根）⇒ `verdict: pass`、exit 0、`evaluationRoot: /data/home/yale/work/quay-worktrees/goal-GOAL-036`、`treeSha: 2fbd450985b64148ecdaf840f2b0b0ddaa98305a`、**耗时 34s**（确实重跑了两个测试文件 ⇒ 不是回放缓存事件；`dryRun:true` ⇒ 未追加 GateEvent、未改状态）。AC-360 记录本身亦已由 goal-driver 置 `achieved`（`reason: "I2: criterion pass"`，`2026-10-10T19:09:04.868Z`）。
- **生产接线复核（只读，非本任务改动）**：`worker-driver.ts:5743` 恰一次 `const exclusion = computeDispatchExclusion(running, coldInflight, retryState);`，该值分别喂给 `readyPoolCheck(rootDir, readyPoolArgv, exclusion.inFlight, cap)` 与 `applyTaskFilters(shuffled, makeFilterContext(rootDir, { inFlight: exclusion.inFlight, retryExhausted: exclusion.retryExhausted }))` —— criterion 所要求的「同一轮单一计算点」在盘上确实成立（`grep -n computeDispatchExclusion plugin/scripts/worker-driver.ts` 在 `step = "ready-pool"`/`step = "apply-filters"` 窗口内仅 1 处）。
- **负对照的诚实边界**：本条证据证明的是「函数级契约存在且在尖端可复现」，**不**证明「两处重算 → 单点」这一结构改动在运行期从未漂移（那由 AC-359 的结构扫描面 + `worker-driver.test.mjs` 的调用点回归覆盖）。本任务只对 AC-360 的判据负责。