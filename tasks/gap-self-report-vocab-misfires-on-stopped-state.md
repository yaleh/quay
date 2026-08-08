---
id: gap-self-report-vocab-misfires-on-stopped-state
title: "self-report-vocab-audit judges a STOPPED inner's self-report as NON-CONVERGED — its convergence window (reports.length >= window && recentClean === inWindow, self-report-vocab-audit.ts:134-135) assumes an ACTIVE rolling-dispatch loop, so an honest 'idle heartbeat, paused awaiting manager' reads as vocabulary drift (few reports < window → fail-closed NOT-CONVERGED); stopped state is honest, not drift — false alarm (archguard da0b2cbf 2026-08-06); observation-only (not a gate) so lower priority"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**self-report-vocab 把停止态自报判为非收敛——假警报（停止态是诚实，不是漂移）。**

**【实测（archguard da0b2cbf 2026-08-06）】**：archguard 的 inner 是停止态（"idle heartbeat, paused
awaiting manager"），自报少。`self-report-vocab-audit.ts:134-135`：

```js
const converged = reports.length >= win && recentClean === inWindow;
```

需要 **reports.length >= window**（至少 window 条自报）才可能 converged。停止态自报 < window →
fail-closed **NOT-CONVERGED**——即使每条自报都干净（无 batch 词汇）。

**【性质】**：收敛判据**假设活跃派发循环**（每轮有自报）。停止态（暂停等待）是**诚实状态**，不是
词汇漂移——但 fail-closed 判据把它当非收敛，**假警报**。

**【影响范围】**：观测工具（非门禁），影响较低——词汇审计是「是否收敛」的报告，不阻塞派发。但会
**干扰重锚有效性判断**（reanchor_effectiveness 看 converged）：停止态被误判非收敛 → 误以为重锚无效
而加密重锚频率。

### 选定机制

1. **收敛判据感知停止态**：自报含停止语义（idle/paused/awaiting manager）时不要求 window 满——
   停止态是「非漂移」的有效证据
2. 或：converged 判定加「停止态豁免」——报告含停止标记 ⇒ 视为收敛（无 batch 词汇 + 诚实状态）

## Acceptance Criteria

- [ ] AC1: 停止态自报（idle/paused/awaiting）不被判非收敛——即使 reports < window（实跑）
- [ ] AC2: 活跃态收敛语义不变——活跃循环无 batch 词汇仍 converged，有 batch 仍 flagged（无回归）
- [ ] AC3: 与 gap-reanchor-must-converge（done）交叉标注——停止态误判干扰重锚有效性判断

## Definition of Done

- [ ] AC1-AC3 全勾（停止态自报 idle/paused/awaiting 不被判非收敛；活跃态收敛语义不变无回归；与 gap-reanchor-must-converge 交叉标注）
- [ ] 停止态实跑不被判非收敛；活跃态 batch 词汇仍被 flag
- [ ] scoped 门 `scripts/test.sh --for-task gap-self-report-vocab-misfires-on-stopped-state` 绿

## Touches

- plugin/scripts/self-report-vocab-audit.ts（停止态豁免）
- plugin/test/self-report-vocab-audit.test.mjs（AC1/AC2 测试）
- tasks/gap-reanchor-must-converge-inner-self-reported-vocabulary.md（AC3 交叉标注）

## Contract

measure   stopped_converged = `node --experimental-strip-types plugin/scripts/self-report-vocab-audit.ts --git-log 15 --window 3 --json 2>&1 | grep -c 'converged.*true'` stdout 数字段
band      stopped_converged >= 1（停止态自报判收敛）
invoke    `grep -n 'reports.length >= win\|converged\|idle\|paused' plugin/scripts/self-report-vocab-audit.ts`
control   停止态自报 < window ⇒ converged（AC1）；活跃态有 batch ⇒ 仍 flagged（AC2）
resume    停止态豁免与收敛语义分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T07:2xZ
changed: archguard 实证（停止态非收敛）+ 外层核实（行 134-135 需 window 满）立案。收敛判据假设活跃
循环，停止态是诚实状态被误判漂移。观测工具（非门禁）——低优先，但干扰重锚有效性判断。
