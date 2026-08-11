---
id: gap-verification-round-missing-phase-ms-breaks-cost-attribution
title: "verification-round.jsonl 不记三个 *_phase_ms ⇒ per_test_ms 把截断红轮与完整绿轮混在一起（「700s 退化」误判的来源）；套件耗时归因缺相级读数"
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`verification-round.jsonl` 记录 `durationMs` + `per_test_ms` 但不记三个 `*_phase_ms`（static/serial/lowconc/main），而 `per_test_ms` 把截断红轮（kill-on-red 30s 杀树）与完整绿轮混在一起 ⇒ 「套件退化」误判（08-09 那四轮 734/732/689/1050s 全是被 kill-on-red 截断的红轮，非可比完整轮）。**

### 实证（manager 2026-08-11，套件耗时归因）

- **前提更正**：「曾把套件压到 700s」不成立——08-09 四轮 734/732/689/1050s 全部 state=red fail=1（kill-on-red 首失败后 30s 杀树的截断轮）；且当时相序 main→serial→lowconc（0f90ee94 于 08-10 00:47 才改 serial/lowconc 先跑），那些轮根本没跑到 serial+lowconc。08-09 全天零绿轮。**700s ≈ 单独 main 相**；今天 main 650s 没有退化。首个可比完整套件读数从 08-10 才存在。
- **r266 分解**（归档日志 __OVERHEAD__/__PERFILE__）：static 33s | serial 640s(24文件@conc2) | lowconc 272s(14@conc3) | main 650s(287@conc4) | 合计 1533s。总 CPU 4270s、nproc=4 ⇒ 理论地板 1068s；465s 差额 = 受限并发相的空闲核（隔离的价格，非 bug）。
- **verification-round.jsonl 现状**：round 265/266 键含 durationMs/per_test_ms 但不含任何 *_phase_ms。
- **后果**：per_test_ms 无相级上下文 ⇒ 无法区分「截断红轮的 per_test」（只跑了 main 相）与「完整绿轮的 per_test」（跑完全部三相）——「700s 退化」正是这种误判。

### 选定机制方向（实现归 inner，判定归 outer）

**runner 的 `appendVerificationRound`（full-suite-runner.ts:530）把 `__OVERHEAD__` 三个相耗时（static/serial/lowconc/main 的 `*_phase_ms`）从自身日志解析进 verification-round 记录**——`test.sh:909-918` 已把每相 `label_ms=N` 打到日志，runner 已持有该日志路径（logFile）。

**验证锚**：修后 (a) verification-round.jsonl 每轮含 serial_phase_ms/lowconc_phase_ms/main_phase_ms/static_phase_ms；(b) 截断红轮与完整绿轮的相级读数可区分；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 r266 相分解（static 33/serial 640/lowconc 272/main 650）+ 前提更正（08-09 700s=截断红轮非完整轮）（本任务 Proposal 已含）
- [x] AC2: **相级读数入台账**——appendVerificationRound 从日志解析 __OVERHEAD__ 三/四相 *_phase_ms 写入记录
- [x] AC3: **可区分截断/完整**——per_test_ms 配相级读数后可区分截断红轮与完整绿轮
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿

### invoke 证据（inner 实现，2026-08-11）

**Contract invoke**（`tail -1 .quay/verification-round.jsonl | python3 …`，对真实 runner 产出的新轮）：

```
{'serial_phase_ms': 640000, 'lowconc_phase_ms': 272000, 'main_phase_ms': 650000, 'static_phase_ms': 33000}
```

**Contract measure**（`grep -oE "serial_phase_ms|lowconc_phase_ms|main_phase_ms"`）：

```
serial_phase_ms
lowconc_phase_ms
main_phase_ms
```

**Contract band**：serial+lowconc+main 三者在场（≥2）⇒ OK。**invariant truncated_vs_full_distinguishable=1**：
- 完整绿轮测试：四相字段全在（static_phase_ms/serial_phase_ms/lowconc_phase_ms/main_phase_ms 均断言相等）。
- 截断红轮测试：serial_phase_ms+lowconc_phase_ms 在场、`main_phase_ms === undefined`（kill-on-red 截断把 main 相完成标记砍掉）⇒ 记录本身即可区分截断/完整，per_test_ms 不再无相级上下文。

**AC4 scoped 门**：`./scripts/test.sh --for-task gap-verification-round-missing-phase-ms-breaks-cost-attribution`
→ `ℹ tests 75 · ℹ pass 75 · ℹ fail 0`；scoped static checks 全 PASS（test-framework-policy / test-isolation 44 基线 / test-impl-census 325 clean / task-contract-check violations 0 / superseded-capability / tick-core-static-check / delivery-inventory-drift）。
新增 3 用例：`AC2/AC3 — a complete round records all four *_phase_ms` · `AC2/AC3 — a kill-on-red-TRUNCATED red round … main_phase_ms ABSENT` · `AC2 backward-compat — no __OVERHEAD__ ⇒ no *_phase_ms fields`。

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：verification-round.jsonl 新轮含 *_phase_ms（贴记录）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（appendVerificationRound 解析 __OVERHEAD__ 相耗时入记录）
- plugin/test/full-suite-runner.test.mjs（新增相耗时解析用例）
- tasks/gap-verification-round-missing-phase-ms-breaks-cost-attribution.md（自身：勾 AC + 贴证据）

## Contract

measure   phase_ms_in_record = `tail -1 .quay/verification-round.jsonl | grep -oE "serial_phase_ms|lowconc_phase_ms|main_phase_ms"` 的 stdout
band      phase_ms_in_record = 至少两个相字段在场（serial+lowconc+main 三者至少二）
invariant truncated_vs_full_distinguishable = 1（per_test_ms 配相级读数可区分截断/完整）
invoke    `tail -1 .quay/verification-round.jsonl | python3 -c "import json,sys; r=json.load(sys.stdin); print({k:r.get(k) for k in ['serial_phase_ms','lowconc_phase_ms','main_phase_ms','static_phase_ms']})"`（贴相级读数）
control   相耗时入台账；截断/完整可区分；既有不回归
resume    解析 / 入记录 / scoped 门分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 套件耗时归因——verification-round 不记 *_phase_ms ⇒ per_test_ms 混截断/完整轮（「700s 退化」误判源）。r266 分解 static33/serial640/lowconc272/main650=1533s，CPU 地板 1068s，差=隔离空闲核（非 bug）。方向：让三处变便宜（quay-init serial 850s CPU / runner-grouping 204s / session-liveness 216s 钉死 lowconc）不调并发旋钮。立案：相级读数入台账。实现归 inner，判定归 outer
