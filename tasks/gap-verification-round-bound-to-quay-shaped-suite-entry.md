---
id: gap-verification-round-bound-to-quay-shaped-suite-entry
title: 第三方项目用自己的 suite 入口时 verification-round 台账结构性缺失 —— web 测试面恒「未接入」，且 AC-234
  的绿从未在此形态上验过
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**症状（2026-09-12 实测，机械可复算）**：ad-arm1 上由 quay 驱动开发的真实第三方项目 `/home/yale/work/archguard`，其 quay web server 的「测试」卡片显示 **「未接入 / `.quay/verification-round.jsonl` 不存在（尚未跑过验证轮 → 未接入）」**。

**但 suite 确实跑了、而且绿了**（⛔ 不是质量门缺失）：

```
fan-in-step-trace.jsonl（TASK-88）: suite-start 10:56:38 ok=True → suite-end 11:01:09 ok=True
full-suite-state.json           : {"state":"green","runner":"inner","scope":"worktree",
                                   "durationMs":271332,"laneCount":2,"taskId":"TASK-88",
                                   "runId":"mfi-TASK-88-1789210598105-e1ddad"}
gate-events.jsonl               : gate=complete verdict=pass
verification-round.jsonl        : ad-arm1 全盘 find 搜索 = 0 个（不是写错位置，是根本没写）
```

**对照（决定性）**：本机 quay 自己的 `.quay/verification-round.jsonl` **存在且在增长**（1593 行），最近记录的 `runId` 前缀同为 `mfi-`（机械 fan-in）、`runner=inner`、`scope=worktree` —— **同一条 fan-in 路径，一个项目写了、另一个没写**。

**差异的直接量**：

```
archguard 有 scripts/test.sh 吗          → 没有（scripts/test.sh 是 quay 自己仓库的约定，ADR-019/DIR-109）
archguard 的测试入口                     → package.json "test": "vitest run"
archguard .quay/config.yml               → loop.test_command: npx vitest run ；testPass: vitest/tsc/build/eslint
quay full-suite-runner 的默认 suite 命令 → bash scripts/test.sh [--buckets <task>]
```

⇒ **目标项目的 suite 由它自己的入口跑，不经 `full-suite-runner`；于是只有 `full-suite-state.json` 被 mirror 回主检出，而 `verification-round.jsonl` 这条趋势台账结构上不会产生。** web 的 /tests 卡片读的正是后者。

**影响面不是 archguard 特有**：**任何不长成 quay 自己形状（无 `scripts/test.sh`）的第三方项目都会这样**。质量门生效、可观测面失效 —— 这直接损害「quay 能驱动第三方项目开发」这一产品承诺中人可看见的那一半。

**为什么至今没被发现（本条是立案的第二个理由，⛔ 不要删）**：`goals/AC-234`（GOAL-015，「web 指向第三方项目时显示其真实载体与过程记录」）**已 achieved**，其判据要求 `round_records_rendered > 0`。但载体里它的 3 条记录，`project_root` 全部是 `/home/yale/quay-verify-coldstart-*-root` —— **全新 `quay-init` 出来的一次性项目，天然带 quay 自己的形状**，三计数各为 1。⇒ **AC-234 的绿是在「像 quay 自己的项目」上取得的，从未在一个有自己 suite 入口的真实第三方项目上验证过。** 这与 GOAL-009 `AC-238` 的 origin 记载的是**同一模式的第二次出现**（「现有 AC 的证据全部来自全新 quay-init 的一次性项目」）。

**期望（给方向，实现由执行者定）**：suite 的**执行入口**可以是项目自己的（`config.yml` 的 `test_command`），但**台账写入不应绑定在 quay 自己的 `scripts/test.sh` 形状上** —— `verification-round` 的产生应当与「suite 由谁跑」解耦。两个既有写入者（`full-suite-runner.ts` 与 `pre-verified-round-record.ts`）都已在交付物中，⛔ 不要新造第三个写入者。

## Plan

1. **先取直接量，再动代码**：在一个**无 `scripts/test.sh`** 的目标项目上跑一轮 fan-in，打印该轮产生与未产生的载体清单（⛔ 不要只报结论；引用计数前先打印匹配到的实际内容）。
2. **定位解耦点**：`verification-round` 的写入当前依赖什么条件 —— 是 `full-suite-runner` 的内部分支，还是可由 `pre-verified-round-record` 在 runner 之外补写？用**最小输入**验证你的假设（改一个条件看载体产不产生，再改回来），⛔ 不要照抄本段的措辞当结论。
3. **实现解耦**：使目标项目用自己的 `test_command` 时台账同样产生；⛔ 不新造第三个写入者。
4. **负控制（不得回归）**：在 quay 自己仓库（有 `scripts/test.sh`）上跑一轮，记录的字段集与形态**不变** —— 打印前后字段集与差集。
5. **真实验证**：在 ad-arm1 的 archguard 上真跑一轮，从**另一台机器**取回 /tests 页面 HTML，确认不再是「未接入」。

## Acceptance Criteria

- [ ] AC1 能取假：在一个**无 `scripts/test.sh`** 的目标项目跑完一轮 fan-in 后，其 `.quay/verification-round.jsonl` 存在且新增 ≥1 条，该条的 `runId`/`taskId` 与本轮 fan-in 一致（贴出记录原文与本轮 fan-in 的 runId 做对照）。今天此项为假（全盘 0 个文件）。
- [ ] AC2 不回归：quay 自己仓库跑一轮后，`verification-round` 记录的**字段集**与改动前一致（打印前后字段集与两向差集，差集为空）。
- [ ] AC3 web 面真实变化：目标项目的 /tests 页面不再显示「未接入」—— 由**非目标主机**发起 HTTP 取回 HTML 片段留档（⛔ 不采信本地渲染、⛔ 不以 HTTP 200 为证据，硬规则 4）。
- [ ] AC4 覆盖形态而非个例：AC1 的目标项目**不是** `quay-init` 新造的一次性项目，而是一个带自己 suite 入口的真实项目（记录其 `project_root` 与 `test_command` 实际取值）——这条正是 AC-234 的绿所缺的那个形态。

## Definition of Done

- 四条 AC 全部满足，AC1/AC3 的证据取自**真实第三方项目**（ad-arm1 的 archguard 或等价形态），且经**非本机**路径可核。
- 负控制 AC2 有实际输出留档（⛔ 不是「我认为不会回归」）。
- ⛔ 不通过「给 archguard 加一个 `scripts/test.sh`」来绕过 —— 那是把目标项目改成 quay 的形状，不是解耦；若最终判断该形态确实必要，必须在任务体写明理由并说明它对「任意第三方项目」的适用性。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/scripts/pre-verified-round-record.ts
- plugin/scripts/mirror-full-suite-state.ts
- plugin/test/full-suite-runner-phases.test.mjs
- tasks/gap-verification-round-bound-to-quay-shaped-suite-entry.md
