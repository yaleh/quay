---
id: gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close
title: inner panel shows a FROZEN stale agent line after the bracket closed —
  observer-registry line still reads 「Committing observer-registry task work 3h
  5m 32s」 while the bracket was closed (d3fb2839, --task-end needs-human) and
  the task left inProgress at 03:22; same entity, panel and telemetry give
  OPPOSITE states; the frozen line is visually INDISTINGUISHABLE from a live
  agent without cross-time sampling (timer advance), so anyone glancing reads
  「agent ran 3h unfinished」 — same family as tonight's recurring "instrument
  can't distinguish opposite states" (stuck-vs-running → ended-vs-running)
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**inner 面板在括号关闭后仍显示冻结的旧 agent 行——同一实体，面板与遥测给出相反状态。**

### 实测（管理者 2026-08-07，三次采样 03:28:16 / 03:28:25 / 03:31:03）

- inner 面板那行**仍显示**「Committing observer-registry task work **3h 5m 32s**」，而该括号已闭合
  （d3fb2839，`--task-end needs-human`）、已不在 inProgress（外层复验确认）。
- **计时器 3h5m32s 一秒未动**，同屏其它 agent 计时正常前进（1h6m3s→1h6m37s、21m7s→21m41s）。
- 算术对得上：括号 ~00:14 开始，agent 跑 3h5m32s ⇒ ~03:22 结束，任务正是 **03:22:02 转 needs-human**。

### 危害

**已死行与存活行外观完全相同**——唯一区别是计时是否前进，而它需要跨时间两次采样才能分辨。
任何人扫一眼面板都会读成「有个 agent 已跑 3 小时还没完」——实际它已结束十余分钟、括号已闭。
**冻结时长永久留在面板上误导后来者**（人正是因此发问）。

### 与今晚反复出现的一族同形

仪器无法区分两个语义相反的状态。此前是「**卡死 vs 真在跑**」（管理者为此误判过两次），
现在是「**已结束 vs 在运行**」。两个方向都是同一个缺陷：**观测视图没有表达状态转换的机制**，
只能靠人跨时间采样猜。

### 相关但不同（不合并）

- `gap-closed-bracket-leaves-live-agent-consuming-slots`（括号关、agent 进程还活着，资源记账盲区）：
  那条的 agent 进程是**活的**（↑ 输出中）；本条的面板行是**死的**（计时冻结 = 进程已死）——方向相反，
  不合并。
- 本条是**显示/观测**缺陷：面板没在括号关闭时清掉/标记该行。

### 修复方向（接法留执行时）

1. **面板反映遥测状态**：括号关闭（--task-end）时，面板对应行应清除或打上「已结束」标记——
   不能让冻结行与存活行外观相同；
2. **或计时冻结即标记**：面板对 N 秒计时未动的 agent 行打「可能已结束/僵死」标记，无需跨时间采样
   即可分辨；
3. **机械可检出**：括号关闭后该 agent 行仍存在 ⇒ 应可被机械检出（与 instrument-failure 检出器族呼应）。

## Contract

```
measure stale_panel_lines = `tmux capture-pane -p -t quay-0:inner 2>/dev/null | grep -cE 'Committing|Running|Waiting|Execute|Checking|Monitoring|Verifying'` stdout 数字段（与 inProgress 对照的差异面）
invariant 面板上括号已关闭任务的 agent 行不得以「冻结计时」形态与存活行外观相同；观测视图必须表达状态转换
invoke `tmux capture-pane -p -t quay-0:inner 2>/dev/null | grep -E 'observer-registry|Committing'`
control 人为关闭一个括号后保留面板行 ⇒ 检测必须报出该行是冻结行（计时未动）；修复后该行被清除或标记
resume 若中断，先跑 measure 读当前面板残留行，再对照 inProgress 区分存活/冻结
```

## Acceptance Criteria

- [ ] AC1: **面板表达状态转换**——括号关闭后对应 agent 行被清除或打「已结束」标记（不再与存活行外观相同）
- [ ] AC2: **计时冻结可分辨**——面板对计时 N 秒未动的行打标记（或等价机制），无需跨时间采样
- [ ] AC3: **负控制**——人为构造「括号关、面板行留」场景，必须能机械检出该冻结行
- [ ] AC4: 与 `gap-closed-bracket-leaves-live-agent-consuming-slots`（agent 活方向）、
      `gap-manager-instrument-failures-need-mechanical-detection-not-carefulness`（仪器无法区分相反状态族）
      交叉标注——本族两个方向

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体（含修复前后面板对照）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 未来 N 次收尾中，不再出现「括号关、面板行冻结残留」的误导（或被机械检出）

## Touches
- plugin/skills/loop-driver/SKILL.md 或面板观测机制（状态转换表达）
- plugin/scripts/inner-session-check.sh 或等价观测器（冻结行检出）
- tasks/gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close.md（自身文件）
- tasks/gap-closed-bracket-leaves-live-agent-consuming-slots.md（交叉标注）
- tasks/gap-manager-instrument-failures-need-mechanical-detection-not-carefulness.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-07T03:3xZ
changed: 管理者 2026-08-07 观测发现（面板冻结行与遥测相反），请外层判断 → 裁定立案：同族（仪器无法区分
  相反状态）第二个方向 + 显示/观测缺陷，证据充分（3 采样计时冻结 + 算术核对 + 复验）。
