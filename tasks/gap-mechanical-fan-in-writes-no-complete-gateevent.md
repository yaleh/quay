---
id: gap-mechanical-fan-in-writes-no-complete-gateevent
title: 机械 fan-in 不写 complete GateEvent——delivery-critical AC2「loop 完成路径写
  GateEvent」经 08-27 新路径回归，唯一发现它的仪器被当噪声
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky
---
**type:** execution

## Proposal

**实测（2026-09-02）**：`plugin/scripts/worker-driver.ts` 全文 `GateEvent|gate-event` 命中数 = **0** ⇒ 机械 fan-in（`runMechanicalFanIn` / `flipTaskDone`，`:3277-3285` 翻 done 后 `:3289` ff）**完全不经 gate 引擎、不写任何 GateEvent**。

**这不是「QENG 已退役所以无所谓」——gate 引擎仍在活跑**。`.quay/gate-events.jsonl` 事件类型分布：`retreat 48 / dod 48 / promote 46 / complete 10 / acceptance 6`，最近一条 `retreat` 写于 **2026-09-02T08:13:39Z**（今天）。**唯独 `complete` 这一路被绕过**：全库仅 10 条，而近一周经机械 fan-in 翻 done 的任务有 163 条。**且全仓 `tasks/` `adr/` 中查不到任何裁定 QENG complete 退役的记录**（只有 tick-log 里的散文提及，不是裁定）。

**这是一次回归，且有明确的在先裁定**：`gap-loop-completion-path-produces-zero-gateevents`（**status: done，labels 含 `delivery-critical`**）的 AC2 逐字为「**loop 完成路径写 GateEvent**——loop 完成任务（fan-in + status done）经与 CLI 一致的 gate 引擎，写 `complete` pass 事件」，已勾选。该任务修的是 2026-08-12 的旧完成路径；**2026-08-27 上线的机械 fan-in 是一条新路径，把同一个洞重新打开了**——修好一个实例 ≠ 该原则只在那一处（硬规则 5b）。

**唯一发现它的仪器正被当成噪声**：`plugin/scripts/stale-ready-audit.ts` 的 `bypassComplete` 分支（检测「done ≤6h 且无 complete-pass GateEvent」）当前每跑必报 9 条：`gap-continue-prompt-delta-relatedness-note`、`gap-fan-in-suite-log-same-runid-overwrite`、`gap-outer-session-check-waitforclaude-timeout-flaky`、`gap-periodic-push-backup-ac2-divergent-reject`、`gap-quay-init-escalations-vendor-freshness-false-positive`、`gap-runner-grouping-list-groups-perfile-timeout-flaky`、`gap-sea-artifact-consumer-e2e-ac4-assertion`、`gap-worker-driver-restart-orphan-no-outcome-no-timeout`、`gap-worker-premerge-scoped-gate-cache`。**本次调查曾把这 9 条判为「100% 假阳性 / 仪器故障」，该判断错误**——按仍然有效的 AC2 裁定，它们是**真阳性**：仪器正确检测到回归，而读它的人（含本次调查）把信号当噪声解释掉了（硬规则 4 推论四：能解释现象的说法不是被检验的结论）。

**修法方向（默认取①，但②需先被显式否决）**：
- **① 恢复 AC2（默认）**：机械 fan-in 的 flip-done 步骤经 gate 引擎写 `complete` pass 事件（复用既有 `gate-event-store`，不手搓 append）。理由：AC2 是仍然有效的 `delivery-critical` 裁定，且 `retreat/dod/promote` 三路都还在写，`complete` 单路缺席是不一致而非设计。
- **② 若认为 QENG complete 确应退役**：那必须**显式裁定并记录**，同时把 `bypassComplete` 判据一并退役或改判——**不允许维持现状**（现状 = 一条有效 AC 在生产上不成立，且检测它的仪器每轮报 9 条无人相信，两个坏处同时存在）。

**本条的产出必须先落在①/②之间的裁定上，再落实现**——AC1 就是这个裁定点。

**相关任务（非重复）**：`gap-loop-completion-path-produces-zero-gateevents`（done，同一原则的旧路径实例，本条是新路径实例）；`gap-gate-event-store-concurrency`（事件存储并发，不同机制）。

## 方向裁定（AC1）

**取①——恢复 AC2：机械 fan-in 翻 done 后经既有 gate-event-store 写 `complete` pass 事件。** 选择理由：

1. `gap-loop-completion-path-produces-zero-gateevents` 的 AC2 是仍然有效的 `delivery-critical` 裁定，全仓 `tasks/` `adr/` 无任何退役记录；
2. `.quay/gate-events.jsonl` 里 `retreat/dod/promote/acceptance` 四路都还在写，唯独 `complete` 缺席——是新路径回归导致的不一致，不是设计；
3. 检测它的仪器（`stale-ready-audit.ts` 的 `bypassComplete`）报的是**真阳性**（9 条都是机械 fan-in 翻 done 但零 complete 事件）——修写侧（①）比退役仪器（②）更省面、且与既定裁定一致；
4. 取②需要一次新的显式裁定并同步退役/改判 `bypassComplete`，会让一条仍有效的 AC 与检测器互相矛盾——本任务不取②。

## Acceptance Criteria

- [x] AC1: **方向裁定落痕**——①（补写事件）或 ②（退役 complete 闸 + 同步退役 bypassComplete 判据）二选一的结论写进本任务体，含选择理由；未裁定不得开始实现（裁定见上方「方向裁定（AC1）」：取①）
- [x] AC2: **按裁定实现**——若取①：`worker-driver.ts` 机械 fan-in 路径写 `complete` pass GateEvent，且经既有 gate-event-store（`grep -c "GateEvent\|gate-event" plugin/scripts/worker-driver.ts` 由 0 变为 ≥1，打印命中行）；若取②：`stale-ready-audit.ts` 的 `bypassComplete` 分支被退役或改判，且退役理由写进脚本头注释（命中行见 Evidence）
- [ ] AC3: **真实生产载体验证（非 fixture）**——实现落地**之后**跑一次真实机械 fan-in，`.quay/gate-events.jsonl` 中该 task 的 `complete` pass 事件存在（取①）；或 `stale-ready-audit.ts` 对同一批真实任务不再报出该分支（取②）。**N 只计实现落地之后的时间窗**（硬规则 4 推论三）（待外部）
- [x] AC4: **负控制（能取假）**——取①时：关闭写事件的那一行后重跑，`bypassComplete` 必须重新报出该任务；取②时：对一个已知带 complete-pass 事件的历史任务干跑判据，必须不报（负控制输出见 Evidence）
- [x] AC5: **仪器三态**——`bypassComplete` 分支输出能区分「查过且无问题」「查过且有问题」「读不到 gate-events.jsonl ⇒ NOT-EVALUATED」三态，不得让「读不到」与「无问题」同形（硬规则 3b）（三态输出见 Evidence）
- [ ] AC6: **既有不回归**——`--for-task` scoped 门 + 全量 suite 绿；CLI 路径的 gate 事件（`retreat/dod/promote/acceptance`）计数不减少（待外部）

## Evidence

**AC2（实现 + grep 命中行）**：`worker-driver.ts` 新增 `appendCompleteGateEvent`（动态 import 既有 `gate-event-store.ts` 的 `appendGateEvent`，经 `repo-root.ts` 单一真相源解析模块路径），并在 `runMechanicalFanIn` ff 成功后调用。`grep -c "GateEvent\|gate-event" plugin/scripts/worker-driver.ts` 由 **0 → 13**，命中行（前 3 + 关键）：

```
2852:/** gap-mechanical-fan-in-writes-no-complete-gateevent — 机械 fan-in 翻 done 后经既有 gate-event-store
2853: *  写 `complete` pass GateEvent（恢复 gap-loop-completion-path-produces-zero-gateevents AC2 在新路径上
2868:    appendGateEvent(path.join(root, ".quay", "gate-events.jsonl"), {
3342:    const gateEvent = await appendCompleteGateEvent(root, task);
```

**AC3（机制已证，生产载体待外部）**：`worker-driver-fan-in.test.mjs` 集成测试「landed mechanical fan-in writes a complete pass GateEvent」实跑 `runMechanicalFanIn` 到 landed，断言 `.quay/gate-events.jsonl` 出现该 task 的 `complete` pass 事件（`actor:"quay-driver"`、`payload:{from:"ready",to:"done"}`）——真实 gate-event-store + 真实 `.quay/gate-events.jsonl` 载体（非 fixture 注入）。**生产载体（主检出 `.quay/gate-events.jsonl` 里实现落地之后的那条）留待驱动/外层跑下一次真实机械 fan-in 验证（待外部）**。

**AC4（负控制）**：`worker-driver-fan-in.test.mjs`「AC4 negative control」证明 `appendCompleteGateEvent` 是事件的唯一来源（删事件 ⇒ 载体空）。另用真实 `stale-ready-audit.ts` 干跑：done 任务 + complete 事件 ⇒ `bypassComplete:[]`；删掉事件（= 关闭写事件的那一行）重跑 ⇒ `bypassComplete:[gap-x]`、exit 1。输出：

```
# positive
{"staleReady":[],"bypassComplete":[],"count":0,"gateLogReadable":true}
# negative（关闭写事件）
{"staleReady":[],"bypassComplete":[{"id":"gap-x",...}],"count":1,"gateLogReadable":true}  (exit 1)
```

**AC5（三态）**：`stale-ready-audit.ts` 新增 `gateLogReadable` 三态。真实干跑三态：① 读不到 ⇒ `gateLogReadable:false` + 人读 `BYPASS-COMPLETE NOT-EVALUATED — …`；② 读得到且 clean ⇒ `gateLogReadable:true` + `bypassComplete:[]`；③ 读得到且有 bypass ⇒ `gateLogReadable:true` + `bypassComplete:[…]`。`stale-ready-audit.test.mjs` 5/5 绿（含新增两条三态用例）。

**AC6（部分）**：改动只新增 worker-driver 的补写路径、不触碰 CLI lifecycle / gate-event-store 写面 ⇒ CLI 路径 gate 事件计数结构上不减少（`retreat/dod/promote/acceptance` 计数不变）。`--for-task` scoped 门 + 全量 suite 绿由 fan-in driver / 外层 verification-round 验证（待外部）。

**测试**：`stale-ready-audit.test.mjs` 5/5、`worker-driver-fan-in.test.mjs` 64/64 绿（含 2 条新增）。

**Fan-in 阻塞（第四次 suite-red，2026-09-03）**：全量 suite 红与本案改动无关——3 个 `@load-sensitive` session-liveness probe 测试确定性失败（连续多轮同签名）：① `session-liveness-scd-inflight-changing`（lowconc）`worktree add wt-2 … No such file or directory`＝`gap-session-liveness-worktree-fixture-repo-vanishes` 残留（`dirContainsGitRepo` 未覆盖实际删除路径）；② `session-liveness-restart`（engine，~211s）与 ③ `session-liveness-scd-busy`（lowconc，~212s）＝probe 饿死超时。re-triage `01374fbad` 声称「probe 饿死 + worktree add 失败两类根因全根治」但零代码改动（仅 3 个 task 状态翻转）⇒ 根治不成立，独立缺陷需另行立案。本案 `--for-task` scoped 门已绿（历轮均至 step=suite 才红）。

**Fan-in 阻塞（最新 suite-red，2026-09-03 02:02，d8c07e）**：本次 3 个失败是 `packages/quay-native/test/` 的 `cas-write`/`create-validation`/`edit-validation`——**三者逐一 solo 均 EXIT=0 绿**（本 worker 实跑核验）⇒ 与「第四次」的 session-liveness probe 签名不同，但同属**负载诱发 flaky**（`@load-sensitive` probe 占槽 ~215s 饿死 quay-native 子进程测试，与 `9f0d69ca9` 人裁定「不为 session-liveness 家族立案」同一家族）。`--for-task` scoped 门与 `worker-driver-fan-in` 64 条、`stale-ready-audit` 5 条单测均绿；suite 红与本案改动无关。

**合并 develop 后（本 worker 实测）**：本分支已 `git merge develop` 并解决 `worker-driver-fan-in.test.mjs` 的 import 列表冲突（语义并集：本案 `appendCompleteGateEvent` ∪ develop `judgeRetryExemption`/`extractFirstFailureLine` 等）。合并后全文件顺序跑，develop 侧新增集成测试「AC1 (能取假) — suite 红 needs-human 记录含真实 AssertionError 原文」（`extractFirstFailureLine` 接线）**全顺序红（actual `'suite red'`）、`--test-name-pattern` 单独跑绿** ⇒ order-dependent 隔离缺陷，属 develop 侧新增测试（`05b980b89`），非本案代码；根因未深究（develop 侧缺陷，不在本案 Touches）。本案自身 2 条新增单测与 `stale-ready-audit` 5 条均绿。

**Fan-in 阻塞（2026-09-03 03:48 第五次 suite-red；needs-human 判词显示 split-or-commit 属误报）**：`extractFirstFailureLine` 的失败信号正则 `\bchecked\b` 误匹配 check 头部 task-id `gap-split-or-commit-not-continuously-checked`（"continuously-checked" 里的 "-checked" 被当「checked 判词」）⇒ needs-human「失败步/判词」显示 `== split-or-commit whole-store check ==`，而 split-or-commit 实为 **PASS**（1711 任务零违规，03:48 日志 line 208）。真实失败仍是 session-liveness probe 饿死（restart/scd-busy）+ quay-native `cas-write`/`create-validation`/`edit-validation` 三例（与既往同族）。本 worker 实跑核验：split-or-commit 对 worktree 与主检出均 PASS；`stale-ready-audit` 5/5、`worker-driver-fan-in` 74/74 单测绿。正则缺陷属 develop 侧 `05b980b89`（gap-needs-human-note-missing-real-error-line），非本案改动，建议另行立案。

## Definition of Done

真实运行的机械 fan-in 在 `.quay/gate-events.jsonl` 里留下了 `complete` pass 事件（取①），或 `bypassComplete` 判据已被显式退役且退役裁定写进脚本头注释与本任务体（取②）——**判据落在生产载体上，不是落在测试或 fixture 上**；AC4 的负控制输出已贴出，证明该判据能取假；`gap-loop-completion-path-produces-zero-gateevents` 的 AC2 在新路径上重新成立（取①）或被显式撤销（取②），两条任务之间不再互相矛盾；改动经 fan-in 落到 develop 并可 `git show develop:` 核验。

## Touches

- plugin/scripts/worker-driver.ts（机械 fan-in flip-done 步骤写 complete GateEvent，或记录取②的裁定）
- plugin/scripts/stale-ready-audit.ts（bypassComplete 分支：三态输出 / 按裁定退役或改判）
- plugin/test/worker-driver-fan-in.test.mjs（机械 fan-in 写事件断言 + 负控制）
- plugin/test/stale-ready-audit.test.mjs（bypassComplete 判据三态断言）
- tasks/gap-mechanical-fan-in-writes-no-complete-gateevent.md（自身）

## Needs-Human

**执行 2026-09-02T12:59:29.560Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red
- run_id：wk-prod-1788285192
- session_id：dbd0b0a4-45fd-46d5-8ec1-3488cb6b2fef
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-mechanical-fan-in-writes-no-complete-gateevent~wk-prod-1788285192~1788352862327-c35643.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-mechanical-fan-in-writes-no-complete-gateevent-wk-prod-1788285192.log

## Needs-Human

**执行 2026-09-02T23:08:16.544Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red
- run_id：wk-prod-1788285192
- session_id：1f5362a3-96dd-4457-934c-140d527f9eba
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-mechanical-fan-in-writes-no-complete-gateevent~wk-prod-1788285192~1788390078441-bf466e.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-mechanical-fan-in-writes-no-complete-gateevent-wk-prod-1788285192.log

## Needs-Human

**执行 2026-09-03T02:02:45.840Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red
- run_id：wk-prod-1788285192
- session_id：17a6cba7-680b-4058-a4f9-38da5a508940
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-mechanical-fan-in-writes-no-complete-gateevent~wk-prod-1788285192~1788400494179-d8c07e.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-mechanical-fan-in-writes-no-complete-gateevent-wk-prod-1788285192.log
