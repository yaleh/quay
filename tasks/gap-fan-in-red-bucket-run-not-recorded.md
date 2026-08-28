---
id: gap-fan-in-red-bucket-run-not-recorded
title: fan-in 桶路径跑红不入账——第二套平行 harness + green-only writer 绕开
  full-suite-runner.ts 的正确记录（硬规则 3b；人裁定「定义正确机制，不修修补补」）
status: ready
labels:
  - gap
  - defect
  - instrumentation
parent: null
children: []
extra:
  schema: execution
---
**type:** execution
> **REOPENED / 重开（人 2026-08-27 逐字批准「同意。发给 outer。」）**：本条曾于 2026-08-27 被作废（5c53fb22d，superseded_by gap-fan-in-driver-mechanical-orchestration），作废前提「新 SPEC driver 直接用 full-suite-runner.ts，『跑红不入账』被自然满足」**已被生产证据证伪**：
> ```
> ① 机械路径 suite 命令缺省 = bash <worktree>/scripts/test.sh --buckets <task>（worker-driver.ts:1486），
>    不是 full-suite-runner.ts；worker-driver 对 verification-round.jsonl 只读不写（:297/:360/:370）。
> ② green 记录仍由 workflow 兜底 subagent 调 green-only writer pre-verified-round-record.ts 补写
>    （state :547 硬编码 "green"、仅 suite_exit=0 后写）。
> ③ 生产实证（2026-08-27，gap-full-suite-runner-test-poll-timeout-load-flake）：两轮红 suite
>    （16:17–16:48 机械 fan-in 红；17:22 capture 落地 suite_exit=1、wall 1840.5s）在
>    verification-round.jsonl 按 runId/taskId grep 均 0 条（谓词已对 round 683/684/685 真样本核对过），
>    文件 mtime 停 16:13:57Z，/tests 最新三条全绿——约 1h 真实红运行无痕。
> ④ 替代任务 gap-fan-in-driver-mechanical-orchestration（done）AC1-AC5 无一要求红轮入账，义务未被继承。
> ```
> 修复面随之扩大：**主修复面 = 机械路径**（worker-driver.ts runMechanicalFanIn 的 suite 步），workflow 兜底路径（fan-in-execute.js）是次要面。

## Proposal

**现象（manager 实读，outer 读码复核）**：`gap-suite-lock-starvation-long-validation-hold` 全量轮 `exit=1`（1 个已知 flaky fail），但 `/tests` 页面显示最近全绿（#628 等）。`verification-round.jsonl` 全文件搜「lock-starvation」=0 命中（628 行有效 JSON）。

**根因（读码确认，非猜测）**：
```
① fan-in-execute.js 注释「step 4.5 全绿后 # suite-record-block 写」⇒ record 写入块挂在 suite_exit=0 后，
   红色分支走不到
② 唯一 writer pre-verified-round-record.ts 字面量写死 state:"green"（:31/:76 注释自认
   「both fan-in branches only write after suite_exit=0」）
③ /tests 读的正是 verification-round.jsonl（observation.ts:2514 VERIFICATION_ROUND_REL）
```

**更深一层（人 2026-08-26 逐字指正 + manager 追查的架构线索）**：这不仅是「writer 该不该记红」，
而是**两套平行机制**——fan-in 桶路径（`.claude/workflows/fan-in-execute.js:239` 那段 `setsid bash scripts/test.sh`
detached harness）**绕开了正确的 runner**，自己另起一套 ad-hoc 直跑 + 单独嫁接一个只认 green 的窄 writer：

```
plugin/scripts/full-suite-runner.ts:1627  已原生支持 --buckets <task-id>（gap-ac124-suite-bucket-production-carrier-benefit）
  —— 内部转成 `bash scripts/test.sh --buckets <id>`，__BUCKETS__ marker 正确带入 round 记录，
  且它本就是【同时记录 green 与 red】的那个正确 writer（appendVerificationRound / runner-state-write.ts，
  SuiteStateValue = "running" | "green" | "red"）
  但 —— grep 全仓库：fan-in 路径【从未调用】full-suite-runner.ts --buckets（唯一出现是它的定义处）
```

**人裁定（逐字）**：「改进的方向应当是"定义正确的机制并实现"，而不是做修修补补。真正定义正确应当记录的是什么和应当展示的是什么，并实现正确。」

⇒ **本条不修那个窄 writer。** 正确的机制是：fan-in 桶路径**应当通过 `full-suite-runner.ts --buckets <task>` 跑**（它已经存在、已经正确记录 green+red、已经带 __BUCKETS__ marker），而不是维护第二套平行 harness + green-only writer。

**硬规则 3b 形状**：只在成功时写的账本，把「没跑过」和「跑了但红了」伪装成同一种外观（都「无记录」）。危害非理论：任何人拿 `/tests` 判「最近是否都健康」，都会漏掉所有 fan-in 桶路径上的真实红。

**与 done 任务不重叠**：`gap-preverified-suite-bypasses-verification-round-ledger`（done）修的是 pre-verified 分支「复用 capture 跳重跑」时绿结果不入账（suite_exit 隐含 0）。本条修的是「真跑了但红了」的红结果不入账，且根因更深（平行 harness 绕开正确 runner），非那条任务的验收范围。

## Plan

1. **先定义正确的机制（人裁定，⛔ 不可跳过）**：fan-in 桶路径的正确形态 = 通过 `full-suite-runner.ts --buckets <task>` 跑（复用其单飞锁 / resource-gate / green+red 记录 / __BUCKETS__ marker），而非 `setsid bash scripts/test.sh` 直跑 + 窄 writer 嫁接。
2. **保留 fan-in detached harness 的真实约束**（⛔ 不得因统一而丢）：cross-relaunch 存活（调用方会话重启不杀 suite）、回合预算（不在 agent turn 内同步等 ~40min）、`/tmp/fan-in-suite-<task>.{log,exit,pid,time}` 跨 relaunch 进度文件。实现方须判断：`full-suite-runner.ts --buckets` 以 detached 形态跑（`setsid node full-suite-runner.ts --buckets <task> ... & disown`）能否同时满足这三条；不能则**写明哪条不可满足及为何**（不得静默退回窄 writer 补丁）。
3. 若统一不可行（给出不可行的机械理由，非「嫌麻烦」），退而求其次也必须让 detached harness 通过**同一正确 writer**（appendVerificationRound）记 green+red——但这是**后备**，非首选。
4. `.claude/workflows/` 与 `plugin/workflows/` 双副本逐字节一致（dual-copy drift gate）。

## Acceptance Criteria

- [ ] AC1（能取假，记录定义正确）：一次跑红的 fan-in 桶路径落地，在 verification-round.jsonl 产生一条 `state=red` 记录（真实 suite_exit + fail 计数 + __BUCKETS__ marker）；（⛔ 仍无记录 / 记绿 ⇒ 假）。
- [ ] AC2（能取假，机制正确——统一非补丁）：fan-in 桶路径通过 `full-suite-runner.ts --buckets <task>` 跑并记录，而非平行 `setsid bash scripts/test.sh` harness + green-only writer；若保留 detached harness，须给出「为什么 full-suite-runner.ts detached 形态不可用」的机械理由并仍走同一正确 writer；（⛔ 仍是无理由的平行 green-only writer ⇒ 假）。
- [ ] AC3（能取假，展示定义正确）：`/tests` 页面（verification-round 消费者）显示红轮次（state=red 记录可见）——账本是完整真相，非 green-only 视图；（⛔ 红仍被隐藏 ⇒ 假）。

## Definition of Done

fan-in 桶路径统一到正确 runner（full-suite-runner.ts --buckets），green+red 都入账；AC1-AC3 全勾；「没跑过」与「跑了但红」在账本与 /tests 上可区分；两套平行机制收敛为一。

## Touches

- plugin/scripts/worker-driver.ts（机械路径 suite 步统一到 full-suite-runner.ts --buckets，主修复面）
- .claude/workflows/fan-in-execute.js（兜底路径桶路径改走 full-suite-runner.ts --buckets，删/收窄平行 detached harness + green-only writer）
- plugin/workflows/fan-in-execute.js（dual-copy 同步，逐字节一致）
- plugin/scripts/pre-verified-round-record.ts
- plugin/test/worker-driver.test.mjs（机械路径红轮入账测试）
- plugin/test/fan-in-execute-paths.test.mjs
- plugin/test/full-suite-runner.test.mjs
- tasks/gap-fan-in-red-bucket-run-not-recorded.md（自身）
