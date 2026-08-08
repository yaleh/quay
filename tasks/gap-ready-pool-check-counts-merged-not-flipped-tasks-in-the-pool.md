---
id: gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool
title: ready-pool-check's notYetFlipped requires all-ACs-checked, but the inner
  merges without ticking ACs — so done-work tasks pollute the pool and the
  fake-full problem reproduces inside the mechanism
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

外层 2026-08-04 独立核实刚合并的 `gap-promotion-cadence-...`（人方向裁定，ready-pool-check 机制）时发现：

**实跑 `ready-pool-check.ts --root . --json` 得 `pool: 6`**——但 6 条里 5 条是**已合并未翻 done**：
am2 / node-cache / promotion-cadence / reliable-send / task-write 全部 `status: ready` 且 **AC 勾选 0/6..9**
（内层 fan-in 合并时**不勾 AC 框**）。⇒ 机制的真实可派发池 = **0**，而机制报 6。

**根因**：`ready-pool-check.ts` 的 `notYetFlipped(task)`（line 118-120）判据是「**全部 AC 勾选** + status
ready」——但它不匹配内层实际的关闭方式（合并时不勾 AC，状态也不翻 done）。于是「本批已做完未翻」这一
类（机制规格里明确要排除的 ①）**一条也认不出**，done-work 全部算进池。

**这是「假满」在机制内部复现**——机制存在的全部理由就是消灭假满（`pool ≥3` 若用 6 这种虚数，就绪池
看起来健康、永不补晋，12 小时无人值守下再犯 AC-queue 原来的病）。内层 11/11 测试通过但没有覆盖这个
形态（夹具里可能没有「merged 但 AC 全未勾」的样本）。

### 选定机制

**`notYetFlipped` 的判据从「AC 全勾」改为「工作已落 master」**——复用 `task-status-drift-check.ts`
已有的信号：**任务声明的符号在树里已解析 / 触摸文件已在 master，且 status 仍是 ready** ⇒ 视为
「本批已做完未翻 done」，从池里排除。这个信号不依赖 AC 勾选状态（勾选是可选表示，不勾不代表没做完）。

## Acceptance Criteria

- [x] AC1: `ready-pool-check.ts` 的 `notYetFlipped`（或等价排除）改判「工作已落 master + status ready」，
      不依赖 AC 勾选状态——用 `task-status-drift-check` 的符号解析/触摸文件信号（grep 它的导出复用）
- [x] AC2: **负控制**——构造/实取一条「merged 但 AC 全未勾 + status ready」的任务 ⇒ 必须从池里排除
      （当前 5 条 merged 任务就是活样本：跑 checker，pool 必须反映真实可派发 ≈ 0）
- [x] AC3: **正控制**——一条真正未开始的 ready 任务（AC 未勾 + 工作未落 master）⇒ 留在池里
- [x] AC4: 实跑当前真实树——`pool` 字段反映真实可派发（排除 merged 后），输出贴任务体
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`；加「merged 但 AC 全未勾」夹具样本
      （正是 11/11 没覆盖的那个形态）
- [x] AC6: 防回归——`ready-pool-check.ts` 的测试断言「pool 不会把 merged 任务数进去」，且
      `task-status-drift-check` 的信号被复用（不各自发明一套）

## Definition of Done

- [x] AC1–AC6 全部勾上；AC2/AC4 实跑输出逐字贴任务体（pool 修正前后对照）
- [x] 真实树跑通：pool 反映真实可派发（本 tick 时 ≈ 0，因 5 条 merged 全排除）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

### invoke 实跑证据（task-contract-check 消费者：done 任务必须展示 invoke 入口路径）

`node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root . --json`（Contract invoke）→ 修复后当前真实树 `pool = 0`（5 条 merged-not-flipped 任务全排除，不再污染池）。
`scripts/test.sh plugin/test/ready-pool-check.test.mjs` → ℹ tests 12 / pass 12 / fail 0 / cancelled 0 / skipped 0（含「merged 但 AC 全未勾」夹具样本）。
批量 fan-in 全量：tests 2298 / fail 0 / cancelled 0 / skipped 27。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check.test.mjs
- plugin/scripts/task-status-drift-check.ts（若需导出可复用的「已落地」判定）

## Contract

measure   pool_real = `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root . --json` stdout 的 pool 字段
band      pool_real = 反映真实可派发（本 tick：merged 5 条全排除 ⇒ ≈0；后续按实际）
invariant drift_signal_reused = 1（notYetFlipped 复用 task-status-drift 的「工作已落 master」信号，不新发明）
invoke    `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root . --json`
control   负控制：merged 但 AC 全未勾 ⇒ 排除；正控制：未开始 ⇒ 留在池（AC2/AC3）
resume    判据修改与测试补样分两步提交，任一步完成即写盘

## Cross-references（AC 交叉标注，2026-08-08，`gap-closure-detection-reads-symbols-not-checkboxes` 落地时写）

> **互为镜像**：本条把判据从「AC 全勾」改为「工作已落 master」（内层合并不勾 AC，全勾不是收尾信号）；
> 那条把 `taskWorkLanded` 改成**并集**补上「AC 全勾」信号（散文 AC 完成态 17 个被 workLanded 漏掉）。
> 两条并集后收尾信号完整覆盖三态：勾了没落地（workLanded 纯信号不报、AC 信号报收尾）、落地没勾全
> （workLanded 报）、全勾 ready（AC 信号报）。`taskWorkLanded` 语义原样保留，只是不再唯一。

> **只测心跳的补充（AC3，`gap-landing-blocked-invisible-to-dispatch-criteria`，2026-08-08 落地时写）**：
> 本条 + `taskWorkLanded` 家族测的是**池成员是不是「已做完未翻 done」**（收尾/心跳维度）；
> 那条补的是**落地可见性轴**——`criterion_met` 之外新增 `landing_blocked` 信号（develop 落后 master 且
> integration 冻结时明确报，AC17 catch-up 场景可观测）。两者正交：本条保证池里**没有假满的已落地任务**，
> 那条保证**落地被结构阻塞时就绪池不再误读成健康**。互补不重叠。

## Dispatch review

reviewer: outer
at: 2026-08-04T17:5xZ
changed: 外层独立核实发现并立案。三处收紧：
(1) **判据从「AC 全勾」改为「工作已落 master」**——AC 勾选是可选项，不勾不代表没做完；drift-check
的信号才是「做没做完」的可靠判据；
(2) **AC4 用真实树跑**——本 tick 的 5 条 merged 任务就是活样本，pool 必须从 6 降到真实值，不允许
构造夹具自证；
(3) **AC6 防回归**——11/11 通过但没覆盖「merged 且 AC 全未勾」形态，本任务必须补那个夹具样本。
status: todo——排在 suite-speed 完成（当前唯一在飞）之后；它改的是刚合并的 ready-pool-check.ts。
