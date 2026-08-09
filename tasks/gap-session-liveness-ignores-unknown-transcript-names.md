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

- [ ] AC1: **未知名字显式告警**——SESSION_TRANSCRIPTS/HEARTBEATS 给的名字不在 SESSION_TARGETS 表
      时，启动输出 WARN（或 fail-closed），非静默忽略
- [ ] AC2: **合法名字不误伤**——表内名字正常处理，零告警（负控制）
- [ ] AC3: **观察目标可验证**——`--once` 报的 pid 与预期目标一致（manager 实例应盯 outer 2989418，
      外层实例应盯 inner 2989409）；名字不匹配时不会悄悄盯错
- [ ] AC4: 与 gap-session-liveness-monitor-watches-self-not-inner（ready）交叉标注——同族：
      观察目标解析/校验；本任务补「名字不匹配」显式化，那条补「目标指向 inner」

## Definition of Done

- [ ] AC1-AC4 实跑输出贴任务体（未知名字 WARN 对照 + 合法名字零告警 + pid 匹配）

## Touches
- plugin/scripts/session-liveness.sh（启动校验：transcript/heartbeat 名字 vs SESSION_TARGETS 表）
- plugin/test/session-liveness.test.mjs（AC1/AC2 测试）
- orchestration/session-liveness.env（若需格式注释）

## Dispatch review

reviewer: none
at: 2026-08-08T12:5xZ
changed: 管理者 12:5x 实测（SESSION_TRANSCRIPTS=outer 但目标表来自 env=inner ⇒ 盯错对象 216s 无人观测，
  非去抖漏报是从未观测）+ 判据建议（未知名字 WARN/fail-closed）。外层复核：:541 只做防重名覆盖不校验
  表成员——成立，立案。
