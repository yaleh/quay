---
id: gap-session-idle-true-idle-via-transcript-fusion-and-debounce
title: SESSION-IDLE judged by pane-hash alone can't distinguish true idle from
  between-tool-calls gaps — fuse transcript last-message-type (pure text vs
  pending tool_use) + debounce 2 rounds, per human's accept-FP-avoid-FN risk
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人问「能判断真的空闲等输入吗、能结晶到工具降误报吗」。管理者实测：**能**——transcript 最后一条
assistant 消息**类型**（纯文本 vs 挂起 tool_use）比 session-liveness.sh 现在的 pane 哈希更可靠。

### 证据（管理者实测 + 外层核实）

- `session-liveness.sh:13` 现有判据：「**相邻两轮 pane 哈希相同 = 空闲**」——pane 哈希只答「屏幕
  60 秒内变没变」，**分不清「真空闲」与「两次工具调用间的正常间隙」**（间隙通常几秒到几十秒）。
- 管理者实测（外层 transcript）：00:24:37 完成一条**纯文本轮次** → 00:33 已 8 分半无新工具调用 +
  pane 无忙碌标志 = **真空闲**，不是间隙误判。
- 人的风险偏好（明确）：**可接受误报（持续降低概率），强烈不希望漏报**（虽有 cron 兜底）。

### 选定机制（管理者方案建议，外层判断采纳）

**① 信号融合**：`session-liveness.sh` 现有 pane 哈希 + esc 标志判据，**加一路 transcript 最后一条
消息类型**：

- **纯文本 = 候选闲**（模型已结束回合，无挂起动作）；
- **挂起 tool_use = 确定忙**（回合进行中）；
- **这一路优先级更高**——忙判据不能有漏报（transcript 显示挂起 tool_use ⇒ 绝不可报 idle）。

**② 去抖**：纯 pane 侧候选闲要求**连续 2 轮（120 秒）都闲**才报 SESSION-IDLE（不是现在这样单轮转换
就报）。只会让报告延迟最多一个轮询周期，**不会造成漏报**（真空闲下一轮还是闲），且远在 20 分钟 cron
兜底之内。

**为什么值得**：今晚的「两层都正确空闲 = 没人推进」形态 + R2 AC8 反向坑都源于**无法可靠区分
「真空闲」与「间隙」**。信号融合 + 去抖把「真空闲」判据从 pane 代理变成**结构信号**（transcript 是
已发生事实的日志，不是代理）。

## Acceptance Criteria

- [x] AC1: `session-liveness.sh` 增加 transcript 最后一条消息类型路径——**纯文本 = 候选闲**；
      **挂起 tool_use = 确定忙**（这一路优先级更高，忙判据零漏报）
- [x] AC2: **去抖**——纯 pane 侧候选闲要求**连续 2 轮（120s）都闲**才报 SESSION-IDLE；
      单轮转换不报（只延迟 ≤1 轮询周期，不造成漏报）
- [x] AC3: **负控制（管理者实测场景）**——纯文本轮次 + 8.5 分钟无新工具调用 + pane 无忙碌标志
      ⇒ 必须报 SESSION-IDLE（真空闲被检出，非间隙误判）
- [x] AC4: **负控制（间隙场景）**——两次工具调用间几秒到几十秒的 pane 不动 ⇒ **不得**报 SESSION-IDLE
      （现有 pane 哈希单轮的误报被去抖消除）
- [x] AC5: **忙判据零漏报**——transcript 有挂起 tool_use（回合进行中）⇒ 任何情况下不得报 idle
      （含 pane 恰好不动的情况）
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`
- [x] AC7: 与故障 5/6 关系标注——transcript 是唯一可信信号族（结晶文档故障 5），本任务把它接入
      idle 判据；pane 哈希降级为去抖的候选闲辅助，不再单判

## Definition of Done

- [x] AC1–AC7 全部勾上；AC3/AC4/AC5 的实跑输出逐字贴任务体
- [x] 一次真实对象验证：一个真空闲轮次被报 SESSION-IDLE、一个忙轮次（挂起 tool_use）不被报
      （DIR-026，非构造夹具）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## 实跑输出（AC3/AC4/AC5，2026-08-05 逐字）

### AC3 真·空闲被检出（纯文本轮 + 8 分钟无新工具调用 + pane 无忙碌标志 ⇒ 报 SESSION-IDLE）

```
############ AC3: 真·空闲被检出 ############
--- ac3 monitor stdout:
session-liveness: starting pid=613259 file=session-liveness.sh md5=564f91699f49ca6e
SESSION-IDLE ac3 的会话转入空闲等输入；心跳 8 分钟前更新
```

### AC4 间隙不被报（两次 tool_use 之间恰好一轮纯文本 ⇒ 不得报 SESSION-IDLE）

```
############ AC4: 间隙（恰好一轮纯文本）不被报 ############
--- gap4 monitor stdout (must contain NO SESSION-IDLE before the control):
SESSION-RESUMED gap4 的会话恢复活动（此前空闲；成因：状态变化；上次收到输入：取不到）
--- gap4 positive control (persistent true idle):
SESSION-IDLE gap4 的会话转入空闲等输入；心跳 8 分钟前更新
```

注：间隙期间只出现 SESSION-RESUMED（会话从一轮候选闲回到忙，属「恢复」方向、非 idle 报告，
是既有行为——任何 idle→busy 转换都报 RESUMED），**没有** SESSION-IDLE；随后持续纯文本（真闲）
才报 SESSION-IDLE——证明间隙抑制是去抖的功劳。AC4 判据「不得报 SESSION-IDLE」成立。

### AC5 忙判据零漏报（transcript 挂起 tool_use + pane 恰好不动 ⇒ 永不报 idle）

```
############ AC5: 挂起 tool_use ⇒ 永不报 idle ############
--- ac5 monitor stdout (must contain NO SESSION-IDLE while pending tool_use):
(no SESSION-IDLE emitted while pending tool_use — hard cap holds)
--- ac5 control (pending cleared → true idle):
SESSION-IDLE ac5 的会话转入空闲等输入；心跳 8 分钟前更新
```

### 真实对象验证（DIR-026，非构造夹具——用真实会话 transcript）

```
############ 真实对象验证 A：真实挂起 tool_use transcript ⇒ 不报 idle ############
--- realA monitor stdout:
(no SESSION-IDLE emitted for a REAL pending-tool-use transcript — busy zero-false-negative holds)
seam on the real file: pending-tool-use

############ 真实对象验证 B：真实纯文本 transcript ⇒ 报 SESSION-IDLE ############
--- realB monitor stdout:
SESSION-IDLE realB 的会话转入空闲等输入；心跳 8 分钟前更新
seam on the real file: pure-text
```

真实 transcript 来源：`~/.claude/projects/-home-yale-work-quay/9957a092-….jsonl`（最后消息 = 挂起
tool_use）、`6a950975-….jsonl`（最后消息 = 纯文本）。真实会话数据经真实监视器判忙闲——忙轮次
不被报、真空闲轮次被报，与合成 e2e 一致。

### 测试结果

`scripts/test.sh plugin/test/session-liveness.test.mjs`（含静态检查）：**pass 42 / fail 0 /
cancelled 0 / skipped 1**（跳过 = 真实探针会话 quay-0:probe 本机不在，属 KNOWN-LOAD-SENSITIVE 家族
的既有跳过）。AC3/AC4/AC5 三个 e2e 各连跑 3 次全绿。

### 再验证（inner 执行派发，2026-08-05；实现已落 master b07f67bf）

本次执行派发（worktree `task/gap-session-idle-true-idle-via-transcript-fusion-and-debounce`，off
master 2c1260a5）确认实现与证据已由先前内层落盘，执行路径为验证 + 复跑：

- scoped 门禁 `scripts/test.sh --for-task gap-session-idle-true-idle-via-transcript-fusion-and-
  debounce --allow-thin`：**EXIT=0，pass 42 / fail 0 / cancelled 0 / skipped 1**（skipped = 既有
  探针跳过）。AC1 seam / AC3 / AC4 / AC5 四个本任务新增测试全绿。
- KNOWN-LOAD-SENSITIVE 处理：首次并发 scoped 跑出现过一次 transient 红——既有测试
  `AC3/AC7 — the laid-down script, run --once`（session-liveness.test.mjs:658）在并发下因
  quay-init 的 referenced-not-landed 检查 race 而红；单测串行隔离（`--test-concurrency=1`）
  与 scoped 全量重跑均 **42/0/0/1 绿**。与本次变更无关（该测试未涉及 transcript 融合/去抖），
  判定为并发负载放大，非回归。
- 真实对象复验（DIR-026，独立于任务体既有证据）：`--last-message-type` 对真实会话数据——`9957a092`
  （挂起 tool_use，任务体引用的同一 transcript）→ `pending-tool-use`（忙，绝不报 idle）；
  多个纯文本结尾 transcript → `pure-text`（候选闲）；`e8e80f27`/`6a950975`（结尾为 user 记录）→
  `user-input`（忙）。忙判据零漏报路径在真实 transcript 上成立。

## Touches

- tasks/gap-session-idle-true-idle-via-transcript-fusion-and-debounce.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/session-liveness.sh
- plugin/test/session-liveness.test.mjs

## Contract

measure   idle_report_latency = `bash plugin/scripts/session-liveness.sh --read` stdout 的 IDLE 事件时间字段
band      idle_report_latency = 120000..180000 ms（去抖 2 轮 × 60s = 结构下界；≤1 轮询周期延迟）
invariant busy_no_false_negative = 1（挂起 tool_use ⇒ 永不报 idle）
invoke    `bash plugin/scripts/session-liveness.sh --read`
control   真空闲 ⇒ 报；工具间隙 ⇒ 不报；挂起 tool_use ⇒ 不报（AC3/4/5）
resume    信号融合与去抖分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T00:4xZ
changed: 外层受人问 + 管理者方案立案。四处收紧：
(1) **transcript 消息类型是结构信号不是代理**——它是已发生事实的日志（模型回合结束 vs 进行中），
比 pane 哈希（代理）可靠，恰好是 AC-queue 族「用错仪器」教训的正解；
(2) **忙判据零漏报（AC5）单独钉死**——人的风险偏好是防漏报优先，transcript 挂起 tool_use 是不可
报 idle 的硬上限；
(3) **去抖（AC2）只延迟不漏报**——真闲下一轮还是闲，2 轮判据最多晚报一个轮询周期，20 分钟 cron
兜底之内；
(4) **AC7 与故障 5/6 挂钩**——transcript 唯一可信信号族接入 idle 判据，pane 哈希降级为候选闲辅助。
status: todo——排在 gap-init-ships（卡自建目标，管理者优先）之后；不阻塞当前批。
