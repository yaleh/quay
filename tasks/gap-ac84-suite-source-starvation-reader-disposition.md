---
id: gap-ac84-suite-source-starvation-reader-disposition
title: AC84 退役外层自动 suite 后我的读取源断供——ready-pool red-window 车道错配 + full-suite-state 无 writer + verification-round 断供，统一处置
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（outer 2026-08-15 13:0xZ 报三条发现，均与 inner 面相关——AC84 退役外层自动 suite 的直接后果）**。

**背景**：AC84（人 09:47Z 裁定 outer 不跑 suite）后，遗留的 suite-state-trigger Monitor（pid 2507531）被 outer 于 13:03Z 击杀 ⇒ 外层不再有自动轮 ⇒ **我多个读取源不再被写**。

**三个发现（同族：读取源断供）**：
1. **ready-pool-check red-window 车道错配（结构性失效，自 round24/08-12 11:37 起）**：`defaultLaneCount()`（full-suite-runner.ts:1555）= `max(1, floor(ncpu*oversub/slots))` = 16×1/2 = **8**；runner 实际记录 `laneCount=16`（rounds 177/212）。⇒ `isExperimentRound(r, 8)` 把每条正常轮判为实验轮排除 ⇒ `consecutiveRed` 恒 0 / `window_active` 恒 false——**红窗节流结构性失效**。实测对照：defaultLane=8 → window_active=false；defaultLane=16 → consecutiveRed=5 window_active=true。
2. **full-suite-state.json 无 writer**：遗留 Monitor 是最后一个 writer，已死 ⇒ 主检出 `.quay/full-suite-state.json` 冻结在 `red@37a13c1d`（superseded commit）+ 5 条 phantom failures[]。`fan-in-ff-merge.sh:185` 只 block `running` ⇒ 现无害；但若未来被任何机制写成 running 后 crash，watchdog 已随 Monitor 死，无人翻回终态（永久 stale 值）。
3. **verification-round.jsonl 断供 + phantom reds**：AC84 后 outer 不再写 verification-round.jsonl；尾部 5 条 phantom red（rounds 208-212，遗留 Monitor post-ruling 期写、验 orphaned commit）若 red-window 数据源仍读它会触发节流。

**不覆盖**：不改 AC84 本身（外层无自动轮是既定裁定）；不恢复 Monitor。

## Plan

1. 修 ready-pool-check 车道错配：defaultLane 参考默认对齐 runner 实际记录的车道（16），或 isExperimentRound 改读 runner 实际默认——使正常轮不再被误判为实验轮。
2. red-window 数据源迁移：verification-round.jsonl → per-task-suite-records.jsonl（同 trend-check 判据6 先例），并处理 phantom reds（不触发节流）。
3. full-suite-state.json writer/退役裁定：AC84 后谁写（或无）；若保留需 crash-watchdog 替代；fan-in-ff-merge 判据是否改读 per-task-suite-records。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 车道错配修：isExperimentRound 不再把正常轮（laneCount=runner 实际默认）判为实验轮；consecutiveRed/window_active 恢复真实读数（实测对照：默认对齐后 consecutiveRed 非恒 0）。
- [x] AC2 数据源迁移：red-window 节流读 per-task-suite-records.jsonl（AC84 后唯一持续 suite 数据源）；verification-round.jsonl 不再作节流输入；phantom reds（208-212）不触发节流。
- [x] AC3 full-suite-state.json 处置：writer 归属明确（AC84 后谁写）或正式退役；fan-in-ff-merge 判据与数据源一致；crash-watchdog 缺口有替代或文档化。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Evidence（实测对照）

**AC1 车道错配 — 修前后 consecutiveRed/window_active（真实 verification-round.jsonl，212 行）**：

| 参考默认 | 来源 | consecutiveRed（尾部） | window_active |
|---|---|---|---|
| 8（旧：env 派生 `defaultLaneCount()`，oversub=1） | checker 自己 env | **0**（恒） | false（恒） |
| 16（修后：`deriveDefaultLane` = runner 实际记录 laneCount 的众数，rounds 177/212 均为 16） | 记录数据 | **5**（尾部 rounds 208-212 全 red） | true |

laneCount 分布：`{16:177, 8:32, None:3}`；尾部 rounds 207=green、208-212=red（均 lane 16）。旧路径把每条正常 lane-16 轮误判为实验轮排除 ⇒ 恒 0（自 round24 结构性失效）；修后默认对齐 16 ⇒ consecutiveRed 非恒 0。

**AC2 数据源迁移 — 修前后节流读数（真实 per-task-suite-records.jsonl，41 行）**：

| 数据源 | 尾部 consecutiveRed | window_active |
|---|---|---|
| verification-round.jsonl（旧，断供 + phantom） | 5（phantom tail 208-212，遗留 Monitor post-ruling 写、验 orphaned commit） | true |
| per-task-suite-records.jsonl（新，AC84 后唯一持续源） | **0**（41 行全 green；10 条非 skip 全量均为 green，lane 16） | false |

迁移后 phantom reds（208-212）不再作节流输入 ⇒ 不触发节流。`collectFailureFiles` 归一化 per-task `failedFiles`（字符串数组）；`consecutiveRedRounds` 把 doc-only skip（`fullSuiteRan=false`）当中性（不计数、不断窗）。

**AC3 full-suite-state.json 处置（选 ① 正式退役）**：
- writer 归属：AC84 后 **无 writer** —— 唯一 loop 调用者 suite-state-trigger Monitor 已死；per-task fan-in 套件直跑 `bash scripts/test.sh`（记 per-task-suite-records），从不经 runner 写该文件。文件冻结在 `red@37a13c1d` + phantom failures。
- ready-pool-check 红窗 reader **不再读** full-suite-state.json（改由 per-task red 记录的 failedFiles 承担归因）。
- fan-in-ff-merge.sh 的「suite running」guard **改读直接量** —— test.sh 的 single-flight 锁槽（`<git-common-dir>/full-suite.lock.0/.1`，跨 worktree 同一 inode）：任一拍 held ⇒ 拒绝取 merge 锁（AC4）。flock 崩溃即自动释放 ⇒ crash-watchdog 缺口结构性闭合（无需 watchdog）。
- 已知残留 reader：slot-refill.ts 的 `suite_red` DIAGNOSTIC（`readSuiteRed`）仍读该文件 —— 不在本任务 Touches，仅诊断非触发（真实触发是 `red_window_active`，来自 per-task-suite-records）。

**AC4**：`scripts/test.sh --for-task gap-ac84-suite-source-starvation-reader-disposition --allow-thin` 绿（静态检查全 PASS + 275 tests / 0 fail / 0 skip，EXIT=0）。新增 4 组 AC1/AC2 单测（deriveDefaultLane / 修前后对照 / per-task failedFiles+skip 语义 / 真实 per-task ledger 对照）。

## Definition of Done

- [x] AC84 后 inner 读取源全部有明确归属（per-task-suite-records 为唯一持续源），车道错配修复，red-window 节流恢复有效，full-suite-state 处置完毕，无 stale/phantom 数据误导判定。

## Touches

- plugin/scripts/ready-pool-check.ts（车道默认对齐 + red-window 数据源迁移）
- plugin/scripts/full-suite-runner.ts（defaultLaneCount 对齐 runner 实际记录，如需）
- plugin/scripts/fan-in-ff-merge.sh（full-suite-state 判据处置，如需）
- plugin/test/*（对应测试）
- tasks/gap-ac84-suite-source-starvation-reader-disposition.md（自身）
