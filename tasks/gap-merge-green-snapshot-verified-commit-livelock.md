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

- [x] AC1: **复现固化**——任务体记录实测（套件 1847s vs 提交间隔 147s、round-204 绿、50229970 代码文件 fail-closed 正确、绿快照无 verified commit）（本任务 Proposal 已含）
- [x] AC2: **绿快照记录 verified commit**——`full-suite-state.json` 加 `verifiedCommit`（runner 启动时记录 integration tip）；`verification-round.jsonl` round 加 `commit`
- [x] AC3: **批量合合已验证点**——`integration-batch-merge.sh` 支持「合 verifiedCommit 而非 HEAD」入口
- [x] AC4: **COVERAGE 判据不放松**——仍要求 `verifiedCommit >= 该点之后的 fan-in`（合的点本身被验证过即满足）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿；两线分支模型 invariant 保持

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
- tasks/gap-batch-merge-gate-reads-stale-green.md（交叉标注——相关但不同：那是 stale green 读旧快照，这是绿快照不记 commit）
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

## Evidence（内层实现 2026-08-10）

**AC2 — 绿快照记录 verified commit**

- `plugin/scripts/full-suite-runner.ts`:
  - 新增 `readVerifiedCommit(root)`：套件启动时 `git rev-parse HEAD`（被测 checkout 的 tip，主仓库即 integration tip）。非 git 临时根（hermetic 测试根）返回 undefined → 字段省略（AC1 exact-shape 测试在非 git 根保持字节稳定）。
  - `SuiteState` 增加 `verifiedCommit?: string`（run 启动时一次性记录，进 `base` 对象 → 每次 state 写都带）；`SuiteRoundRecord` 增加 `commit?: string`，`verification-round.jsonl` round 记录同样写 `commit: verifiedCommit`。
  - 形状：`full-suite-state.json` 加 `"verifiedCommit": "<40-hex-sha>"`（仅在 git checkout 下）；`verification-round.jsonl` 每行加 `"commit": "<40-hex-sha>"`（同一值）。SYNC BRIDGE（--state-dir 拆分的 worktree 镜像）继承同一 base → 镜像字节相同。

**AC3 — integration-batch-merge.sh 合到已验证点**

- 读 `<state-dir>/full-suite-state.json` 的 `verifiedCommit`；若是一个真实 commit 且是 integration 祖先（`merge-base --is-ancestor <vc> integration`），则 `merge_target=<vc>`（`merge_uses_verified=1`）；否则回退 `merge_target=integration_tip`（旧行为，向后兼容）。
- 合到 `merge_target` 而非 integration HEAD：FF 路径 `update-ref develop <merge_target>`；real-merge 路径在临时 worktree 里 `git merge <merge_target>`。COVERAGE 轴改为比较 `merge_target` 的 commit 时间（合的点被验证过 ⇒ 天然满足）；OBJECT GATE 改为校验 `merge_target ⊕ develop`（合结果 = 被测点 ⊕ develop）。
- dry-run 报告「merge target 在已验证点过 COVERAGE」+ 延后的新 fan-in 数；integration HEAD 有更新未测 commit 时 `measure integration_ff_merges=1`（未测的留在 integration 等下一个绿，不静默丢弃）。
- 向后兼容：无 verifiedCommit 的快照/state 文件缺失 → 行为与旧版逐字节一致（现有 34 个 merge 测试全绿）。

**AC4 — 判据不放松**

- 负面控制测试 `mtv3`：快照无 verifiedCommit + 套件启动后有代码文件 fan-in → COVERAGE 仍 fail-closed（`FRESHNESS-GATE FAIL-CLOSED`），nothing moved。合的点必须是被验证过的点，未验证点照旧拦截。

**测试结果（scoped 门，2026-08-10）**

- `bash scripts/test.sh --for-task gap-merge-green-snapshot-verified-commit-livelock --allow-thin`：**exit 0，tests 103，pass 103，fail 0，cancelled 0**。
- `plugin/test/full-suite-runner.test.mjs`（含 2 个新 AC2 测试）：63 全绿（新增：git-repo 记录 verifiedCommit+round commit；worktree 镜像带同一 verifiedCommit 字节相同）。
- `plugin/test/integration-batch-merge.test.mjs`（含 4 个新 MERGE-TO-VERIFIED-COMMIT 测试）：38 全绿（新增：合已验证点非 HEAD + COVERAGE 过；dry-run 报 COVERAGE 过+deferred；已合 no-op；无 verifiedCommit 负面控制仍拦截）。
- 附带修复：任务 Touches 中 `tasks/gap-batch-merge-reads-stale-green.md` → `tasks/gap-batch-merge-gate-reads-stale-green.md`（原名不存在，scoped strict-subset 会 ENOENT）。

**DoD 剩余**：全量套件绿（外层 verification-round 验证）未勾。

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 结构性根因立案（套件 1847s vs 提交间隔 147s——一轮落 ~12 条,代码文件必 fail COVERAGE ⇒ 活锁）。处方:批量合「已验证 commit」而非 HEAD。前置缺失:绿快照没记 verified commit(full-suite-state.json/verification-round.jsonl 均无),integration-batch-merge.sh 无合到指定 commit 入口。第一步补快照字段,第二步改合并入口。实现归内层
