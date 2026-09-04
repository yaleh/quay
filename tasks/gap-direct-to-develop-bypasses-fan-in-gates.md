---
id: gap-direct-to-develop-bypasses-fan-in-gates
title: 直接提交 develop 绕过全部 fan-in 机件（ff-lock/anti-drift/AC 完成闸）且不进任何差集——AC78 判据2 结构上看不见（发生率 25-30，硬规则12b）
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

- [x] AC1 检测器落地：直接提交 develop ∧ 触及代码/断言面（fan-in-execute.js:87 code_delta 谓词）∧ 无 ff-lock 时间窗事件 ⇒ 报「直接提交绕过 fan-in 机件」。
- [x] AC2 分类：设计内（.gitignore / manager 独占 / 热修 fan-in 机件本身）与设计外分离——不把设计内误报成违规。
- [x] AC3 能取假·真样本：7e64a86b + 核心子集 4 条（7d1d5d2e/b389a758/18e7a3be/77174684）回放必须报红；.gitignore/manager 独占设计内样本回放必须绿。denominator 谓词写明（25 vs 30 差异在排除集，任务体记录）。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 直接提交 develop 绕过 fan-in 机件的检测器 + 分类（设计内/外）+ 真样本回放（4 红 + 设计内绿）。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（新检测器——reflog action=commit 直接提交 ∧ 代码/断言面 ∧ 无 ff-lock 时间窗 ⇒ 红；设计内排除集分类）
- plugin/scripts/checker-mutation-cases/direct-to-develop-bypass-check.sh（检测器 mutation case——L_S 仪器，checker-mutation-check 要求新 checker 必须配 mutation case）
- plugin/test/direct-to-develop-bypass-check.test.mjs（检测器测试 + 真样本回放 fixture——12 例）
- scripts/test.sh（接入 run_static_checks，--baseline 77b291db enforcement 边界）
- plugin/scripts/capability-catalog.sh（声明 6 表：question/cadence/invalidation/last-reaffirmed/matching/consumer）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照再生——scripts 251→252）
- tasks/gap-direct-to-develop-bypasses-fan-in-gates.md（自身）

## Evidence

（2026-08-15 inner Build 落地后填）

**检测器**：`plugin/scripts/direct-to-develop-bypass-check.ts` + `plugin/test/direct-to-develop-bypass-check.test.mjs`（12 例全绿，`node --test` 直跑）。

**判定谓词（AC1/AC3 denominator）**：直接提交 = develop reflog action `commit:`（fan-in 落地是 `merge … Fast-forward`——reflog 是唯一区分读面，CLAUDE.md 硬规则 2 按位置判定）；代码/断言面 = 改动文件不落在设计内排除集（tasks/ docs/ orchestration/ adr/ .quay/ plugin/loop/ measurements/ milestones/ .claude/ CLAUDE.md .gitignore/.gitattributes/.npmrc .github/ plugin/scripts|test/fan-in-*）；ff-lock 时间窗 = commit 落在 fan-in-merge-lock-events.jsonl 某 acquire→release 区间内（缺失 = 可读空，malformed/unpaired = NOT-EVALUATED，硬规则 3b）。

**denominator 实测（audit 全史）**：430 直接提交中 29 代码面 / 401 设计内——29 落在任务体「25 vs 30」区间内（差异在排除集精度：本谓词排除 .gitignore/CLAUDE.md/manager 独占，故 29 介于 manager 的 30 与 inner 独立谓词的 25 之间，且把 SKILL.md 计为代码面）。基线 77b291db（enforcement 落点）⇒ 无新直接代码面提交 ⇒ 绿。

**AC3 真样本回放**（`node --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root <main> --commits <5 shas> --json`）：7e64a86b/7d1d5d2e/b389a758/18e7a3be/77174684 全红（exit 1，candidates=5，reason=direct-commit-bypasses-fan-in）；5e54bb37（热修 fan-in 机件 .claude/workflows/fan-in-execute.js）绿（exit 0）；fixture 设计内样本（.gitignore / manager-tick-core.js / orchestration/ / CLAUDE.md / fan-in-execute.js / tasks/）全绿。锁窗豁免：直接提交落在 acquire→release 区间内 ⇒ 不报。锁事件不成对 ⇒ NOT-EVALUATED（evaluated:false，不与合格同形）。

**scoped 门**：`scripts/test.sh --for-task gap-direct-to-develop-bypasses-fan-in-gates --allow-thin` —— capability-catalog 16 例全绿 + build_dist 通过；检测器测试因 Touches 已收窄到具体文件（`plugin/test/direct-to-develop-bypass-check.test.mjs`）而随 scoped 选择器命中（见 AC4）。

## 止损

**需要 —— 当下动作 = 本任务立案**：发生率 30（上界）已由 `git reflog show develop` + code_delta 谓词测得（硬规则12b），立案门槛已到。7e64a86b 是核心子集最新一条，绕过三道闸——本任务把它从「观察项」升为「机制缺口」。
