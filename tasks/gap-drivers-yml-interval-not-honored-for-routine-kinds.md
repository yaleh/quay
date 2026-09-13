---
id: gap-drivers-yml-interval-not-honored-for-routine-kinds
title: drivers.yml 声明的 interval_ms 对例程型 kind 未生效 —— 声明 30 秒，实际是 supervisor 每 5 秒重启一次
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**症状（2026-09-13 实测，在 ad-arm1 的 archguard 上）**：`plugin/scripts/drivers.yml` 为 `goal`/`quality`/`meta` 三个例程型 kind 声明：

```yaml
  goal:
    interval_ms: 30000   # 循环滴答（每轮跑一遍 goal 机械环：跑 criterion→写 evidence→I2 flip→I3/I4）
```

而 `.quay/goal-driver-supervisor.log` 的实际节奏是：

```
2026-09-13T02:29:15Z supervisor: started driver pid=4038030
2026-09-13T02:29:15Z supervisor: driver exited code=0
2026-09-13T02:29:15Z supervisor: respawning driver in 5s
2026-09-13T02:29:20Z supervisor: started driver pid=4038202
2026-09-13T02:29:21Z supervisor: driver exited code=0
2026-09-13T02:29:21Z supervisor: respawning driver in 5s
```

⇒ driver **每轮跑完即 `exit 0`**，由 supervisor 以**固定 5 秒**重启，**声明的 30000ms 从未参与节奏**。driver 侧日志证实它确实在干活（`currentRound: 3`、`poolCount: 0`、`lastJudgeState: state-file-absent (fail-open: never judged ⇒ 该跑)`），所以这不是「driver 坏了」，而是**轮询节奏的声明与实际是两回事**。

**为什么值得修**：`drivers.yml` 的头注释逐字自称是「并发 cap / 轮询间隔 / 协调地板 的**单一真相源**」，且 AC155 专门为此立过。一个被声明为单一真相源、实际却不被消费的字段，**与「配置了但没生效」同形**——读配置的人会以为改它能调节奏，而实际不能（本仓库硬规则 3b 的同族：可配置 ≠ 已生效）。

**待查明（Plan 第 1 步的产出，⛔ 不要在此处预设结论）**：是 supervisor 起 driver 时未传 `--interval`（导致 driver 走单轮模式）、还是该字段对例程型 kind 根本没有消费者、抑或 5 秒是另一处独立的重启退避常量。`goal-driver.ts:38-39` 的用法注释显示它**同时支持** `--once` 与 `--interval <ms>` 两种模式，两条路都存在。

## Plan

1. **先定位消费者**：grep `interval_ms` 的读取点，打印命中内容；确认 `goal`/`quality`/`meta` 三个 kind 的值**是否被任何代码读过**（零命中须配正控制——用 `promotion`/`worker` 的同字段验证谓词有效）。
2. **定位那个 5 秒**：它是硬编码常量还是另一个配置项？打印其定义位置与取值。
3. **决定正确形态**：例程型 kind 应当 (a) 由 supervisor 按 interval 定时重启单轮进程，还是 (b) driver 自身常驻并按 interval 循环？**给出选择理由**，⛔ 不要两种都实现。
4. **接线**：让声明值真正决定节奏。
5. **⛔ 不得顺手改 `promotion`/`worker`**：这两个 kind 当前工作正常（实测本机 promotion 31 进程、worker 1 进程持续运行），改动面须限定在例程型 kind。

## Acceptance Criteria

- [ ] AC1 能取假：把某个例程型 kind 的 `interval_ms` 从 30000 改成一个明显不同的值（如 90000）⇒ 实际轮次间隔**必须随之改变**；打印改前/改后连续三轮的时间戳做对照。今天此项为假（改它不影响 5 秒节奏）。
- [ ] AC2 零消费者已消除：`interval_ms` 对三个例程型 kind 各有至少一个真实读取点，打印命中内容（⛔ 计数不贴内容不算）。
- [ ] AC3 不回归：`promotion`/`worker` 的轮询行为与改动前一致——打印改前/改后各三轮时间戳对照。
- [ ] AC4 那 5 秒有归属：说明它是被保留（作为崩溃退避，与正常轮询节奏是两回事）还是被取代；若保留，两者的分工要写进代码注释。

## Definition of Done

- 四条 AC 满足，AC1/AC3 的时间戳对照有实际留档。
- ⛔ 不得通过删除 `drivers.yml` 里的 `interval_ms` 声明来「消除不一致」——那是把单一真相源变成没有源。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## Touches

- plugin/scripts/drivers.yml
- plugin/scripts/driver-config.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/driver-config.test.mjs
- tasks/gap-drivers-yml-interval-not-honored-for-routine-kinds.md
