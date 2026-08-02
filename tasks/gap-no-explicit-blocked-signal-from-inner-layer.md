---
id: gap-no-explicit-blocked-signal-from-inner-layer
title: "The inner layer stops and waits with no way to say so — the outer can
  only infer it from an absence"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

内层停下等裁定是**设计内的**——它是外层存在的理由（`orchestration/orchestrator-loop-tick.md` 定位段）。
但内层**没有任何办法说出「我停下了、在等什么」**。外层只能从两种间接迹象猜：

1. **读 TUI**：`tmux capture-pane` 比对两次 md5 看屏幕是否在变。ADR-016 已明确判定读屏是权宜手段
   （「never parse the TUI」），且它不可产品化
2. **遥测的空集**：`fast-mode-telemetry --report` 的 `inProgress` 为空。**这是一个从缺席推断存在的
   信号，会错**——2026-08-02 实测：内层正在做 M243 抢救（合并、诊断、跑测试），而 `inProgress`
   为空，因为抢救类工作跑在 `--task-start`/`--task-end` 括号之外。此时内层在忙，信号显示 IDLE

后果是**死时间不可测也不可压**。当前唯一的兜底是 20 分钟 tick，而 tick 由 cron 触发、cron 只在
外层会话空闲时 fire——外层和人对话期间根本不触发。内层实际等了多久，**我们没有任何数据**。

## Chosen mechanism

**内层在停下时写一个结构化的阻塞记录；外层 Monitor 该文件。**

1. **`.quay/inner-blocked.json`**（gitignored，与 `gate-events.jsonl` 同类）：

   ```json
   {"since": 1785700000000, "taskId": "…", "reason": "ruling-required",
    "question": "M243 冲突按 A 还是 B", "options": ["A: …", "B: …"],
    "evidence": ["20 tests / 6 pass / 14 fail", "tampered 负控制也失败"]}
   ```

   `reason` 取自内层已有的停摆条件：`merge-conflict` / `suite-red` / `review-refuted` /
   `task-over-90m` / `needs-human-backlog` / `ruling-required` / `queue-empty`。

2. **写在停下的那一刻，删在恢复的那一刻。** 文件存在 == 内层在等。这是**存在性信号**，
   不是从缺席推断。

3. **外层 Monitor 用 `inotifywait` 监视该路径**，延迟从最多 20 分钟降到秒级。事件里直接带上
   `question` 与 `evidence`，外层不必再读屏就能开始判断。

4. **顺带得到死时间计量**：`since` 到文件被删的时间差就是这一次的等待时长。累计写进遥测，
   **这个数当前完全没有**。

### 为什么这条同时是阶段 2 的交付物

`orchestration/exp6-phase1-sustained-unattended-operation.md` §D 记着：双层机制要随 quay 产品交付，
而其中**层间通信（读 TUI）与排程（会话内 cron）是两个不可产品化的缺口**。本任务把第一个缺口
换成一个**文件协议**——不依赖终端、不依赖某个 Claude Code 会话活着、任何实现都能读写。

**不做**：不改排程（会话内 `CronCreate`/`Monitor` 的会话生命周期问题是另一件事）。
不让内层自动恢复——它仍然停，只是**能说出自己停了**。

## Acceptance Criteria

- [ ] AC1: `.quay/inner-blocked.json` 的 schema 定义并进 `.gitignore`
- [ ] AC2: `reason` 的合法值就是内层已有的停摆条件，不新增语义
- [ ] AC3: 内层 tick 文件（`docs/analysis/fast-mode-loop-tick.md`）要求：停下前写、恢复后删
- [ ] AC4: 一个 `--assert-blocked` / `--clear` 的小 CLI，内层调它而不是手写 JSON（避免格式漂移）
- [ ] AC5: 文件存在时 `restart-readiness-check.sh` 打印它（内层在等裁定 ≠ 可以解除 `.halt`）
- [ ] AC6: 外层 Monitor 脚本改用 `inotifywait` 监视该路径，事件带 `reason` + `question`
- [ ] AC7: 等待时长（`since` → 删除）记进遥测，`--report` 输出累计死时间与单次最长
- [ ] AC8: **真实演练**：内层制造一次阻塞 → 外层在 60 秒内收到带 `question` 的事件 → 裁定 →
      内层清除 → 死时间被记录。全过程输出贴进任务体
- [ ] AC9: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] AC8 的端到端演练有完整记录（时间戳可对照）
- [ ] 任务体记录演练那一次的死时间，作为此后对比的第一个基线数
- [ ] `scripts/test.sh` 绿
- [ ] 明确记录：本任务**不让内层自动恢复**，只让它能说出自己停了

## Touches

- plugin/scripts/inner-blocked-signal.ts
- plugin/test/inner-blocked-signal.test.mjs
- plugin/scripts/fast-mode-telemetry.ts
- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
- orchestration/watch/inner-state.sh
- docs/analysis/fast-mode-loop-tick.md
- .gitignore
