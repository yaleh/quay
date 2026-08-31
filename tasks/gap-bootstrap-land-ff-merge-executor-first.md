---
id: gap-bootstrap-land-ff-merge-executor-first
title: 落地 fan-in ff 步 executor-first（ff-merge.ts + worker-driver.ts ff 步 import，⛔ 不删 bash）——解 gap-execution-loop bootstrap 死锁
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`gap-execution-loop-productization-p2-p4` 的 P2（fan-in ff 步 TS 化）陷入 bootstrap 死锁：机械 fan-in 执行器 `spawnMechanicalFanIn`（worker-driver.ts:2454）读【主检出】worker-driver.ts（⛔ 不用 worktree 的，注释明写），而主检出 :2209 仍是旧 `ffMerge = fan-in-ff-merge.sh`；任务分支已迁 `ffMergeModule`（:1730）+ 删 fan-in-ff-merge.sh + 加 ff-merge.ts ⇒ 执行器读旧 ff 步 shell `bash fan-in-ff-merge.sh` → exit 127（`No such file`）。**落地需新执行器、新执行器需先落地**——死锁。

本任务落**执行器半边**（executor-first）：把 ff-merge.ts + worker-driver.ts 的 ff 步 import 改动落地 develop，**⛔ 不删 fan-in-ff-merge.sh**（bash 删除随 gap-execution-loop 后续 fan-in 再做）。

**源**：ff-merge.ts 与 ff 步改动已在 `task/gap-execution-loop-productization-p2-p4` 分支（实现完成、`fan-in-ff-merge.test.mjs` 绿）。实现方取该分支的文件：`git show task/gap-execution-loop-productization-p2-p4:packages/quay/src/fan-in/ff-merge.ts`、`...:plugin/test/fan-in-ff-merge.test.mjs`，worker-driver.ts 的 ff 步改动照该分支 diff 取（只取 ff 步 import 部分，⛔ 不取 fan-in-ff-merge.sh 删除）。⛔ 不重写实现（已有、已验证）。

落地后（fan-in 到 develop）由 manager 做 ②主检出同步 ③重启 worker-driver ④重派 gap-execution-loop——本任务只落执行器半边。

## Plan

1. 从 task/gap-execution-loop-productization-p2-p4 分支取 `packages/quay/src/fan-in/ff-merge.ts` + `plugin/test/fan-in-ff-merge.test.mjs` 落本分支。
2. worker-driver.ts ff 步 import 改动：`ffMerge = fan-in-ff-merge.sh` → 用 `ffMergeModule`（ff-merge.ts），照 gap-execution-loop 分支 diff 取 ff 步部分。⛔ 保留 fan-in-ff-merge.sh（`git checkout develop -- plugin/scripts/fan-in-ff-merge.sh` 确保未删）。
3. fan-in（merge develop → suite → ff）：suite 绿（含 fan-in-ff-merge.test.mjs）。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：develop 上 worker-driver.ts ff 步不再 shell `bash fan-in-ff-merge.sh`——grep 主检出 worker-driver.ts 无 `ffMerge = .*fan-in-ff-merge\.sh` 的 ff 步调用，改为 ff-merge.ts 模块；（⛔ 仍 shell bash ⇒ 假）。（待外部）
- [ ] AC2（能取假，bash 保留）：fan-in-ff-merge.sh 仍在 develop（未删）——`git show develop:plugin/scripts/fan-in-ff-merge.sh` 存在；（⛔ 已删 ⇒ 假）。（待外部）
- [ ] AC3（能取假，自举验证）：一次真实 fan-in 经新 ff 步（ff-merge.ts）落地本任务自身；（⛔ 仍需旧 bash ⇒ 假）。（待外部）

## Definition of Done

executor-first 落地 develop（ff 步走 ff-merge.ts、bash 保留）；AC1-AC3 全勾；全量 suite 绿；fan-in-ff-merge.test.mjs 绿。

## Touches

- packages/quay/src/fan-in/ff-merge.ts（从 gap-execution-loop 分支取，executor-first 落）
- plugin/scripts/worker-driver.ts（ff 步 import ff-merge.ts，⛔ 不删 bash）
- plugin/test/fan-in-ff-merge.test.mjs（从 gap-execution-loop 分支取）
- plugin/test/worker-driver.test.mjs（ff 步测试伴生：ffMergeModule 缝 + AC1 step 断言，从 gap-execution-loop 分支取）
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs（ff 步测试伴生：ffMergeModule 缝，从 gap-execution-loop 分支取）
- tasks/gap-bootstrap-land-ff-merge-executor-first.md（自身）
