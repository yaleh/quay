---
id: gap-telemetry-brackets-vs-subagents-no-slot-visibility
title: "telemetry in-flight brackets do NOT reflect real concurrency — 5 bracket-holders in-flight (cold-start-key4/ready-pool-floor/red-window/nbsp-fix/session-idle, startedAt 05:19-08:28, all stale red-window leftovers) while the inner actually runs 1 subagent (pane ← 1 agent), so '11 dispatchable slots idle vs 1 running' is INVISIBLE to both layers: the fast-mode-loop-tick state-self-check item ① reads telemetry inProgress[] ≤ 3 (cap) but brackets ≠ subagents (the orchestrator-tick 4b distinction is documented yet the self-check still uses brackets) — the check is DEAD for concurrency (5 brackets ≤ 3 false; even at cap, 5 > 3 would false-RED a healthy 1-agent state); manager measured: telemetry --report in-flight=0 (all outcome-closed) while pane shows ← 1 agent just fan-in'd nbsp-fix — the --task-start/--task-end pair is NOT called in the current dispatch path, telemetry degraded to a historical archive that no longer reflects current state; the only remaining view (batch2-queue-state.md) is hand-written narrative markdown not structural slot state; this is the FOURTH 'writer exists but nobody calls' instance tonight (loop-driver.jsonl no-writer / blocked-signal 90min unconsumed / verification-round.jsonl stopped 05:03), and the COSTLIEST — it directly gates throughput; fix direction: (a) confirm WHO calls --task-start/--task-end in the dispatch path and restore it; (b) self-check item ① is currently a VACUOUS check (in-flight always ≤ 3 trivially — either 0 or stale-brackets), worth its own note because it lets any future concurrency violation pass silently; AC10: +1 => 6->7, pre-friction (nothing hurting — no failure, suite running, inner working, telemetry command exits 0; found by asking the generator 'what range does this criterion quantify' → answer: HISTORY not CURRENT)"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者（2026-08-05）——**比「前台空等」更根本的诊断：不是纪律问题，是观测缺失**。请判断立案。

**【三个实测】**
1. **池子**：pool 26 / floor 12 / dispatchable_disjoint **12** / criterion_met true；todo 93、ready 32。
   ⇒ 有 12 个互不相交、立即可派发的任务在排队，并发上限是 3，实际在飞 1 个。
2. **外层能不能看到内层的在飞数/空槽——不能，机制是断的**：状态自检清单第①项明写查遥测
   `inProgress[]` 长度 ≤ 3（步骤 4 并发上限）。实测三条：(a) `.quay/fast-mode-telemetry.jsonl`
   **不存在**；(b) `--report --json` 有 99 条记录但 **in-flight = 0**（全部 outcome 已闭合）；
   (c) 同一时刻内层 pane 显示 `← 1 agent`、刚 fan-in 完 nbsp-fix。⇒ 遥测报 0 而实际有 1，
   **--task-start/--task-end 这对调用在当前派发路径里根本没被调用**，遥测退化成历史归档。
   唯一还能看的 batch2-queue-state.md 是内层手写的叙事 markdown，不是结构化槽位状态。
3. **因此那个落差没有任何一方看得见**：12 个可派发 vs 1 个在飞 = 11 个槽位级闲置。内层不主动把
   todo 写成 ready（上轮报），外层看不到槽位空着（这轮测出）——**两边都不知道有浪费**。

**【外层核实——部分与管理者不符，需澄清但核心成立】**
- 外层实测 inProgress **= 5**（非 0）：cold-start-key4 / ready-pool-floor / red-window / nbsp-fix /
  session-idle 都有括号在飞，startedAt 05:19-08:28。**遥测机制在记录**（nbsp-fix 的 task-start 08:28
  已写进 fm-*.jsonl）。
- 但**核心论断成立**：5 个括号在飞全是**红窗遗留的未闭合 start**（startedAt 05:19-08:28），内层实际
  只 1 个 agent 在跑。**遥测括号 ≠ subagent 在飞**（orchestrator-tick 4b 明确区分，但状态自检①仍用
  括号）⇒ **「还剩几个并发槽」机械不可判**。这正是管理者的核心：**in-flight 数字与实际空槽脱节**。

**【为什么最贵】第四个「写入方存在但无人调用」实例**（loop-driver.jsonl 无写入者 / blocked-signal
90min 没人消费 / verification-round.jsonl 停 05:03），且**最贵**——直接决定吞吐。11 个槽位级闲置是
今晚最大的浪费，而没有任何一方能看到。

### 选定机制（外层裁定：立案，与观测族并列）

1. **(a) 恢复 --task-start/--task-end 调用**：确认派发路径哪一步该调用，补回去——遥测从「历史归档」
   变回「当前状态」（nbsp-fix 08:28 有 start 说明部分路径在调，但 red-window 遗留的 5 个未闭合证明
   闭合路径断了）。
2. **(b) 状态自检①是恒真空检查**：in-flight 恒为 0 或恒为红窗遗留括号 ⇒ `≤ 3` 永远成立——它不是判据、
   是装饰。**单独记**：任何未来并发违规都会静默通过。
3. **观测补真槽位**：遥测 in-flight 与真实 subagent 数对齐（括号闭合 + 空槽可见），让「还剩几个槽」
   机械可判——外层不再依赖内层手写叙事。
4. **AC10 记账：+1 ⇒ 6 → 7**——pre-friction（无失败/告警、套件在跑、内层在干活、遥测命令 exit 0），
   照生成器问句「这条判据量化什么范围」→ 答案：**历史不是当下**。

## Acceptance Criteria

- [ ] AC1: **遥测括号与真实 subagent 对齐**——inProgress[] 反映真实并发（红窗遗留的未闭合 start 被
       reconcile/闭合；nbsp-fix 类新任务正确记录）
- [ ] AC2: **空槽机械可见**——外层能从遥测（或等价结构信号）读出「还剩几个并发槽」，不再依赖内层
       手写叙事 markdown
- [ ] AC3: **状态自检①从装饰变判据**——in-flight 反映真实在飞（不再恒真）；并发违规能被判据抓住
       （5 个遗留括号 > cap 3 不应误判健康态，1 个真实 agent 不应误判满负荷）
- [ ] AC4: **--task-start/--task-end 调用恢复**——派发路径在派发/收尾时正确调用这对（遥测从历史归档
       变回当前状态；阻塞信号消费族同源）
- [ ] AC5: **回归控制**——今晚形态（5 红窗遗留括号 + 1 真实 agent）下，外层能看到「11 槽位闲置」而非
       「满负荷」或「空」（实测输出贴任务体）
- [ ] AC6: **AC10 诚实记账**——pre-friction（无东西在疼），计 +1 ⇒ 6 → 7
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC5 实跑输出贴任务体
- [ ] 遥测反映当前状态（非历史归档）；空槽机械可见；状态自检①是判据非装饰
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/fast-mode-telemetry.ts（reconcile 红窗遗留 + 括号闭合 + 空槽信号）
- plugin/loop/fast-mode-loop-tick.md（状态自检①：in-flight 从括号改为真实并发信号）
- plugin/loop/orchestrator-loop-tick.md（步骤 4b：括号 vs subagent 的机械区分落地到自检）
- tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md（AC6 记账引用）

## Contract

measure   slot_visibility = `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json` stdout 的 inProgress 数
band      slot_visibility = 真实并发（红窗遗留 reconcile 后 ≤ cap；与 pane ← agent 对齐）
invariant brackets_reflect_subagents = 1（in-flight 括号数与真实 subagent 数一致，非恒 0/恒 5）
invoke    `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json`
control   构造 5 红窗遗留括号 + 1 真实 agent ⇒ 空槽可见为 2 非「满负荷」（AC5）；reconcile 后括号闭合
resume    遥测对齐与自检修正分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T08:5xZ
changed: 外层受管理者（比「前台空等」更根本的观测缺失）裁定立案。四处收紧：
(1) **核心坐实**——11 槽位级闲置无人可见；遥测括号(5 红窗遗留)≠subagent(1)，空槽机械不可判；
    --task-start/--task-end 在当前派发路径未正确调用，遥测退化历史归档；
(2) **最贵的观测族实例**——第四个「写入方存在无人调用」且直接决定吞吐；
(3) **自检①是恒真空检查**——in-flight 恒 ≤3 恒真，是装饰非判据，任何并发违规静默通过；
(4) **AC10 +1 ⇒ 6→7**——pre-friction（照生成器问句发现，量化的是历史不是当下）。
status: todo——观测缺失直接决定吞吐；排 ROUND 3 收尾后，高优先。
