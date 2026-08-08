---
id: gap-session-liveness-busy-mask-idle-with-subagents
title: "session-liveness 对带后台任务的停摆结构性失明（inner 16 窗口 100% IDLE 漏报）——压制源 = pane_busy 抖动（成因无证据不猜修；D2「有 subagent⇒忙」已撤）；D3 去抖不对称（RESUMED 单轮/IDLE 2 轮）硬事实；D5 SEEN_BUSY 起始门吞掉挂载时已进行的停摆；D4 CANT-SEND 无时效无限重发；人裁定：inner 停下即使有 subagent 也必须报 IDLE，收到后查 inner 槽位——AC25/AC22 一直卡住的机制原因"
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

**session-liveness 的忙标志假阳性把【带后台任务的主循环停摆】整类静默掉——而这恰是最需要上报的一类。**

### 实测（manager 2026-08-08 13:0x 两小时全量对账，meta-cc 取证，空隙阈值 90s）

**地面真相**：outer 停 12 次 / 合计 4528s（63%）；inner 停 16 次 / 5552s（77%）。
**实收**：manager 收到 SESSION-IDLE 5 条，前 4 条对得上 outer 窗口（延迟 89-139s ≈ 2 轮，符合设计）。
**outer 12 窗口只报出 4 个（漏 67%）**，漏掉的含 842s（12:08:52→12:22:54，正是人 12:21 抱怨那次）、
533s、475s。**outer 侧收到 3 条全是 SESSION-RESUMED，SESSION-IDLE 零条 ⇒ inner 16 窗口 100% 漏报。**

### D2 忙标志（2026-08-08 13:1x 更正——D2「有后台任务⇒恒判忙」撤回）

**原 D2 论断撤回**：manager 反证——外层此刻屏幕有 2 monitors + ← 1 agent 但**无 esc to interrupt**，
分类器判 waiting-input 非 busy。**忙标志跟的是主循环，不是后台任务。别按 D2 改判据。**
（pane-state-classify.ts:344 的 green-busy fixture = 空输入+esc+agent⇒busy 仍存在，但那描述的是
「esc 出现」的忙，非「有 agent 就忙」。）

### D3 去抖不对称（直证，RESUMED 归属更正后仍硬）

RESUMED 单轮沿即报（:199），IDLE 要连续 2 轮（:168/1000-1002）——**不对称本身仍是硬事实**。
（原「3 条 RESUMED 有 2 条发在 inner 空隙内部」**撤回**——manager 对错了会话：SESSION_TARGETS=inner
是 12:26 ba0c1968 才写进 env，之前 bdc5e5fw2 盯的是 outer 自己；对着 outer 时间线 11:54:24 与
12:23:53 都是合法的，分别紧跟 11:53:43 和 12:22:54 的复活。②i-B 类——拿一个序列解释另一个对象。）

**撤掉错证据后抖动反而被更干净地证明（这条是硬的）**：outer 12:08:52→12:22:54 窗口 = 842s ≈ 14 轮
（INTERVAL=60），窗口内 SESSION-IDLE 零条 ⇒ IDLE_CONSEC 从未到 2；窗口结束 12:23:53 发出 RESUMED，
其触发条件 PREV_IDLE==1 ⇒ idle 曾为 1。**两者合起来：连续 14 轮里 idle 反复 1,0,1,0…，从未连着两轮
为 1**。会话这 14 分钟零 transcript 记录，所以**抖动源只在 pane 侧**。

### 覆盖率账

现机制对「主循环空转且无后台任务」可报（4/8 命中），对「停在提示符但有后台任务」**结构性零覆盖
（0/16）**。inner 几乎总有 subagent ⇒ **inner 的停摆对上层永远不可见。**

### 人裁定（本轮）

**inner 停下时即使有若干 subagent 在跑，也必须报 IDLE 事件；外层收到后必须去查 inner 的槽位是不是满。**

### 修法方向（实现归外层/内层，判据建议）——压制源在 pane_busy 抖动，成因无证据不猜

**manager 2026-08-08 13:1x 更正后的硬事实**：transcript 侧判闲不是压制源（outer 12/12、inner 14/16
窗口起点都是 pure-text）；报告闸 -eq 边沿语义正确不是压制源；**压制源确定在 pane_busy 的抖动上，
但抖动成因无证据，不要猜着改。**

**建议的第一步（manager）**：把每轮的 pane_state 原样记一行到日志（state + 区域几行原文），
跑 15 分钟，抖动的形状会自己显形——再据形状修。

1. **先观测**：每轮 pane_state（state + 区域原文）记日志 15min，定位抖动形状（不做猜测修）；
2. **RESUMED 与 IDLE 同阶去抖**——否则事件对在语义上不成立（D3 不对称是硬事实）；
3. **人裁定落地**（需求非诊断）：inner 停下（transcript 无写入）即使有 subagent 也要报 IDLE；
   外层收到 IDLE 后查 inner 槽位是否满（AC25/AC22 的机制衔接）。

## Contract

```
measure pane_state_logged = 运行 session-liveness ≥15min 后 `.quay/` 下日志出现每轮 `pane_state=<state>` 行（≥1）stdout 数字段
band pane_state_logged = ≥1（抖动形状可观测；先观测再修）
invoke `bash plugin/scripts/pane-state-classify.ts` 对照 inner 实时屏幕
control 负控制：观测期不提前改判据（抖动成因无证据不猜修）；真忙仍判 busy
resume 若中断，先跑 measure 读 pane_state 日志是否在记，不要假设已修
```

## Acceptance Criteria

- [ ] AC0: **先观测**——每轮 pane_state 记日志 ≥15min，抖动形状显形（不做猜测修）
- [ ] AC1: **IDLE 可报**——inner 停下（transcript 无写入）即使有 subagent 也报 SESSION-IDLE
      （人裁定；对照当前 inner 16 窗口 100% 漏报）
- [ ] AC2: **同阶去抖**——RESUMED 与 IDLE 用同一去抖深度（D3 修复）；事件对语义成立
- [ ] AC3: **人裁定落地**——带 subagent 的 inner 停摆报 IDLE；外层收到后查 inner 槽位（AC25/AC22 衔接）
- [ ] AC4: **覆盖率改善**——inner 停摆从 0/16 报出到 ≥ 大部分报出（对照实测）
- [ ] AC5: 与 gap-session-liveness-monitor-watches-self-not-inner、ignores-unknown-transcript-names
      交叉标注（观察家族：目标/名字/忙判定）
- [ ] AC6: **D5 修复（SEEN_BUSY 起始门）**——挂载时已在进行的停摆也必须可报：
      IDLE 闸不能要求「挂载后见过忙轮」（:1043 SEEN_BUSY==1 是 :1003 忙分支才置）——
      **每次重挂监视器都会把当时正在进行的那次停摆整段吞掉**（重挂恰发生在「发现坏了」=停摆进行时）。
      复现（manager）：INTERVAL=10 对可证空闲的 inner（屏幕 waiting-input、transcript 静止 3min+、
      subagent 跑 3m35s）跑满 6 轮，**SESSION-IDLE 零条**；同期照常发 SATURATED/MARKER-STALE
      ⇒ 监视器在跑，是起始门吞了停摆。
- [ ] AC7: **D4 修复（CANT-SEND 无限重发）**——API_ERROR_WINDOW 判据须加时效：
      该错误记录须**晚于本段空闲起点**（不能只是「最近 200 条含 ≥1 isApiErrorMessage」），
      且同一段空闲内**边沿触发一次**。复现（manager 三次）：13:04:47 API Error 恢复后 13:08:47
      正常应答，但记录仍在 200 条窗口内（12:43→13:09=26min），13:06/13:09/13:11 连收三条
      「不可自愈类立即升级给人」⇒ **一次瞬时网络错误把此后 26 分钟的每次空闲都升级成叫人告警**。

## Definition of Done

- [ ] AC1-AC7 实跑输出贴任务体（带 subagent 停摆报 IDLE 对照 + 去抖同阶 + 覆盖率前后 + D5 起始门 + D4 时效）

## Touches
- plugin/scripts/session-liveness.sh（每轮 pane_state 记日志先观测 + D3 同阶去抖 + 人裁定落地）
- plugin/test/session-liveness.test.mjs（AC0/AC1/AC2 测试）
- orchestration/manager-phase-goal.md（人裁定交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-08T13:0xZ
changed: 管理者两小时全量对账（outer 12 窗口漏 67%、inner 16 窗口 100% 漏报）+ D2 忙假阳性（green-busy
  fixture = 空输入+esc+agent⇒busy，inner 实时屏幕同形态）+ D3 去抖不对称（RESUMED 单轮/IDLE 2 轮）
  + 人裁定（带 subagent 的停摆必须报 IDLE）。外层复核 pane-state-classify.ts:344 + inner 屏幕——成立。
