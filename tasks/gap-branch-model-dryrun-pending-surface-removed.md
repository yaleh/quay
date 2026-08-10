---
id: gap-branch-model-dryrun-pending-surface-removed
title: verified-commit 修复(d666a79e)删除 integration-batch-merge.sh 的 `pending on
  integration:` dry-run 输出块⇒branch-model.test.mjs AC3 断言失败(round-212 红 + solo
  320ms 真回归非 flake)——活锁修复引入的契约破坏,scoped 盲区(basename 配对选不出);恢复输出段或同步断言
status: done
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**inner 的 verified-commit 修复（d666a79e，gap-merge-green-snapshot-verified-commit-livelock）删掉了 `integration-batch-merge.sh` 的 `pending on integration:` 输出块——branch-model.test.mjs AC3 断言该行存在，dry-run 输出形状变了 ⇒ 全量套件必红（round-212），solo 也红（1 fail / 8 pass，320ms 断言失败）。这是活锁修复引入的真实回归，不是 flake。**

### 实证（outer 2026-08-10 01:40 红窗分诊）

- **round-212 early-red**：唯一失败 = `branch-model.test.mjs` AC3 `--dry-run reports ff-ability and the pending surface WITHOUT moving any ref`（7.1s）。
- **solo 复现**：9 tests → 8 pass / 1 fail（320ms）。**真回归非 flake**。
- **失败断言**：`assert.match(r.stdout, /pending on integration:/)` 失败。实际输出：`measure unmerged_develop_files=0 / freshness-gate SKIPPED / DRY-RUN (no ref moved) / develop=... integration=...`——**无 `pending on integration:` 行**。
- **根因**：`git show d666a79e` 确认——verified-commit 重构删除了 `-    echo "integration-batch-merge: pending on integration:"`（连同其后列 pending commits 的循环）。当前脚本 `grep -n "pending on integration"` **0 命中**。
- **scoped 盲区**：gap-merge-green-snapshot-verified-commit-livelock 的 scoped 门（`--for-task`）没跑 branch-model.test.mjs——Touches 未含该文件，basename 配对选不出（integration-batch-merge.sh 无同 basename 测试）。正是 manager Q2 的「跨文件耦合 basename 配对选不出」类。
- **测试文件未变**：branch-model.test.mjs 最后改动 bb769453（freshness gate），非本次变更——是 merge 脚本输出契约被改。

**为什么重要**：这是「修活锁却破坏既有契约」的实例——verified-commit 是正确修复，但删 dry-run 的 `pending on integration:` 输出段是无关重构（该段与 verified-commit 逻辑无关，是 dry-run 报告面）。应恢复该输出段（或更新 AC3 断言）——契约一致性优先于报告面重构。

### 选定机制方向（实现归内层，接法留执行时）

1. **恢复 `pending on integration:` 输出段**：integration-batch-merge.sh dry-run 恢复该段（列出 pending commits），或明确更新为新的输出形状并同步 AC3 断言——二者取一，契约一致。
2. **回归验证**：branch-model.test.mjs 9/9 solo 绿；scoped 门绿。

**验证锚**：修后 (a) branch-model.test.mjs solo 9/9 绿；(b) dry-run 输出含 pending surface（或 AC3 断言更新为新形状）；(c) verified-commit 逻辑不回归。

## Acceptance Criteria

- [x] AC1:- [x] AC1: **复现固化**——任务体记录 round-212 + solo 复现 + 失败断言 + d666a79e 删除行（本任务 Proposal 已含）
- [x] AC2: **契约恢复**——`pending on integration:` 输出段恢复（或 AC3 断言同步新形状），branch-model.test.mjs 9/9 绿
- [x] AC3: **verified-commit 不回归**——MERGE-TO-VERIFIED-COMMIT 逻辑保持
- [x] AC4: **scoped 盲区标注**——与 Q2 跨文件耦合同族（basename 配对选不出），可衔接 pool-quality-gate / CROSSCUT
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：branch-model.test.mjs 9/9 solo 绿（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/integration-batch-merge.sh（恢复 `pending on integration:` 输出段，或同步 AC3 断言）
- plugin/test/branch-model.test.mjs（AC2 验证 / 断言更新）
- tasks/gap-merge-green-snapshot-verified-commit-livelock.md（交叉标注——回归源）
- tasks/gap-crosscut-checks-zero-coverage-of-plugin-scripts.md（交叉标注——scoped 盲区族）
- tasks/gap-pool-quality-semantic-gate.md（交叉标注——Q2 跨文件耦合）
- tasks/gap-branch-model-dryrun-pending-surface-removed.md（自身：勾 AC + 贴证据）

## Contract

measure   branch_model_solo_pass = `node --no-warnings --experimental-strip-types --test plugin/test/branch-model.test.mjs 2>&1 | grep -c '^ℹ pass 9'` 的 stdout 数字
band      branch_model_solo_pass = 1（9/9 solo 绿）
invariant verified_commit_logic_preserved = 1（MERGE-TO-VERIFIED-COMMIT 不回归）
invariant dry_run_contract_consistent = 1（输出含 pending surface 或断言同步）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/branch-model.test.mjs`（solo 贴回）+ `bash plugin/scripts/integration-batch-merge.sh --develop develop --integration integration --dry-run`（输出形状贴回）
control   branch-model 9/9 绿；verified-commit 不回归；dry-run 契约一致
resume    输出段恢复 / 断言同步分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: round-212 红分诊——branch-model AC3 solo 复现失败（320ms,断言 /pending on integration:/ 不匹配）⇒ d666a79e（verified-commit 修复）删除 dry-run 的 pending on integration 输出段,契约破坏。真回归非 flake。修:恢复输出段或同步断言。实现归内层

## Evidence（内层实现 2026-08-10）

**AC2 契约恢复**：integration-batch-merge.sh dry-run 恢复 `pending on integration:` 标签（
merge surface `${develop_ref}..${merge_target}` 详情并入下一行 `  (merge surface ...)`），
FF-OK 行保留 verified-commit 上下文（"ancestor of the merge target ${merge_target}"）。
branch-model.test.mjs **9/9 solo 绿**（AC3 `/pending on integration:/` 断言恢复命中）。

**AC3 verified-commit 不回归**：只改输出标签，MERGE-TO-VERIFIED-COMMIT 逻辑（merge_target 解析、
deferred 报告、object-gate 对 merge_target）零改动——`merge_uses_verified` 路径不变。

**AC4 scoped 盲区标注**：本回归经 round-212 全量才浮现，scoped 门（`--for-task`）因 basename 配对
选不出 branch-model.test.mjs（integration-batch-merge.sh 无同 basename 测试）——正是 manager Q2
「跨文件耦合 basename 配对选不出」类，衔接 pool-quality-gate / CROSSCUT 讨论。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-branch-model-dryrun-pending-surface-removed --allow-thin`
→ exit 0（branch-model 9/9 入 scoped 选择）。
