---
id: gap-merge-green-snapshot-verified-commit-livelock
title: 套件轮时长(1847s)与 integration 提交间隔(147s)差一个数量级⇒一轮落~12条、代码文件必 fail
  COVERAGE⇒活锁(绿追不上 HEAD)；处方=批量合「已验证 commit」非 HEAD；前置缺失=绿快照不记 verified
  commit(full-suite-state.json/verification-round.jsonl 均无)、merge 脚本无合到指定 commit
  入口
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**套件轮时长（~1847s≈30.8min）比 integration 提交间隔（中位 147s≈2.5min）高一个数量级——一轮跑批期间平均落 ~12 条新提交，只要一条碰代码文件，COVERAGE freshness 门就 fail-closed ⇒ 绿快照永远追不上 integration HEAD。这是结构性活锁，不是谁的失职。处方：批量合「绿快照验证过的那个 commit」而不是 integration HEAD；前置缺失：绿快照没记录自己验证的是哪个 commit。**

### 实证（manager 2026-08-10 核实 + outer 复核）

- **round-204/205 已绿**（155 测试 fail 0 cancelled 0，durationMs=1847334ms≈30.8min）——绿是真的。
- **判据正确**：COVERAGE 轴 `suite startedAt >= 最新 fan-in`，实测 `23:04:25 < 23:13:23`；`50229970` 改 `plugin/scripts/known-load-sensitive.ts`（**代码文件**，doc-only 豁免不适用），fail-closed 正确。
- **结构性根因（活锁）**：
  - 套件一轮 **1847.3s ≈ 30.8 min**（实测）。
  - integration 提交间隔中位 **147s ≈ 2.5 min**（6 小时 83 条，每小时 ~14 条，实测）。
  - ⇒ 一轮跑批期间平均落 **~12 条**新提交；只要一条碰代码文件，COVERAGE 失败。
  - 今晚 round-204 只落了 2 条（两层大多在等）就已挡住合并；**正常吞吐下绿快照永远追不上 integration**。
- **前置缺失（必须先补）**：
  - `full-suite-state.json` 字段只有 `state/runner/startedAt/laneCount/scope/runId/pid/systemdRun/finishedAt/durationMs`——**无 verified commit**。
  - `verification-round.jsonl` round 记录字段无 commit。
  - `integration-batch-merge.sh` 参数只有 `--integration <ref>`（分支名），**没有「合到指定已验证 commit」的入口**。
  - ⇒ 「合被验证过的点」无法机械执行。

**为什么重要**：这不是本次红窗的问题，是两层时间尺度差一个数量级导致的结构性活锁。今晚 round-204 只落 2 条就挡住；正常吞吐（~14 条/时）下每轮必被 COVERAGE 拦，④ 批量合永远无法执行，nyf 永远涨。四条既有处方（回滚肇事合并 / 连续3次非绿窄范围 cherry-pick / 并发不降改进 serial 组 / 红且无人处置查三步）**都不适用**——不是回归、不是闭锁、serial 组正在做、outer 全程在处置。

### 选定机制方向（实现归内层，接法留执行时）

1. **第一步（前置，一行数据）**：绿快照记录它验证的 commit——`full-suite-state.json` 加 `verifiedCommit` 字段（runner 在套件启动时记录 `git rev-parse integration` 的 tip）；`verification-round.jsonl` round 记录同样加 `commit` 字段。没有它，「合被验证过的点」无法机械执行。
2. **第二步（处方）**：`integration-batch-merge.sh` 增加「合到已验证 commit」入口——不是合 `integration` HEAD，而是合绿快照记录的 `verifiedCommit`。COVERAGE 轴自然满足（验证的就是那个点），**不需要静默窗、不需要缩短套件、不需要放宽任何判据**。
3. **回归验证**：改后 (a) 绿快照带 verifiedCommit；(b) 批量合能合到已验证点；(c) 既有判据不放松。

**验证锚**：修后 (a) `full-suite-state.json`/`verification-round.jsonl` 含 verified commit；(b) 批量合 dry-run 在「绿快照验证过的点」通过 COVERAGE（无需再重启套件测新 tip）；(c) 既有套件时长/提交间隔不变。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实测（套件 1847s vs 提交间隔 147s、round-204 绿、50229970 代码文件 fail-closed 正确、绿快照无 verified commit）（本任务 Proposal 已含）
- [ ] AC2: **绿快照记录 verified commit**——`full-suite-state.json` 加 `verifiedCommit`（runner 启动时记录 integration tip）；`verification-round.jsonl` round 加 `commit`
- [ ] AC3: **批量合合已验证点**——`integration-batch-merge.sh` 支持「合 verifiedCommit 而非 HEAD」入口
- [ ] AC4: **COVERAGE 判据不放松**——仍要求 `verifiedCommit >= 该点之后的 fan-in`（合的点本身被验证过即满足）
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿；两线分支模型 invariant 保持

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：绿快照带 verifiedCommit（贴任务体）；批量合 dry-run 在已验证点过 COVERAGE
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（套件启动时记录 verifiedCommit 进 full-suite-state.json）
- plugin/scripts/verification-round.ts 或等价（verification-round.jsonl round 加 commit 字段）
- plugin/scripts/integration-batch-merge.sh（「合到已验证 commit」入口，非 HEAD）
- plugin/test/full-suite-runner.test.mjs（AC2 新增测试）
- plugin/test/integration-batch-merge.test.mjs（AC3 新增测试）
- tasks/gap-batch-merge-reads-stale-green.md（交叉标注——相关但不同：那是 stale green 读旧快照，这是绿快照不记 commit）
- tasks/gap-green-verdict-never-expires-411-minutes-and-187-commits-later-still-green.md（交叉标注——绿判据时效族）
- tasks/gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge.md（交叉标注——门判据单源族）
- tasks/gap-merge-green-snapshot-verified-commit-livelock.md（自身：勾 AC + 贴证据）

## Contract

measure   verified_commit_recorded = `python3 -c "import json;d=json.load(open('.quay/full-suite-state.json'));print(bool(d.get('verifiedCommit')))"` 的 stdout
band      verified_commit_recorded = True（绿快照带 verifiedCommit）
invariant coverage_criterion_not_loosened = 1（合的点仍被验证过，判据不放松）
invariant branch_model_invariant_kept = 1（is-ancestor develop integration = TRUE 保持）
invoke    `bash plugin/scripts/integration-batch-merge.sh --develop develop --integration integration --dry-run`（已验证点过 COVERAGE）
control   绿快照带 verifiedCommit；批量合过 COVERAGE；既有判据不放松
resume    快照加字段 / 合并入口分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 结构性根因立案（套件 1847s vs 提交间隔 147s——一轮落 ~12 条,代码文件必 fail COVERAGE ⇒ 活锁）。处方:批量合「已验证 commit」而非 HEAD。前置缺失:绿快照没记 verified commit(full-suite-state.json/verification-round.jsonl 均无),integration-batch-merge.sh 无合到指定 commit 入口。第一步补快照字段,第二步改合并入口。实现归内层
