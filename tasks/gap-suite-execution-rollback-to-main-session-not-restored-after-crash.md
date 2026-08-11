---
id: gap-suite-execution-rollback-to-main-session-not-restored-after-crash
title: "OOM 崩溃后套件执行形态静默回落——.halt 解除后本用 workflow（17:52/20:11/21:01/22:45/00:57 五次调用），01:07 整机 OOM 重启后 r265/266/268/269/270 五轮全部 runner=outer 主会话直跑（2h50m 零 Workflow）；无任何机件把执行形态切回来，崩溃回落与有意改用主会话在记录上不可区分（C17 形状）"
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**人 2026-08-10 裁定【.halt 期间由主会话跑；workflow 等 .halt 解除才用】；.halt 于 08-10 17:0x 解除后，execute-suite-fix workflow 在 17:52/20:11/21:01/22:45/00:57 各调用一次（r253-259 由 workflow 治理）。01:07 整机 OOM（manager 会话也被杀重启）后，r265/266/268/269/270 全部 runner=outer 主会话直跑——meta-cc 查 00:57:41 之后零次 Workflow 调用，2 小时 50 分钟。崩溃后没有任何机件把执行形态切回 workflow：静默回落与有意改用主会话在记录上不可区分（C17 形状）。**

### 实证（manager 2026-08-11 04:0x 核实 + outer 复核）

- **人裁定**：2026-08-10【.halt 期间由主会话跑；workflow 等 .halt 解除才用】；.halt 于 08-10 17:0x 解除。
- **workflow 正常期**：execute-suite-fix 在 17:52 / 20:11 / 21:01 / 22:45 / 00:57 各调用一次（worktree verify-suite-243/257/258/259）；manager 台账记 r253/r254/r255/r256/r259「由 workflow 治理」。
- **OOM 点**：末次调用 00:57:41 启动 r264（00:58:26，19s 红）；01:07 整机 OOM（manager 会话也被杀重启）。
- **回落后**：r265(01:12) / r266(01:46) / r268(03:02 lane8 对照) / r269(03:36) / r270(03:39) 全部 runner=outer；meta-cc 查 00:57:41 之后零次 Workflow 调用——2h50m、5 轮。
- **人另一条架构裁定（与 .halt 无关，独立指向 workflow/subagent 路径）**：「outer 主 session 不应当做是否可以合并的判断。它只应启动 subagent 执行 suite test、修复和合并。仅当 subagent fail 以后，它会被 halt 并被要求自行修复和合并」——主会话跑常规验证轮本身就是越界形态。
- **C17 形状**：r268（lane8 一次性对照实验）用主会话是合理的；但 r265/r266/r270 是常规验证轮，正是 execute-suite-fix 存在的场景。回落成因是 OOM——崩溃后没有任何机件把执行形态切回来。

### 选定机制方向（实现归 inner，判定归 outer）

**让「套件由谁执行」成为可机械判定、可自动恢复的状态**：
1. **执行形态留痕**：verification-round.jsonl 已记 `runner` 字段（outer/workflow）——但没有任何检查器监控「连续 N 轮 runner=outer 且非 .halt 接管期」⇒ 加一个心跳/计数器（照 a15-ruling5-counter 形态）：`.halt 解除后连续 K 轮 runner=outer ⇒ 报「执行形态回落」，驱动切回 workflow`。
2. **主会话越界检测**：人裁定「主会话只起 subagent；subagent fail 才自行修复合并」——连续 K 轮主会话直接跑全量（无 subagent 失败前提）即违规信号。
3. **OOM 恢复 hook**：崩溃重启后检查「上次是否 workflow 治理中」——若是，恢复后首轮即 workflow 而非主会话直跑。

**验证锚**：修后 (a) 执行形态计数器在场（读 verification-round `runner` 字段）；(b) `.halt 解除 + 连续 K 轮 runner=outer ⇒ 信号`；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 OOM 前 workflow 5 次调用（17:52-00:57）+ OOM 点 + 回落后 5 轮 runner=outer + meta-cc 零 Workflow（本任务 Proposal 已含）
- [ ] AC2: **执行形态计数器**——读 verification-round `runner` 字段，`.halt 解除后连续 K 轮 runner=outer ⇒ 报「回落」信号（照 a15-ruling5-counter 形态）
- [ ] AC3: **主会话越界检测**——连续 K 轮主会话直跑全量（无 subagent 失败前提）即违规信号（人裁定：主会话只起 subagent）
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：计数器对当前状态（r270 runner=outer）报回落信号（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/suite-execution-form-counter.ts（新计数器：读 verification-round runner 字段，K 轮回落报信号）
- plugin/test/suite-execution-form-counter.test.mjs（新增测试）
- orchestration/orchestrator-tick-core.md（每 tick 跑计数器 + 回落处置）
- plugin/scripts/capability-catalog.sh（声明新脚本）
- tasks/gap-suite-execution-rollback-to-main-session-not-restored-after-crash.md（自身：勾 AC + 贴证据）

## Contract

measure   execution_form_counter = `node --no-warnings --experimental-strip-types plugin/scripts/suite-execution-form-counter.ts --root "$PWD" --json` 的 stdout 中 consecutive_outer_rounds 数字
band      consecutive_outer_rounds < K（.halt 解除后连续 K 轮 runner=outer 即越界；K 值实现时定，建议 3）
invariant runner_field_tracked = 1（verification-round.jsonl 已记 runner 字段——已有）
invariant halt_taken_into_account = 1（.halt 接管期不计数）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/suite-execution-form-counter.ts --root "$PWD" --json`（贴 consecutive_outer_rounds）
control   回落报信号；.halt 期豁免；主会话越界检测
resume    计数器 / tick 接线 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 核实——.halt 解除后 workflow 5 次调用，01:07 OOM 重启后 5 轮全 runner=outer（2h50m 零 Workflow）；人裁定主会话只起 subagent、subagent fail 才自行修复合并。回落成因=OOM，无机制切回（C17 形状）。立案：执行形态计数器。实现归 inner，判定归 outer
