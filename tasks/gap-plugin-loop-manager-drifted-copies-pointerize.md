---
id: gap-plugin-loop-manager-drifted-copies-pointerize
title: plugin/loop/manager-*.md 漂移副本指针化——副本教已被推翻的做法（manager-tick-core 170 diff 停 08-13 / manager-loop-tick 2321 diff 停 08-12，37 reader 读陈旧），drift-check 机械不可见（manager 22:1xZ 裁定 inner 落）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（plugin/loop/manager-*.md 漂移副本指针化——manager 2026-08-14 22:1xZ 裁定，inner 落地）**。

**现象（outer 核实）**：
```
manager-tick-core: plugin/loop 副本 84 行 / 170 diff / 停 08-13 / 正本 orchestration 106 行 08-14
manager-loop-tick: plugin/loop 副本 331 行 / 2321 diff / 停 08-12 / 正本 orchestration 2198 行 08-14
drift-check 配对（tick-core-static-check.ts:146）只列 tick-CORE，loop-tick 不在配对 ⇒ 2321 行漂移结构上不可见
37 个 reader 读陈旧副本（capability-catalog.sh / test.sh / adr016-screen-use-check / verify-delivery-surface /
  instrument-failure-check / SPEC docs 等）——「教人怎么做」的文档教的是已被推翻的做法
```

**根因（不是 C17 制造，是让它显形）**：副本早就在漂，C17 枚举把它暴露了。**死锁**：C17 标 manager 独占（外两层不更新）+ manager 豁免面不含 plugin/（manager 不更新）⇒ 结构冻结。

**修法 = 让被争夺的对象消失，不是重新分配它**：`plugin/loop/manager-*.md` 删空留一行指向 `orchestration/` 正本 ⇒ 无内容可归属，死锁自然消解。**不改 C17 枚举**（改了漂移又不可见——宽标题/窄枚举歧义的镜像；判据要说实话，哪怕说出来的是当前无人可执行的状态）。

**⛔ 落地方 = inner**（`plugin/` 是 inner 实现面）；manager 不申请扩大豁免面（豁免面人设，peer 裁定不扩大）。

**判据1（AC-1 落点映射，⛔ 不可跳过）**：37 个 reader **逐个判「读内容 / 只提路径」**，产出表格；`capability-catalog.sh`/`test.sh`/`adr016-screen-use-check` 等**很可能按结构或行数解析**——指针行的形状由这张表决定，不是先删了再看谁红（硬规则 5 产物 = 「全部有家」不是「抽查有家」；今日已因「给机械读者新增引用没查读者」造过红）。
**判据2（AC-2 漂移检查器补配对）**：`tick-core-static-check.ts:146` 配对只列 tick-CORE，`manager-loop-tick` 不在配对 ⇒ 2321 行漂移结构不可见。指针化后配对要么覆盖两份、要么改成「`plugin/loop/manager-*.md` 行数 > N 即红」——任选，但**必须留一个会取假的判据**（否则下次有人再复制一份，还是三天后发现）。
**判据3（AC-3 C17 已加说明，本任务不动）**：C17 manager 独占项已注明「该路径只应存在指针；内容正本在 orchestration/manager-*.md；指针化一次性删除由 inner 执行」——db99aecd 已落，本任务执行即可。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改 C17 枚举（manager 22:1xZ ⛔）；不动 orchestration/ 正本（那些是活的）；不申请扩大 manager 豁免面。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. **AC-1 落点映射**：grep -rl 全部 reader（已核 37 个），逐个判「读内容/只提路径」，产出表格——确定指针行形状。
2. 指针化：`plugin/loop/manager-tick-core.md` + `plugin/loop/manager-loop-tick.md` 删空留一行指向 `orchestration/` 正本（按 AC-1 表定形状）。
3. **AC-2 漂移检查器补配对**：tick-core-static-check 配对覆盖两份 或 行数阈值——留会取假的判据。
4. AC-3 C17 说明已落（db99aecd），本任务执行。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：37 个 reader 逐个判「读内容/只提路径」产出落点映射表（⛔ 不跳过；指针形状由表定，非删了再看谁红）。
- [ ] AC2 判据2：漂移检查器补配对（覆盖两份 或 行数>N 即红）——留会取假的判据，manager-loop-tick 不再结构不可见。
- [ ] AC3 判据3：plugin/loop/manager-*.md 指针化（删空留一行指向 orchestration/ 正本）+ C17 说明已落 db99aecd。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] plugin/loop/manager-*.md 指针化（无内容可归属）+ 落点映射表 + 漂移检查器补配对（会取假）+ 测试绿。

## Touches

- plugin/loop/manager-tick-core.md（指针化：删空留一行指向 orchestration/manager-tick-core.md）
- plugin/loop/manager-loop-tick.md（指针化：删空留一行指向 orchestration/manager-loop-tick.md）
- plugin/scripts/tick-core-static-check.ts（AC2：配对覆盖两份 或 行数阈值）
- plugin/test/tick-core-static-check.test.mjs（补测 AC2）
- tasks/gap-plugin-loop-manager-drifted-copies-pointerize.md（自身）

## Evidence

（落地后回填——outer 2026-08-14 22:0xZ：漂移核实 manager-tick-core 170 diff/停 08-13、manager-loop-tick 2321 diff/停 08-12；drift-check :146 只配对 tick-CORE；37 reader）
