---
id: AC-143
title: 观测/账本/收尾面驱动化 —— outer 纯机械 A/B 段收进 driver
status: achieved
kind: criterion
goal: GOAL-002
criterion: |
  node --no-warnings --experimental-strip-types -e 'import("./plugin/scripts/driver-runtime.ts").then(m=>{const k=m.DRIVER_KINDS.outer;process.exit(k&&k.driver==="outer-driver.ts"&&k.carriers.includes("outer-round.jsonl")?0:1)})'
expect: exit 0
origin: |
  人 2026-08-23 方向「其它定期操作 → 实现相应 driver，由 quay 统一机械驱动」。
  kind 派发是 registry 表驱动（KIND_DRIVER[]/KIND_VERBS[]/KIND_PREFIX[]），
  加一个 kind = 表里加一行 + 写该 driver 的 .ts（AC139-2 的设计红利，不需重造承载）。
---

**判据（能取假）**：outer 执行核里**纯机械**的 A/B 段（A1/A3/A6/A9/A10/A18/A21 读数 ·
B1/B2/B6 收尾留痕 · B12/B17 自查审计）收进 driver（新 kind 或并入既有 kind，落笔方定）。

**取假**：①该 driver 的**生产载体**在其落地后 ≥N 轮无记录 ⇒ 假（硬规则④推论三：能产出 ≠
已产出）；②driver 落地后 outer tick-log 里**仍出现**该步骤的手动调用记录 ⇒ 假
（两个真相源，同 AC135 形态）。


