---
id: gap-ac101-suite-under-600s
title: "AC101: suite 在 main 相 lane=8 下总耗时 ≤600s（人设定 600s；先造反事实对照轮再优化）"
status: todo
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

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` AC101。

**目标值 600s = 人逐字设定（输入，非自推导阈值）**。基线（round215，`.quay/verification-round.jsonl` 实读，
lane=8, nproc=16）：static 83s + serial 304s + lowconc 276s + main 349s = **1015s** ⇒ 需砍 ≈415s（41%）。

**成本分解（同 jsonl 历史 14 轮对照）**：
- serial/lowconc 历史上【一直 lane=8】，但 round215 各 304/276s vs 历史典型 110-170/107-181 ⇒ **翻倍，原因未定**
- main 相 lane 16→8 增长可由 lane 减半解释（154-239 → 349s）
- ⇒ 首要对象 = serial+lowconc 多出的 ≈290s；回落到典型后总计 ≈712s，**main 相还需砍 ≈112s**

**⚠️ 因果未证（标注假说，⛔ 不得按假说直接改）**：round215 起止紧邻两段 systemd-run scope 突发
（08:10-08:13Z ~112 次、08:28-08:31Z ~114 次，特征串 → full-suite-runner/trend-check/checker-cost 的资源闸
自测 fixture），时间吻合但无反事实对照轮。**本 AC 第一步动作 = 造对照**：无并发 scope churn 窗口跑一轮
同提交 lane=8 全量，两轮 phase 级耗时对比，才判该假说真假。⛔ 不得跳过对照直接按假说优化。

## Acceptance Criteria

- [ ] AC1: `.quay/verification-round.jsonl` 存在 ≥3 轮记录，满足 `laneCount==8` ∧ `state=="green"`
      ∧ `durationMs <= 600000`，且 `startedAt` 晚于立条时刻（2026-08-16T16:2xZ）——读生产载体非 fixture。
- [ ] AC2: 这 3 轮 `tests` 字段不得低于基线 **4951**（禁止砍覆盖换速度；低于基线即不计入且判作弊）。
- [ ] AC3: 优化手段落成代码/配置（可 `git log` 追溯的提交），⛔ 不接受"挑低负载时段跑一轮"充数。

## Definition of Done

- [ ] 3 轮 lane=8 全绿且 ≤600s、tests≥4951、优化可追溯；对照轮已跑并记录 serial/lowconc 翻倍真因。

## Touches

- scripts/test.sh（suite 耗时结构——static/serial/lowconc/main 分相）
- plugin/scripts/*（资源闸自测 fixture 若为串行+lowconc 翻倍真因——先对照再改）
- packages/quay/src/ + packages/quay/test/（若 main 相砍时长的对象在此）
- tasks/gap-ac101-suite-under-600s.md（自身）
