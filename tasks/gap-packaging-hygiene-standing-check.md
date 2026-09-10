---
id: gap-packaging-hygiene-standing-check
title: 打包卫生缺陷转为常设检查项——把 GOAL-015 捕捉的 files 白名单误装/配置键悬空类问题接入 loop.routines
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-shipped-entry-files-not-runnable
---
## Proposal

GOAL-015（AC-233/234/235）捕捉到的两类缺陷——交付包 `files` 白名单误装了"形如入口、实际在安装位置下结构性跑不起来"的文件（AC-233，`gap-shipped-entry-files-not-runnable`）、配置键无消费者（AC-235，`gap-config-key-consumer-check-mechanical-enumeration` 已 done，产出了 `config-key-consumer-check` 机械枚举）——属于**会随代码演化持续复发**的一类打包卫生问题，不是一次修完就完的缺陷。GOAL-009 AC-202（`DRIVER_KINDS` 数据表字面量 6 个 driver kind 曾经不进 tarball、无人发现直到第三方主机上才暴露）是同一类模式的又一个独立实例。

当前的检测机制只在 goal AC 被验收时手工跑一次；验收后没有人定期重跑它——新增配置键、新增 bin 文件、新增字面量表都会重新引入同类缺陷，而不会被发现，直到下一次人工审计或下一次真实的第三方部署踩坑。

**⚠️ 2026-09-10 补充实测：`.quay/config.yml` `loop.routines`/`quay:routines` 这条常设机制目前是死的，本任务的原方案不能直接照搬。**

- 直接证据：`.quay/routine-last-run.json`（全仓/所有 worktree 内容逐字节相同）最后一次记录是
  `self-validation` @ **2026-08-12 16:31 UTC**，距今 29 天；配置里另外三条 routine
  （`architecture-analysis`/`history-mining`/`browser-explorer`）从未记录过一次运行。
- 会话记录交叉验证：最近 48 小时全仓会话（含 subagent transcript）真实 `Skill` 工具调用共 44 次，
  按位置核对无一是 `quay:routines`/`quay:run-routines`。
- 根因（已追到代码）：该机制唯一的生产调用点是已退役的 `orchestrator-loop-tick.md`（outer，
  2026-09-04 退役）步骤 1a 与 `fast-mode-loop-tick.md`（inner，已被 worker-driver 取代）步骤 4b；
  现行 `orchestration/manager-tick-core.md`（当前正本）零处提及 routine，`worker-driver.ts` 唯一
  的 `routine-scheduler` 引用只是复用其 `isDue()` 工具函数做自己的协调地板计时器，与探针派发无关。
  接线随两个角色退役一起失效，没人把它接回新架构（manager 直派 + worker-driver）。
- 已有更早、更精确的同类核实：`orchestration/SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md`
  §2.3（5 天前，manager 写）——结论比本任务更狠一层：`.quay/routine-last-run.json` 的持久化从来
  不是机械写的，写手是 `plugin/workflows/run-routines.js:29` 里"交给 LLM 执行的一段散文指令"，
  探针轨道**从来没有被机械接线过**，唯一那条记录只是某个 agent 恰好照做对了一次。该 SPEC §5 提出
  的修法方向是把 probe 实现为 Layer 1b `RoutineSpec.run()` 的一种形态（不新增 driver kind，复用
  `driver-runtime.ts` 的通用例程循环——这条基础设施本身是活的、且正被 `meta-driver`/`goal-driver`
  积极采用，见 `5516d291f`/`986f841e5`/`2cf0f42db`），但仍是 `proposal` 状态、待人裁定 §6.3/§9，
  **核心的"让 probe 重新在新架构下跑起来"这块尚无实现任务落地**（2026-09-10 复核：`routine-last-run.json`
  mtime 仍未变化，近期 driver-runtime 相关提交均未触碰 probe 派发路径）。

**⇒ 本任务不得假设 `loop.routines` 会被周期性触发。** 实现前必须先做以下二选一之一（见 Plan 步骤 0）：
(a) 确认 SPEC §5 的 probe 驱动化已经落地并真的在跑（不是接线存在就算数，要有真实 run 记录）；
(b) 若尚未落地，把打包卫生检查接到一个**当前真实会被触发**的机制上（例如 `meta-driver`/`goal-driver`
已经在用的 Layer 1b 通用例程循环，或其他生产验证过在跑的常设检查点），而不是重复"探针机制存在但
无人调用"这个仓库已经出现过至少 6 次的同族缺陷。

## Plan

0. **前置核实（新增，AC0）**：实现前先核 `.quay/routine-last-run.json` 是否已有 2026-09-10 之后的
   非 fixture 真实 run 记录、且 SPEC §5 的 probe-driver 化是否已从 `proposal` 转为落地。若尚未落地，
   走上面 Proposal 结尾的 (b) 路径——把 probe 挂到 `meta-driver`/`goal-driver` 已验证在跑的 Layer 1b
   例程循环上，不要重建一个依赖已死机制的新 probe。
1. 若前置核实确认 `loop.routines` 已被重新接线且真实在跑：在 `.quay/config.yml` `loop.routines` 下
   新增一个 `packaging-hygiene` probe（`trigger` 形态与届时的接线方式一致——可能已不是原来的
   `every(N)`/`interval:<N>m`，以实际重新接线的形态为准）。
2. probe 的实际检查动作复用/包装两个既有机械检测：`config-key-consumer-check`（AC-235 产物，配置键
   消费者枚举）与交付包入口可运行性枚举（AC-233/`gap-shipped-entry-files-not-runnable` 完成后的产物
   ——若该任务尚未落地，本任务的 AC2 允许先接入 config-key-consumer-check 一个维度，另一维度留 TODO
   并记录依赖任务 id，不得虚报覆盖）。
3. probe 发现新漂移（新的零消费者配置键 / 新的不可运行入口文件）时，落一个新 gap 任务，不静默。

## Acceptance Criteria

- [ ] AC0（新增，前置）：核实 `.quay/routine-last-run.json` 是否有落地后产生的真实 probe run，以及
      SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md §5 是否已从 proposal 落地；把核实
      结果（用的哪条路径 (a) 还是 (b)）写进本任务，作为 AC1-3 的前提说明，不得跳过直接假设机制在跑
- [ ] AC1 打包卫生 probe 接到一个**当场核实过真实会被触发**的机制上（`loop.routines` 若已重新接线则
      用它；否则用 AC0 选定的替代机制），贴出触发声明片段
- [ ] AC2 probe 执行体接上 config-key-consumer-check（若 gap-shipped-entry-files-not-runnable 已 done
      则两个维度都接，否则接一个维度 + 记录另一维度的依赖任务 id）
- [ ] AC3 probe 发现漂移时能落一个新 gap 任务（不是只打印/只记日志），给出机制说明或实测证据
- [ ] AC4 至少一次真实触发的 probe run 记录（非只接线未跑过——硬规则推论三：实现落地但生产没跑过一轮
      ⇒ 与未实现同形，AC 不得只靠 fixture/注入满足；且该 run 记录的时间戳必须晚于本任务落地时刻，
      呼应 AC0 对"接线存在≠真的在跑"的区分）

## Definition of Done

- [ ] AC0-4 全部满足；`--for-task` scoped 门绿
- [ ] 有一条记录载体里，落地后产生的真实 probe run（非 fixture），且其触发机制当场被核实为非死机制

## Touches

- .quay/config.yml
- plugin/scripts/config-key-consumer-check.ts（如存在，复用其检测逻辑）
- 新增或复用的 probe 触发脚本（路径由 AC0 核实结果决定，可能是 loop.routines 侧或 driver-runtime.ts
  Layer 1b 侧）
- tasks/gap-packaging-hygiene-standing-check.md（本任务自身）