---
id: gap-ac79-inner-cron-create-anchor
title: inner 加 CronCreate 锚（AC79，人 14:2xZ 裁定三层统一应用 CronCreate）——ScheduleWakeup 无外部可核证据，07:41 切模式致自驱死 4.7h
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

**（inner 加 CronCreate 锚——人 2026-08-14 14:2xZ 逐字裁定「把三层统一应用 CronCreate 加入本阶段的目标和 AC」）**。

**三条实测（manager 14:2xZ 报，立 AC 依据非偏好）**：
```
① ScheduleWakeup 无外部可核证据，CronCreate 有（CronList + 注册表收据，manager 连续 17 轮）
   代价：07:41:46 inner 切驱动模式 ⇒ 链断 ⇒ 自驱死 4.7 小时，三层加人误诊整个上午
② ScheduleWakeup 事实上不是 inner 的驱动源：169 次调用 delaySeconds 全为 1500(25min)，
   而实际唤醒间隔 0.6–11 分钟 ⇒ 真驱动是 task-notification，它是从未真正触发的兜底
③ CronCreate 也不免费：CronList 文档写明 "in this session" ⇒ 会话作用域
   ⇒ 光换机制不补配套 = 把一个不可核的机制换成另一个
```

**判据1**：inner 加 CronCreate 锚——meta-cc 查 inner 的 CronCreate ≥1 条（当前真值 0 ⇒ 此刻为假，非恒真）。
**判据2**：ScheduleWakeup 降为间隙加速器（⛔ 不删——event-driven 段仍有价值）；CronCreate 成为主驱动锚。
**判据3**：inner 的 cron prompt ⛔ 不得要求「读上下文记忆」，须与 manager 锚同形——**只放指针**（指向执行核，1 跳）。
**判据4**：与 AC80（prompt 正本）/ AC81（注册表收据）配套——三层各有正本+检查器+收据（本任务只落 inner 的 CronCreate 锚本身）。

**不覆盖**：不删 ScheduleWakeup（保留 event-driven 价值）；不改唤醒间隔；不在窗口内改（人裁定窗口内不得改任何唤醒机制）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 inner 当前 ScheduleWakeup 用法 + manager 的 CronCreate 锚形态（manager-tick-prompt.txt + CronList）。
2. 判据1：inner 加 CronCreate 锚（prompt 只放指针）。
3. 判据2：ScheduleWakeup 降为间隙加速器。
4. 判据3：prompt 同 manager 锚（只放指针）。
5. 判据4：与 AC80/AC81 配套。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## C17 建议（outer-landable —— 落地到 outer 独占的 `plugin/loop/fast-mode-loop-tick.md`，inner 不得直接编辑）

**落点**：`### 6. 重新排程`（src 行 ≈1162-1205，主落点）+ 冷启动 `/loop` 讨论节（src 行 66-78，表述升格）。执行核 `orchestration/fast-mode-tick-core.md` 同步（它指回 src:N）。

**建议文案（三步）**：

1. **Step 6 开头声明主驱动源 = cron 锚**（判据1/判据3）：在 `### 6. 重新排程` 第一段前加一句——
   「**本 tick 的主唤醒源是 CronCreate 固定间隔锚**（cron `7,27,47 * * * *`，job id `025f4132` 为参考实例），
   它跨 `/clear`/`/compact` 保持行为稳定，可经 `CronList` + 注册表 + `--verify` 机械核验（meta-cc 可查）。
   锚 prompt **只放指针**，同 manager 锚形（首句「不要依赖上下文记忆——本 prompt 只是指针」），指向执行核
   `orchestration/fast-mode-tick-core.md`，不要求读上下文记忆。」
2. **ScheduleWakeup 降为间隙加速器，不删**（判据2）：Step 6 明确「**ScheduleWakeup 不是唯一唤醒源**」——
   cron 锚是主驱动，ScheduleWakeup 保留用于**事件间隙加速**（后台完成事件与下一 cron 之间、及 cron 覆盖不到的空档的兜底心跳），
   间隔维持 1200–1800s，心跳产物 `.quay/inner-wakeup-heartbeat.jsonl` 与 AC53 结束不变式全部不变。⛔ **不得删除 ScheduleWakeup。**
3. **冷启动 `/loop` 节表述升格**（src 行 66-78）：把「固定间隔走 CronCreate、动态模式走 ScheduleWakeup 且不可查验」
   的并列表述，升格为「**固定间隔 cron 锚是主驱动路径**（可查验），ScheduleWakeup 是事件间隙加速器（保留）」。

**判据对应**：判据1（cron 锚 meta-cc ≥1 条）+ 判据3（prompt 只放指针）由第 1 步覆盖；判据2（降为加速器不删）由第 2 步覆盖。
AC81 的四判据核实（CronList 恰一条 + id 等注册表 + `--verify`）已在锚 prompt 内声明，不在此文档侧重复落。

## Acceptance Criteria

- [ ] AC1 判据1：inner CronCreate ≥1 条（meta-cc 可查）。
- [ ] AC2 判据2：ScheduleWakeup 降为间隙加速器（不删）。
- [ ] AC3 判据3：prompt 只放指针（同 manager 锚形）。
- [ ] AC4 判据4：与 AC80/AC81 配套。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] inner CronCreate 锚落地（meta-cc ≥1 条）+ ScheduleWakeup 降为加速器 + prompt 只放指针 + 与 AC80/81 配套。

## Touches

- plugin/loop/fast-mode-loop-tick.md（inner 驱动路径加 CronCreate 锚——outer 侧 C17：loop 文档 outer 独占但 inner 执行；落地实现归 inner）
- tasks/gap-ac79-inner-cron-create-anchor.md（自身）

> ⛔ 不含 plugin/scripts/——锚注册表/检查器是 AC81 的载体、prompt 正本/不变式检查器是 AC80 的载体，均非本任务（AC79）触碰面（touches-overlap 风险：不宣称不属于自己的文件）。

## Evidence

（2026-08-14 回填——锚已在 inner 主会话落地）

**CronCreate 锚（inner 主驱动，判据1/判据3 的载体）**：
- cron 表达式：`7,27,47 * * * *`（AC82：与 manager `13,33,53`、outer `0,20,40` 相位不相交；period 20 整除 60；避开 :00/:30）
- job id：`025f4132`（CronList 可查，参考实例）
- prompt 形态：**pointer-only**，同 manager 锚形——首句逐字：「不要依赖上下文记忆——本 prompt 只是指针，内容现读：(1) 读 orchestration/fast-mode-tick-core.md 拿本轮步骤…」；指向执行核，不要求读上下文记忆（判据3）。
- 锚 prompt 内已声明 AC81 唤醒锚核实（每轮先核实 CronList 恰一条 + id 等注册表 + `--verify` 报 registry-verified；三条全真才不动，任一为假才清扫重建）——AC81 配套，不在本任务落检查器。

**AC82 相位不相交检查（三条全真）**：
```
{7,27,47} ∩ {13,33,53} = ∅      （inner vs manager）→ 真
{7,27,47} ∩ {0,20,40}  = ∅      （inner vs outer）  → 真
20 整除 60（period 20 是 60 的因子）                  → 真
```

**ScheduleWakeup 降为间隙加速器（判据2，⛔ 不删）**：文档侧落地建议见上方 `## C17 建议` 段；Step 6 将声明「ScheduleWakeup 不是唯一唤醒源」，保留用于事件间隙加速，间隔与心跳产物不变。
