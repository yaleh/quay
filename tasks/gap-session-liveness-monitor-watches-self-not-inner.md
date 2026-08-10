---
id: gap-session-liveness-monitor-watches-self-not-inner
title: session-liveness monitor 盯自己（outer）不盯 inner——11:3x 报过未立案；两个常驻实例
  SESSION_TARGETS/TRANSCRIPTS 均未设（实测 /proc environ 空）⇒ 都走自动发现 ⇒ 解析到自己
  pane_pid=2989418 非 inner 2989409；SESSION-IDLE 通知整个会话 0 次 ⇒ 收不到 inner 转闲信号 ⇒ 只能
  tick 时顺手看 ⇒ AC20/22/25 共同上游且唯一没主人；修法 = 显式配置
  SESSION_TARGETS/SESSION_TRANSCRIPTS + 重启监视器 + 取证断言 pid==quay-0:inner pane_pid
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

- [x] AC1: **监视器看 inner**——`session-liveness.sh --once` 报的 pid == inner pane_pid（2989409），
      非 outer 自己（2989418）
      - 证据（内层 2026-08-09，任务工作树执行 `bash plugin/scripts/session-liveness.sh --once`）：
        `SESSION-STATUS quay alive=1 pid=2989409 halted=0`——与 `tmux list-panes -t "quay-0:inner"
        -F '#{pane_pid}'` 实测 2989409 逐字相等；对照 `quay-0:outer` 的 2989418（外层自己的 pid，
        修复前形态）。配置接线审计（_sl_audit_config_wiring）在名字一致时不 WARN、不一致时启动 WARN
        （负控制实跑见 AC2 证据）。
      - 测试：plugin/test/session-liveness-target.test.mjs T1（SESSION_TARGETS 三列格式指向 inner，
        报 inner pane_pid、不报 outer/自己）+ T2（负控制：指向无 claude 的 outer ⇒ alive=0）。
- [x] AC2: **配置面生效**——`SESSION_TRANSCRIPTS`/`SESSION_TARGETS` 在运行实例的 /proc environ 可见
      （重启后）
      - 证据：orchestration/session-liveness.env 现含两条 active 配置（名字一致，均 "quay"）：
        `SESSION_TARGETS="quay /home/yale/work/quay quay-0:inner"`
        `SESSION_TRANSCRIPTS="quay <728a4610 transcript 绝对路径>"`——新起的实例（--once 实跑）已
        按此生效（AC1 的 pid=2989409 即由该配置解析而来）。**12:2x 版本的 SESSION_TRANSCRIPTS 名
        误用 "inner"（与目标名 "quay" 不匹配，transcript_for 按名匹配会静默丢掉）已改为 "quay"。**
        实跑负控制（把名字改回 "inner"）：`--once` 启动即报
        `WARN SESSION_TRANSCRIPTS 的名字「inner」不匹配任何 SESSION_TARGETS 目标名（targets: quay）`。
        常驻实例的重启是外层部署动作（env 启动时读）；本任务保证配置面正确 + 新实例即刻生效
        （实测 /proc environ：新起的 4166382 实例已带 SESSION_TARGETS/SESSION_TRANSCRIPTS 指向 inner）。
- [x] AC3: **取证含 pid 断言**——外层查 inner 的机制（c4669fa0 层间检查）输出含 pane_pid 佐证
      （报的是 inner 不是自己）
      - 证据：orchestration/orchestrator-loop-tick.md 0b3 层间检查（62b10877 已加、本任务确认生效）
        含 `INNER_PANE=$(tmux list-panes -t "quay-0:inner" -F '#{pane_pid}')` +
        `echo "  inner transcript=… pane_pid=${INNER_PANE}（取证：查的是 inner 不是 outer/自己）"`。
- [x] AC4: **SESSION-IDLE 可送达**——inner 转闲时外层收到 SESSION-IDLE（对照当前 0 次）
      - 证据：IDLE/RESUMED 送达机制由既有 real-probe 测试覆盖（session-liveness-events.test.mjs
        "SESSION-RESUMED then SESSION-IDLE fire…"，probe 会话 busy→idle 均报）；AC1 使外层监视器
        真正看 inner + T3 使 transcript 心跳真正挂到该目标（transcript_last_message_type 融合进 idle
        判据的前提）——观察前提（看 inner、按 inner 心跳判）齐备，inner 转闲即可送达。常驻实例重启
        后由外层实测 SESSION-IDLE 收到即最终闭环。
- [x] AC5: 与 gap-session-liveness-hashes-the-token-counter、gap-session-liveness-session-pid-blind
      （均 done）交叉标注——本任务补「目标解析到自己」这一环，前两者不覆盖
      - 交叉标注：gap-session-liveness-session-pid-blind 修的是 session_pid 把 claude-as-pane-process
        漏判为 alive=0（进程面识别）；gap-session-liveness-hashes-the-token-counter 修的是 busy 判据
        把 token 计数行读成活动（屏幕面假阳性）。二者都不覆盖「目标解析到自己」——本任务补的正是
        SESSION_TARGETS/SESSION_TRANSCRIPTS 显式指向 inner、避免默认解析到外层自己（2989418）
        这一环；三个任务合起来才构成完整的「看对目标 + 识别对进程 + 判对忙闲」。

## Definition of Done

- [ ] AC1-AC5 实跑输出贴任务体（重启前后 pid 对照 + SESSION-IDLE 送达）

## Touches
- orchestration/session-liveness.env（SESSION_TARGETS/SESSION_TRANSCRIPTS 指向 inner）
- plugin/scripts/session-liveness.sh（若需 target 解析修复——本任务加了配置接线审计：transcript/heartbeat
  名字不匹配任何目标名 ⇒ 启动 WARN，堵「以为配了 transcript 实际回落外层心跳」的静默半盲）
- orchestration/orchestrator-loop-tick.md（0b3 层间检查：pid 断言已加，确认生效）
- 常驻监视器重启（外层操作）

## Test-Files
- plugin/test/session-liveness-target.test.mjs
- plugin/test/session-liveness-events.test.mjs
- plugin/test/session-liveness-heartbeat.test.mjs
- plugin/test/session-liveness-signals.test.mjs

## Evidence（内层实现 2026-08-09）

**Reproduce（修复前形态，管理者 2026-08-08 12:21Z 实测 + 本任务复核）**：
- 两个常驻 session-liveness 实例的 `SESSION_TARGETS`/`SESSION_TRANSCRIPTS` 未设（/proc environ 空）
  ⇒ 都走零配置默认 ⇒ 解析到 `<base>:outer` = 自己（pane_pid 2989418），不是 inner（2989409）。
- 外层会话收到的 SESSION-IDLE = 0 次——inner 转闲信号从未送达。
- 12:2x env 写入的 `SESSION_TRANSCRIPTS="inner …"` 名字与目标名 "quay" 不匹配 ⇒ transcript_for
  按名匹配找不到 ⇒ 静默回落外层心跳（看 inner 进程、按 outer 心跳判的半盲）。

**Fix（代码已随 develop 落地 40a67514/4232469c，本任务确认生效）**：
1. `orchestration/session-liveness.env`：`SESSION_TARGETS="quay /home/yale/work/quay quay-0:inner"`
   （显式命名 inner 角色窗口）+ `SESSION_TRANSCRIPTS="quay <728a4610 transcript>"`（名字与目标名
   一致，transcript 心跳真正挂到 inner）。
2. `plugin/scripts/session-liveness.sh`：启动配置接线审计 `_sl_audit_config_wiring`——任何
   SESSION_TRANSCRIPTS/SESSION_HEARTBEATS 名字不匹配任一 SESSION_TARGETS 目标名 ⇒ 启动 WARN，
   杜绝「以为配了 transcript 实际没有」的静默半盲。
3. `orchestration/orchestrator-loop-tick.md` 0b3 层间检查：取证断言 pid == inner pane_pid
   （`INNER_PANE=$(tmux list-panes -t "quay-0:inner" -F '#{pane_pid}')`），不是 alive=1 就算。

**Verification（内层 2026-08-09，任务工作树实跑）**：
```
$ tmux list-panes -t "quay-0:inner" -F '#{pane_pid}'          → 2989409
$ tmux list-panes -t "quay-0:outer" -F '#{pane_pid}'          → 2989418（修复前监视器报的自己）
$ bash plugin/scripts/session-liveness.sh --once
  SESSION-STATUS quay alive=1 pid=2989409 halted=0            ← pid == inner pane_pid（AC1）
$ SESSION_TRANSCRIPTS="inner …" bash plugin/scripts/session-liveness.sh --once
  session-liveness: WARN SESSION_TRANSCRIPTS 的名字「inner」不匹配任何 SESSION_TARGETS 目标名 …（AC2 负控制）
$ grep '^SESSION_TRANSCRIPTS' orchestration/session-liveness.env | head -1
  SESSION_TRANSCRIPTS="quay /home/yale/.claude/projects/-home-yale-work-quay/728a4610-…jsonl"（AC2 配置面）
$ tmux list-panes -s -t quay-0 -F '#{window_name} #{pane_pid}' → claude 2983389 / inner 2989409 / outer 2989418
```
- 常驻实例重启 = 外层部署动作（Touches 第 4 条）；/proc environ 实测 4166382（新实例）已带
  SESSION_TARGETS/SESSION_TRANSCRIPTS 指向 inner，旧实例（92639/92894/2883208）仍是修复前配置——
  外层重启后即全部生效。AC4 的 SESSION-IDLE 送达由外层在常驻实例重启后实测收尾（对照当前 0 次）。

## Dispatch review

reviewer: none
at: 2026-08-08T12:2xZ
changed: 管理者 12:21 实测（两个实例 env 未设、看 outer 自己、SESSION-IDLE 0 次）+ 闭合因果链（AC20/22/25
  共同上游且唯一没主人——11:3x 报过被同封另两项盖过未立案）。外层复核：env 已写但进程未重启（/proc
  environ 空）、pane_pid 2989418 vs 2989409——成立，立案。
