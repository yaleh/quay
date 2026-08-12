---
id: gap-dead-loop-check-fresh-coldstart-false-running
title: dead-loop-check --check-running 对 fresh cold-start 假阳性 running（冷启动会话自身
  transcript 被当 loop 在跑）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Finding

`plugin/scripts/dead-loop-check.sh --check-running` 对**刚 quay-init 完、从未启动**的 fresh clone 假阳性报 `cold_start_state=running`，导致 cold-start skill step 0 朝 `ALREADY-RUNNING` 分支走（跳过整个冷启动），需 operator 人工诊断才转向 fresh-start。

**实测（self-hosting-e2e-proof 运行，2026-08-12）**：
```
DEAD_LOOP_TRANSCRIPT_DIR=... bash dead-loop-check.sh --check-running --root <fresh clone> → cold_start_state=running
```
而该 clone `.workflow-events/` 不存在、`.quay/loop-driver.jsonl` 不存在、`loop-driver-check.sh` 报 `STALLED (0)`——三项都证明「从未启动」。

## 根因

dead-loop-check.sh 的 `loop_alive` 判定（:170 附近）：「最近 N 分钟目标项目 outer/inner transcript 有新的 user 消息」⇒ alive。**fresh cold-start 时，冷启动外层会话自己的 transcript 正在被写入**（它在跑 step 1-9），被误判成「loop 在跑」。

`:170-173`：`loop_alive=alive` ⇒ 直接 `cold_start_state=running`，**根本不会走到 `never-started` 判定**（`:181-189` 的 `.workflow-events` + `loop-driver.jsonl` 佐证只在 stopped 分支生效）。

**信号无法区分**：transcript user 消息活动 ≠ 真 loop 在跑。冷启动 driver 会话的转录活动与正常 loop 的驱动消息在 dead-loop 判据里无法区分。

## 影响

- cold-start skill step 0 误判 ALREADY-RUNNING ⇒ 跳过冷启动 ⇒ 需要 operator 介入
- **self-hosting-e2e-proof AC2（self_certify=1）的直接阻塞根因**——「无人工验证步」判据因这个假阳性失败

## 修法方向

step 0 在 `loop_alive=alive` 时，不能直接判 running——需佐证区分「冷启动 driver 在跑」vs「真 loop 在跑」：
1. **driver 佐证**：`loop-driver-check.sh` 报 LIVE + `.quay/loop-driver.jsonl` 存在 ⇒ 真 loop 已起
2. **telemetry 佐证**：`.workflow-events/*.jsonl` 有 task-start ⇒ loop 已真正派发过
3. 若 driver 空 + telemetry 空 ⇒ **never-started**（fresh cold-start，应走 fresh-start 分支），即使 transcript 有活动

即：把 `loop_alive=alive` 的判定从「transcript 有活动」收紧为「transcript 有活动 **且** driver/telemetry 佐证 loop 已起」。

## AC

- [ ] 复现固化——任务体记录 fresh cold-start 假阳性（transcript 活动被当 loop 在跑）
- [ ] dead-loop-check 对 fresh clone 报 stopped/never-started（而非 running）
- [ ] cold-start skill step 0 不再误走 ALREADY-RUNNING 分支
- [ ] 既有 dead-loop-check 测试不回归

## DoD

- [ ] 修后 self-hosting-e2e-proof 重跑 AC2 self_certify=1
- [ ] 全量套件绿（fail 0 且 cancelled 0）

## Touches

- plugin/scripts/dead-loop-check.sh（loop_alive=alive 判定收紧：driver/telemetry 佐证）
- plugin/test/dead-loop-check.test.mjs（修法用例）
- tasks/gap-dead-loop-check-fresh-coldstart-false-running.md（自身：勾 AC + 贴证据）

## Dispatch review

reviewer: inner
at: 2026-08-12
changed: self-hosting-e2e-proof 运行中实测（D2）。dead-loop-check loop_alive=alive 判定无法区分冷启动 driver 会话 transcript 活动与真 loop 在跑。