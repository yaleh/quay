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

- [ ] AC1: **抢占判据由可查询事实驱动**——supervisor 只读进程/时长/槽位/资源，不解析任务语义；
      代码评审可查（越界判据：无一行需理解任务内容）
- [ ] AC2: **超时任务确定性抢占**——模拟 >90min 且无推进的任务 ⇒ 子进程树被杀、bracket 关闭、
      ledger 记录事件（负控制实跑输出贴任务体）
- [ ] AC3: **正常任务不被误杀**——正控制：活跃推进的任务调用抢占 ⇒ 拒绝/忽略（不误杀）
- [ ] AC4: **边界**——抢占不跨项目/不跨容器（AC9 边界下只 kill 目标任务子进程树）；`kill-server` 杀穿隔离
      事故不复现（负控制）
- [ ] AC5: **复用已验证能力**——kill 动作复用 `kill-session`/os-anchor-watchdog re-spawn 机制，零新发明
- [ ] AC6: **与既有基座任务交叉标注**——`SPEC-integration-architecture` 步骤④ + `gap-over-90m`（超时判据源）
      + `gap-supervisor-step-5-message-bus-with-identity`（抢占事件经总线带身份广播）

## Definition of Done

- [ ] AC1-AC3 全勾（抢占判据由可查询事实驱动——只读进程/时长/槽位/资源不解析任务语义，代码评审可查；超时任务确定性抢占——>90min 无推进 ⇒ 子进程树被杀/bracket 关/ledger 记事件；正常任务不被误杀——活跃推进任务调用抢占被拒）
- [ ] 超时抢占负控制实跑 + 正常任务正控制实跑
- [ ] scoped 门 `scripts/test.sh --for-task gap-supervisor-step-4-preemption` 绿

## Touches
- tasks/gap-supervisor-step-4-preemption.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/scripts/（supervisor-preempt 若成：基座层实现）
- orchestration/SPEC-integration-architecture-2026-08-05.md（来源，步骤④）
- tasks/gap-over-90m-false-signal-source-reads-telemetry-not-task-status.md（超时判据交叉）
- tasks/gap-supervisor-step-5-message-bus-with-identity.md（事件广播交叉）

## Contract

measure   preempt_success = `bash plugin/scripts/supervisor-preempt.sh --list-preemptible` stdout 计数（可抢占任务的判定计数）
band      preempt_success = 1（超时且无推进的任务可被确定性列出并抢占）
invoke    `bash plugin/scripts/supervisor-preempt.sh --list-preemptible`
control   无抢占机制（当前形态，.halt 挡不住连续流程）⇒ 超时任务只能靠人手动 kill；有抢占 ⇒ 确定性 kill
resume    分步提交，任一步完成即写盘
## Dispatch review

reviewer: none
at: 2026-08-06
changed: 由 supervisor 架构任务（gap-supervisor-base-layer-outside-sessions-architecture）落地时按次序立案（④）
