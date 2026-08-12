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

- [x] 复现固化——任务体记录 fresh cold-start 假阳性（transcript 活动被当 loop 在跑）
- [x] dead-loop-check 对 fresh clone 报 stopped/never-started（而非 running）
- [x] cold-start skill step 0 不再误走 ALREADY-RUNNING 分支
- [x] 既有 dead-loop-check 测试不回归

## 修后验证（inner 实现 agent，2026-08-12）

`loop_alive=alive` 的 `--check-running` 判定已收紧：alive 时先查 `dl_has_start` 佐证
（`.quay/loop-driver.jsonl` driver 注册 + `.workflow-events/*.jsonl` task-start 遥测），
alive + has_start ⇒ `running`；alive + 无佐证 ⇒ `stopped/never-started`。佐证提取为
`dl_has_start()`，stopped 分支复用同一函数（行为不变，仅去重）。

**手动复现（fresh clone：活跃 transcript + 无 driver/telemetry）**：
```
cold_start_state=stopped
stopped_reason=never-started
next_step=restart
```
修前此场景报 `cold_start_state=running`（假阳性）。

**修法用例（dead-loop-check.test.mjs 新增 6 条）**：
- fresh transcript + 无佐证 ⇒ stopped/never-started（核心负控制，修前 running）
- fresh commit + 无佐证 ⇒ stopped/never-started（git 信号同形假阳性）
- fresh transcript + `.quay/loop-driver.jsonl` ⇒ running
- fresh transcript + `.workflow-events` task-start ⇒ running（无 driver 也可）
- dead + 无佐证 ⇒ stopped/never-started（既有行为不变）
- started-but-stopped（有 driver、陈旧、backlog 空）⇒ queue-empty（stopped 分支复用 dl_has_start 不回归）

**cold-start-check-running.test.mjs 同步修正**：原「fresh commit + started:false ⇒ running」用例
编码的就是本缺陷语义，改为 started:true（真 running 必带启动佐证）+ 新增 fresh commit 无佐证 ⇒
never-started 负控制。

**读数**：`dead-loop-check.test.mjs` 14/14；`cold-start-check-running.test.mjs` 10/10；
`bash scripts/test.sh --for-task gap-dead-loop-check-fresh-coldstart-false-running` exit 0（fail 0 / cancelled 0）。

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

## Evidence

（scoped 验证，2026-08-12，task 分支 `task/gap-dead-loop-check-fresh-coldstart-false-running`，fork 自 integration @ 1d75ac00）

实现已在 integration `93c903ea`（inner 实现）合并。本 agent 复验 + 记录证据：

1. `bash scripts/test.sh --for-task gap-dead-loop-check-fresh-coldstart-false-running` → exit 0
   - dead-loop-check.test.mjs 14/14（pass 14 / fail 0 / cancelled 0）
   - 静态闸全过：task-contract-check no violations / adr016-screen-use-check 0 / superseded-capability PASS / dead-code-after-return 0 / tick-core-static-check PASS / delivery-inventory-drift-gate PASS
2. `node --test plugin/test/cold-start-check-running.test.mjs` → 10/10（pass 10 / fail 0 / cancelled 0）——同步修正后的 cold-start 消费方不回归
3. 手动复现（fresh clone + 活跃 transcript + 无 driver/telemetry）：
   ```
   cold_start_state=stopped
   stopped_reason=never-started
   next_step=restart
   ```
   修前此场景报 `cold_start_state=running`（假阳性）。同一 clone 加 `.quay/loop-driver.jsonl` 后：
   ```
   cold_start_state=running
   next_step=none
   ```

AC 1-4 已勾选；DoD 两条（self-hosting-e2e-proof 重跑 AC2 self_certify=1、全量套件绿）不在本次 scoped 范围，留待外层。