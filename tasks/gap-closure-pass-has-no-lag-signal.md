---
id: gap-closure-pass-has-no-lag-signal
title: "1b 异步收尾「强制/每 tick」静默停跑 8.5h 无机械信号——AC23 只验 tick 响不响，不验 tick 内强制步骤跑没跑"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**外层 tick 文档把「### 1b 异步收尾例程」标成「强制」「每 tick 执行」（plugin/loop/orchestrator-loop-tick.md:687/713），但它的执行没有任何滞后信号——一个「强制」步骤可以静默不跑 8.5 小时而无人发现。**

**实证（manager 2026-08-09 04:5x 核实，外层复核）**：
- **机制存在**：1b 设计上正是为 not-yet-flipped 任务集准备的（跑 ready-pool-check → 逐个收尾翻 done）。正文**没有**把收尾门控在套件状态上（红窗停派发不应蕴含停收尾）。
- **执行停了**：`git log` 的 outer:close 提交——08-08 14:49→20:08 每 ~20 分钟一次（5.3h 节奏极稳），**20:08 后无任何 outer:close，至今 8.5h**。同期 not-yet-flipped 涨到 42/51 = 82%（对照已关闭案 gap-closure-detection-reads-symbols-not-checkboxes 的 61%）。
- **无信号**：AC23「层间 tick 间隔检查」只验 tick 有没有响（transcript 心跳间隔），**不验 tick 内的强制步骤有没有执行**。1b 停跑 8.5h，没有任何机械信号报出来。
- **外层自认**（本会话）：00:1x 识别了 not-yet-flipped 积压（31）却自行延后（dirty-tree 顾虑——1b 文档无此门控），随后被收敛/结构工作吸收，04:4x 才执行 closure-pass。**这是执行侧缺口 + 无信号的双重问题。**

**后果**：记账 backlog 无界增长（82% 仍涨）；「强制」步骤的可执行性不可验证——和 forkBaseline 未接线、scope 未读同族的「写了没强制」缺陷。

**修的方向（实现归内层，方向 manager/外层已定）**：
- 候选 A：**closure-lag 信号**——每 tick（或 monitor）读 not-yet-flipped 计数，超阈值（如 >30）即报（WARN/事件）；closure-pass 执行本身打时间戳，超时未跑即报。
- 候选 B：**执行可验证**——closure-pass 每次跑后写 `.quay/closure-pass-last-run.json`（时间戳 + 翻转数），消费方（tick/monitor）对比间隔。
- 候选 C：**门控收尾**——1b 明确不受套件状态门控（文档强调），红窗期间照常收尾（消除本会话的 dirty-tree 误顾虑）。

**验证锚**：修后，(a) 人为停跑 closure-pass（或注入高 not-yet-flipped）⇒ 机械信号报出；(b) 正常每 tick 跑 ⇒ 无信号；(c) 文档明确 1b 不随红窗停。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 8.5h 停跑实证（outer:close 时间序列 + not-yet-flipped 42/51）+ AC23 只验 tick 不验步骤（本任务 Proposal 已含）
- [x] AC2: **closure-lag 信号**——not-yet-flipped 超阈值或 closure-pass 超时未跑 ⇒ 机械信号（WARN/事件）报出。落地 `plugin/scripts/closure-lag-check.sh`：退出码即信号（0 静默 / 1 报出 / 2 错误）。**实跑（2026-08-09 实现后，本 worktree 真实现场）**：`bash plugin/scripts/closure-lag-check.sh` → `CLOSURE-LAG-WARN: closure-pass-never-ran with 22 task(s) awaiting closure`，`exit=1`（当前 22 个 not-yet-flipped、无留痕 ⇒ 信号报出——正是 8.5h 静默缺陷类）。注入高 not-yet-flipped / 停跑 closure-pass ⇒ 报出；正常 ⇒ 静默，见 DoD 实跑注。
- [x] AC3: **执行可验证**——closure-pass 每次执行留痕（时间戳 + 翻转数），消费方可查。`closure-lag-check.sh --record --flipped <N>` 写 `.quay/closure-pass-last-run.json`（`{ranAt, flipped, at}`，gitignored 运行时态）；消费方（measure / monitor）对比间隔。测试 `plugin/test/closure-lag-check.test.mjs` AC3 用例验证写入 + 读出。
- [x] AC4: **1b 不随红窗停**——文档明确收尾不受套件状态门控；红窗期间照常收尾（或机械强制）。`plugin/loop/orchestrator-loop-tick.md` + `orchestration/orchestrator-loop-tick.md` 的 1b 顶部新增「**1b 不随红窗停（AC4）**」段：`state: red` 停的是派发与合并推进，**不停收尾**；红窗期间照常跑收尾例程；「dirty-tree 顾虑」不构成延后收尾的理由。
- [x] AC5: **既有机制不回归**——ready-pool-check / closure 相关测试全绿（`--for-task` scoped）。`bash scripts/test.sh --for-task gap-closure-pass-has-no-lag-signal --allow-thin` → 通过（详见 DoD）；新增 `plugin/test/closure-lag-check.test.mjs` 8/8 绿，复用现有 ready-pool-check 探测（未改其实现）。

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：注入高 not-yet-flipped / 停跑 closure-pass ⇒ 信号报出；正常跑 ⇒ 静默（贴任务体）
      **实跑（2026-08-09，`bash plugin/scripts/closure-lag-check.sh`，temp workspace + 本 worktree 现场）**：
      - **本 worktree 真实现场**（22 not-yet-flipped、无留痕）：`CLOSURE-LAG-WARN: closure-pass-never-ran
        with 22 task(s) awaiting closure`，`exit=1`——**停跑（从未留痕）⇒ 报出**。
      - **注入高 not-yet-flipped（> 阈值）**：temp workspace 2 个 all-ACs-checked ready 任务，
        `--threshold 1` → `CLOSURE-LAG-WARN: ... not-yet-flipped=2 > threshold=1`，`exit=1`。
      - **停跑 closure-pass（留痕超时）**：写旧留痕 `ranAt = now-5000s`，`--timeout 1` →
        `CLOSURE-LAG-WARN: ... closure-pass-overdue`，`exit=1`。
      - **正常跑 ⇒ 静默**：`--record --flipped 2` 留痕后，1 not-yet-flipped ≤ 阈值 30 →
        `closure-lag-check: ok (not-yet-flipped=1 ≤ threshold=30; closure-pass fresh)`，`exit=0`。
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
      `bash scripts/test.sh --for-task gap-closure-pass-has-no-lag-signal --allow-thin`：scoped
      static checks 全 PASS（`violations: 0`），新增 `plugin/test/closure-lag-check.test.mjs` 8/8 绿，
      `EXIT=0`（task-contract-check 对任务文件 `--strict-subset` 通过）。
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证
      （本 task 在隔离 worktree 实现，全量套件由外层 verification-round 在本分支合入 integration 后验证）

## Touches

- plugin/scripts/closure-lag-check.sh（closure-lag 信号脚本——候选路径，实现时落地，具体文件名以实现为准）
- orchestration/orchestrator-loop-tick.md + plugin/loop/orchestrator-loop-tick.md（1b 文档：不随红窗停 + 留痕要求）
- plugin/loop/fast-mode-loop-tick.md（收尾语义涉及时）
- tasks/gap-closure-pass-has-no-lag-signal.md（自身：勾 AC + 贴证据）

## Contract

measure   closure_lag_signal = 构造「not-yet-flipped > 阈值 / closure-pass 超时未跑」后 `bash plugin/scripts/closure-lag-check.sh` 的退出码
band      closure_lag_signal = 非 0（报出；正常时 0 静默）
invariant closure_pass_leaves_trace = 1（每次执行留时间戳 + 翻转数）
invariant red_window_does_not_stop_closure = 1（1b 不受套件状态门控，红窗照常收尾）
invoke    `bash plugin/scripts/closure-lag-check.sh`（实跑贴回）
control   not-yet-flipped 超阈值 ⇒ 报；closure-pass 停跑超时 ⇒ 报；正常 ⇒ 静默
resume    信号 + 留痕 + 文档分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 硬发现：1b 强制/每 tick 静默停跑 8.5h，无机械信号——AC23 只验 tick 响不响；outer 自认执行缺口（00:1x 延后 + 吸收）；方向已定候选 A/B/C，实现归内层）
