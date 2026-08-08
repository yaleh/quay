---
id: gap-session-liveness-ignores-unknown-transcript-names
title: "session-liveness 静默忽略不在 SESSION_TARGETS 表里的 transcript/heartbeat 名字——零告警盯错对象（实测：manager 用 SESSION_TRANSCRIPTS=\"outer <outer transcript>\" 挂载但未设 SESSION_TARGETS，目标表来自 env（ba0c1968 quay→quay-0:inner），--once 报 pid=2989409（inner）非 2989418（outer）；outer 216s 空闲窗口无人观测——不是去抖漏报是从未观测；判据建议：启动时任一 transcript/heartbeat 名字不在目标表 ⇒ WARN 或 fail-closed，与 env 自述「归属靠位置隐式决定而位置是巧合」同族"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**session-liveness 静默忽略不在 SESSION_TARGETS 表里的 transcript/heartbeat 名字——观察者盯错对象、零告警。**

### 实测（manager 2026-08-08 12:5x）

用 `SESSION_TRANSCRIPTS="outer <outer transcript>"` 挂载但**未设 SESSION_TARGETS**，目标表因此来自
`orchestration/session-liveness.env`（外层 ba0c1968 写的 `quay → quay-0:inner`），`--once` 实测报
**pid=2989409（inner）** 而非 2989418（outer）。后果：manager 自以为盯 outer 的监视器 12:35-12:55
**全程盯的是 inner**，12:43:55→12:47:32 outer 的 216 秒空闲窗口**无人观测**——不是去抖漏报，是**从未观测**。

### 根因

脚本对 transcript/heartbeat 名只做「防重名覆盖」（`[ "$n" = "$name" ]`，:541 附近），
**不校验名字是否在 SESSION_TARGETS 表里**。名字不匹配 ⇒ 静默忽略，目标仍是默认/env 解析的那个。

### 与 env 自述同族

`orchestration/session-liveness.env` 自己写「**归属靠位置隐式决定，而位置是巧合**」——本缺陷同族：
**观察目标靠名字隐式关联，而名字不匹配时零告警。**

### 修法方向（判据建议，设计归外层/内层）

**启动时任一 transcript/heartbeat 名字不在目标表内 ⇒ WARN 或 fail-closed。**
（与「资源闸 fail-closed」「重锚零派发措辞 fail-closed」同一原则：配置不匹配要显式，不能静默。）

## Contract

```
measure unknown_name_warn = `SESSION_TRANSCRIPTS="nonexistent /tmp/x.jsonl" timeout 5 bash plugin/scripts/session-liveness.sh --once 2>&1 | grep -cE "WARN|unknown|not in.*target"` stdout 数字段（≥1：未知名字被显式告警）
band unknown_name_warn = ≥1（当前=0：静默忽略）
invoke `SESSION_TRANSCRIPTS="nonexistent /tmp/x.jsonl" bash plugin/scripts/session-liveness.sh --once`
control 负控制：合法名字（在 SESSION_TARGETS 表里）不告警；未知名字才告警（不误伤正常配置）
resume 若中断，先跑 measure 读当前未知名字是否被静默忽略，不要假设已修
```

## Acceptance Criteria

- [x] AC1: **未知名字显式告警**——SESSION_TRANSCRIPTS/HEARTBEATS 给的名字不在 SESSION_TARGETS 表
      时，启动输出 WARN（或 fail-closed），非静默忽略
      - 实跑（本任务，plugin/scripts/session-liveness.sh --once）：
        - Contract measure `SESSION_TRANSCRIPTS="nonexistent /tmp/x.jsonl" … --once 2>&1 | grep -cE "WARN|unknown|not in.*target"` → **1**（band ≥1 达成；修复前=0 静默忽略）。
          输出：`session-liveness: WARN SESSION_TRANSCRIPTS 的名字「nonexistent」不匹配任何 SESSION_TARGETS 目标名（targets: quay）——transcript_for 按名匹配会找不到它…`
        - manager 实测形态 `SESSION_TRANSCRIPTS="outer /tmp/outer.jsonl"`（未设 SESSION_TARGETS，env 文件 source）→ `WARN …「outer」不匹配任何 SESSION_TARGETS 目标名`。
        - `SESSION_HEARTBEATS="bogus /tmp/x"` → `WARN SESSION_HEARTBEATS 的名字「bogus」不匹配任何 SESSION_TARGETS 目标名`。
      - 根因补齐：env 文件 source 之前先钉住调用方显式 SESSION_TRANSCRIPTS/SESSION_HEARTBEATS、
        source 后回写（与 SESSION_TMUX_SESSION 同模式）——调用方给的名字不再被 env 文件静默覆盖，
        `_sl_audit_config_wiring` 才能看到它并对不在目标表的名字告警。测试：T4（T3 已覆盖 env 文件内
        名字不匹配）。
- [x] AC2: **合法名字不误伤**——表内名字正常处理，零告警（负控制）
      - 实跑：正常 env 配置（SESSION_TRANSCRIPTS="quay …" 与目标名 "quay" 一致）`--once 2>&1 | grep -c WARN` → **0**；
        `SESSION_HEARTBEATS="quay /tmp/x"`（匹配）→ **0**。测试：T5（负控制：全部名字匹配 ⇒ 零 WARN）。
- [x] AC3: **观察目标可验证**——`--once` 报的 pid 与预期目标一致（manager 实例应盯 outer 2989418，
      外层实例应盯 inner 2989409）；名字不匹配时不会悄悄盯错
      - 实跑：`--once` 报 `SESSION-STATUS quay alive=1 pid=2989409`；`tmux list-panes -t "quay-0:inner" -F '#{pane_pid}'` → **2989409**（逐字相等，盯 inner 非 outer 2989418）。名字不匹配时现在启动即 WARN（AC1），不再悄悄盯错。T1 亦覆盖（报 inner pane_pid、非 outer/自身）。
- [x] AC4: 与 gap-session-liveness-monitor-watches-self-not-inner（ready）交叉标注——同族：
      观察目标解析/校验；本任务补「名字不匹配」显式化，那条补「目标指向 inner」
      - 同族标注：姊妹任务补的是「目标指向 inner」（SESSION_TARGETS/SESSION_TRANSCRIPTS 显式配置 +
        `_sl_audit_config_wiring` 启动审计 WARN 名字不匹配目标表）；本任务补的是「名字不匹配」的最后一环——
        调用方显式 SESSION_TRANSCRIPTS/HEARTBEATS 在 env 文件 source 后存活（先钉后回），审计才能对它告警。
        两个任务合起来：**看对目标（inner）+ 配错名字会响**。

## Definition of Done

- [x] AC1-AC4 实跑输出贴任务体（未知名字 WARN 对照 + 合法名字零告警 + pid 匹配）
      - AC1：未知名字 WARN 对照见 AC1 证据（Contract measure 1、manager "outer" 形态、SESSION_HEARTBEATS "bogus" 形态）。
      - AC2：合法名字零告警见 AC2 证据（env 正常配置 0 WARN、匹配 SESSION_HEARTBEATS 0 WARN）。
      - AC3：pid 匹配见 AC3 证据（--once pid=2989409 == quay-0:inner pane_pid）。
      - 测试：plugin/test/session-liveness-target.test.mjs T1-T5 全绿（node --test 5 pass / 0 fail）。

## Touches
- plugin/scripts/session-liveness.sh（先钉后回：调用方显式 SESSION_TRANSCRIPTS/SESSION_HEARTBEATS
  在 env 文件 source 后存活，_sl_audit_config_wiring 才能对不在目标表的名字告警）
- plugin/test/session-liveness-target.test.mjs（AC1/AC2 测试：T4 先钉后回判别 + T5 负控制）
- orchestration/session-liveness.env（无需改动——名字已由姊妹任务对齐为 "quay" 与目标名一致，
  验证零告警；本任务补的是调用方显式名字不被覆盖）

## Test-Files
- plugin/test/session-liveness-target.test.mjs
- plugin/test/session-liveness-heartbeat.test.mjs
- plugin/test/session-liveness-events.test.mjs
- plugin/test/session-liveness-signals.test.mjs

## Dispatch review

reviewer: none
at: 2026-08-08T12:5xZ
changed: 管理者 12:5x 实测（SESSION_TRANSCRIPTS=outer 但目标表来自 env=inner ⇒ 盯错对象 216s 无人观测，
  非去抖漏报是从未观测）+ 判据建议（未知名字 WARN/fail-closed）。外层复核：:541 只做防重名覆盖不校验
  表成员——成立，立案。
