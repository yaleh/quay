---
id: gap-ac84-suite-source-starvation-reader-disposition
title: AC84 退役外层自动 suite 后我的读取源断供——ready-pool red-window 车道错配 + full-suite-state 无 writer + verification-round 断供，统一处置
status: ready
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

- [ ] AC1 车道错配修：isExperimentRound 不再把正常轮（laneCount=runner 实际默认）判为实验轮；consecutiveRed/window_active 恢复真实读数（实测对照：默认对齐后 consecutiveRed 非恒 0）。
- [ ] AC2 数据源迁移：red-window 节流读 per-task-suite-records.jsonl（AC84 后唯一持续 suite 数据源）；verification-round.jsonl 不再作节流输入；phantom reds（208-212）不触发节流。
- [ ] AC3 full-suite-state.json 处置：writer 归属明确（AC84 后谁写）或正式退役；fan-in-ff-merge 判据与数据源一致；crash-watchdog 缺口有替代或文档化。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] AC84 后 inner 读取源全部有明确归属（per-task-suite-records 为唯一持续源），车道错配修复，red-window 节流恢复有效，full-suite-state 处置完毕，无 stale/phantom 数据误导判定。

## Touches

- plugin/scripts/ready-pool-check.ts（车道默认对齐 + red-window 数据源迁移）
- plugin/scripts/full-suite-runner.ts（defaultLaneCount 对齐 runner 实际记录，如需）
- plugin/scripts/fan-in-ff-merge.sh（full-suite-state 判据处置，如需）
- plugin/test/*（对应测试）
- tasks/gap-ac84-suite-source-starvation-reader-disposition.md（自身）
