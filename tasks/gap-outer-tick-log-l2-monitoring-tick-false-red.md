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

- [x] AC1: 纯监控 tick（在飞=cap、promotions=[]、无派发）的 L2 trace 判据不假红——修法：checker 识别「本窗口无 commit 但 tick-log 行自带完整读数举证」为合法监控 tick（读取数行判定，⛔ 不压布尔）；或 tick 侧把 A22 读数写进 git 可见处（二选一，实现方选）。取假：构造监控 tick（在飞=cap、无 commit），checker 不得报 action-claimed-but-no-git-trace。
- [x] AC2: 修法不削弱 L2 防欺骗意图——取假：构造「判词 correct 但无读数行、无 commit」的假 tick，checker 仍必须报（⛔ 不能把监控豁免做成万能豁免）。
- [x] AC3: 修法后纯监控 tick 的 tick-log 行 checker 返回 PASS（或显式 NOT-EVALUATED，不得 FAIL），且不需要补做 git 动作。

## Definition of Done

- [ ] 纯监控 tick 不再被 L2 trace 判据误红（监控 tick 有合法分类路径）；L2 防欺骗语义保留。

## Touches

- plugin/scripts/outer-tick-log-check.sh（L2 trace 判据：识别监控 tick 合法豁免）
- plugin/test/outer-tick-log-check.test.mjs（取假：监控 tick PASS / 假 correct FAIL）
- tasks/gap-outer-tick-log-l2-monitoring-tick-false-red.md（自身）

## Evidence（实现方选方向 A：改 checker 判据，不动 tick 侧）

**修法**：`outer-tick-log-check.sh` 新增 `A22_LINE`（ready-pool 读数行判定）+ `MONITORING_TICK` 判定 =
「动作分类=correct ∧ 行带完整读数举证（B13 五条 INEQ_LINE + A22 ready-pool 读数 + A23 AC81 输出）」。
L2 trace 判据两分支（`--truth` 接缝与真实重测）在「窗口无 commit」时：`MONITORING_TICK=1 ⇒ 监控豁免
（PASS，JSON 报 `"monitoring":1`）；否则仍判 `action-claimed-but-no-git-trace`（AC2 防欺骗保留）`。
⛔ 不压布尔——豁免只给 correct（监控 tick 的实际分类），escalate/unblock 声称具体动作，即使带读数
也不豁免；⛔ 无读数举证（判词 correct 但无 B13/A22/A23）仍 FAIL。跨日宽限代码（gap-outer-tick-log-
cross-midnight-monotonic 已 land）未动——改动在其上叠加。

**取假（plugin/test/outer-tick-log-check.test.mjs 新增 3 条，全绿）**：
```
✔ AC1 — 监控 tick（correct + 完整读数 + 窗口无 commit）⇒ PASS，不报 action-claimed-but-no-git-trace
✔ AC2 — 假 correct（判词 correct 但无读数行、无 commit）⇒ 仍 FAIL（防欺骗保留）
✔ AC3 — 豁免不压布尔：escalate + 完整读数 + 窗口无 commit ⇒ 仍 FAIL（豁免只给 correct）
```

**验证**：
```
$ bash scripts/test.sh plugin/test/outer-tick-log-check.test.mjs
ℹ tests 27  ℹ pass 27  ℹ fail 0

$ bash scripts/test.sh --for-task gap-outer-tick-log-l2-monitoring-tick-false-red --allow-thin
EXIT CODE: 0（scoped static checks 全绿；tests 27 / pass 27 / fail 0）
```

**对真实监控 tick 的判定**（构造自 2026-08-17 04:43Z 行）：correct + B13 + A22（pool=10 floor=20
deficit=10 promotions=[]）+ A23（code=0）⇒ 完整读数举证 ⇒ 窗口无 commit 时 PASS（monitoring:1），
不再需要补做 git 动作（04:03Z 那次用「录证据进任务补 commit」的 workaround 不再必要）。
