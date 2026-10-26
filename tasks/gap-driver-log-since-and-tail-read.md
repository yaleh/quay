---
id: gap-driver-log-since-and-tail-read
title: driver log --kind worker 没有 --since 且整读 worker-outcome.jsonl；消费方要按时间尾部取
  fan-in attempts
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

`quay driver log --kind worker --json` 是目前唯一输出 mechanical fan-in attempts 的读取面（`packages/quay/src/cli/driver.ts:199` 的 `runDriverLog` → `packages/quay/src/observation/records.ts:365` 的 `readFanInAttempts`）。它：

- **已有 `--limit`**（`driver.ts:214-217`；v0.22.0 起可用——消费方钉的 0.19.0 没有，所以对方看到的是「没有 --limit」）；
- **没有 `--since`**；
- `readFanInAttempts` 用 `readCarrierText` **整读** `.quay/worker-outcome.jsonl`（消费方 4.3MB / 1860 条；本仓库 8MB+），`limit` 是读完之后才 slice（`records.ts:383-385`）。

attempts 的字段已经齐全：`WorkerOutcomeRecord` 的 `ts/task/run_id/final_state/failure_reason` + `MechanicalFanInRecord` 的 `outcome/step/reason/lockHoldSecs/lockAcquireEpoch/lockReleaseEpoch/suiteFinishedEpoch`（`records.ts:108-116`）。

## AC

- [ ] AC1（`--since`）：`quay driver log --kind worker --json --since <ISO8601>` 只返回 `ts >= since` 的 attempts；与 `--limit` 可组合（先按 since 过滤，再取尾部 N 条）。贴三次实跑（无 since / since / since+limit）。
- [ ] AC2（有界读取）：`.quay/worker-outcome.jsonl` ≥50MB 时 `--limit N` 不得整读。贴 ① 合成载体上的墙钟与峰值 RSS；② 一条证明只读尾部窗口的读数（reader seam 统计字节数，或把前半段替换为噪声后结果不变）。⛔ 先整读再 slice。
- [ ] AC3（三态 + 计数语义）：`carrier-absent` / `carrier-unreadable` / `malformed-lines` / `ok` 四态语义不变；尾部窗口内的 malformed 行数与「全文件行数」必须可区分——⛔ 不允许把「只读了尾部」谎报成 `totalLines` 是全文件。输出必须明确该键现在指什么（见 AC4）。贴四条实跑。
- [ ] AC4（输出形状只追加）：不改变 `FanInAttemptsResult` 的既有键；新增信息只能是追加字段（如 `window: {fromByte, toByte, since, truncated}`）。贴改动前后同一 fixture 的 JSON diff。
- [ ] AC5（help/版本）：`packages/quay/src/cli/help.ts` 的 driver 段登记 `--since`，并写明起始版本。

## DoD

- 尾部窗口读取复用 `packages/quay/src/observation/records.ts` 里已为 `worker-round.jsonl` 建立的 tail 读法（同一套 helper），⛔ 不新增第二份窗口逻辑。
- 若 `plugin/scripts/driver-runtime.ts` 也有 attempts 读取路径，保持同一 `readFanInAttempts`（⛔ 不新增第二解析）。
- `packages/quay/test/` 或 `plugin/test/` 有 `node:test` 覆盖 AC1/AC2/AC3。
- `totalLines` 改动后的语义在输出与 help 里写明，⛔ 不得默默改变同一个键的含义。

## Touches

- `tasks/gap-driver-log-since-and-tail-read.md`（自指）
- `packages/quay/src/cli/driver.ts`
- `packages/quay/src/observation/records.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/test/cli.test.mjs`
- `packages/quay/test/observation.test.mjs`