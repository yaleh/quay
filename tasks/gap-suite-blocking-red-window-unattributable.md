---
id: gap-suite-blocking-red-window-unattributable
title: "suite_blocking 红窗信号活着却映射不到任务——round-210 红失败文件 send-keys-verified.sh
  不在任何任务 ## Touches ⇒ window_active=true consecutive_red=4 但 tasks=[] 空 ⇒
  红窗信号连改排序的作用都没有,红对派发影响严格为零；与 CROSSCUT plugin/scripts 零覆盖同根(plugin/scripts
  机制层不被索引)；补归因映射+未归因清单"
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**`suite_blocking` 红窗信号活着却映射不到任何任务——`window_active=true consecutive_red=4` 但 `tasks=[]` 空。本轮红失败文件 `send-keys-verified.sh`（quay-init-drift-report 的 Contract control 子测试）不在任何任务的 `## Touches` 里，所以红窗信号连改排序的作用都没有，红对派发的影响严格为零。这与 CROSSCUT_CHECKS 对 plugin/scripts 零覆盖是同一个根：plugin/scripts 下的东西既不进 scoped 选择，也不进红窗归因。**

### 实证（manager 2026-08-10 核实 + outer 复核）

- **round-210 红**：`quay-init-drift-report.test.mjs` 的 Contract control 子测试失败，失败文件字段 `send-keys-verified.sh`（这是该子测试操作的派生脚本，不是测试文件本身）。
- **suite_blocking 信号**：`ready-pool-check --json` → `suite_blocking: {consecutive_red: 4, window_active: true, failure_files: [send-keys-verified.sh], tasks: []}`——**window_active=true 但 tasks=[] 空**。
- **根因**：`computeSuiteBlocking` 用 `expandDeclaredTouches` 把失败文件映射到任务的 `## Touches`。`send-keys-verified.sh`（plugin/scripts/ 下）不在任何任务的 `## Touches` 里 → 映射失败 → tasks=[] → 红窗信号无法提升任何任务的 blocking/value → 排序增益失效。
- **与 CROSSCUT 同根**：plugin/scripts 下的东西既不进 scoped 选择（CROSSCUT_CHECKS 全认 packages/*/src），也不进红窗归因（computeSuiteBlocking 的 Touches 映射漏 plugin/scripts）——两个都是「机制层文件不被机制索引」。
- **红对派发影响严格为零**：即使 window_active，tasks=[] 空 ⇒ 无任务被提升 ⇒ 排序不变 ⇒ 红窗信号完全失效。

**为什么重要**：红窗信号的唯一价值（把 suite-blocking 缺陷提升到派发前列）在 plugin/scripts 失败时失效——恰是今晚绝大多数失败所在地。补上归因映射，红窗信号才能把「阻塞 suite 的缺陷」排到 inner 面前。

### 选定机制方向（实现归内层，接法留执行时）

1. **归因补全**：`computeSuiteBlocking` 的失败文件 → Touches 映射补 plugin/scripts 覆盖——`send-keys-verified.sh`（或任一 plugin/scripts 文件）应能映射到相关任务。若任务 Touches 未声明该文件，至少报「未归因失败文件」清单（不静默空 tasks）。
2. **与 CROSSCUT 衔接**：plugin/scripts 失败归因 + CROSSCUT plugin-scripts 条目同一根——本任务和 gap-crosscut-checks-zero-coverage-of-plugin-scripts 是同一族。
3. **回归验证**：构造 plugin/scripts 失败 → suite_blocking 非空 tasks（或至少报未归因清单）；无失败 → 不变（负控制）。

**验证锚**：修后 (a) plugin/scripts 失败文件映射到任务或报未归因清单（非空 tasks 或显式未归因列表）；(b) 无红窗不误报；(c) 与 cross-cut 条目衔接。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 round-210 实证（consecutive_red=4/window_active=true/tasks=[] 空 + send-keys-verified.sh 不在任何 Touches）（本任务 Proposal 已含）
- [ ] AC2: **归因补全**——`computeSuiteBlocking` 失败文件→Touches 映射补 plugin/scripts 覆盖（或报未归因清单，不静默空）
- [ ] AC3: **红窗信号生效**——plugin/scripts 失败 ⇒ suite_blocking 非空 tasks（或显式未归因列表）
- [ ] AC4: **负控制**——无红窗不误报
- [ ] AC5: **与 CROSSCUT 衔接**——同根标注（plugin/scripts 机制层不被索引）
- [ ] AC6: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] 修后实跑：构造 plugin/scripts 失败 → suite_blocking 非空 tasks 或未归因清单（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/ready-pool-check.ts（computeSuiteBlocking：失败文件→Touches 映射补 plugin/scripts 覆盖 / 未归因清单）
- plugin/test/ready-pool-check.test.mjs（AC2-AC5 测试）
- tasks/gap-crosscut-checks-zero-coverage-of-plugin-scripts.md（交叉标注——同根：plugin/scripts 机制层不被索引）
- tasks/gap-ready-relevance-blind-to-suite-blocking-signal.md（交叉标注——红窗信号机制源）
- tasks/gap-suite-state-trigger-crash-watchdog-breaks-running-transition-test.md（交叉标注——plugin/scripts 失败族）
- tasks/gap-relation-sync-load-flake-child-spawn-under-suite.md（交叉标注——plugin/scripts 测试族）
- tasks/gap-suite-blocking-red-window-unattributable.md（自身：勾 AC + 贴证据）

## Contract

measure   suite_blocking_tasks_nonempty = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root <repo> --json` 输出里 plugin/scripts 失败后 `suite_blocking.tasks` 长度
band      suite_blocking_tasks_nonempty > 0（plugin/scripts 失败 → tasks 非空或显式未归因清单）
invariant no_false_positive_on_no_red = 1（无红窗不误报）
invariant crosscut_plugin_scripts_linked = 1（与 cross-cut 条目同根衔接）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root <repo> --json`（plugin/scripts 失败 fixture 贴回）
control   plugin/scripts 失败 → tasks 非空；无红窗不误报；与 cross-cut 衔接
resume    归因映射 / 未归因清单分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 核实——suite_blocking window_active=true consecutive_red=4 但 tasks=[] 空：本轮红失败文件 send-keys-verified.sh 不在任何任务 Touches ⇒ 红窗信号连改排序的作用都没有,红对派发影响严格为零。与 CROSSCUT plugin/scripts 零覆盖同根（plugin/scripts 机制层不被索引）。立案：归因映射补 plugin/scripts + 未归因清单。实现归内层
