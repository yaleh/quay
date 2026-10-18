---
id: gap-ac353-criterion-pins-moved-acceptance-runner-path
title: AC-353 判据钉住已搬迁的 gate/acceptance-runner.ts（路径+相对深度双 stale）：消费者改为按导出符号定位 +
  新增 fs 路径字面量防复发检查（同时修 AC-355）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-353
---
## Proposal

**本轮逐字实测（2026-10-18，不是 ledger 尾巴）**：

```
node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-353 --root . --json
⇒ "verdict": "fail"
   "reason": "... Error: ENOENT: no such file or directory, open
              'packages/quay/src/gate/acceptance-runner.ts' ..."

node ... gate AC-355 --root . --json
⇒ "verdict": "fail"（同一行 ENOENT，exit 1）
```

**成因：合法重构搬走了承载者，不是 GOAL-034 的保证坏了。** commit `e676d097b`（`gate: extract types.ts + acceptance-runner.ts into gate/shared/`）把 `packages/quay/src/gate/acceptance-runner.ts` 移到 `packages/quay/src/gate/shared/acceptance-runner.ts`。判据的 `need` 数组里钉了两件事，这次**两件同时变**：

| 钉住的东西 | 旧值 | 当前真值 |
|---|---|---|
| 文件路径 | `gate/acceptance-runner.ts` | `gate/shared/acceptance-runner.ts` |
| 相对 import 深度 | `../kernel/gate-run-options.ts` | `../../kernel/gate-run-options.ts` |

**负对照（硬规则 4 推论四：若假设为假，结果必须不同）——两步都做了**：

1. 只把路径改成 `gate/shared/acceptance-runner.ts`（保留 `../` 深度）⇒ 仍 exit 1，但 CAUSE 换成
   `CAUSE=consumer-not-converged -- gate/shared/acceptance-runner.ts does not import kernel/gate-run-options.ts`
   ⇒ 证明「只改路径」不够，深度也是 stale 的一部分。
2. 路径 + 深度同时改对 ⇒ **exit 0 PASS**（完整判据其余部分全绿：defOnly 4 函数、2 类型、两个死文件缺席、
   非目标 loader/abi 未动、out-of-scope diff 为空）。
   ⇒ 证明 AC-353 断言的**保证本身仍然成立**，坏的只有判据对内部模块目录的钉死。

**为什么上一轮的修复没顶住（这是本任务的核心教训）。**
`gap-ac237-criterion-stale-acceptance-runner-moved`（done）已经处理过**同一个 commit** 造成的同类失效：
AC-237/AC-243 的判据把 `./packages/quay/src/gate/acceptance-runner.ts` 写进 `import(...)` 字面量。
那次修复的防复发产物 `packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` 在自己的
COVERAGE BOUNDARY 里明确写了：**只覆盖 `import(...)` / `require(...)` 字面量**，不覆盖
`readFileSync` / `test -e` / `grep` 的路径。AC-353/AC-355 的 stale 路径恰好是
`fs.readFileSync(path.join(src, f))` 里的数组字面量 ⇒ **对那把唯一的检查器不可见**，同一 commit 的
第三、第四处失效就这样漏了过去。这正是硬规则 5b 的形态：修的人只修了被报出来的那一个，兄弟实例
（同一 commit、同一路径、同一 goal 家族）留在原地。

**同族普查（硬规则 5b，本轮实测，不是抽查）。**
扫描全部 `goals/*.md` 的 `criterion` 块（跳过 superseded/retired），共 36 条；取「整 token 的 `.ts`
相对路径字面量」并排除显式缺席断言（`! -e` / `! -f` / `must be deleted` / `reappeared`）后，
**恰好 2 条**解析不到：

| 判据 | 状态 | 处置 |
|---|---|---|
| AC-353 | achieved | **本任务修** |
| AC-355 | achieved | **本任务一并修**（同一 goal GOAL-034、同一 stale 字面量；只修一处即违反 5b） |

其余 34 条零误报。in-flight 任务中没有任何 `goal_ac: AC-353` 的记录（现存两条均 done）。

**修法（两个原型已在当前树上跑通，读数见下）。**

- ✗ 把判据改成 `gate/shared/...` + `../../`：拒绝。这正是 AC-237 已经证伪的做法——下一次合法搬迁会
  第三次把它变假。
- ✗ 在 `gate/acceptance-runner.ts` 加 re-export shim：拒绝，与 GOAL-034 明确要求删除
  `gate/factories/loader.ts` 这类死 shim 的方向相反。
- ✓ **消费者按导出符号定位，不按目录**：`runAcceptance` 的承载者由 `export function runAcceptance`
  在树内找到（当前解析到 `gate/shared/acceptance-runner.ts`），再用**解析后的绝对路径**与
  `kernel/gate-run-options.ts` 比较——目录/深度怎么变都自动正确。
  同法覆盖其余角色：`VALID_GOAL_STATUSES`→goal-store、`handleGate`→cli/gate、
  `registerGoalGate`→gate/registry、`discoverWorkspaceRoot`→gate/config/loader、
  `makeGoalGate`→gate/factories/goal。只有两个**有意保留在原目录的 barrel**
  （`gate/config/index.ts`、`gate/factories/utils.ts`）以及「必须保持不存在」的两个死文件路径继续按路径断言。
  原型读数：8/8 角色 ok（exit 0）。
- ✓ **防复发检查**：给 `goal-criterion-import-specifiers-resolve.test.mjs` 增加第二类提取器——
  criterion 内的整 token `.ts` 路径字面量（排除缺席断言）必须能解析到 repo root 或
  `packages/quay/src` 下。原型读数：36 条判据 → 恰好上述 2 条红，零误报；负对照 fixture
  （`QUAY_GOALS_ROOT` 指向含 `gate/acceptance-runner.ts` 缺口的判据）必红并点名该字面量。

<!-- dedup-ref -->
去重结论：按机制（「判据把内部模块路径钉成字符串」）检索，现存 `gap-ac237-criterion-stale-acceptance-runner-moved`
是同一机制的前一次修复（done），其检查器覆盖面正是本任务要补的洞；它不是重复立案，是本轮的复发证据。
`task-granularity-advice.ts` 对本任务 Touches 报 `peers: []`（无合并候选），故**独立立案**。

## AC

- [ ] AC-353 判据转绿：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-353 --root . --json` 的 `verdict` 为 `pass`（exit 0；不是 exit 3 NOT-EVALUATED，也不是 exit 1 CAUSE=*）
- [ ] 兄弟判据 AC-355 同步转绿：同形命令 `goal ... gate AC-355 --root . --json` 的 `verdict` 为 `pass`；两条判据承载同一 stale 字面量，不允许只修一处
- [ ] 搬迁负对照实测：在 HEAD 上的临时 git worktree 中把 `packages/quay/src/gate/shared/acceptance-runner.ts` 移到 `packages/quay/src/gate/runner/acceptance-runner.ts` 并修正其 import 深度（不提交），在该 worktree 根运行 AC-353 判据仍为 `pass`；两条读数（原树 pass + 搬迁树 pass）贴进 Evidence
- [ ] 复发检查落地：`packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` 新增整 token `.ts` 路径字面量解析检查；对 `goals/*.md`（跳过 superseded/retired）全部判据绿，且负对照 fixture（`QUAY_GOALS_ROOT` 指向含缺失 `gate/acceptance-runner.ts` 的判据）必须红并点名该字面量
- [ ] re-anchor 后的 AC-353 criterion 中不存在 `gate/shared/` 或 `gate/acceptance-runner.ts` 作为消费者路径断言；承载者由 `export function runAcceptance` 定位（`grep -n` 读数贴进 Evidence）
- [ ] 生产代码未动：本任务 diff 只含 `goals/AC-353-*.md`、`goals/AC-355-*.md`、该测试文件与任务自身；`packages/quay/src/**` 零改动，AC-353 判据内 defOnly/类型/abi/out-of-scope 各检查全绿

## DoD

- 两条 goal 记录已**在盘上**（`goals/AC-353-*.md`、`goals/AC-355-*.md`）携带 re-anchor 后的 criterion，且从共享检出分别跑 `goal gate` 得到 `verdict: "pass"`；贴 `goal-round.jsonl` / gate-event 里对应的 pass 记录，而不是只贴本任务自报。
- 防复发测试确实被 `scripts/test.sh` 的 product 泳道收集（给出 glob/泳道命中的实测读数），并完成一次真实的「负对照红 → 修复后绿」两读数，两段原文都进 Evidence。
- 搬迁负对照是在**真实 worktree** 上跑的，不是只读判据文本推断「应该能过」；worktree 路径与两条 verdict 原文进 Evidence。

## Touches

- `goals/AC-353-结构护栏-kernel-gate-run-options-ts-持有-4-函数-2-类型单一定义-gate-config.md`
- `goals/AC-355-post-merge-生产验证-develop-尖端持有本刀全部结构改动-七个受影响测试文件回归全绿.md`
- `packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs`
- `tasks/gap-ac353-criterion-pins-moved-acceptance-runner-path.md`
