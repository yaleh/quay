---
id: AC-145
title: 语义面 subagent 化 + 由 manager 后台驱动
status: achieved
kind: criterion
goal: GOAL-002
criterion: |
  node --no-warnings --experimental-strip-types -e 'import("./plugin/scripts/semantic-face-dispatch-record.ts").then(m=>{process.exit(typeof m.appendSemanticFaceRecord==="function"&&Array.isArray(m.SEMANTIC_DUTY_KINDS)?0:1)})'
expect: exit 0
origin: |
  人 2026-08-23 方向「语义撰写/人机接口 → 实现相应 subagent，由 manager 直接驱动（后台执行）」。
  跨层纠错必须单列（本会话三个实证，⛔ 全部由另一层读散文发现）：
  outer 自诊断「优先级排序疏漏」错（真因 AskUserQuestion 卡 3h17m）；
  manager 自称「非手搓走已有机件」过度声称；manager 过早给出因果归因。
---

**判据（能取假）**：①任务撰写/立案 · 需求分析 · 升级判断（B11）· 学习（B10，证据推翻原判断时改
目标/方法）· AC65 快修判断 · B16-C 类冲突意图 · B18 止损 · **跨层纠错**——这些结构上不能是 driver
（driver 读不出一个"听起来自洽但错了"的因果故事），由 manager **派后台 subagent** 执行，非 manager
主线程直接做；②每类语义职责有**可查的派发记录**（同 A16b dispatch-record 形态）。

**取假**：①`manager` 主线程出现产品文件编辑 ⇒ 假（同 inner A24 `main_thread_edits > 0` 即判违反的
判据形态，直接复用）；②发生了一次语义产出而无对应派发记录 ⇒ 假。


