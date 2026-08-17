---
id: gap-outer-tick-log-l2-monitoring-tick-false-red
title: "outer-tick-log-check L2 trace 判据对纯监控 tick 必然触发（correct 需 git 证据，而监控 tick 无 git 动作；no-action 又因 pool<floor 非法）——发生率 2/日"
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

**来源**：outer 2026-08-17 04:43Z（第 2 次实测）+ 04:03Z（第 1 次）。

**问题**：`outer-tick-log-check.sh` 的 L2 trace 判据（`action-claimed-but-no-git-trace`）对**纯监控 tick** 必然触发——此类 tick（在飞=cap 5、无晋升、无派发、无新立案）**没有任何 develop git 提交**可作「correct」的证据，而「no-action」又因 B13 ② pool<floor 为真（10-11<20）非法 ⇒ 监控 tick 无法分类。

**实证（2026-08-17，两次）**：
```
04:03Z tick: 监控 only → L2 FAIL action-claimed-but-no-git-trace（窗口 [03:41,04:05] 无 commit）
   → 用「AC95 turn-budget 证据录进任务」补了一个合法 commit 才过
04:43Z tick: 监控 only → 同形（窗口 [04:21,04:45] 无 develop commit；6e456679 在窗口外）
```
**机制**：L2 trace 窗口 = [tick 起点, tick-log mtime]，检查该窗口内 develop 有无 commit。监控 tick 的 A22/A23/B1/B2 读数都是运行时状态（tick-log 是 gitignored，.quay 也是），不产生 develop commit。**tick-log 本身就是证据，但被 gitignore 排除 ⇒ L2 看不到**。

**⊢ 这不是 checker「误报」而是分类空间缺口**：checker 按设计工作（correct 需要 git 证据，防「判词写了但没做事」）。缺口在**监控 tick 无法被分类**——它确实做了每轮必跑的事（A22/A23/B1/B2），但无 git 痕迹。硬规则 9（可见性 ≠ 执行）的镜像：**执行了但记录不可见**。

**⊢ 发生率**：2026-08-17 已 2 次（04:03 + 04:43），且**在飞=cap + 无晋升的监控 tick 每 20 分钟可能出现一次** ⇒ 不是一次性，是结构性重复噪声。

## Acceptance Criteria

- [ ] AC1: 纯监控 tick（在飞=cap、promotions=[]、无派发）的 L2 trace 判据不假红——修法：checker 识别「本窗口无 commit 但 tick-log 行自带完整读数举证」为合法监控 tick（读取数行判定，⛔ 不压布尔）；或 tick 侧把 A22 读数写进 git 可见处（二选一，实现方选）。取假：构造监控 tick（在飞=cap、无 commit），checker 不得报 action-claimed-but-no-git-trace。
- [ ] AC2: 修法不削弱 L2 防欺骗意图——取假：构造「判词 correct 但无读数行、无 commit」的假 tick，checker 仍必须报（⛔ 不能把监控豁免做成万能豁免）。
- [ ] AC3: 修法后纯监控 tick 的 tick-log 行 checker 返回 PASS（或显式 NOT-EVALUATED，不得 FAIL），且不需要补做 git 动作。

## Definition of Done

- [ ] 纯监控 tick 不再被 L2 trace 判据误红（监控 tick 有合法分类路径）；L2 防欺骗语义保留。

## Touches

- plugin/scripts/outer-tick-log-check.sh（L2 trace 判据：识别监控 tick 合法豁免）
- plugin/test/outer-tick-log-check.test.mjs（取假：监控 tick PASS / 假 correct FAIL）
- tasks/gap-outer-tick-log-l2-monitoring-tick-false-red.md（自身）
