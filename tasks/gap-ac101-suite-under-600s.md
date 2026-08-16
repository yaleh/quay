---
id: gap-ac101-suite-under-600s
title: "AC101: suite 在 main 相 lane=8 下总耗时 ≤600s（人设定 600s；先造反事实对照轮再优化）"
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

## 对照轮记录（2026-08-16 17:0xZ）

**⛔ 第 1 轮（startedAt 16:51:19，lane=8）只能当基线记录，不是反事实对照轮**（inner 直接量确认）：
- worktree 分支含 quoted-path（968cc1a8）+ AC99（505dd16d）两个**非本任务**提交（全量静态闸前置并入）
  ⇒ 测的代码 = develop + quoted-path 修复 + AC99 修复，非「同提交干净对照」
- 同时 5 worktree 并发在飞（并发场景，非「无并发 scope churn 窗口」）
- **⇒ 对照需重跑**：等其余任务收尾后，在无并发窗口跑一轮同提交 lane=8 全量，两轮 phase 级对比。
- **任务隔离破坏**：quoted-path + AC99 改动并入 AC101 worktree 是污染源——两修复已在各自任务路径上
  （quoted-path fan-in 在跑、AC99 Touches 已在主检出修），AC101 worktree 内副本冗余且污染对照。

## Touches

**收窄说明（manager 2026-08-16 16:5xZ 裁定）**：⛔ 不使用目录级条目（`plugin/scripts/*` / `packages/quay/src/`）
——目录级是展开+不对称自锁语义，会挡住本阶段所有 UI 任务（serve-handlers 单点 + AC99 的 5 个 plugin 文件），
使「人明令 suite 与 UI 并行」在派发层结构上不可能。**真实改动对象 = 对照测量与优化落点**，对照轮跑完前
「main 相砍时长对象在 packages/quay/src/」是未证实猜测，⛔ 不得用未证实可能性锁住 src 目录。等对照轮真因
确定后，按实际落点补具体文件条目。

- scripts/test.sh（suite 分相结构——static/serial/lowconc/main 的 lane 与时长控制）
- plugin/test/full-suite-runner.test.mjs（资源闸自测 fixture——serial/lowconc 翻倍候选真因，先对照再改）
- plugin/test/trend-check.test.mjs（同上，资源闸自测 fixture）
- plugin/test/checker-cost.test.mjs（同上，资源闸自测 fixture）
- tasks/gap-ac101-suite-under-600s.md（自身）
