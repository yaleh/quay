---
id: goal-034-edge-count-before-after-negctl
title: GOAL-034 读数块（AC-354）：before/after 边数读数 root→gate/config
  1→0、gate/factories→gate/config 行数 5→0 + 可证伪负对照（4 环是否收缩按实测记录）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - goal-034-gate-run-options-to-kernel
goal_ac: AC-354
---
## Proposal

GOAL-034 的第二个 pre-merge AC（AC-354）是**读数/证据** AC，不是独立的实现切片：它的判据 `quay goal gate AC-354` 全部在**被求值的树上现场静态扫描**（grep 按位置判定 + `node -e` 计数），不读任何证据文件；它要求 (a) `packages/quay/src/kernel/gate-run-options.ts` 已落地 —— 否则 exit 3（未评估，区别于失败）；(b) `gate/config/utils.ts` 已整个删除（不是留一层 re-export shim）；(c) `gate/config/loader.ts` 与 `gate/config/index.ts` 已改口 import kernel；(d) `goal-store.ts` 的 `./gate/config/` 计数 1→0；(e) `gate/factories/utils.ts` 与 `gate/factories/goal.ts` 的 `../config/` 计数归零；(f) 可证伪负对照 —— 在 `goal-store.ts` 的 scratch 字符串副本里重插旧 import 行，同一计数法必须从 0 变回 ≥1，否则读数不可信（硬规则 4：结构上不可能取假的量不是测量）。

<!-- dedup-ref -->
已存在的 `tasks/goal-034-gate-run-options-to-kernel.md`（`goal_ac: AC-353`）承接的是**结构护栏** AC-353，是本任务的实现前置（`depends_on`）。它虽在自己的 Plan/AC 里把 AC-354 列为一步，但顶层 `goal_ac` 只声明了 AC-353；驱动的独立核验按 `readTaskFacts` 读顶层 `goal_ac`，故 AC-354 在机制上仍是无主读数 AC，需要本任务作为它的载体。本任务**不改任何源码**（那属于该实现任务的 Touches）——它只负责把实现落地后的读数取出来、把可证伪负对照跑通、并把「4 环是否因此收缩」如实记录（⛔ 不预先断言）。

为什么单独一块而不并进实现任务：AC-354 与 AC-353 的判据、仪器、以及「读数能取假吗」的负对照是两回事（硬规则 4）；且 AC-354 只有在实现落地后才可评估 —— 把它写成同一任务的 AC 会让该任务的 worker 在两棵树之间反复（同 GOAL-033 AC-351 的处置，见 `tasks/gap-goal033-selfhost-and-archguard-evidence.md` 前例）。

## Plan

1. 前置：`goal-034-gate-run-options-to-kernel`（AC-353 实现）已在 `goal/GOAL-034` 分支上落地 —— `packages/quay/src/kernel/gate-run-options.ts` 存在、`gate/config/utils.ts` 与 `gate/factories/loader.ts` 已删除、七个真实消费点 + `gate/factories/utils.ts` 已改口。本任务 worktree 从 `goal/GOAL-034` 建，前置落地后即含实现。
2. 在**本任务 worktree**（= 被求值树）上跑 `quay goal gate AC-354`（或等价的 `node packages/quay/bin/quay.ts goal gate AC-354`），要求 exit 0。若 exit 3 ⇒ 实现尚未落地（前置未满足），停等，不自行推进范围；若 exit 1 ⇒ 判据同行给出 `CAUSE=`，把原文记下并交回实现任务，不在此任务内改源码。
3. 把判据在 stdout 打印的那一行 JSON 逐字落进 `## Evidence`：四个键 `fork_point` / `before` / `after` / `negative_control_count_on_scratch_regression`，不得改写数值。同时记 before 基线（fork point `162f8c380ed1dd9267167cc791ef8727fd13269d`：`root→gate/config` = 1、`gate/factories→gate/config` 行数 = 5）与分支尖端重读值（期望 0 / 0）。
4. 独立第二来源负对照（不依赖判据内置的那次）：把 `packages/quay/src/goal-store.ts` 拷进一个 scratch 目录，只在副本顶部重插 `import { resolveAcceptanceTimeoutMs } from "./gate/config/utils.ts";`，用判据里同一个计数函数（正则按 `from "./gate/config/` 前缀匹配，剔注释行）重读 ⇒ 必须 ≥1。读数为 0 ⇒ 读数不可信，报 red，不得勾选。
5. 4 环实测（AC-354 标题的「4 环是否因此收缩按实测记录，不预先断言」）：用 ArchGuard 对**分支尖端**跑一次 `archguard_analyze(projectRoot=<本任务 worktree>, sources:["packages/quay/src"], lang:"typescript", format:"json")`，**从回显取 scopeKey 并显式传回**（⛔ 省略 scope 会静默选中一个陈旧的无关 scope），再跑 `archguard_detect_cycles(outputScope:"package", scope:<key>)`。如实记录 SCC 成员集与大小 —— **可能仍为 4**（GOAL-034 body 的手工推导预期 4 环存活；判据把它标为 hand-derived 前置假设，本条是其实测确认）。⛔ 不因读数调整本 goal 的范围（尤其**不得**为让数字好看而顺手搬走 `discoverWorkspaceRoot` 等真实 config 加载逻辑）。
6. 把 2/4/5 三段读数写进 `.quay/goal-034-evidence/ac-354-edge-counts.json`（`.quay/` 被 gitignore，需 `git add -f` 提交，否则 goal 判据 worktree 读不到），键：`{ fork_point, before:{root_to_gate_config,factories_to_config_lines}, after:{...}, negative_control:{method, count}, package_scc:{scopeKey, members, size, note} }`。
7. 自查：在本任务 worktree 内确认 `node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/goal-034-edge-count-before-after-negctl.md` exit 0，且 `quay task check <本任务 id> --json` 的 `missing` 为空。

## Acceptance Criteria

- [ ] `quay goal gate AC-354` 在本任务 worktree 上 exit 0，输出原文（含那一行 JSON）逐字落进 `## Evidence`。
- [ ] `## Evidence` 记录 before 基线（fork point `162f8c38`：root→gate/config = 1、factories→config 行数 = 5）与分支尖端重读值（root→gate/config = 0、factories→config 行数 = 0），两处均为**实测**读数，非转录。
- [ ] 独立第二来源负对照（Plan 第 4 步）实测计数 ≥1，证明计数法能检测到旧 import 的回归。
- [ ] `package_scc` 段如实给出分支尖端 `detect_cycles(outputScope:"package")` 的显式 scopeKey + 成员集 + 大小；4 环收缩与否**按实测写**（是几写几）。
- [ ] `.quay/goal-034-evidence/ac-354-edge-counts.json` 已 `git add -f` 提交到本任务分支。
- [ ] 未改任何 `packages/quay/src/**` 源码（`git diff --name-only` 不含该目录）。

## Definition of Done

AC-354 判据在本任务的被求值树上 exit 0，其 JSON 读数与独立手工负对照读数都逐字进了 `## Evidence`；4 环（`gate` 包 SCC）是否因本刀收缩有**实测**记录（不采信预推导）；证据文件在分支上可读；本任务未触碰任何源码文件。

## Touches

- .quay/goal-034-evidence/ac-354-edge-counts.json
- tasks/goal-034-edge-count-before-after-negctl.md

## Evidence

（执行时填写：判据 stdout 原文、独立负对照读数、package_scc 实测段。）