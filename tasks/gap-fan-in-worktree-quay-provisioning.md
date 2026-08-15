---
id: gap-fan-in-worktree-quay-provisioning
title: fan-in 全量 suite 在 worktree 跑时读 worktree 陈旧/缺失 .quay（config/gates/运行时载体）⇒ 环境性红——provisioning 时复制主检出现行 .quay（gap-gitignored-carriers 同族病的另一半）
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

**（outer 2026-08-15 06:0xZ 隔离对照定案：ruled-gap fan-in 首次全量 suite 红 72 fail = 环境性，非改动。根因 = fan-in worktree 的 .quay 陈旧/缺失。归 inner C17。）**。

**现象**：ruled-gap fan-in 的全量 suite（worktree 内 `scripts/test.sh`）红 72 fail，22 个失败文件全是 gate/telemetry/resource 系（M63 ts-typecheck / blocked-signal / cap-from-gate / monitor-mount / run-identity 等）——**全部在主检出上通过**（outer 逐个实跑：M63 5/5、slot-visibility 8/8、blocked-signal-param 27/27、cap-from-gate-cli 4/4、run-identity 27/27）。改动自身测试绿（fan-in-workflow-check.test.mjs 不在失败文件里）。

**根因（gap-gitignored-carriers 同族病的另一半）**：carriers（QUAY_MAIN_CHECKOUT）修的是**检查器读主检出**；但**全量 suite 在 worktree 里跑时，测试自己读 worktree 的陈旧/缺失 .quay**——worktree .quay/config.yml 旧拷贝（缺 ts-typecheck gate 在 `gate --list`，M63 报 got=[dod,acceptance,doc-quay-directive-skill] 无 ts-typecheck）、运行时载体缺失（fan-in-merge-lock-events / gate-events / .workflow-events 等）。

**修法（供 inner 选，同 carriers 三候选）**：
① fan-in worktree provisioning 时把主检出现行 `.quay/` **只读复制**进 worktree（快照，gitignored，suite 跑一次即够）；
② `scripts/test.sh` 在 `QUAY_MAIN_CHECKOUT` 设置时让 suite 从主检出解析 `.quay/`（config/gates/运行时载体）；
③ 判据改由 worktree 内可得量承载。
**⛔ 不可接受第四条：把环境性红当合格 / landing over known-red。**

**判据1**：fan-in worktree 跑全量 suite 时，读到的 `.quay/`（config/gates/运行时载体）与主检出一致（陈旧/缺失不再造成环境性红）。
**判据2（能取假）**：ruled-gap（或任一 code-delta 任务）fan-in 全量 suite 绿——修复前 72 fail 环境性红，修复后同 suite 在主检出/修后 worktree 都绿。M63 ts-typecheck gate 在 `gate --list` 出现。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**不覆盖**：不改 ruled-gap 豁免表（本身正确）；不改 carriers QUAY_MAIN_CHECKOUT 检查器接线（互补非替代）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 full-suite-runner.ts provisioning（one-shot worktree 创建 + QUAY_MAIN_CHECKOUT 接线）+ scripts/test.sh 的 config/gates 解析。
2. 选修法（① 复制 .quay / ② QUAY_MAIN_CHECKOUT 解析 / ③ worktree 内量）——按实现代价 + 覆盖。
3. 判据2 能取假：ruled-gap 或代表 code-delta fan-in 全量 suite 绿；M63 gate --list 含 ts-typecheck。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：fan-in worktree 全量 suite 读到的 .quay 与主检出一致。
- [ ] AC2 判据2 能取假：修复前 72 fail 环境性红 → 修复后同 suite 绿；M63 gate --list 含 ts-typecheck。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] fan-in worktree .quay provisioning（config/gates/运行时载体与主检出一致）+ 环境性红消除 + M63 等 gate 系测试绿 + 测试绿。

## Touches

- plugin/scripts/full-suite-runner.ts（provisioning 时复制/解析主检出 .quay——inner 实现面）
- scripts/test.sh（若选修法②——QUAY_MAIN_CHECKOUT 解析 .quay）
- plugin/test/（对应测试：worktree suite 读主检出 .quay）
- tasks/gap-fan-in-worktree-quay-provisioning.md（自身）

## Evidence

（落地后回填——ruled-gap fan-in 全量 suite 72 fail 环境性红（22 失败文件全主检出通过）；worktree .quay config.yml 旧拷贝缺 ts-typecheck gate）
