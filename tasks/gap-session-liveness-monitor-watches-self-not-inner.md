---
id: gap-session-liveness-monitor-watches-self-not-inner
title: "session-liveness monitor 盯自己（outer）不盯 inner——11:3x 报过未立案；两个常驻实例 SESSION_TARGETS/TRANSCRIPTS 均未设（实测 /proc environ 空）⇒ 都走自动发现 ⇒ 解析到自己 pane_pid=2989418 非 inner 2989409；SESSION-IDLE 通知整个会话 0 次 ⇒ 收不到 inner 转闲信号 ⇒ 只能 tick 时顺手看 ⇒ AC20/22/25 共同上游且唯一没主人；修法 = 显式配置 SESSION_TARGETS/SESSION_TRANSCRIPTS + 重启监视器 + 取证断言 pid==quay-0:inner pane_pid"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**session-liveness 监视器盯自己（outer），不是 inner——11:3x 报过、没被立案，今晚唯一没主人的上游环。**

### 实测（manager 2026-08-08 12:21Z + 外层复核）

1. **两个常驻 session-liveness 实例的 `SESSION_TARGETS`/`SESSION_TRANSCRIPTS` 都是「未设」**（/proc environ 空）⇒ 都走自动发现 ⇒ 都解析到本项目自己的 pane（**outer pane_pid=2989418**，不是 inner 的 2989409）。
2. **外层会话收到的 SESSION-IDLE 通知（整个会话）= 0 次**——与 11:3x 首次报时相同。
3. **env 已写但监视器没重启**：`orchestration/session-liveness.env` 已有 `SESSION_TRANSCRIPTS="inner <728a4610 路径>"`（62b10877），但常驻进程（522110/644390）在写入前启动，/proc environ 仍空 ⇒ 需要**重启监视器**才生效。

### 闭合因果链（manager 12:2x）

监视器盯自己 ⇒ 收不到 inner 转闲信号（实测 0 次）⇒ 只能在自己 tick 时顺手看一眼 ⇒ tick 间隔里
inner 空转，而外层正忙于 fan-in/收尾（真活）⇒ 修该监视器的任务【不存在】。
⇒ **AC20（全系统空闲窗口）/ AC22（衔接）/ AC25（槽未满即追上游）三条的共同上游就是这个盲点，
且它是唯一一条既没被修、也没被立案的。**

### 修法方向（机制决定归外层）

1. **显式配置**：`SESSION_TARGETS` 或 `SESSION_TRANSCRIPTS` 指向 inner 的真实会话/transcript
   （728a4610），两个实例都要生效。
2. **重启监视器**（env 在启动时读，写入后需重启）——或确认哪个实例该看 inner。
3. **取证必须含 pid 断言**：`它报的 pid == quay-0:inner 的 pane_pid（2989409）`，不只是 alive=1
   （c4669fa0 层间检查同坑——复用默认解析会做第二个盯自己的检查）。

## Contract

```
measure inner_observed = `bash plugin/scripts/session-liveness.sh --once` 输出里的 pid 是否 == `tmux list-panes -t "quay-0:inner" -F '#{pane_pid}'` stdout 数字段（是=1，否=0）
band inner_observed = 1（监视器报的是 inner 的 pid 不是 outer 自己的；当前=0）
invoke `tmux list-panes -t "quay-0:inner" -F '#{pane_pid}'`（inner 真实 pid 2989409）
control 负控制：监视器报 outer 自己 pid（2989418）⇒ 判为未修（当前形态）；重启后报 inner pid ⇒ 已修
resume 若中断，先跑 measure 读当前监视器报的 pid，不要假设已修
```

## Acceptance Criteria

- [ ] AC1: **监视器看 inner**——`session-liveness.sh --once` 报的 pid == inner pane_pid（2989409），
      非 outer 自己（2989418）
- [ ] AC2: **配置面生效**——`SESSION_TRANSCRIPTS`/`SESSION_TARGETS` 在运行实例的 /proc environ 可见
      （重启后）
- [ ] AC3: **取证含 pid 断言**——外层查 inner 的机制（c4669fa0 层间检查）输出含 pane_pid 佐证
      （报的是 inner 不是自己）
- [ ] AC4: **SESSION-IDLE 可送达**——inner 转闲时外层收到 SESSION-IDLE（对照当前 0 次）
- [ ] AC5: 与 gap-session-liveness-hashes-the-token-counter、gap-session-liveness-session-pid-blind
      （均 done）交叉标注——本任务补「目标解析到自己」这一环，前两者不覆盖

## Definition of Done

- [ ] AC1-AC5 实跑输出贴任务体（重启前后 pid 对照 + SESSION-IDLE 送达）

## Touches
- orchestration/session-liveness.env（SESSION_TARGETS/SESSION_TRANSCRIPTS 指向 inner）
- plugin/scripts/session-liveness.sh（若需 target 解析修复）
- orchestration/orchestrator-loop-tick.md（0b3 层间检查：pid 断言已加，确认生效）
- 常驻监视器重启（外层操作）

## Dispatch review

reviewer: none
at: 2026-08-08T12:2xZ
changed: 管理者 12:21 实测（两个实例 env 未设、看 outer 自己、SESSION-IDLE 0 次）+ 闭合因果链（AC20/22/25
  共同上游且唯一没主人——11:3x 报过被同封另两项盖过未立案）。外层复核：env 已写但进程未重启（/proc
  environ 空）、pane_pid 2989418 vs 2989409——成立，立案。
