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

## Definition of Done

真实运行的机械 fan-in 在 `.quay/gate-events.jsonl` 里留下了 `complete` pass 事件（取①），或 `bypassComplete` 判据已被显式退役且退役裁定写进脚本头注释与本任务体（取②）——**判据落在生产载体上，不是落在测试或 fixture 上**；AC4 的负控制输出已贴出，证明该判据能取假；`gap-loop-completion-path-produces-zero-gateevents` 的 AC2 在新路径上重新成立（取①）或被显式撤销（取②），两条任务之间不再互相矛盾；改动经 fan-in 落到 develop 并可 `git show develop:` 核验。

## Touches

- plugin/scripts/worker-driver.ts（机械 fan-in flip-done 步骤写 complete GateEvent，或记录取②的裁定）
- plugin/scripts/stale-ready-audit.ts（bypassComplete 分支：三态输出 / 按裁定退役或改判）
- plugin/test/worker-driver-fan-in.test.mjs（机械 fan-in 写事件断言 + 负控制）
- plugin/test/stale-ready-audit.test.mjs（bypassComplete 判据三态断言）
- tasks/gap-mechanical-fan-in-writes-no-complete-gateevent.md（自身）
