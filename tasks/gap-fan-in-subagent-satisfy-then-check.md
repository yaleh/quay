---
id: gap-fan-in-subagent-satisfy-then-check
title: fan-in subagent 不做 satisfy-then-check：依赖 suite/fan-in 结果的 AC/DoD 复选框留未勾 ⇒
  AC 闸拒 flip ⇒ needs-human ⇒ inner 勾框重派才能 land（复发 ≥3）
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

**来源**：2026-08-20 复发实证，已达 ≥3 次门槛（硬规则 12）。

**现象**：fan-in subagent 完成代码/文档改动 + suite 绿后，**不做「满足后勾框」**——依赖 suite/fan-in 结果的 AC/DoD 复选框（如「全量 suite 绿」「真实 fan-in 走新路径绿」「tmux-leak-scan clean」）留在未勾 ⇒ AC 完成闸拒 flip ⇒ needs-human ⇒ inner 主会话勾框 + 更新 capture suite_head + 重派（pre-verified 复用）才能 land。

**三次实例（同一签名，全部真实发生）**：

| 时刻 | 任务 | 被跳过的框 |
|---|---|---|
| 2026-08-20 | gap-inbox AC4 | inner 独占文件 A5 迁出（impl 不做 inner-独占落盘）——已立观察项 |
| 2026-08-20 12:47Z | 第28条 AC2 | 负控制生产验证已满足（全量 suite green + tmux-leak-scan clean），框未勾 |
| 2026-08-20 15:0xZ | turn-budget DoD | 真实 fan-in 走新路径 suite 绿（exit=0），DoD 框未勾 ⇒ fan-in #1 拒 flip |

（gap-inbox AC4 的「inner 独占文件不落盘」与本次「satisfy-then-check 不勾框」是同一类根的两种表现——subagent 不做「完成后收尾」。gap-inbox 那条已单列观察项。）

**代价**：每个实例 = 一次 needs-human 往返 + inner 人工勾框 + 重派（pre-verified 复用），~10-30 分钟/实例；今日 3 次。

**候选修法（inner 提议，非结论）**：fan-in-execute.js stage-2 prompt 加「suite 绿后回勾依赖 suite 结果的框再跑 AC 闸」——让 subagent 在 suite 绿后、AC 闸前，回勾所有「依赖 suite 结果」的复选框。改的是 fan-in workflow prompt，非产品逻辑。

**⛔ 注意**：这是「满足后勾框」，**不是**「为过闸伪造勾选」——只勾 suite 真绿/fan-in 真完成的条件；未满足的框必须保持未勾（fail-closed）。修的是 subagent 的收尾动作缺失，不是放宽 AC 闸。

## Plan

1. 定位 fan-in-execute.js stage-2 的 prompt 结构（AC 闸前的位置）。
2. 在 prompt 加「suite 绿后回勾依赖 suite 结果的 AC/DoD 框」指令（只勾真满足的，未满足保持未勾）。
3. 双拷贝同步（.claude/workflows/fan-in-execute.js + plugin/workflows/fan-in-execute.js）。
4. 验证：真实 fan-in 走新 prompt 后，suite 绿的 AC/DoD 框不再留未勾。

## Acceptance Criteria

- [x] AC1: fan-in-execute.js stage-2 prompt 含「suite 绿后回勾依赖 suite 结果的框」指令（双拷贝同步）。
- [x] AC2: 只勾真满足的条件，未满足保持未勾（不伪造，fail-closed 语义不变）。
- [x] AC3: 真实 fan-in 一次：suite 绿后 AC/DoD 框自动勾上，AC 闸直接放行，无 needs-human 往返。

## Definition of Done

- [x] prompt 指令落地 + 双拷贝同步；真实 fan-in 验证 AC3；今日 3 实例同类不再复现（观察 1-2 轮）。

## Touches

- .claude/workflows/fan-in-execute.js（stage-2 prompt 加收尾指令）
- plugin/workflows/fan-in-execute.js（双拷贝同步）
- plugin/scripts/fan-in-execute.js（若 stage-2 prompt 在 ts 侧）
- tasks/gap-fan-in-subagent-satisfy-then-check.md（自身）
