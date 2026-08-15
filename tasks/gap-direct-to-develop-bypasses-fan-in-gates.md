---
id: gap-direct-to-develop-bypasses-fan-in-gates
title: 直接提交 develop 绕过全部 fan-in 机件（ff-lock/anti-drift/AC 完成闸）且不进任何差集——AC78 判据2 结构上看不见（发生率 25-30，硬规则12b）
status: todo
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

> **止损（2026-08-15，人 04:3xZ 裁定「处理问题必须同时覆盖机制与止损」——manager 00:5xZ 推翻我「单例给不出」的观察项处置）：需要 —— 当下动作 = 本任务立案**。硬规则 12b（能查历史就必须先查历史）：`git reflog show develop | grep 'develop@{...}: commit'` ⇒ **426 条直接提交**；用 code_delta 谓词（fan-in-execute.js:87 同款，排除 orchestration/ 记账面）⇒ **~25-30 条触及代码/断言面**（我独立谓词 25，manager 谓词 30——差异在排除集精度，denominator 见判据3）。7e64a86b（AC81 doc-only）只是最新一条。**发生率 30 是读数，不是 1——「单例给不出」理由不成立，立案门槛已到（硬规则12）。**

**背景（manager 00:5xZ 分诊）**：7e64a86b（SKILL.md reference-doc，单亲无 merge + 1 文件 + task 未跟踪）**不是一次 fan-in**（fan-in-execute.js:44 `if (!task...) return bad-args` 结构上走不了 workflow），故 AC78 判据2 差集（按任务算）结构上看不见它。但核历史发现它是**一类持续现象的最新一条**：**直接提交 develop、绕过 ff-lock / anti-drift-touches / AC 完成闸三道、不进任何差集**。

**核心子集（manager 实测，至少四条，全部在开发日 13:12-13:23 直接提交）**：
```
7d1d5d2e 13:23 test: AC5 负控制 self-touch 样本 DIR-127→DIR-001      → plugin/test/ready-pool-check.test.mjs
b389a758 13:16 mjs: AC1b 排除表加 manager-phase-goal-archive.md       → plugin/scripts/loop-shipping-exclusion-data.mjs
18e7a3be 13:12 mjs: manager-phase-goal 条目加 retainedNote            → plugin/scripts/loop-shipping-exclusion-data.mjs
77174684 13:12 test: AC3 pgrep-idle-watch 谓词加位置感知              → plugin/test/manager-tick-core.test.mjs
5e54bb37 10:48 workflows: fix fan-in-execute body meta is not defined  → .claude/workflows/fan-in-execute.js（热修 fan-in 机件本身）
```
**这些绕过三道闸且不进任何差集**——AC78 判据2（fan-in 走 workflow）和 11b 的「盘上状态即生产输入」都看不见它们。

**追加样本（2026-08-15 01:1xZ，manager AC63 缺口 #3 复核）**：`gap-ac81-inner-verify-wiring`（orchestrator-tick-core.md +7/-1，8e833277 step-1 中间 merge + 22:04 ff）——**任务文件从未 git 跟踪**（磁盘不存在），真实内容改动无任务文件直接落地；meta-cc 21:55-22:10 窗口**零 fan-in-execute Workflow 调用**（唯一调用是 manager 自己的 manager-tick-core.js 21:59:30）⇒ AC78 判据2 (a) 疑违规。**注意**：`fm-` runId 前缀不可作 workflow 证据（fan-in-execute.js:46 `runId = A.runId ?? ''` 调用方传入、可伪造）——判据须查执行记录（meta-cc Workflow 调用 / ff-lock 时间窗）而非字段形状。

**归属（manager 00:5xZ 明确）**：**11b/C17 线**（写所有权 / 越权直改面），**⛔ 不要挂在 AC78 下**——把这类违规塞进 AC78 差集会毁掉那个判据「fan-in 有没有走 workflow」的干净读数（硬规则⑧）。

**机制方向（供判）**：一个检测器，扫描直接提交 develop 且触及代码/断言面的 commit（复用 fan-in-execute.js:87 的 code_delta 谓词 + ff-lock 事件时间窗），报「直接提交绕过 fan-in 机件」。**30 是上界不是全部违规**——混着按设计就该直接提交的（.gitignore、manager 独占 .claude/workflows/manager-tick-core.js）⇒ 需按「是否设计上该直接提交」分类，不能一刀切。

## Plan

1. 读 fan-in-execute.js:87 code_delta 谓词 + 87 的 doc-only-delta 分支（现有跳过逻辑）。
2. 定谓词（判据3：denominator 用哪个排除集，写明——manager 原谓词排除 orchestration/，我独立谓词另排除 docs/milestones/.gitignore/tasks，25 vs 30）。
3. 造检测器：直接提交 develop ∧ 触及代码/断言面 ∧ 不在 ff-lock 事件时间窗内 ⇒ 报。
4. 分类：按「是否设计上该直接提交」（.gitignore / manager 独占 / 热修机件本身）分设计内/设计外。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 检测器落地：直接提交 develop ∧ 触及代码/断言面（fan-in-execute.js:87 code_delta 谓词）∧ 无 ff-lock 时间窗事件 ⇒ 报「直接提交绕过 fan-in 机件」。
- [ ] AC2 分类：设计内（.gitignore / manager 独占 / 热修 fan-in 机件本身）与设计外分离——不把设计内误报成违规。
- [ ] AC3 能取假·真样本：7e64a86b + 核心子集 4 条（7d1d5d2e/b389a758/18e7a3be/77174684）回放必须报红；.gitignore/manager 独占设计内样本回放必须绿。denominator 谓词写明（25 vs 30 差异在排除集，任务体记录）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 直接提交 develop 绕过 fan-in 机件的检测器 + 分类（设计内/外）+ 真样本回放（4 红 + 设计内绿）。

## Touches

- plugin/scripts/（新检测器，如 direct-to-develop-bypass-check.ts）
- plugin/test/（检测器测试 + 真样本 fixture）
- scripts/test.sh（接入 run_static_checks）
- plugin/scripts/capability-catalog.sh（声明）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照再生，如适用）
- tasks/gap-direct-to-develop-bypasses-fan-in-gates.md（自身）

## Evidence

（待落地后填：检测器实现、回放红/绿输出、denominator 谓词、scoped 门结果）

## 止损

**需要 —— 当下动作 = 本任务立案**：发生率 30（上界）已由 `git reflog show develop` + code_delta 谓词测得（硬规则12b），立案门槛已到。7e64a86b 是核心子集最新一条，绕过三道闸——本任务把它从「观察项」升为「机制缺口」。
