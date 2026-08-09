---
id: gap-supervisor-step-4-preemption
title: "supervisor 基座步骤④：抢占（preemption）——把「暂停/停止一个在飞任务」从屏幕抓取/文件轮询伪造（.halt 挡不住连续流程）收编为会话外进程的确定性操作；机制：任务超时/资源争抢/更高优先派发时 kill 子进程树（复用 kill-session 能力），只读可查询事实（进程在不在、跑多久、槽位空不空）不读任务语义；越界判据（任何一行需理解任务在讲什么 = 越界）在代码评审可查"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**来源**：`orchestration/SPEC-integration-architecture-2026-08-05.md` §7 落地次序 **④ 抢占**（supervisor 基座层
七职责之一）。基座层判据：抢占是平台原语，必须 outlive 会话；在会话里用 `.halt` 文件伪造**挡不住连续流程**
（实测：inner 绕过步骤 0 仍派发 5 个 subagent）。

**实测依据**（今晚）：
- `.halt` 规则说「在 tick 步骤 0 检查」，连续流程没有步骤 0 ⇒ 规则失效（state-crystallization §2.1）；
- 假 OVER90 冻结（`gap-over-90m-false-signal-source-reads-telemetry-not-task-status`）：崩溃遗留 bracket 让
  任务永远 in-progress，inner 停下等裁定，没人消费 ⇒ 92min 被吃；
- `kill-server` 杀穿隔离（管理者自伤，三项目会话全死）——**抢占必须有边界**（只 kill 目标子进程树，不碰他人）。

**supervisor 抢占操作（越界边界内）**：
- **只读可查询事实**：进程在不在（`pgrep`）、跑多久（`startedAt`）、槽位空不空（ledger）、资源够不够（gate）；
- **不读任务语义**：不解析 Proposal/Plan/AC——「这个任务该不该被抢占」是判断，推回 agent 层；
  supervisor 只提供「事实 + 确定性操作」；
- **复用已验证能力**：`kill-session.sh` / os-anchor-watchdog 的 re-spawn（同一 kill/re-create 机制）；
- **边界**：只 kill 目标任务的子进程树，不跨容器、不碰其他项目（AC9 容器边界下尤其如此）。

### 选定机制

1. **抢占判据**：任务超时（>90min 且 ledger 确认无真实推进）/ 资源门 WAIT 下的强制回收 / 更高优先派发请求——
   全部由**可查询事实**驱动，supervisor 不判断「该不该」，只执行「已裁定的事实条件」
2. **抢占动作**：`kill` 目标子进程树 + 关闭 bracket + 记录 ledger 事件（复用 kill-session + fast-mode-telemetry --reconcile）
3. **越界判据**：代码评审可查——任何一行需要「理解任务在讲什么」即越界
4. **验证**：负控制——模拟超时任务 ⇒ 被抢占；正控制——正常任务 ⇒ 不被误杀；边界——kill 不跨项目

## Acceptance Criteria

- [x] AC1: **抢占判据由可查询事实驱动**——supervisor 只读进程/时长/槽位/资源，不解析任务语义；
      代码评审可查（越界判据：无一行需理解任务内容）
      **证据**：`supervisor-preempt-candidates.ts` 的 `listPreemptible()` 判据 = 遥测 in-progress bracket
      `nowMs - startedAtMs > 90min`（时长）+ `taskStatusAllowsOver90m()`（任务 status 仍是 in-progress——
      机械 frontmatter 字段，同 gap-over-90m 闸）+ `reconcileInFlight(makeOver90ExecutorGone)`（未落地）。
      无一行读 Proposal/Plan/AC/DoD 正文。代码评审可查。
- [x] AC2: **超时任务确定性抢占**——模拟 >90min 且无推进的任务 ⇒ 子进程树被杀、bracket 关闭、
      ledger 记录事件（负控制实跑输出贴任务体）
      **证据**：`preempt-task <taskId>` 对 runId 进程组发 SIGINT→SIGKILL（子进程树被杀）、写
      `--task-end`（outcome=abandoned, reconcileReason=preempted，bracket 关闭）、append ledger
      事件。负控制实跑输出见 `## Evidence`（AC2）。
- [x] AC3: **正常任务不被误杀**——正控制：活跃推进的任务调用抢占 ⇒ 拒绝/忽略（不误杀）
      **证据**：`preempt-task` 先查 `findPreemptibleCandidate`——任务不在可抢占集 ⇒ exit 1
      `NOT preemptible`，零 kill、零 ledger。正控制实跑输出见 `## Evidence`（AC3）。
- [x] AC4: **边界**——抢占不跨项目/不跨容器（AC9 边界下只 kill 目标任务子进程树）；`kill-server` 杀穿隔离
      事故不复现（负控制）
      **证据**：kill 目标 = 仅 cmdline 匹配该任务 runId 的进程组（`findExecutorPids` 扫 /proc）；
      非目标进程（另一 runId/另一项目）不被触碰。测试「decoy in another group survives」+ 实跑见
      `## Evidence`（AC4）。
- [x] AC5: **复用已验证能力**——kill 动作复用 `kill-session`/os-anchor-watchdog re-spawn 机制，零新发明
      **证据**：判据复用 fast-mode-telemetry 的 `aggregate`/`reconcileInFlight`/`buildEndEvent`/
      `writeEvent` + inner-blocked-signal 的 `taskStatusAllowsOver90m`/`makeOver90ExecutorGone`；
      进程组 kill = `tmux kill-session -t <name>`（从不 `kill-server`）的进程级对应——只杀目标组，
      同 full-suite-runner 的进程组界。
- [x] AC6: **与既有基座任务交叉标注**——`SPEC-integration-architecture` 步骤④ + `gap-over-90m`（超时判据源）
      + `gap-supervisor-step-5-message-bus-with-identity`（抢占事件经总线带身份广播）
      **证据**：SPEC §7 步骤④ 状态表改为 done（2026-08-08）；`gap-over-90m` 任务体加步骤④交叉注；
      `gap-supervisor-step-5-message-bus-with-identity` 已引用本任务（AC5 事件广播交叉），本任务
      已加步骤⑤互注。

## Definition of Done

- [x] AC1-AC6 全勾（抢占判据由可查询事实驱动——只读进程/时长/槽位/状态不解析任务语义，代码评审可查；
      超时任务确定性抢占——>90min 无推进 ⇒ 子进程树被杀/bracket 关/ledger 记事件；正常任务不被误杀——
      活跃推进任务调用抢占被拒 exit 1；边界——只 kill 目标任务 runId 进程组不跨项目；复用已验证能力；
      交叉标注）
- [x] 超时抢占负控制实跑 + 正常任务正控制实跑（输出见 `## Evidence`）
- [x] scoped 门 `scripts/test.sh --for-task gap-supervisor-step-4-preemption` 绿

## Definition of Done

- [ ] AC1-AC3 全勾（抢占判据由可查询事实驱动——只读进程/时长/槽位/资源不解析任务语义，代码评审可查；超时任务确定性抢占——>90min 无推进 ⇒ 子进程树被杀/bracket 关/ledger 记事件；正常任务不被误杀——活跃推进任务调用抢占被拒）
- [ ] 超时抢占负控制实跑 + 正常任务正控制实跑
- [ ] scoped 门 `scripts/test.sh --for-task gap-supervisor-step-4-preemption` 绿

## Touches
- tasks/gap-supervisor-step-4-preemption.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/scripts/（supervisor-preempt 若成：基座层实现——supervisor-preempt-candidates.ts 新建 +
  supervisor-preempt.sh 扩展 --list-preemptible/preempt-task + capability-catalog.sh 声明）
- orchestration/SPEC-integration-architecture-2026-08-05.md（来源，步骤④）
- tasks/gap-over-90m-false-signal-source-reads-telemetry-not-task-status.md（超时判据交叉）
- tasks/gap-supervisor-step-5-message-bus-with-identity.md（事件广播交叉——步骤⑤ 已落地 2026-08-08：
  抢占事件经 `supervisor-bus.sh --send --from <layer> --to <target> --payload <msg>` 带身份广播，
  ledger 记谁→谁→何时→是否送达）

## Test-Files

- plugin/test/supervisor-preempt-candidates.test.mjs（新建——Contract measure / AC1-AC5 机械断言）
- plugin/test/supervisor-preempt.test.mjs（回归——halt 抢占原语 14 绿）

## Contract

measure   preempt_success = `bash plugin/scripts/supervisor-preempt.sh --list-preemptible` stdout 计数（可抢占任务的判定计数）
band      preempt_success = 1（超时且无推进的任务可被确定性列出并抢占）
invoke    `bash plugin/scripts/supervisor-preempt.sh --list-preemptible`
control   无抢占机制（当前形态，.halt 挡不住连续流程）⇒ 超时任务只能靠人手动 kill；有抢占 ⇒ 确定性 kill
resume    分步提交，任一步完成即写盘

## Evidence (2026-08-08)

### Contract `measure` / AC1 / AC2 负控制 — `--list-preemptible` 实跑（band = 1）

模拟 >90min 且无推进的任务（`status: in-progress` + 遥测 bracket 已 95 分钟 + 未落地）：

```
$ bash plugin/scripts/supervisor-preempt.sh --list-preemptible --root <fixture>
preemptible: 1
  gap-preempt-evidence  fm-gap-preempt-evidence-...  95.0 min  timeout-no-progress
```

判据只读可查询事实：`listPreemptible()` = 遥测 in-progress bracket（`nowMs - startedAtMs > 90min`，
时长）+ `taskStatusAllowsOver90m()`（任务 status 仍在 in-progress，同 gap-over-90m 闸，无真实推进）+
`reconcileInFlight(makeOver90ExecutorGone)`（未落地）。无一行读任务正文。

### AC2 负控制 — `preempt-task` 确定性抢占（子进程树被杀 + bracket 关闭 + ledger 记录）

```
$ bash plugin/scripts/supervisor-preempt.sh preempt-task gap-preempt-evidence --root <fixture>
preempt-task: preempted gap-preempt-evidence (runId fm-gap-preempt-evidence-..., 95 min)
  killed pgids: 3078878,3078888
  bracket closed: outcome=abandoned reconcileReason=preempted
  ledger: /tmp/preempt-evidence-.../.quay/supervisor-preempt-ledger.jsonl
$ echo "exit=$?"; exit=0

$ bash plugin/scripts/supervisor-preempt.sh --list-preemptible --root <fixture>   # 抢占后
preemptible: 0
```

ledger（纯 append）：
```
{"preemptedAtMs":...,"taskId":"gap-preempt-evidence","runId":"fm-gap-preempt-evidence-...","minutes":95,"killedPids":[3078878,3078888],"outcome":"abandoned","reconcileReason":"preempted","boundary":"process-group-of-runId"}
```

遥测 bracket（start + preempt end 同一 runId 文件）：
```
{"taskId":"gap-preempt-evidence","eventKind":"start",...,"timing":{"queuedAtMs":null,"startedAtMs":1786221566797,"endedAtMs":null}}
{"taskId":"gap-preempt-evidence","eventKind":"end",...,"outcome":"abandoned","reconcileReason":"preempted","timing":{"queuedAtMs":null,"startedAtMs":null,"endedAtMs":1786227268541}}
```

### AC3 正控制 — 活跃推进的任务不被误杀（拒绝/忽略，零 kill 零 ledger）

```
$ bash plugin/scripts/supervisor-preempt.sh --list-preemptible --root <fresh>    # 10 分钟新任务
preemptible: 0
$ bash plugin/scripts/supervisor-preempt.sh preempt-task gap-active-pos --root <fresh>
preempt-task: gap-active-pos NOT preemptible (not-preemptible)
$ echo "exit=$?"; exit=1
```

`status: ready` + 陈旧 91min bracket（gap-over-90m 假信号形态）同样 `preemptible: 0`——不误判。

### AC4 边界 — 只 kill 目标任务 runId 进程组，不跨项目

`findExecutorPids(runId)` 扫 /proc 匹配该任务 runId needle → 取其进程组 → 只对该组发
SIGINT→SIGKILL。测试「AC4 boundary: decoy in another group survives」：目标 + 另一 runId 的 decoy
同场，preempt 目标 ⇒ decoy 存活、ledger killedPids 不含 decoy pid。

### AC5 复用 — 零新发明

判据复用 `fast-mode-telemetry.ts`（`readAllEvents`/`aggregate`/`reconcileInFlight`/`buildEndEvent`/
`writeEvent`）+ `inner-blocked-signal.ts`（`TASK_OVER_90M_MS`/`taskStatusAllowsOver90m`/
`makeOver90ExecutorGone`）；进程组 kill = `tmux kill-session -t <name>`（从不 `kill-server`）的进程级
对应（同 full-suite-runner 进程组界）。

### 测试统计（scoped 选中集）

`plugin/test/supervisor-preempt-candidates.test.mjs`（node:test + `@test-group governance` +
`@load-sensitive wall-clock`）11 绿 + 既有 `plugin/test/supervisor-preempt.test.mjs` 14 绿无回归。

## Dispatch review

reviewer: none
at: 2026-08-06
changed: 由 supervisor 架构任务（gap-supervisor-base-layer-outside-sessions-architecture）落地时按次序立案（④）
