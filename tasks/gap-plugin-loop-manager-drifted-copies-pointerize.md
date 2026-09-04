---
id: gap-plugin-loop-manager-drifted-copies-pointerize
title: plugin/loop/manager-*.md 漂移副本指针化——副本教已被推翻的做法（manager-tick-core 170 diff 停 08-13 / manager-loop-tick 2321 diff 停 08-12，37 reader 读陈旧），drift-check 机械不可见（manager 22:1xZ 裁定 inner 落）
status: done
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

- [x] AC1 判据1：37 个 reader 逐个判「读内容/只提路径」产出落点映射表（⛔ 不跳过；指针形状由表定，非删了再看谁红）。
- [x] AC2 判据2：漂移检查器补配对（覆盖两份 或 行数>N 即红）——留会取假的判据，manager-loop-tick 不再结构不可见。
- [x] AC3 判据3：plugin/loop/manager-*.md 指针化（删空留一行指向 orchestration/ 正本）+ C17 说明已落 db99aecd。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] plugin/loop/manager-*.md 指针化（无内容可归属）+ 落点映射表 + 漂移检查器补配对（会取假）+ 测试绿。

## Touches

- plugin/loop/manager-tick-core.md（指针化：删空留一行指向 orchestration/manager-tick-core.md）
- plugin/loop/manager-loop-tick.md（指针化：删空留一行指向 orchestration/manager-loop-tick.md）
- plugin/scripts/tick-core-static-check.ts（AC2：配对覆盖两份 或 行数阈值）
- plugin/test/tick-core-static-check.test.mjs（补测 AC2）
- plugin/scripts/checker-mutation-cases/tick-core-static-check.sh（AC2 突变夹具同步——Evidence 第 5 行）
- plugin/test/manager-cold-start.test.mjs（manager-*.md 指针化配套——改读正本/archive）
- plugin/test/manager-productization.test.mjs（同上）
- plugin/test/manager-tick-core.test.mjs（同上）
- tasks/gap-plugin-loop-manager-drifted-copies-pointerize.md（自身）

## Evidence

**AC1 落点映射（38 reader 逐个判「读内容/只提路径」，指针形状由表定）**——`grep -rl` 全库 38 个 reader（37 + 本任务体），逐个读其用法：

| # | reader | 读内容 / 只提路径 | 指针化后需要的形状 |
|---|---|---|---|
| 1 | `plugin/scripts/capability-catalog.sh` | 读内容（`grep -ohE "plugin/scripts/.*\.sh" plugin/loop/*.md` 统计交付面） | 指针行无 `plugin/scripts/*.sh` 引用 → 通过（实测 `--entry-surface` PASS） |
| 2 | `plugin/scripts/check-set-after-change-check.ts` | 只提路径（git diff ∩ @judges 的身份键） | 路径不变 → 通过 |
| 3 | `plugin/scripts/checker-mutation-cases/check-set-after-change-check.sh` | 只提路径（自建 fixture） | 路径不变 → 通过 |
| 4 | `plugin/scripts/checker-mutation-cases/instrument-failure-check.sh` | 读内容（copy_surface 复制真文件 + sed 删 family-3 行） | 指针行存在 → 通过（实测 mutation case exit 0） |
| 5 | `plugin/scripts/checker-mutation-cases/tick-core-static-check.sh` | 读内容（fixture 模拟 shipped 副本 + drift 注入） | **已更新** fixture 为指针形态 + 新增 AC2 注入（实测 exit 0） |
| 6 | `plugin/scripts/adr016-screen-use-check.ts` | 读内容（扫 `plugin/loop/manager-loop-tick.md` 的 ```bash 块查 md5/capture-pane） | 指针行无 bash 块 → 通过（实测 violations=0） |
| 7 | `plugin/scripts/instrument-failure-check.ts` | 读内容（扫 5 族失效；文件必须存在，缺失即 throw） | 指针行存在 + 无失效形态 → 通过（实测 --gate ok） |
| 8 | `plugin/scripts/manager-arm-loop.sh` | 读内容（`--validate` 读 `plugin/loop/manager-loop-tick.md` 查哨兵/指针/收据三规则） | **指针行必须携带** `[manager-tick]` + `指针` + `record-cron`（实测 VALIDATE-OK） |
| 9 | `plugin/scripts/manager-start.sh` | 只提路径（注释/默认值） | 路径不变 → 通过 |
| 10 | `plugin/scripts/verify-delivery-surface.ts` | 只提路径（deliverables 存在性检查） | 文件存在 → 通过（实测 6/6 covered） |
| 11 | `scripts/test.sh` | 只提路径（@static-object 身份键，scoped 选择） | 路径不变 → 通过（scoped 门绿） |
| 12 | `plugin/test/manager-tick-core.test.mjs` | 读内容（A10/B4 断言在 execution core） | **已更新**：读正本 `orchestration/manager-tick-core.md`；B4 改断言 A19 的 `--record-cron`/`registry-verified`/`--verify` |
| 13 | `plugin/test/manager-cold-start.test.mjs` | 读内容（TICK_CORE idle-watch + TICK_DOC record-cron/--verify + 跑 --validate） | **已更新**：TICK_CORE 改读正本；TICK_DOC 指针行携带 record-cron/--verify（未改断言） |
| 14 | `plugin/test/manager-install-vector.test.mjs` | 只提路径 + 跑 --validate（pack 内） | 指针行携带标记 + 文件存在 → 通过（实测 5/5 pass） |
| 15 | `plugin/test/manager-productization.test.mjs` | 读内容（AC9 §6 产品行为） | **已更新**：断言指针指向正本 + 行为保留在 phase-goal-archive + SKILL.md 越界纪律 |
| 16 | `plugin/test/tick-core-static-check.test.mjs` | 读内容（新增 AC2 漂移/指针判据测试） | **已新增** 4 条 AC2 测试（baseline 绿 / 复制的 manager 大文件红 / 不指正本红 / 真库指针一致） |
| 17 | `plugin/test/adr016-screen-use-check.test.mjs` | 只提路径（fixture） | 路径不变 → 通过（15/15 pass） |
| 18 | `plugin/test/instrument-failure-check.test.mjs` | 只提路径（fixture） | 路径不变 → 通过（32/32 pass） |
| 19 | `orchestration/SPEC-complete-delivery-surface-2026-08-05.md` | 只提路径（散文/清单） | 路径不变 |
| 20 | `orchestration/SPEC-manager-productization-2026-08-05.md` | 只提路径（散文） | 路径不变 |
| 21 | `orchestration/escalations.md` | 只提路径（散文） | 路径不变 |
| 22 | `orchestration/manager-phase-goal-archive.md` | 只提路径（散文） | 路径不变 |
| 23-37 | `tasks/*.md`（15 个任务体，不含本任务） | 只提路径（历史正文/证据） | 路径不变 |
| 38 | `tasks/gap-plugin-loop-manager-drifted-copies-pointerize.md`（本任务） | 只提路径 | 路径不变 |

**指针行形状（由表定）**：
- `plugin/loop/manager-tick-core.md`：`> 正本: orchestration/manager-tick-core.md — 本文件只应存在这一行指针；执行核内容一律读正本。`——需满足 drift-check（含正本路径）+ capability-catalog（无 .sh 引用）；无其它内容读者。
- `plugin/loop/manager-loop-tick.md`：`> 正本: orchestration/manager-loop-tick.md — 本文件只应存在这一行指针；内容一律读正本。武装约定（哨兵 [manager-tick]、prompt 只携带指针、record-cron 收据核实 --verify）见正本。`——需满足 `manager-arm-loop.sh --validate` 三规则（指针+哨兵+record-cron）与 `manager-cold-start.test.mjs` AC4（record-cron + --verify）。该行是【指针 + 指向正本武装约定的合约摘要】，不教副本的旧执行内容。

**AC2 漂移检查器（tick-core-static-check.ts）**：配对从「tick-CORE 三对字节一致」改为「orchestrator/fast-mode 字节一致 + manager 两份（tick-core 与 loop-tick）为**指针判据**」——`plugin/loop/manager-*.md` 必须 ≤3 行且引用正本路径，否则红（复制的 manager 大文件/不指正本的指针都取假）。会取假：指针化绿 / 再复制红（含字节一致的复制也红——判据是「必须是指针」不是「必须匹配源」）。

**AC3 指针化落地**：两份文件已删空留一行指针；C17 说明已在 db99aecd（orchestration/orchestrator-tick-core.md 独占表 manager 行）。

**AC4 验证**：
- `bash scripts/test.sh --for-task gap-plugin-loop-manager-drifted-copies-pointerize --allow-thin` → exit 0（26 测试全绿：manager-tick-core 5 + tick-core-static-check 21）。
- `fan-in-ts-typecheck-gate.ts --task ... --worktree ... --merge-target develop` → ADMITTED（Touches 无新增 .ts）。
- 内容读者实测：capability-catalog.sh（default + --entry-surface）exit 0；adr016-screen-use-check violations=0；instrument-failure-check --gate ok；manager-arm-loop.sh --validate VALIDATE-OK；verify-delivery-surface 6/6；check-set-after-change PASS；两个 mutation case（tick-core-static-check / instrument-failure-check / check-set-after-change）exit 0。
- 受影响测试全绿：manager-tick-core / manager-cold-start / manager-install-vector / manager-productization / manager-arm-loop / adr016 / instrument-failure（另跑全部通过）。
