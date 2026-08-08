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

- [x] AC1: 停止态自报（idle/paused/awaiting）不被判非收敛——即使 reports < window（实跑）
      （`auditSelfReports` 加 `STOPPED_MARKERS` 停止态豁免：窗口内含停止标记 ⇒ 免除 window 满要求，
      all-clean 要求不变；实跑「idle heartbeat, paused awaiting manager」reports_total=1 < window 3 ⇒
      `converged: true`、`stopped_in_window: true`——见下方 Evidence AC1 实跑）
- [x] AC2: 活跃态收敛语义不变——活跃循环无 batch 词汇仍 converged，有 batch 仍 flagged（无回归）
      （豁免只免除 window 满，all-clean 不变：停止态+「Batch of 3 fully merged」⇒ 仍
      `converged: false`、`inner_self_report_vocab: 1`；活跃态无停止标记、reports < window ⇒ 仍
      fail-closed `converged: false`——既有 15 条测试 + 新 4 条全过，见 Evidence AC2 无回归）
- [x] AC3: 与 gap-reanchor-must-converge（done）交叉标注——停止态误判干扰重锚有效性判断
      （本任务 Proposal「影响范围」已标注：reanchor_effectiveness 看 converged，停止态误判非收敛 →
      误以为重锚无效而加密重锚频率；修复后停止态判收敛，重锚有效性不被停止态压低——对已 done 的
      gap-reanchor-must-converge 文件做**只加不改**的交叉标注，见该文件 Touches 节）

## Definition of Done

- [x] AC1-AC3 全勾（停止态自报 idle/paused/awaiting 不被判非收敛；活跃态收敛语义不变无回归；与 gap-reanchor-must-converge 交叉标注）
- [x] 停止态实跑不被判非收敛；活跃态 batch 词汇仍被 flag（Evidence AC1/AC2 实跑）
- [x] scoped 门 `scripts/test.sh --for-task gap-self-report-vocab-misfires-on-stopped-state` 绿（Evidence Scoped gate）

## Touches
- tasks/gap-self-report-vocab-misfires-on-stopped-state.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

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

## Evidence（2026-08-08，inner executor）

**机制落点**：`plugin/scripts/self-report-vocab-audit.ts` 新增 `STOPPED_MARKERS`（idle/paused/awaiting/
halted/stopped/parked/suspended 七类停止态标记）。`auditSelfReports` 的收敛判据从
`reports.length >= win && recentClean === inWindow` 改为
`(stoppedInWindow || reports.length >= win) && recentClean === inWindow`——**停止态豁免只免除
「window 满」要求，all-clean 要求原封不动**：停止态是诚实的非漂移证据，但停止态里出现 batch 词汇仍是
漂移。`AuditResult` 新增 `stopped_in_window` / `stopped_reports` 两个字段（json 输出可见）。
测试 `plugin/test/self-report-vocab-audit.test.mjs` 新增 4 条 AC1/AC2 用例（`node:test` +
`// @test-group governance`，19/19 pass）。

### AC1 实跑——停止态自报 < window ⇒ converged（修复前为 false）

修复前基线：`reports_total 1, converged false`（假警报）。修复后：

```text
$ printf 'inner: idle heartbeat, paused awaiting manager\n' > /tmp/stopped-reports.txt
$ node --experimental-strip-types plugin/scripts/self-report-vocab-audit.ts /tmp/stopped-reports.txt --window 3 --json
{
  "inner_self_report_vocab": 0, "reports_total": 1, "window": 3,
  "converged": true, "recent_clean": 1,
  "stopped_in_window": true, "stopped_reports": 1
}
```

多停止态自报（`paused awaiting manager` / `idle heartbeat` / `halted via .halt`，window 5）同样
`converged: true`。

### AC2 实跑——活跃态收敛语义不变（无回归）

- **停止态 + batch 词汇 ⇒ 仍不收敛/仍 flagged**（豁免不动 all-clean）：
  ```text
  $ printf 'Batch of 3 fully merged\nidle, paused awaiting manager\n' > /tmp/stopped-batch.txt
  $ node --experimental-strip-types plugin/scripts/self-report-vocab-audit.ts /tmp/stopped-batch.txt --window 3 --json
  → "inner_self_report_vocab": 1, "converged": false, "stopped_in_window": true
  ```
- **活跃态（无停止标记）reports < window ⇒ 仍 fail-closed 非收敛**：
  ```text
  $ printf 'inner: verification-round-1 green\ninner: verification-round-2 green\n' > /tmp/active-below.txt
  $ node --experimental-strip-types plugin/scripts/self-report-vocab-audit.ts /tmp/active-below.txt --window 3 --json
  → "reports_total": 2, "converged": false, "stopped_in_window": false
  ```
- 既有 15 条测试（AC1 flag/AC2 收敛/fail-closed/robustness/CLI/wiring）+ 新 4 条全过（19/19）。

### Contract measure / invoke（实跑）

```text
$ node --experimental-strip-types plugin/scripts/self-report-vocab-audit.ts --git-log 15 --window 3 --json 2>&1 | grep -c 'converged.*true'
1        # stopped_converged = 1 >= 1（band 满足）

$ grep -n 'reports.length >= win\|converged\|idle\|paused' plugin/scripts/self-report-vocab-audit.ts
→ 命中 `(stoppedInWindow || reports.length >= win) && recentClean === inWindow` 判据与
  `{ id: "idle", ... }` / `{ id: "paused", ... }` 停止态标记（Contract invoke 逐字命中）
```

### Scoped gate（DoD）

```text
$ bash scripts/test.sh --for-task gap-self-report-vocab-misfires-on-stopped-state --allow-thin
→ # tests 19 · pass 19 · fail 0 · cancelled 0 · EXIT=0
```

### AC3 交叉标注

- 已 done 的 `gap-reanchor-must-converge-inner-self-reported-vocabulary` 是重锚有效性判据
  （`reanchor_effectiveness_is_convergence` 读 `converged`）。本任务修的是同一判据的停止态误判：
  修复前停止态被误判非收敛 → 重锚有效性被误压低 → 加密重锚频率；修复后停止态判收敛，重锚有效性
  不被停止态压低。对 done 文件做**只加不改**的交叉标注（不改状态/不勾 AC），见该任务 Touches 节。
