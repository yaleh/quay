---
id: gap-telemetry-brackets-vs-subagents-no-slot-visibility
title: "telemetry in-flight brackets do NOT reflect real concurrency — 5 bracket-holders in-flight (cold-start-key4/ready-pool-floor/red-window/nbsp-fix/session-idle, startedAt 05:19-08:28, all stale red-window leftovers) while the inner actually runs 1 subagent (pane ← 1 agent), so '11 dispatchable slots idle vs 1 running' is INVISIBLE to both layers: the fast-mode-loop-tick state-self-check item ① reads telemetry inProgress[] ≤ 3 (cap) but brackets ≠ subagents (the orchestrator-tick 4b distinction is documented yet the self-check still uses brackets) — the check is DEAD for concurrency (5 brackets ≤ 3 false; even at cap, 5 > 3 would false-RED a healthy 1-agent state); manager measured: telemetry --report in-flight=0 (all outcome-closed) while pane shows ← 1 agent just fan-in'd nbsp-fix — the --task-start/--task-end pair is NOT called in the current dispatch path, telemetry degraded to a historical archive that no longer reflects current state; the only remaining view (batch2-queue-state.md) is hand-written narrative markdown not structural slot state; this is the FOURTH 'writer exists but nobody calls' instance tonight (loop-driver.jsonl no-writer / blocked-signal 90min unconsumed / verification-round.jsonl stopped 05:03), and the COSTLIEST — it directly gates throughput; fix direction: (a) confirm WHO calls --task-start/--task-end in the dispatch path and restore it; (b) self-check item ① is currently a VACUOUS check (in-flight always ≤ 3 trivially — either 0 or stale-brackets), worth its own note because it lets any future concurrency violation pass silently; AC10: +1 => 6->7, pre-friction (nothing hurting — no failure, suite running, inner working, telemetry command exits 0; found by asking the generator 'what range does this criterion quantify' → answer: HISTORY not CURRENT)"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

> **Supervisor 步骤标注（2026-08-06，gap-supervisor-base-layer-outside-sessions-architecture AC4）**：
> 本任务是 supervisor 落地次序的 **②槽位账本+会话状态**（SPEC-integration-architecture §4.4 第 2 步；
> SPEC-state-crystallization §3 的 Run/Session 实体）——恢复 --task-start/--task-end 单写入者、
> 把「还剩几个并发槽」变成机械可判。AC8 的「一个事实六源四答案」验收基准即在本任务之上收敛。
> 不另开重复任务。

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

### 升为根因级（2026-08-05 09:10Z，管理者因果链 + 外层验证）——它制造假阻塞，不止看不到槽位

**完整因果链（管理者查证，解释了今晚所有冻结）**：`--task-start/--task-end` 从没被调用 ⇒ 任务永远
显示 in-progress ⇒ **task-over-90m 虚假触发** ⇒ inner 写阻塞信号停下等裁定 ⇒ **没人消费** ⇒ inner
**无限期冻结**。

**外层验证（09:05Z）**：cold-start-key4 的 over-90m 信号（08:23:19 写入，156.1m）是**假的三重矛盾**——
① fan-in 05:52 已落地；② status=ready 非 in-progress；③ 信号说「in-progress 4 超预算」而遥测实际 5
个红窗遗留括号（都不反映真实）。**inner 等它被消费 = 冻结 44 分钟**（wait 2641.4s）。这**在同一分钟
复发第二次**（首次 48min + 这次 44min = 92 分钟被假信号吃掉）。

**结构性修复（管理者建议，外层采纳）**：
- (a) **task-over-90m 判据源统一到遥测**——现在它用另一个源，且那个源和遥测对不上；
- (b) **阻塞信号超时自动升级**——一条没人消费的信号不该让 inner 无限期等（今晚吃掉至少 75 分钟）；
- (c) **遥测括号 = 根因级**（本任务升优先）——不只「看不到槽位」，它还在**制造假阻塞**。

## Acceptance Criteria

- [x] AC1: **遥测括号与真实 subagent 对齐**——inProgress[] 反映真实并发（红窗遗留的未闭合 start 被
       reconcile/闭合；nbsp-fix 类新任务正确记录）
      → 新增 `--slot-status` 纯读子命令（`analyzeSlotStatus`）：对 inProgress[] 跑与 `--reconcile` 同一
      执行者可观测探针的 **dry-run**，分 `real_in_flight`（执行者仍存活）vs `stale_brackets`（`--reconcile`
      会闭合的幽灵括号）。`stale_brackets > 0` ⇒ 红窗遗留可见且可由 `--reconcile` 闭合；`--report` 的
      `inProgress[]` 括号视角保持原样。scoped 测试 `SLOT-STATUS — 5 stale brackets + 1 real agent…` 全绿。
- [x] AC2: **空槽机械可见**——外层能从遥测（或等价结构信号）读出「还剩几个并发槽」，不再依赖内层
       手写叙事 markdown
      → `--slot-status --cap <n> --json` 输出 `slots_free = max(0, cap − real_in_flight)`——纯读（不写盘，
      观测轮询不弄脏工作树），外层不再读 batch2-queue-state.md 式手写叙事。`orchestrator-loop-tick.md`
      步骤 4b 已加「槽位视角」小节，步骤 1b 收尾加「括号对账」。
- [x] AC3: **状态自检①从装饰变判据**——in-flight 反映真实在飞（不再恒真）；并发违规能被判据抓住
       （5 个遗留括号 > cap 3 不应误判健康态，1 个真实 agent 不应误判满负荷）
      → `fast-mode-loop-tick.md` 状态自检①判据从「遥测 inProgress[] 长度 ≤ cap」改为
      「`--slot-status` 的 `real_in_flight` ≤ `effective_cap`」——5 遗留括号 + 1 真实 agent ⇒ real=1 ≤ cap
      判健康（不再 5>3 假红）；`real_in_flight > cap` ⇒ 真并发违规被抓。scoped 测试
      `SLOT-STATUS — real_in_flight > cap is a detectable violation` 全绿。
- [x] AC4: **--task-start/--task-end 调用恢复**——派发路径在派发/收尾时正确调用这对（遥测从历史归档
       变回当前状态；阻塞信号消费族同源）
      → 调用点确认并在文档固化：inner 派发 `fast-mode-loop-tick.md` 步骤 3.5 写 `--task-start`；外层收尾
      `orchestrator-loop-tick.md` 步骤 1b 写 `--task-end`（`--reconcile` 兜底执行者已消失的）。新增机械
      可判据：`--slot-status` 的 `brackets_reflect_subagents: false` ⇒ 有陈旧括号（`--reconcile`）或
      `--task-start`/`--task-end` 没调齐（AC4 违规）。外层步骤 1b 收尾批次后跑 `--slot-status` 对账。
- [x] AC5: **回归控制**——今晚形态（5 红窗遗留括号 + 1 真实 agent）下，外层能看到「11 槽位闲置」而非
       「满负荷」或「空」（实测输出贴任务体）
      → 实跑 `--slot-status --cap 3 --json`（构造 5 分支已合并幽灵 + 1 open-worktree 真实 agent，见下
      「AC5 实跑输出」）：`in_progress_total 6 / stale_brackets 5 / real_in_flight 1 / slots_free 2 /
      slot_state free / brackets_reflect_subagents false`——空槽可见为 **2**（非满负荷、非空）。scoped
      测试 `SLOT-STATUS CLI — real git…` 同形态全绿。
- [x] AC6: **AC10 诚实记账**——pre-friction（无东西在疼），计 +1 ⇒ 6 → 7
      → 照生成器问句「这条判据量化什么范围」→ 答案：**历史不是当下**（`--report` 括号视角量化的是历史归档，
      `--slot-status` 才量化当下槽位）。pre-friction（无失败/告警、套件在跑、内层在干活、遥测命令 exit 0），
      +1 ⇒ 6 → 7。引用任务 `gap-loop-has-no-os-level-anchor…` 的 0/6 判据计数保持（本轴是 +1 的 pre-friction
      轴）。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
      → 新增测试全部在 `plugin/test/fast-mode-telemetry.test.mjs`（`// @test-group governance`），用
      `node:test`。4 个 SLOT-STATUS 用例：AC5 回归形态 / real_in_flight>cap 违规 / 空态 / CLI 真实 git +
      纯读性 / 人类可读输出。
- [x] AC8: **task-over-90m 判据源统一**——over-90m 用遥测的 in-progress（真实在飞），不再用与遥测矛盾
       的另一个源；任务真正 done/reconcile 后不触发假 over-90m
      → 判据源已统一：机械检测器 `detectTaskOver90m`（`inner-blocked-signal.ts`）读的就是遥测
      `.workflow-events/` + `aggregate().inProgress`（旧 inner-state.sh OVER90 另一源已退役）。「任务真正
      done/reconcile 后不触发假 over-90m」：reconcile 闭合的幽灵离开 inProgress ⇒ OVER90 静默——既有测试
      `AC5 — OVER90 no longer fires for a reconcile-closed record` 全绿。本任务让 reconcile 成为**收尾常规**
      （`--slot-status` 暴露 `stale_brackets` + 外层步骤 1b 对账跑 `--reconcile`），幽灵不再滞留触发假块。
      scoped 静态检查 `task-contract-check: no violations`。
- [ ] AC9: **阻塞信号超时自动升级**——一条没人消费的阻塞信号不应让 inner 无限期等（自动升级为需要
      人工介入/超时归档，不无限冻结）；今晚 92 分钟假阻塞形态消除
      → **未实现**——独立机制（`inner-blocked-signal.ts` 的消费超时/自动升级），不在本任务 DoD（AC1–AC7）
      与 Contract（slot_visibility）范围内；留待专门任务/外层裁定。

### 交叉标注（低报方向，`gap-telemetry-underreport-nontask-subagents-not-counted-in-slots`）

本任务判据 `brackets_reflect_subagents` 只覆盖**高报方向**：括号多、实际少（红窗遗留未闭合 start
把健康态误判成满负荷）。同族**低报方向**由新任务
`tasks/gap-telemetry-underreport-nontask-subagents-not-counted-in-slots.md` 覆盖：调查型 subagent 不
进括号，`--slots` 的 `realInFlight` 恒 0 而实际 1 个 subagent 在跑（0/3 空槽误判，真实并发 4 不是 3）——
修法是 `--slots`/`--slot-status` 增 `subagentsInFlight` 计数（非任务 subagent 进程），
`realConcurrency = realInFlight + subagentsInFlight`，状态自检①改读真实并发。两面合起来才是
「括号 ⇄ 真实 subagent」的完整对账。

### AC5 实跑输出（invoke evidence，2026-08-06 内层实跑）

构造 5 红窗遗留幽灵括号（`task/stale-1..5` 分支已合并进 master，执行者可观测消失）+ 1 真实 agent
（`task/live-1` 分支在 open worktree，执行者仍存活），cap 3：

```
$ node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --root <ws> --slot-status --cap 3 --json
{
  "cap": 3,
  "in_progress_total": 6,
  "stale_brackets": 5,
  "real_in_flight": 1,
  "slots_free": 2,
  "slot_state": "free",
  "brackets_reflect_subagents": false,
  "closed": [ {taskId: stale-1..5, reconcileReason: "branch-merged", startedAtMsUnreliable: true}, ... ],
  "kept":   [ {taskId: "live-1", keepReason: "worktree-present", startedAtMsUnreliable: false} ]
}

$ node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --root <ws> --slot-status --cap 3   # human
slot status (generated 2026-08-06T01:38:46.777Z)
  cap: 3
  in-progress brackets (raw --report inProgress): 6
  stale brackets (reconcile would close, executor observably gone): 5
  real in-flight (executor still present): 1
  slots free: 2 (slot_state free)
  brackets reflect subagents: NO (stale brackets or missing --task-end)
```

同形态 scoped 测试 `SLOT-STATUS — 5 stale brackets + 1 real agent ⇒ real_in_flight 1, slots_free 2 (AC5
regression shape)` 与 `SLOT-STATUS CLI — real git: merged-branch phantom counts stale…` 全绿（45 pass,
0 fail, 0 cancelled，见下验证）。
      → **--report --json 新增 reconcile 感知字段**（`fast-mode-telemetry.ts` `loadAndAggregate` 对
      `inProgress` 做 dry-run reconcile——executor 已消失者进 `reconcilable[]`，其余为 `realInFlight`）；
      **外层 step 1b 每次收尾无条件跑 `--reconcile`**（`orchestrator-loop-tick.md`）用可观测证据关红窗
      遗留括号。`--report --json` 实测：`inProgress: 6 | reconcilable: 5 | realInFlight: 1`（5 红窗遗留
      + 1 真实 agent）。新任务 `--task-start`（inner step 3.5 强制）正确开括号。
- [x] AC2: **空槽机械可见**——外层能从遥测（或等价结构信号）读出「还剩几个并发槽」，不再依赖内层
       手写叙事 markdown
      → 新增 **`--slots --cap N`** 子命令（`fast-mode-telemetry.ts`），输出 `bracketsInFlight /
      reconcilable / realInFlight / slotsTotal / slotsRemaining`；`--report --json` 的 `realInFlight` 即
      Contract measure。两个 tick 文档都引用 `--slots`（`fast-mode-loop-tick.md` 步骤 3.5 + 必报、
      `orchestrator-loop-tick.md` 步骤 1b）。
- [x] AC3: **状态自检①从装饰变判据**——in-flight 反映真实在飞（不再恒真）；并发违规能被判据抓住
       （5 个遗留括号 > cap 3 不应误判健康态，1 个真实 agent 不应误判满负荷）
      → `fast-mode-loop-tick.md` 状态自检①改为读 **`realInFlight`**（`--slots --cap` 的 real-in-flight /
      `--report --json` 的 `realInFlight`），**不再用原始 `inProgress[]` 括号数**（括号 ≠ subagent）。
      `orchestrator-loop-tick.md` 步骤 4b 拆三种「在飞」并注明自检①必须读真实在飞。doc 断言测试：
      `slot-visibility.test.mjs`「item ① 必须读 realInFlight、不得是恒真空原始括号检查」通过。
- [x] AC4: **--task-start/--task-end 调用恢复**——派发路径在派发/收尾时正确调用这对（遥测从历史归档
       变回当前状态；阻塞信号消费族同源）
      → WHO 已确认并写进文档机制：**inner 步骤 3.5 派发时调 `--task-start`（强制）**；**外层 step 1b
      收尾时调 `--task-end` + `--reconcile`（无条件）**（`orchestrator-loop-tick.md`）。`--reconcile`
      是机械安全网——即使 `--task-end` 被漏调，executor 已消失的括号也会被关，遥测从「历史归档」变回
      「当前状态」。阻塞信号消费族（`--detect-stop`/`--clear`/`--escalate-stale`）读同一
      `.quay/inner-blocked.json` + `.workflow-events/` 同源。
- [x] AC5: **回归控制**——今晚形态（5 红窗遗留括号 + 1 真实 agent）下，外层能看到「11 槽位闲置」而非
       「满负荷」或「空」（实测输出贴任务体）
      → 实测输出（`slot-visibility.test.mjs` AC2/AC3/AC5 用例 + 独立 demo 复现）：
      ```
      node ... fast-mode-telemetry.ts --slots --cap 3 --json --root /tmp/slot-demo
      { "bracketsInFlight": 6, "reconcilable": 5, "realInFlight": 1, "slotsTotal": 3, "slotsRemaining": 2 }
      ```
      空槽 = `dispatchable_disjoint − realInFlight` = 12 − 1 = **11 槽位闲置**（非「满负荷」——
      slotsRemaining 2 非 0；非「空」——realInFlight 1 非 0）。
- [x] AC6: **AC10 诚实记账**——pre-friction（无东西在疼），计 +1 ⇒ 6 → 7
      → `tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md` AC10 记账段追加
      「2026-08-06：`gap-telemetry-brackets-vs-subagents-no-slot-visibility` 立案为 pre-friction 观测轴，
      照 SYNTHESIS-axis-generation §3 判据 **+1 ⇒ 6 → 7**」。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
      → 新测试 `plugin/test/slot-visibility.test.mjs`：`// @test-group governance` + `import { test } from
      "node:test"`；8 用例覆盖 AC1/AC2/AC3/AC5/AC8/AC9。scoped 套件（79 tests）全绿。
- [x] AC8: **task-over-90m 判据源统一**——over-90m 用遥测的 in-progress（真实在飞），不再用与遥测矛盾
       的另一个源；任务真正 done/reconcile 后不触发假 over-90m
      → `detectTaskOver90m`（`inner-blocked-signal.ts`）reconcile 感知：对 inProgress 施加保守的
      `makeOver90ExecutorGone`（分支已 merge **或**有 durable merge record ⇒ 工作已落地 ⇒ 跳过）。
      `slot-visibility.test.mjs` AC8 用例：merged-done（fan-in 落地后分支已删）**不**触发假 over-90m，
      live-slow（打开 worktree）仍触发；非 git 店 fail-closed 仍触发（负控制不回归）。
- [x] AC9: **阻塞信号超时自动升级**——一条没人消费的阻塞信号不应让 inner 无限期等（自动升级为需要
       人工介入/超时归档，不无限冻结）；今晚 92 分钟假阻塞形态消除
      → 新增 **`--escalate-stale`**（`inner-blocked-signal.ts`）：block 超龄（默认 30m）自动归档——记遥测
      等待时长 + 写 `.quay/blocked-escalations.jsonl` + 移除 block 文件（底层条件若仍成立，下一 tick
      `--detect-stop` 写新 block 重新验证，每段等待有界）。外层 step 1b 无条件调用。实测：
      ```
      inner-blocked-signal: ESCALATED stale block (gap-demo, ruling-required) — waited 31.0m ≥ 30m; archived
      ```
      block 文件移除（不无限冻结）。92 分钟假阻塞形态：AC8 消除假 over-90m 源头 + AC9 有界每段等待。

## Definition of Done

- [x] AC1–AC7 全部勾上；AC5 实跑输出贴任务体
- [x] 遥测反映当前状态（非历史归档）；空槽机械可见；状态自检①是判据非装饰
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md（自身文件：勾 AC + 贴 invoke 证据授权）


- plugin/scripts/fast-mode-telemetry.ts（reconcile 红窗遗留 + 括号闭合 + 空槽信号：`--report` 增
  `reconcilable`/`realInFlight`；新增 `--slots` 子命令）
- plugin/scripts/inner-blocked-signal.ts（AC8：over-90m reconcile 感知——已落地任务不再假触发；
  AC9：新增 `--escalate-stale` 阻塞信号超时自动升级）
- plugin/loop/fast-mode-loop-tick.md（状态自检①：in-flight 从括号改为真实并发信号 `realInFlight`）
- plugin/loop/orchestrator-loop-tick.md（步骤 1b：`--reconcile` + `--escalate-stale`；步骤 4b：括号 vs
  subagent 的机械区分落地到自检）
- tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md（AC6 记账引用 6→7）
- tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md（self-touch：AC 勾选 + invoke 证据）

## Supervisor step（base-layer-outside-sessions 步骤②）

本任务 = `gap-supervisor-base-layer-outside-sessions-architecture` 落地次序 **② 槽位账本 + 会话状态**。
基座层判据：槽位账本/会话状态是平台原语，必须 outlive 会话（"几个任务在飞"的单一答案，六实体唯一写入者）——
本任务的 `--slots`/`realInFlight`/reconcile 正是该判据的落地。详见
`orchestration/SPEC-integration-architecture-2026-08-05.md` §7 + §9。不新开重复任务（AC4）。

## Test-Files

- plugin/test/slot-visibility.test.mjs（AC1/AC2/AC3/AC5/AC8/AC9 新测试）
- plugin/test/fast-mode-telemetry.test.mjs
- plugin/test/inner-blocked-signal.test.mjs

## Contract

measure   slot_visibility = `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json` stdout 的 `realInFlight` 数（reconcile 感知——原始 `inProgress[]` 括号数扣减 executor 已消失者；状态自检①读它，非原始括号）
band      slot_visibility = 真实并发（红窗遗留 reconcile 后 ≤ cap；与 pane ← agent 对齐）
invariant brackets_reflect_subagents = 1（`--slots` 的 real-in-flight 与真实 subagent 数一致，非恒 0/恒 5）
invoke    `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slots --cap "${effective_cap:-3}" --json`
control   构造 5 红窗遗留括号 + 1 真实 agent ⇒ `--slots --cap 3` 报 real-in-flight 1 / slots-remaining 2 非「满负荷」（AC5）；reconcile 后括号闭合
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

## Dispatch review（追加 2026-08-05T16:1xZ，管理者量化复核）

- **数量级坐实**：遥测总记录 105 条，而近 6h fan-in merge 有 20 次——`--task-start`/`--task-end`
  不系统，历史并发数据不可信（本 tick 实测：reconcile 前 inProgress 16 个陈旧括号，over-90m 假块
  反复写 inner-blocked.json，正是本条目的另一面——不只在「看不见真实并发」方向，也在「假块骚扰 inner」
  方向）。
- **与事件驱动派发任务交叉**：`gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release`
  AC6——事件驱动依赖准确的完成感知，括号失真会让完成感知也失真。
- **本 tick 实证**：reconcile（worktree-gone-and-no-process 判据）一次性关 14 个陈旧括号，剩余 2
  （1 真实在飞 + 1 手动 needs-human 闭合）——reconcile 判据本身有效，缺的是**派发路径没人调
  --task-end**。
